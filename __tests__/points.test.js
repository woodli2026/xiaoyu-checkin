// __tests__/points.test.js —— 候选④：pointsLog 聚合读取（O2 数据源）+ 零修剪修复
const test = require('node:test');
const assert = require('node:assert');

const { aggregatePointsLog } = require('../miniprogram/utils/points');
const store = require('../miniprogram/services/local/store');
const local = require('../miniprogram/services/local');
const { callApi } = require('../miniprogram/utils/api');
const { installWxStorageMock } = require('./helpers/wx-storage');

// 样例流水：c1 打卡 +5、c1 兑换 -2、c2 打卡 +3、c1 投喂 -1
const SAMPLE = [
  { _id: '1', childId: 'c1', delta: 5, refType: 'checkin', createdAt: 1000 },
  { _id: '2', childId: 'c1', delta: -2, refType: 'redeem', createdAt: 2000 },
  { _id: '3', childId: 'c2', delta: 3, refType: 'checkin', createdAt: 3000 },
  { _id: '4', childId: 'c1', delta: -1, refType: 'pet_feed', createdAt: 4000 }
];

test('聚合：按 childId 过滤，earned/spent/net/byRefType 正确', () => {
  const r = aggregatePointsLog(SAMPLE, { childId: 'c1' });
  assert.strictEqual(r.earned, 5, 'c1 收入只计 +5');
  assert.strictEqual(r.spent, 3, 'c1 支出计 2+1');
  assert.strictEqual(r.net, 2);
  assert.strictEqual(r.count, 3, 'c1 共 3 条');
  assert.deepStrictEqual(r.byRefType.checkin, { delta: 5, count: 1 });
  assert.deepStrictEqual(r.byRefType.redeem, { delta: -2, count: 1 });
  assert.deepStrictEqual(r.byRefType.pet_feed, { delta: -1, count: 1 });
});

test('聚合：不带 childId 则全量', () => {
  const r = aggregatePointsLog(SAMPLE);
  assert.strictEqual(r.earned, 8, '收入 5+3');
  assert.strictEqual(r.spent, 3, '支出 2+1');
  assert.strictEqual(r.count, 4);
});

test('聚合：时间窗 sinceMs/untilMs 含端点', () => {
  const r = aggregatePointsLog(SAMPLE, { sinceMs: 2000, untilMs: 4000 });
  assert.strictEqual(r.count, 3, '含 2000/3000/4000 三条');
  assert.strictEqual(r.earned, 3, '仅 c2 的 +3');
  assert.strictEqual(r.spent, 3, 'c1 的 -2 与 -1');
});

test('聚合：空 / 非法输入不抛错', () => {
  assert.deepStrictEqual(aggregatePointsLog(null), { earned: 0, spent: 0, net: 0, count: 0, byRefType: {} });
  assert.strictEqual(aggregatePointsLog(SAMPLE, { childId: 'no-such' }).count, 0);
});

test('本地 op pointsLog：返回聚合（O2 数据源可达，经本地数据层）', async () => {
  installWxStorageMock();
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const dash = await local.getDashboard({ childId });
  await local.checkIn({ childId, taskId: dash.todayTasks[0].taskId, parentToken: token });

  const r = local.pointsLog({ childId });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.childId, childId);
  assert.strictEqual(r.count, 1, '应有 1 条打卡流水');
  assert.ok(r.earned > 0, '打卡应产生收入');
  assert.strictEqual(r.byRefType.checkin.count, 1);
  // childId 不匹配应返回空聚合
  const empty = local.pointsLog({ childId: 'no-such' });
  assert.strictEqual(empty.count, 0);
  assert.strictEqual(empty.earned, 0);
});

test('callApi 透传 pointsLog op：经统一数据入口可达（运行时契约一致性）', async () => {
  installWxStorageMock();
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const dash = await local.getDashboard({ childId });
  await local.checkIn({ childId, taskId: dash.todayTasks[0].taskId, parentToken: token });

  const prevGetApp = global.getApp;
  global.getApp = () => ({ globalData: { useCloud: false, parentToken: null } });
  let res = null;
  try { res = await callApi('pointsLog', { childId }); } finally {
    if (prevGetApp === undefined) delete global.getApp; else global.getApp = prevGetApp;
  }
  assert.ok(res && res.ok, '应成功返回聚合');
  assert.strictEqual(res.count, 1);
});

test('零修剪：pointsLog 超过上限自动裁剪，保留最新 CAP 条', () => {
  const { POINTS_LOG_CAP } = store;
  const big = [];
  for (let i = 0; i < POINTS_LOG_CAP + 500; i++) {
    big.push({ _id: 'p' + i, childId: 'c1', delta: 1, refType: 'checkin', createdAt: i });
  }
  store.savePoints(big);
  const out = store.allPoints();
  assert.strictEqual(out.length, POINTS_LOG_CAP, '应裁剪到上限');
  const maxCreated = Math.max.apply(null, out.map((e) => e.createdAt));
  assert.strictEqual(maxCreated, POINTS_LOG_CAP + 499, '应保留 createdAt 最大的最新条目');
});

test('零修剪：少量条目不触发裁剪', () => {
  store.savePoints([{ _id: 'a', createdAt: 1, delta: 1, refType: 'checkin', childId: 'c1' }]);
  assert.strictEqual(store.allPoints().length, 1);
});
