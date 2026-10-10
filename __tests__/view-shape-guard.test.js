// __tests__/view-shape-guard.test.js
// B′ 守卫：把「本地兜底层 ↔ 云端云函数」的视图/写操作输出形状焊死，
// 防止 v1.0.8 这类"双份实现人工对齐"在后续只改一端时静默漂移（测试全绿却线上不一致）。
//
// 两类断言：
//   ① getDashboard 输出形状（真执行）：mock wx-server-sdk 让云端 main 在 Node 中真实跑起来，
//      注入同一份 fixture（由本地 API 造好再灌进云端 mock db），对比两端返回对象的键集。
//   ② taskCRUD / rewardCRUD create 的 doc 形状（vm 字面量）：提取两端"建文档"的字面量比对键集。
//
// 零运行时风险：纯新增测试文件，不改动任何被测代码。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const keysOf = (o) => Object.keys(o).sort();

// ---------- 字面量提取（与 mirror-guard 同思路） ----------
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

// 返回 anchor 之后第一个 '{' 起的完整 "{...}" 文本
function objectLiteralAfter(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const b = src.indexOf('{', a);
  if (b < 0) throw new Error('anchor 后无 {');
  return src.slice(b, matchBrace(src, b) + 1);
}

// 返回 anchor 之后第一个 '{' 起的完整 "{...}" 块（用于提取箭头函数体）
function arrowBlock(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const i = src.indexOf('=>', a);
  const b = src.indexOf('{', i);
  return src.slice(b, matchBrace(src, b) + 1);
}

// 括号感知地提取具名函数体（正确处理 `async function f({ op }) {` 之类的解构参数）
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
  return src.slice(b, matchBrace(src, b) + 1);
}

function evalObj(span, sandbox) {
  return vm.runInNewContext('(' + span + ')', sandbox);
}

// ---------- wx-server-sdk mock：让云端 getDashboard 在 Node 真执行 ----------
const collections = {};          // name -> docs[]
let CURRENT_OPENID = 'init';
let seq = 0;
const genId = (p) => p + '_' + (++seq);

function makeQuery(arr) {
  let data = arr.slice();
  const api = {
    where(filter) {
      if (filter) data = data.filter(d => Object.keys(filter).every(k => d[k] === filter[k]));
      return api;
    },
    orderBy(field, dir) {
      data.sort((a, b) => (dir === 'desc' ? (b[field] - a[field]) : (a[field] - b[field])));
      return api;
    },
    limit(n) { data = data.slice(0, n); return api; },
    get() { return Promise.resolve({ data }); }
  };
  return api;
}

const dbMock = {
  command: {},
  collection(name) {
    if (!collections[name]) collections[name] = [];
    const arr = collections[name];
    return {
      where(f) { return makeQuery(arr).where(f); },
      orderBy(f, d) { return makeQuery(arr).orderBy(f, d); },
      limit(n) { return makeQuery(arr).limit(n); },
      get() { return makeQuery(arr).get(); },
      add({ data }) {
        const doc = Object.assign({ _id: genId(name[0]) }, data);
        arr.push(doc);
        return Promise.resolve({ _id: doc._id });
      },
      doc(id) {
        const found = arr.find(d => d._id === id);
        return {
          get() { return Promise.resolve({ data: found || null }); },
          update() { return Promise.resolve({}); },
          remove() { return Promise.resolve({}); }
        };
      }
    };
  }
};

const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  database() { return dbMock; },
  getWXContext() { return { OPENID: CURRENT_OPENID }; }
};

// 拦截 require('wx-server-sdk')，注入 mock（必须在 require 云端 index 之前安装）
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudMock;
  return origLoad.apply(this, arguments);
};

// ---------- 本地层 wx.storage mock ----------
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

const storage = require('../miniprogram/utils/storage');
const local = require('../miniprogram/services/local');
const cloudDash = require('../cloudfunctions/getDashboard');

// ---------- 用本地 API 造 fixture，再灌进云端 mock db ----------
const ready = (async () => {
  await local.resetAll();
  await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childrenArr = store[storage.KEYS.children] || [];
  const childId = childrenArr[0]._id;

  // 建任务 / 奖励 / 打卡 / 兑换，喂出更丰富的看板
  await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '背单词', icon: '📚', score: 2, praise: '今天发音更标准啦！' } });
  await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '喝水', icon: '💧', score: 1 } });
  await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '冰淇淋', cost: 2, resetAfterRedeem: false, praise: '甜蜜补给' } });
  await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '贴纸', cost: 1 } });
  const tk = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '读书', score: 5 } });
  await local.checkIn({ childId, taskId: tk.task._id, parentToken: token });
  const rw = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '全家出游', cost: 3, resetAfterRedeem: false } });
  await local.redeem({ childId, rewardId: rw.reward._id, parentToken: token });

  // 把同一份数据灌进云端 mock db（保证两端吃完全一致的入参）
  const user = store[storage.KEYS.user];
  CURRENT_OPENID = user ? user.openid : 'local_openid';
  collections.users = user ? [user] : [];
  collections.children = store[storage.KEYS.children] || [];
  collections.tasks = store[storage.KEYS.tasks] || [];
  collections.rewards = store[storage.KEYS.rewards] || [];
  collections.checkIns = store[storage.KEYS.checkIns] || [];
  collections.redemptions = store[storage.KEYS.redemptions] || [];

  return { childId };
})();

// ---------- ① getDashboard 输出形状（真执行对比） ----------
test('getDashboard 输出形状 本地↔云端 一致（顶层 + 各投影）', async () => {
  const { childId } = await ready;
  const localOut = await local.getDashboard({ childId });
  const cloudOut = await cloudDash.main({ childId });

  assert.deepStrictEqual(keysOf(localOut), keysOf(cloudOut), 'getDashboard 顶层键不一致');

  assert.ok(localOut.todayTasks.length && cloudOut.todayTasks.length, 'todayTasks 应为非空');
  assert.deepStrictEqual(keysOf(localOut.todayTasks[0]), keysOf(cloudOut.todayTasks[0]), 'todayTasks 投影键不一致');

  assert.deepStrictEqual(keysOf(localOut.child), keysOf(cloudOut.child), 'child 投影键不一致');
  assert.deepStrictEqual(keysOf(localOut.children[0]), keysOf(cloudOut.children[0]), 'children 投影键不一致');
  assert.deepStrictEqual(keysOf(localOut.rewards[0]), keysOf(cloudOut.rewards[0]), 'rewards 投影键不一致');

  assert.ok(localOut.checkIns.length && cloudOut.checkIns.length, 'checkIns 应为非空');
  assert.deepStrictEqual(keysOf(localOut.checkIns[0]), keysOf(cloudOut.checkIns[0]), 'checkIns 投影键不一致');
});

test('getDashboard v1.0.8 关键字段透出一致 + todayTasks 双端均无 praise', async () => {
  const { childId } = await ready;
  const localOut = await local.getDashboard({ childId });
  const cloudOut = await cloudDash.main({ childId });

  // praise 透传（tasks / rewards 为原始 doc，应自动带出）
  assert.ok('praise' in localOut.tasks[0] && 'praise' in cloudOut.tasks[0], 'tasks 应透出 praise');
  assert.ok('praise' in localOut.rewards[0] && 'praise' in cloudOut.rewards[0], 'rewards 应透出 praise');

  // checkIns 透出撤销用 id
  assert.ok('id' in localOut.checkIns[0] && 'id' in cloudOut.checkIns[0], 'checkIns 应透出 id');

  // 限次奖励透出 redeemId / redeemed
  const localRedeemed = localOut.rewards.find(r => r.redeemId);
  const cloudRedeemed = cloudOut.rewards.find(r => r.redeemId);
  assert.ok(localRedeemed && cloudRedeemed, '应存在已兑换奖励且带 redeemId');
  assert.ok('redeemId' in localRedeemed && 'redeemId' in cloudRedeemed, 'rewards 应透出 redeemId');
  assert.ok('redeemed' in localRedeemed && 'redeemed' in cloudRedeemed, 'rewards 应透出 redeemed');

  // todayTasks 双端均故意不含 praise（避免大对象下传）
  assert.strictEqual('praise' in localOut.todayTasks[0], false, '本地 todayTasks 不应含 praise');
  assert.strictEqual('praise' in cloudOut.todayTasks[0], false, '云端 todayTasks 不应含 praise');
});

// ---------- ② taskCRUD / rewardCRUD create 文档形状（vm 字面量对比） ----------
function extractCreateDoc(body, docAnchor, sandbox) {
  const lit = objectLiteralAfter(body, docAnchor);
  return evalObj(lit, sandbox);
}

const STR = { String, Number, Date };
const taskSandbox = Object.assign({ s: { nextId: () => 't1' }, user: { _id: 'u1' }, p: { childId: 'c1' }, D: { ymd: () => '2026-01-01' } }, STR);
const rewardSandbox = Object.assign({ s: { nextId: () => 'r1' }, user: { _id: 'u1' }, p: { childId: 'c1' } }, STR);
const cloudTaskSandbox = Object.assign({ child: { _id: 'c1', ownerId: 'u1' }, p: { childId: 'c1' }, ymd: () => '2026-01-01' }, STR);
const cloudRewardSandbox = Object.assign({ child: { _id: 'c1', ownerId: 'u1' }, p: { childId: 'c1' } }, STR);

test('taskCRUD create 文档形状 本地↔云端 一致', () => {
  const localSrc = read('miniprogram/services/local/task.js');
  const cloudSrc = read('cloudfunctions/taskCRUD/index.js');
  const localDoc = extractCreateDoc(functionBlock(localSrc, 'taskCRUD'), 'const task =', taskSandbox);
  const cloudDoc = extractCreateDoc(arrowBlock(cloudSrc, 'exports.main = async (event) =>'), 'const doc =', cloudTaskSandbox);
  // _id 在本地内联生成、云端在返回时 Object.assign 追加，故比对时排除 _id
  const lk = keysOf(localDoc).filter(k => k !== '_id');
  const ck = keysOf(cloudDoc);
  const expected = ['childId', 'createdAt', 'date', 'deleted', 'icon', 'ownerId', 'praise', 'priority', 'repeat', 'score', 'title', 'type'].sort();
  assert.deepStrictEqual(lk, expected, '本地 task 文档键集漂移');
  assert.deepStrictEqual(ck, expected, '云端 task 文档键集漂移');
  assert.deepStrictEqual(lk, ck, 'task 文档双端键集不一致');
  // v1.0.8：默认 type=study 两端一致
  assert.ok(localSrc.includes("'study'") || localSrc.includes('"study"'), '本地 task 默认 type=study 缺失');
  assert.ok(cloudSrc.includes("'study'") || cloudSrc.includes('"study"'), '云端 task 默认 type=study 缺失');
});

test('rewardCRUD create 文档形状 本地↔云端 一致', () => {
  const localSrc = read('miniprogram/services/local/reward.js');
  const cloudSrc = read('cloudfunctions/rewardCRUD/index.js');
  const localDoc = extractCreateDoc(functionBlock(localSrc, 'rewardCRUD'), 'const reward =', rewardSandbox);
  const cloudDoc = extractCreateDoc(arrowBlock(cloudSrc, 'exports.main = async (event) =>'), 'const doc =', cloudRewardSandbox);
  const lk = keysOf(localDoc).filter(k => k !== '_id');
  const ck = keysOf(cloudDoc);
  const expected = ['category', 'childId', 'cost', 'createdAt', 'deleted', 'icon', 'ownerId', 'praise', 'resetAfterRedeem', 'title'].sort();
  assert.deepStrictEqual(lk, expected, '本地 reward 文档键集漂移');
  assert.deepStrictEqual(ck, expected, '云端 reward 文档键集漂移');
  assert.deepStrictEqual(lk, ck, 'reward 文档双端键集不一致');
});
