// __tests__/v108.test.js —— v1.0.8 改造逻辑校验（TDD 红→绿）
// 覆盖：
//   ① 任务模型新增 praise 字段（create/update 落库 + 看板透传），默认 type=study
//   ② getDashboard 透出撤销所需 id：checkIns[].id（撤销打卡）、限次已兑换奖励的 redeemId（取消兑换）
const test = require('node:test');
const assert = require('node:assert');

// —— mock wx.storage ——
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

const local = require('../miniprogram/services/local');

test('v1.0.8 任务模型：create 写入 praise 且默认 type=study', async () => {
  await local.resetAll();
  const login = await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = login.childId;

  const created = await local.taskCRUD({
    op: 'create', parentToken: token,
    payload: { childId, title: '背单词', icon: '📚', score: 2, praise: '今天发音更标准啦！' }
  });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.task.type, 'study');                  // 默认 study
  assert.strictEqual(created.task.praise, '今天发音更标准啦！');

  // 不传 type / praise → 取默认值
  const def = await local.taskCRUD({
    op: 'create', parentToken: token,
    payload: { childId, title: '喝水', score: 1 }
  });
  assert.strictEqual(def.task.type, 'study');
  assert.strictEqual(def.task.praise, '');

  // 看板透传 praise
  const dash = await local.getDashboard({ childId });
  const t = dash.tasks.find(x => x._id === created.task._id);
  assert.strictEqual(t.praise, '今天发音更标准啦！');
});

test('v1.0.8 任务模型：update 可补丁 praise', async () => {
  await local.resetAll();
  const login = await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = login.childId;
  const created = await local.taskCRUD({
    op: 'create', parentToken: token, payload: { childId, title: '练琴', score: 2 }
  });
  assert.strictEqual(created.task.praise, '');
  const upd = await local.taskCRUD({
    op: 'update', parentToken: token,
    payload: { id: created.task._id, praise: '节奏感进步明显' }
  });
  assert.strictEqual(upd.ok, true);
  assert.strictEqual(upd.task.praise, '节奏感进步明显');
  const dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.tasks.find(x => x._id === created.task._id).praise, '节奏感进步明显');
});

test('v1.0.8 奖励模型：create/update 写入 praise 且看板透传', async () => {
  await local.resetAll();
  const login = await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = login.childId;

  const created = await local.rewardCRUD({
    op: 'create', parentToken: token,
    payload: { childId, title: '冰淇淋', cost: 2, praise: '甜蜜补给到账！' }
  });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.reward.praise, '甜蜜补给到账！');

  // 不传 praise → 默认空串
  const def = await local.rewardCRUD({
    op: 'create', parentToken: token, payload: { childId, title: '贴纸', cost: 1 }
  });
  assert.strictEqual(def.reward.praise, '');

  // update 可补丁 praise
  const upd = await local.rewardCRUD({
    op: 'update', parentToken: token,
    payload: { id: def.reward._id, praise: '收集小达人就是你' }
  });
  assert.strictEqual(upd.ok, true);
  assert.strictEqual(upd.reward.praise, '收集小达人就是你');

  // 看板透传 praise（兑换页/兑换成功弹泡用）
  const dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.rewards.find(x => x._id === created.reward._id).praise, '甜蜜补给到账！');
});

test('v1.0.8 看板：checkIns 透出 id 供撤销打卡', async () => {
  await local.resetAll();
  const login = await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = login.childId;
  const created = await local.taskCRUD({
    op: 'create', parentToken: token, payload: { childId, title: '读书', score: 3 }
  });
  await local.checkIn({ childId, taskId: created.task._id, parentToken: token });
  const dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.checkIns.length, 1);
  assert.ok(dash.checkIns[0].id, 'checkIns 应携带 id 供 undoCheckIn 使用');
  // 用该 id 可成功撤销（星星扣回）
  const uc = await local.feedCRUD({ op: 'undoCheckIn', id: dash.checkIns[0].id, parentToken: token });
  assert.strictEqual(uc.ok, true);
  assert.strictEqual(uc.totalStars, 0);
});

test('v1.0.8 看板：限次奖励透出 redeemId 供取消兑换', async () => {
  await local.resetAll();
  const login = await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = login.childId;
  // 先攒 5 星
  const tk = await local.taskCRUD({
    op: 'create', parentToken: token, payload: { childId, title: '读书', score: 5 }
  });
  await local.checkIn({ childId, taskId: tk.task._id, parentToken: token });
  const rw = await local.rewardCRUD({
    op: 'create', parentToken: token, payload: { childId, title: '冰淇淋', cost: 2, resetAfterRedeem: false }
  });
  await local.redeem({ childId, rewardId: rw.reward._id, parentToken: token });
  const dash = await local.getDashboard({ childId });
  const r = dash.rewards.find(x => x._id === rw.reward._id);
  assert.strictEqual(r.redeemed, true);
  assert.ok(r.redeemId, '限次已兑换奖励应携带 redeemId 供 undoRedeem 使用');
  const ur = await local.feedCRUD({ op: 'undoRedeem', id: r.redeemId, parentToken: token });
  assert.strictEqual(ur.ok, true);
  assert.strictEqual(ur.totalStars, 5);            // 返还 2
  const dash2 = await local.getDashboard({ childId });
  assert.strictEqual(dash2.rewards.find(x => x._id === rw.reward._id).redeemed, false);  // 恢复可兑
});
