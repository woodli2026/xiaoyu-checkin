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
const { createHarness, installWxServerSdk } = require('./helpers/cloud-db');
const { installWxStorageMock } = require('./helpers/wx-storage');
const {
  read, keysOf, objectLiteralAfter, arrowBlock, functionBlock, evalObj
} = require('./helpers/js-source');

// ---------- 云端 mock：忠实内存 db（helpers/cloud-db）+ wx.storage（helpers/wx-storage） ----------
// 必须「先装 mock 再 require 云函数 / 服务」：lib/cloud.js 在加载期就取 db。
const H = createHarness();
installWxServerSdk(H);
const { store } = installWxStorageMock();

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
  H.setOpenid(user ? user.openid : 'local_openid');
  H.seed('users', user ? [user] : []);
  H.seed('children', store[storage.KEYS.children] || []);
  H.seed('tasks', store[storage.KEYS.tasks] || []);
  H.seed('rewards', store[storage.KEYS.rewards] || []);
  H.seed('checkIns', store[storage.KEYS.checkIns] || []);
  H.seed('redemptions', store[storage.KEYS.redemptions] || []);

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
