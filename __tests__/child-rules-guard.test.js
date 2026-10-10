// __tests__/child-rules-guard.test.js
// B 守卫：把「本地兜底层 ↔ 云端 childCRUD」的**宝宝档案校验规则**焊死，
// 消除原本完全无守卫的盲区（候选 B：petView 已由 mirror-guard ② 覆盖，本文件专攻 childCRUD）。
//
// 两类断言：
//   ① 纯逻辑守卫（vm 提取 + 桩 fail）：常量口径 / childView 形状 / normalizeBirthday /
//      extractProfileFields(云端)↔extractChildProfile(本地) 行为一致。
//   ② 集成行为守卫：本地 childCRUD 真跑 + 云端 exports.main 在单 vm 上下文真跑（同域注入模块级
//      常量与辅助函数，避免 require wx-server-sdk），同一组输入断言校验结果（code+message）与
//      childView 输出形状一致。
//
// 串行执行：本文件所有用例共享模块级 global.wx store 与 cloudChildren，故包进单个父测试、
// 用 await t.test() 顺序执行，避免 Node 默认并发导致的状态竞态。
//
// 零运行时风险：纯新增测试文件，不改动任何被测代码。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const keysOf = (o) => Object.keys(o).sort();

// ---------- 字面量/函数提取（与 mirror-guard / view-shape-guard 同思路） ----------
function matchBrace(src, openIdx) {
  let depth = 0, inStr = null, esc = false, lineC = false, blockC = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && src[i + 1] === '/') { blockC = false; i++; } continue; }
    if (esc) { esc = false; continue; }
    if (inStr) { if (ch === '\\') { esc = true; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && src[i + 1] === '/') { lineC = true; i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('未匹配到右括号');
}

// 返回完整具名函数文本 `function NAME(params) { BODY }`（括号感知，正确处理解构参数）
function functionBlock(src, fnName) {
  const sig = (src.includes('async function ' + fnName) ? 'async function ' : 'function ') + fnName;
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('找不到函数: ' + fnName);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) break; }
  }
  const b = src.indexOf('{', i);
  return src.slice(start, matchBrace(src, b) + 1);
}

function arrowBlock(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const i = src.indexOf('=>', a);
  const b = src.indexOf('{', i);
  return src.slice(b, matchBrace(src, b) + 1);
}

function evalInContext(code, sandbox) { return vm.runInNewContext(code, sandbox); }
function evalFn(whole, sandbox) { return vm.runInNewContext('(' + whole + ')', sandbox); }

// ---------- 本地层 wx.storage mock（供 real require 本地 childCRUD） ----------
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};
const local = require('../miniprogram/services/local');

// ---------- 云端 childCRUD 的 vm 单上下文编译 ----------
// 关键：云端 main 依赖模块级常量（MAX_CHILDREN/NAME_MAX/ALLERGENS_MAX/GENDERS）与辅助函数
// （normalizeBirthday/extractProfileFields/childView）。若在独立 vm 里只跑 main 体，这些符号
// 全部缺失。故把所有符号放进同一个 sandbox 上下文一次性编译，函数间互相引用自然闭环。
const cloudChildren = [];      // 内存版 children 集合（与本地 store 对应）
let seq = 0;

function makeChildrenColl() {
  const coll = {
    where() { return coll; },
    orderBy() { return coll; },
    limit() { return coll; },
    async get() { return { data: cloudChildren.slice() }; },
    doc(id) {
      return {
        async get() { const c = cloudChildren.find(x => x._id === id) || null; return { data: c }; },
        async update(patch) { const c = cloudChildren.find(x => x._id === id); if (c) Object.assign(c, patch.data); return {}; }
      };
    },
    async add({ data }) { const id = 'c_' + (++seq); const doc = Object.assign({ _id: id }, data); cloudChildren.push(doc); return { _id: id }; }
  };
  return coll;
}
const dbMock = {
  collection(name) {
    if (name === 'children') return makeChildrenColl();
    return {
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
      get() { return Promise.resolve({ data: [] }); },
      doc() { return { get() { return Promise.resolve({ data: null }); }, update() { return Promise.resolve({}); } }; },
      add() { return Promise.resolve({ _id: 'x' }); }
    };
  }
};
const cloudMock = { getWXContext: () => ({ OPENID: 'o1' }) };
const okStub = (o) => ({ ok: true, ...(o || {}) });
const failStub = (code, message) => ({ ok: false, code, message: message || code });

function compileCloudMain() {
  const src = read('cloudfunctions/childCRUD/index.js');
  const sandbox = {
    String, Number, Date, Object, Math, Array, Promise, RegExp, console,
    ok: okStub, fail: failStub,
    cloud: cloudMock, db: dbMock,
    getUserByOpenid: () => Promise.resolve({ _id: 'u1' }),
    verifyToken: () => true,
    MAX_CHILDREN: 6, NAME_MAX: 12, ALLERGENS_MAX: 50, GENDERS: ['', 'boy', 'girl']
  };
  const script = `
    ${functionBlock(src, 'normalizeBirthday')}
    ${functionBlock(src, 'extractProfileFields')}
    ${functionBlock(src, 'childView')}
    // 候选 A 收敛进 runtime 的两原语（与 cloudfunctions/lib/runtime.js 同语义）：
    // 在 vm 上下文内定义，才能访问下方 sandbox 注入的 cloud/getUserByOpenid/verifyToken/fail。
    const resolveCaller = async (event) => {
      const { OPENID } = cloud.getWXContext();
      if (!OPENID) return { fail: fail('AUTH_FAIL', '缺少 openid') };
      const user = await getUserByOpenid(OPENID);
      if (!user) return { fail: fail('AUTH_FAIL', '未登录') };
      return { OPENID, user };
    };
    const assertToken = (event, OPENID) => {
      if (!verifyToken(event.parentToken, OPENID)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
      return null;
    };
    const main = async (event) => ${arrowBlock(src, 'exports.main = async (event) =>')};
    ({ main });
  `;
  return evalInContext(script, sandbox).main;
}
const runCloud = compileCloudMain();

// ---------- 测试夹具 ----------
async function localReady() {
  await local.resetAll();
  await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  return token;
}
function cloudReady() { cloudChildren.length = 0; }

// login({}) 会种下一个默认宝宝，故本地 store 非空。该 helper 把本地当前孩子（同 _id）同步进
// 云端 mock，并覆盖 ownerId 为云端桩用户 'u1'（与 runCloud 的 getUserByOpenid 桩一致），使两端
// 初始状态一致，便于后续以相同 childId 做 update/delete 对比（云端会校验 ownerId）。
async function seedCloudFromLocalChildren() {
  const list = await local.childCRUD({ op: 'list' });
  cloudChildren.length = 0;
  cloudChildren.push(...list.children.map(c => Object.assign({}, c, { ownerId: 'u1' })));
}

const CHILD_VIEW_KEYS = ['_id', 'name', 'avatar', 'photo', 'gender', 'birthday', 'allergens'].sort();

function compareChildValues(a, b, label) {
  assert.deepStrictEqual(keysOf(a).sort(), CHILD_VIEW_KEYS, label + '：childView 键集漂移');
  for (const k of keysOf(a)) {
    if (k === '_id' || k === 'createdAt') continue; // 生成主键 / 时间戳不跨端比较
    assert.strictEqual(a[k], b[k], `${label}：child.${k} 双端不一致 (${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])})`);
  }
}
function compareFail(a, b, label) {
  assert.strictEqual(a.ok, false, label + '：期望失败但本地返回成功');
  assert.strictEqual(b.ok, false, label + '：期望失败但云端返回成功');
  assert.strictEqual(a.code, b.code, label + '：失败 code 双端不一致');
  assert.strictEqual(a.message, b.message, label + '：失败 message 双端不一致');
}

// ============ 串行父测试 ============
test('childCRUD 双端档案校验守卫（串行，避免共享 store 竞态）', async (t) => {

  // ① 常量口径守卫
  await t.test('① childCRUD 常量口径 本地↔云端 一致（NAME / ALLERGENS / MAX / GENDERS）', () => {
    const localSrc = read('miniprogram/services/local/child.js');
    const cloudSrc = read('cloudfunctions/childCRUD/index.js');
    const pick = (src, name) => {
      const i = src.indexOf('const ' + name + ' ');
      const j = src.indexOf('=', i);
      const k = src.indexOf(';', j);
      return vm.runInNewContext('(' + src.slice(j + 1, k).trim() + ')', {});
    };
    assert.strictEqual(pick(localSrc, 'NAME_MAX_CHILD'), pick(cloudSrc, 'NAME_MAX'), '昵称上限不一致');
    assert.strictEqual(pick(localSrc, 'ALLERGENS_MAX'), pick(cloudSrc, 'ALLERGENS_MAX'), '过敏原上限不一致');
    assert.strictEqual(pick(localSrc, 'MAX_CHILDREN'), pick(cloudSrc, 'MAX_CHILDREN'), '宝宝上限不一致');
    assert.deepEqual(pick(localSrc, 'GENDERS'), pick(cloudSrc, 'GENDERS'), '性别枚举不一致');
  });

  // ② childView 形状守卫
  await t.test('② childView 输出形状 本地↔云端 一致', () => {
    const sample = { _id: 'c1', ownerId: 'u1', name: '小明', avatar: '🧒', photo: 'p.png', gender: 'boy', birthday: '2018-06-15', allergens: '花生', deleted: false };
    const localView = evalFn(functionBlock(read('miniprogram/services/local/child.js'), 'childView'), {})(sample);
    const cloudView = evalFn(functionBlock(read('cloudfunctions/childCRUD/index.js'), 'childView'), {})(sample);
    assert.deepEqual(localView, cloudView, '双端 childView 输出不一致');
    assert.deepStrictEqual(keysOf(localView).sort(), CHILD_VIEW_KEYS, 'childView 键集漂移');
  });

  // ③ normalizeBirthday 行为守卫
  await t.test('③ normalizeBirthday 行为 本地↔云端 一致（含真实日期校验）', () => {
    const localF = evalFn(functionBlock(read('miniprogram/services/local/child.js'), 'normalizeBirthday'), {});
    const cloudF = evalFn(functionBlock(read('cloudfunctions/childCRUD/index.js'), 'normalizeBirthday'), {});
    const cases = ['', '2020-01-01', '2020-02-29', '2020-12-31', '2021-02-28', '2020-13-01', '2020-02-30', '2019-02-29', '2020-1-1', '20200101', 'abc'];
    for (const c of cases) {
      assert.strictEqual(localF(c), cloudF(c), `生日校验不一致: ${JSON.stringify(c)}`);
    }
  });

  // ④ extractProfileFields(云端)↔extractChildProfile(本地) 行为守卫
  await t.test('④ 档案字段提取校验 本地↔云端 一致', () => {
    const failStubLocal = (code, message) => ({ code, message: message || code });
    const GENDERS = ['', 'boy', 'girl'];
    const ALLERGENS_MAX = 50;
    const localNb = evalFn(functionBlock(read('miniprogram/services/local/child.js'), 'normalizeBirthday'), {});
    const cloudNb = evalFn(functionBlock(read('cloudfunctions/childCRUD/index.js'), 'normalizeBirthday'), {});
    const localExtract = evalFn(functionBlock(read('miniprogram/services/local/child.js'), 'extractChildProfile'),
      { fail: failStubLocal, GENDERS, ALLERGENS_MAX, normalizeBirthday: localNb });
    const cloudExtract = evalFn(functionBlock(read('cloudfunctions/childCRUD/index.js'), 'extractProfileFields'),
      { fail: failStubLocal, GENDERS, ALLERGENS_MAX, normalizeBirthday: cloudNb });

    const cases = [
      { p: { gender: 'boy', birthday: '2020-02-29', allergens: '花生' }, patch: { gender: 'boy', birthday: '2020-02-29', allergens: '花生' } },
      { p: { gender: 'x' }, error: 'INVALID' },
      { p: { birthday: '2020-13-01' }, error: 'INVALID' },
      { p: { birthday: '2020-02-30' }, error: 'INVALID' },
      { p: { allergens: 'a'.repeat(51) }, error: 'INVALID' },
      { p: { allergens: 'a'.repeat(50) }, patch: { allergens: 'a'.repeat(50) } },
      { p: {}, patch: {} },
      { p: { gender: '', birthday: '', allergens: '' }, patch: { gender: '', birthday: '', allergens: '' } }
    ];
    for (const c of cases) {
      const l = localExtract(c.p);
      const r = cloudExtract(c.p);
      if (c.error) {
        assert.strictEqual(l.error && l.error.code, c.error, '本地档案提取未按预期报错: ' + JSON.stringify(c.p));
        assert.strictEqual(r.error && r.error.code, c.error, '云端档案提取未按预期报错: ' + JSON.stringify(c.p));
      } else {
        assert.deepEqual(l.patch, c.patch, '本地档案提取 patch 漂移: ' + JSON.stringify(c.p));
        assert.deepEqual(r.patch, c.patch, '云端档案提取 patch 漂移: ' + JSON.stringify(c.p));
      }
    }
  });

  // ⑤ 集成：create 成功 + 输出形状
  await t.test('⑤ childCRUD create 成功 本地↔云端 输出形状一致', async () => {
    const token = await localReady();
    await seedCloudFromLocalChildren(); // 同步默认宝宝（同 _id）到云端
    const p = { name: '小红', avatar: '🐯', gender: 'girl', birthday: '2020-02-29', allergens: '鸡蛋', photo: 'ph.png' };
    const lRes = await local.childCRUD({ op: 'create', parentToken: token, payload: p });
    const cRes = await runCloud({ op: 'create', parentToken: 'any', payload: p });
    assert.strictEqual(lRes.ok, true, '本地 create 应成功，实际: ' + JSON.stringify(lRes));
    assert.strictEqual(cRes.ok, true, '云端 create 应成功，实际: ' + JSON.stringify(cRes));
    compareChildValues(lRes.child, cRes.child, 'create');
  });

  // ⑥ 集成：create 校验失败
  await t.test('⑥ childCRUD create 校验失败 本地↔云端 一致', async () => {
    const bad = [
      { name: '' }, { name: 'x'.repeat(13) }, { gender: 'x' }, { birthday: '2020-13-01' }, { allergens: 'x'.repeat(51) }
    ];
    for (const payload of bad) {
      const token = await localReady();
      await seedCloudFromLocalChildren();
      const lRes = await local.childCRUD({ op: 'create', parentToken: token, payload });
      const cRes = await runCloud({ op: 'create', parentToken: 'any', payload });
      compareFail(lRes, cRes, 'create ' + JSON.stringify(payload));
    }
  });

  // ⑦ 集成：update 成功 + 校验失败
  await t.test('⑦ childCRUD update 本地↔云端 一致（成功 + 校验失败）', async () => {
    const token = await localReady();
    const created = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '小明', avatar: '🧒', gender: 'boy' } });
    const childId = created.child._id;
    await seedCloudFromLocalChildren(); // 默认 + 小明（同 _id）同步到云端
    const lRes = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { name: '大明', photo: 'new.png' } });
    const cRes = await runCloud({ op: 'update', childId, parentToken: 'any', payload: { name: '大明', photo: 'new.png' } });
    assert.strictEqual(lRes.ok, true, '本地 update 应成功'); assert.strictEqual(cRes.ok, true, '云端 update 应成功');
    compareChildValues(lRes.child, cRes.child, 'update');

    const token2 = await localReady();
    const created2 = await local.childCRUD({ op: 'create', parentToken: token2, payload: { name: '小美', avatar: '🧒' } });
    const id2 = created2.child._id;
    await seedCloudFromLocalChildren();
    for (const payload of [{ name: '' }, { avatar: '' }]) {
      const lRes = await local.childCRUD({ op: 'update', childId: id2, parentToken: token2, payload });
      const cRes = await runCloud({ op: 'update', childId: id2, parentToken: 'any', payload });
      compareFail(lRes, cRes, 'update ' + JSON.stringify(payload));
    }
  });

  // ⑧ 集成：delete（至少保留一个宝宝，故先多建一个再删多余的那个）
  await t.test('⑧ childCRUD delete 本地↔云端 一致（remaining 计数）', async () => {
    const token = await localReady();
    const created = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '小明', avatar: '🧒' } });
    const childId = created.child._id;
    await seedCloudFromLocalChildren(); // 默认 + 小明（同 _id）同步到云端
    const lRes = await local.childCRUD({ op: 'delete', childId, parentToken: token });
    const cRes = await runCloud({ op: 'delete', childId, parentToken: 'any' });
    assert.strictEqual(lRes.ok, true, '本地 delete 应成功，实际: ' + JSON.stringify(lRes));
    assert.strictEqual(cRes.ok, true, '云端 delete 应成功，实际: ' + JSON.stringify(cRes));
    assert.strictEqual(lRes.id, cRes.id, 'delete 返回 id 不一致');
    assert.strictEqual(lRes.remaining, cRes.remaining, 'delete 返回 remaining 不一致');
  });

  // ⑨ 集成：MAX_CHILDREN 上限（默认已占 1 个，再建 5 个达上限 6，第 7 个报 LIMIT）
  await t.test('⑨ childCRUD 宝宝上限 本地↔云端 一致（第 7 个报 LIMIT）', async () => {
    const token = await localReady();
    for (let i = 0; i < 5; i++) {
      const r = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: 'C' + i, avatar: '🧒' } });
      assert.strictEqual(r.ok, true, '建第 ' + (i + 2) + ' 个宝宝应成功，实际: ' + JSON.stringify(r));
    }
    await seedCloudFromLocalChildren(); // 同步全部 6 个（同 _id）到云端
    const lRes = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: 'C7', avatar: '🧒' } });
    const cRes = await runCloud({ op: 'create', parentToken: 'any', payload: { name: 'C7', avatar: '🧒' } });
    compareFail(lRes, cRes, '第 7 个 create');
  });

});
