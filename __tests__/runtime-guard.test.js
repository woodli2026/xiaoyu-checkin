// __tests__/runtime-guard.test.js
// A 守卫：验证授权/上下文深模块 cloudfunctions/lib/runtime.js 的原语语义：
//   resolveCaller —— 归一 AUTH_FAIL（缺 OPENID / 未登录）
//   assertToken  —— 家长令牌校验（失败返回 TOKEN_INVALID）
//   ownedChild   —— 【A·归属校验】严格：不属于自己 → null，绝不回退
//   currentChild —— 【B·默认选中】childId 缺失/不匹配 → 第一个宝宝
//   ownedTask / ownedReward —— 子资源归属：必须属于该用户的某个孩子
//
// 用 vm 编译**真实的 runtime.js 源码**，require 桩解析 './cloud' / './token'，
// 不经过 wx-server-sdk，纯逻辑验证原语行为。
//
// ⚠️ 候选②教训（重要）：旧版桩把 getOwnedChild 写成「严格语义」，
//    而真实 cloud.js 实现是「找不到就回退第一个孩子」——桩与被测实现相反，
//    导致归属越权这类回归永远不可能变红。
//    故本文件的桩原则：**归属判定一律用真实的 lib/ownership.js**（被测逻辑不许被替换），
//    桩只替 db 取数。这才是「接口即测试面」。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 归属判定用真实实现（纯函数，无 wx-server-sdk 依赖）
const ownership = require('../cloudfunctions/lib/ownership');

let CURRENT_OPENID = 'o1';
let USER_EXISTS = true;
const MOCK_USER = { _id: 'u1', pinSet: true };
// o1 拥有 c1 / c2；c9 属于别人
const MOCK_CHILDREN = [{ _id: 'c1', ownerId: 'u1' }, { _id: 'c2', ownerId: 'u1' }];
const MOCK_TASKS = {
  t1: { _id: 't1', childId: 'c1', score: 2, deleted: false },
  t2: { _id: 't2', childId: 'c9', score: 2, deleted: false },   // 别人的孩子
  t3: { _id: 't3', childId: 'c1', score: 2, deleted: true }     // 已软删
};
const MOCK_REWARDS = {
  r1: { _id: 'r1', childId: 'c1', cost: 5, deleted: false },
  r2: { _id: 'r2', childId: 'c9', cost: 5, deleted: false }     // 别人的孩子
};

const cloudMock = { getWXContext: () => ({ OPENID: CURRENT_OPENID }) };
const failStub = (code, message) => ({ code, message: message || code });
const getUserByOpenid = (openid) => Promise.resolve(USER_EXISTS ? MOCK_USER : null);

// 桩只替 db 取数：列表查询按 ownerId，单文档查询按 id
const ownedChildren = () => Promise.resolve(MOCK_CHILDREN.slice());
const getOwnedChild = (openid, childId) =>
  ownedChildren().then((list) => ownership.pickOwned(list, childId));
const getCurrentChild = (openid, childId) =>
  ownedChildren().then((list) => ownership.pickCurrent(list, childId));
const childIdsOf = () => ownedChildren().then((list) => list.map((c) => c._id));

const dbMock = {
  collection: (name) => ({
    doc: (id) => ({
      get: () => {
        const table = name === 'tasks' ? MOCK_TASKS : name === 'rewards' ? MOCK_REWARDS : {};
        const doc = table[id];
        return doc ? Promise.resolve({ data: doc }) : Promise.reject(new Error('not found'));
      }
    })
  })
};

const verifyToken = (token, openid) => token === 'good' && openid === CURRENT_OPENID;

const sandbox = {
  String, Number, Date, Object, Math, Array, Promise, RegExp, console,
  module: { exports: {} },
  require: (p) => {
    if (p === './cloud') {
      return {
        cloud: cloudMock, db: dbMock, fail: failStub,
        getUserByOpenid, ownedChildren, getOwnedChild, getCurrentChild, childIdsOf
      };
    }
    if (p === './token') return { verifyToken };
    if (p === './ownership') return ownership;   // 真实实现，不许替换
    throw new Error('unexpected require: ' + p);
  }
};
const runtime = vm.runInNewContext(
  read('cloudfunctions/lib/runtime.js') + '\n;({ resolveCaller, assertToken, ownedChild, currentChild, ownedTask, ownedReward })',
  sandbox
);

test('resolveCaller：缺 OPENID → AUTH_FAIL', async () => {
  CURRENT_OPENID = '';
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail && r.fail.code, 'AUTH_FAIL', '缺 OPENID 应返回 AUTH_FAIL');
});

test('resolveCaller：未登录 → AUTH_FAIL', async () => {
  CURRENT_OPENID = 'oX';
  USER_EXISTS = false;
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail && r.fail.code, 'AUTH_FAIL', '未登录应返回 AUTH_FAIL');
  USER_EXISTS = true;
});

test('resolveCaller：正常 → { OPENID, user }', async () => {
  CURRENT_OPENID = 'o1';
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail, undefined, '正常不应有 fail');
  assert.strictEqual(r.OPENID, 'o1');
  assert.strictEqual(r.user._id, 'u1');
});

test('assertToken：无效令牌 → TOKEN_INVALID', () => {
  const f = runtime.assertToken({ parentToken: 'bad' }, 'o1');
  assert.strictEqual(f && f.code, 'TOKEN_INVALID', '无效令牌应返回 TOKEN_INVALID');
});

test('assertToken：有效令牌 → null', () => {
  const f = runtime.assertToken({ parentToken: 'good' }, 'o1');
  assert.strictEqual(f, null, '有效令牌应返回 null');
});

// ---------- 候选②：归属语义双原语 ----------

test('ownedChild：属于自己的 childId → 返回该 child', async () => {
  const c = await runtime.ownedChild('o1', 'c2');
  assert.strictEqual(c && c._id, 'c2');
});

test('ownedChild：他人的 childId → null（严禁回退第一个孩子）', async () => {
  // 核心回归：旧实现会回退到 c1，这正是越权根因
  const c = await runtime.ownedChild('o1', 'c9');
  assert.strictEqual(c, null, '他人 childId 必须返回 null，不得回退');
});

test('ownedChild：childId 缺失 → null', async () => {
  assert.strictEqual(await runtime.ownedChild('o1', ''), null);
  assert.strictEqual(await runtime.ownedChild('o1', undefined), null);
});

test('currentChild：childId 命中 → 返回该 child', async () => {
  const c = await runtime.currentChild('o1', 'c2');
  assert.strictEqual(c && c._id, 'c2');
});

test('currentChild：childId 缺失或不匹配 → 回退第一个（看板默认宝宝语义）', async () => {
  assert.strictEqual((await runtime.currentChild('o1', ''))._id, 'c1');
  assert.strictEqual((await runtime.currentChild('o1', 'c9'))._id, 'c1');
});

test('currentChild 与 ownedChild 语义必须不同（回退 vs 严格）', async () => {
  const strict = await runtime.ownedChild('o1', 'c9');
  const fallback = await runtime.currentChild('o1', 'c9');
  assert.strictEqual(strict, null);
  assert.ok(fallback, 'currentChild 应回退，ownedChild 应拒绝');
});

// ---------- 子资源归属：堵住「用别人的 taskId 打卡」 ----------

test('ownedTask：属于自己的任务 → 返回文档', async () => {
  const t = await runtime.ownedTask('o1', 't1');
  assert.strictEqual(t && t._id, 't1');
});

test('ownedTask：他人孩子的任务 → null', async () => {
  const t = await runtime.ownedTask('o1', 't2');
  assert.strictEqual(t, null, '他人任务必须返回 null');
});

test('ownedTask：已软删的任务 → null', async () => {
  assert.strictEqual(await runtime.ownedTask('o1', 't3'), null);
});

test('ownedTask：id 缺失或不存在 → null', async () => {
  assert.strictEqual(await runtime.ownedTask('o1', ''), null);
  assert.strictEqual(await runtime.ownedTask('o1', 'nope'), null);
});

test('ownedReward：属于自己的奖励 → 返回文档', async () => {
  const r = await runtime.ownedReward('o1', 'r1');
  assert.strictEqual(r && r._id, 'r1');
});

test('ownedReward：他人孩子的奖励 → null', async () => {
  assert.strictEqual(await runtime.ownedReward('o1', 'r2'), null, '他人奖励必须返回 null');
});
