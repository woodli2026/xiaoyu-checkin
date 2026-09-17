// __tests__/local.test.js —— 本地兜底数据层端到端逻辑（mock wx.storage）
// 验证：登录建号 → PIN → 解锁 → 建任务 → 打卡(防重复/累加) → 建奖励 → 兑换(只扣星星/限次靠已兑换)
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

test('本地兜底端到端：账号 → PIN → 任务 → 打卡 → 奖励 → 兑换', async () => {
  // 1. 静默登录：自动建号 + 建孩子档案
  const login = await local.login({});
  assert.strictEqual(login.ok, true);
  assert.ok(login.user && login.user._id);
  assert.strictEqual(login.pinSet, true);          // 建号即带默认 PIN
  assert.strictEqual(String(login.user.randomCode).length, 16);
  const childId = login.childId;
  assert.ok(childId);

  // 2. 错误 PIN 被拒
  const wrong = await local.unlockParent({ pin: '000000' });
  assert.strictEqual(wrong.ok, false);
  assert.strictEqual(wrong.code, 'PIN_INVALID');

  // 3. 默认 PIN 123456 可直接进入家长模式
  const unlock = await local.unlockParent({ pin: local.DEFAULT_PIN });
  assert.strictEqual(unlock.ok, true);

  // 4. 修改 PIN：6 位约束 + 因 pinSet 已为 true 必须持家长令牌
  const bad = await local.setPin({ pin: '12345', parentToken: unlock.parentToken });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'INVALID');
  const setNoTok = await local.setPin({ pin: '654321' });
  assert.strictEqual(setNoTok.code, 'TOKEN_INVALID');
  const setOk = await local.setPin({ pin: '654321', parentToken: unlock.parentToken });
  assert.strictEqual(setOk.ok, true);
  assert.strictEqual(setOk.pinSet, true);

  // 5. 旧 PIN 失效，新 PIN 可解锁并换发令牌
  assert.strictEqual((await local.unlockParent({ pin: local.DEFAULT_PIN })).code, 'PIN_INVALID');
  const unlockNew = await local.unlockParent({ pin: '654321' });
  assert.strictEqual(unlockNew.ok, true);
  const token = unlockNew.parentToken;
  assert.ok(token);

  // 5. 无 token 建任务应被拒
  const noTok = await local.taskCRUD({ op: 'create', parentToken: 'x', payload: { childId, title: '读书' } });
  assert.strictEqual(noTok.code, 'TOKEN_INVALID');

  // 6. 建任务（缺标题/星数非法拦截）
  const badTitle = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '', score: 2 } });
  assert.strictEqual(badTitle.code, 'INVALID');
  const badScore = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '读书', score: 0 } });
  assert.strictEqual(badScore.code, 'INVALID');
  const created = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '读书', icon: '📚', score: 3, priority: 'high' } });
  assert.strictEqual(created.ok, true);
  const taskId = created.task._id;

  // 7. 看板：今日任务包含该任务且未打卡
  let dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.ok, true);
  assert.strictEqual(dash.totalStars, 0);
  assert.strictEqual(dash.level, 1);
  const tt = dash.todayTasks.find(t => t.taskId === taskId);
  assert.ok(tt && tt.checked === false);
  assert.deepStrictEqual(dash.children.length, 1);

  // 8. 打卡：星星累加 + 连续天数 1 + 流水
  const ci = await local.checkIn({ childId, taskId, parentToken: token });
  assert.strictEqual(ci.ok, true);
  assert.strictEqual(ci.totalStars, 3);
  assert.strictEqual(ci.streak, 1);

  // 9. 同日重复打卡拦截
  const dup = await local.checkIn({ childId, taskId, parentToken: token });
  assert.strictEqual(dup.code, 'ALREADY_DONE');

  dash = await local.getDashboard({ childId });
  const tt2 = dash.todayTasks.find(t => t.taskId === taskId);
  assert.strictEqual(tt2.checked, true);
  assert.ok(dash.monthLit.length >= 1);
  assert.strictEqual(dash.checkIns.length, 1);

  // 10. 建奖励 + 兑换（「仅一次」类：靠是否已兑换过来限次，不再有库存）
  const rw = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '看动画片', cost: 2, resetAfterRedeem: false } });
  assert.strictEqual(rw.ok, true);
  assert.strictEqual(rw.reward.stock, undefined);   // 已无库存字段
  const rewardId = rw.reward._id;

  const rd = await local.redeem({ childId, rewardId, parentToken: token });
  assert.strictEqual(rd.ok, true);
  assert.strictEqual(rd.totalStars, 1);     // 3 - 2
  assert.strictEqual(rd.stock, undefined);  // 不再返回库存

  // 11. 「仅一次」再兑 → 已被兑换过（替代原「库存不足」）
  const again = await local.redeem({ childId, rewardId, parentToken: token });
  assert.strictEqual(again.code, 'ALREADY_REDEEMED');

  // 11b. 「可反复兑换」类：连兑两次都放行，只受星星约束
  const rwU = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '抱抱一次', cost: 1, resetAfterRedeem: true } });
  const u1 = await local.redeem({ childId, rewardId: rwU.reward._id, parentToken: token });
  assert.strictEqual(u1.ok, true);
  assert.strictEqual(u1.totalStars, 0);            // 1 - 1
  const u2 = await local.redeem({ childId, rewardId: rwU.reward._id, parentToken: token });
  assert.strictEqual(u2.code, 'INSUFFICIENT');     // 被星星拦住，而不是「已兑换」

  // 12. 星星不足拦截
  const rw2 = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '大餐', cost: 99 } });
  const poor = await local.redeem({ childId, rewardId: rw2.reward._id, parentToken: token });
  assert.strictEqual(poor.code, 'INSUFFICIENT');

  // 13. 软删任务：保留历史流水
  const del = await local.taskCRUD({ op: 'delete', parentToken: token, payload: { id: taskId } });
  assert.strictEqual(del.ok, true);
  dash = await local.getDashboard({ childId });
  assert.ok(!dash.todayTasks.some(t => t.taskId === taskId)); // 已从今日隐藏
  assert.strictEqual(dash.checkIns.length, 1);                // 历史打卡仍在

  // 14. 孩子档案：list / update（昵称·头像）+ 越权与校验
  const list = await local.childCRUD({ op: 'list' });
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.children.length, 1);

  const upNoTok = await local.childCRUD({ op: 'update', childId, parentToken: 'x', payload: { name: '小雨' } });
  assert.strictEqual(upNoTok.code, 'TOKEN_INVALID');

  const upBlank = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { name: '   ' } });
  assert.strictEqual(upBlank.code, 'INVALID');

  const upTooLong = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { name: '一二三四五六七八九十十一十二十三' } });
  assert.strictEqual(upTooLong.code, 'INVALID');

  const upEmpty = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: {} });
  assert.strictEqual(upEmpty.code, 'INVALID');

  const up = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { name: '小雨', avatar: '👧' } });
  assert.strictEqual(up.ok, true);
  assert.strictEqual(up.child.name, '小雨');
  assert.strictEqual(up.child.avatar, '👧');

  dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.child.name, '小雨');          // 看板同步
  assert.strictEqual(dash.children[0].avatar, '👧');

  // 切换孩子
  const sw = await local.childSwitch({ childId, parentToken: token });
  assert.strictEqual(sw.ok, true);
  const swBad = await local.childSwitch({ childId: 'not-mine', parentToken: token });
  assert.strictEqual(swBad.code, 'FORBIDDEN');

  // 15. PIN 重置 = 恢复默认 PIN（而非把账号置为「无 PIN」死状态）
  const resetRes = await local.resetPin({});
  assert.strictEqual(resetRes.ok, true);
  assert.strictEqual(resetRes.pinSet, true);
  assert.strictEqual(resetRes.defaultPin, local.DEFAULT_PIN);
  assert.strictEqual((await local.unlockParent({ pin: '654321' })).code, 'PIN_INVALID'); // 自定义 PIN 已失效
  assert.strictEqual((await local.unlockParent({ pin: local.DEFAULT_PIN })).ok, true);    // 默认 PIN 可重新进入
});

test('默认 PIN 口径：本地兜底与云端 lib 必须一致', () => {
  const lib = require('../cloudfunctions/lib');
  assert.strictEqual(local.DEFAULT_PIN, '123456');
  assert.strictEqual(local.PIN_LENGTH, 6);
  assert.strictEqual(lib.DEFAULT_PIN, local.DEFAULT_PIN);
  assert.strictEqual(lib.PIN_LENGTH, local.PIN_LENGTH);
  assert.strictEqual(lib.PIN_SCHEME, local.PIN_SCHEME);   // 方案版本也必须一致
});

test('PIN 方案迁移：旧口径账号登录后可用默认 PIN 进入，且不会冲掉自定义 PIN', async () => {
  // 1. 伪造一个「8 位时代」的账号：pinSet 为真、pinHash 是旧方案的哈希、没有 pinScheme。
  //    关键点：旧逻辑只看 !pinSet，对这种账号不会做任何事 → 它会陷入「怎么输都进不去」。
  await local.resetAll();
  store.xy_user = {
    _id: 'u_legacy', openid: 'local_legacy', randomCode: 'ABCDEFGHIJKLMNOP',
    nickname: '番茄宝宝', avatar: '🧒',
    pinHash: 'legacy-hash-of-an-8-digit-pin',
    pinSet: true,
    createdAt: Date.now()
  };

  // 2. 迁移前：不仅进不去，还必须给出「PIN 方案已过期」这个明确错误码（而不是含糊的
  //    「PIN 不正确」）—— 界面靠它引导用户走「忘记 PIN → 恢复默认」这条出路。
  const before = await local.unlockParent({ pin: local.DEFAULT_PIN });
  assert.strictEqual(before.ok, false);
  assert.strictEqual(before.code, 'PIN_SCHEME_STALE');

  // 3. 重新登录应触发方案迁移
  const relogin = await local.login({});
  assert.strictEqual(relogin.ok, true);
  assert.strictEqual(relogin.pinSet, true);

  // 4. 迁移后：默认 PIN 123456 可进入家长模式
  const after = await local.unlockParent({ pin: local.DEFAULT_PIN });
  assert.strictEqual(after.ok, true);
  assert.ok(after.parentToken);

  // 5. 迁移只对旧账号触发一次：改成自定义 PIN 后再登录，不能被重置回默认值
  await local.setPin({ pin: '778899', parentToken: after.parentToken });
  await local.login({});
  assert.strictEqual((await local.unlockParent({ pin: '778899' })).ok, true);
  assert.strictEqual((await local.unlockParent({ pin: local.DEFAULT_PIN })).code, 'PIN_INVALID');
});
