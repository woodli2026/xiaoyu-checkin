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

  // 14b. 宝宝档案：photo / gender / birthday / allergens 读写 + 校验
  const upPhoto = await local.childCRUD({
    op: 'update', childId, parentToken: token,
    payload: { photo: 'wxfile://child/abc.jpg', gender: 'girl', birthday: '2019-03-05', allergens: '花生、牛奶' }
  });
  assert.strictEqual(upPhoto.ok, true);
  assert.strictEqual(upPhoto.child.photo, 'wxfile://child/abc.jpg');
  assert.strictEqual(upPhoto.child.gender, 'girl');
  assert.strictEqual(upPhoto.child.birthday, '2019-03-05');
  assert.strictEqual(upPhoto.child.allergens, '花生、牛奶');
  const dashPhoto = await local.getDashboard({ childId });
  assert.strictEqual(dashPhoto.child.photo, 'wxfile://child/abc.jpg');
  assert.strictEqual(dashPhoto.child.birthday, '2019-03-05');
  assert.strictEqual(dashPhoto.children[0].gender, 'girl');

  const upGenderBad = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { gender: 'x' } });
  assert.strictEqual(upGenderBad.code, 'INVALID');     // 性别枚举外被拒
  const upBirthBad = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { birthday: '2019-02-30' } });
  assert.strictEqual(upBirthBad.code, 'INVALID');      // 不存在的日期被拒
  const upAllergenLong = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { allergens: 'x'.repeat(51) } });
  assert.strictEqual(upAllergenLong.code, 'INVALID');  // 过敏原超长被拒

  const upClearPhoto = await local.childCRUD({ op: 'update', childId, parentToken: token, payload: { photo: '', birthday: '' } });
  assert.strictEqual(upClearPhoto.ok, true);
  assert.strictEqual(upClearPhoto.child.photo, '');       // 空串清除自定义照片
  assert.strictEqual(upClearPhoto.child.birthday, '');    // 空串清除生日
  assert.strictEqual(upClearPhoto.child.gender, 'girl');  // 未传的字段保持不变

  // 14c. 宝宝新增 / 删除（软删 · 至少保留一个 · 未删档案不可切换）
  const mk = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '二宝', gender: 'boy', birthday: '2021-08-01' } });
  assert.strictEqual(mk.ok, true);
  assert.strictEqual(mk.child.name, '二宝');
  assert.strictEqual(mk.child.avatar, '🧒');   // 未传头像 → 默认 emoji
  assert.strictEqual(mk.child.gender, 'boy');
  const newId = mk.child._id;

  const mkNoTok = await local.childCRUD({ op: 'create', parentToken: 'x', payload: { name: '无令牌' } });
  assert.strictEqual(mkNoTok.code, 'TOKEN_INVALID');
  const mkBlank = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '  ' } });
  assert.strictEqual(mkBlank.code, 'INVALID');

  let list2 = await local.childCRUD({ op: 'list' });
  assert.strictEqual(list2.children.length, 2);

  const delChild = await local.childCRUD({ op: 'delete', childId: newId, parentToken: token });
  assert.strictEqual(delChild.ok, true);
  assert.strictEqual(delChild.remaining, 1);
  list2 = await local.childCRUD({ op: 'list' });
  assert.strictEqual(list2.children.length, 1);              // 软删后不再出现在列表
  const dashAfterDel = await local.getDashboard({ childId: newId });
  assert.strictEqual(dashAfterDel.child._id, childId);       // 指向已删宝宝 → 回退到第一个
  const swDeleted = await local.childSwitch({ childId: newId, parentToken: token });
  assert.strictEqual(swDeleted.code, 'FORBIDDEN');           // 已删宝宝不可切换为当前

  const delLast = await local.childCRUD({ op: 'delete', childId, parentToken: token });
  assert.strictEqual(delLast.code, 'LAST_CHILD');            // 至少保留一个宝宝

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

test('连续打卡天数：补打卡后由流水推导，乱序补录也算得对（2026-09-18 修复）', async () => {
  await local.resetAll();
  const D = require('../miniprogram/utils/domain');
  const login = await local.login({});
  const childId = login.childId;
  const unlock = await local.unlockParent({ pin: local.DEFAULT_PIN });
  const token = unlock.parentToken;
  const created = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '读书', icon: '📚', score: 3, priority: 'high' } });
  const taskId = created.task._id;

  const today = D.ymd(new Date());
  const d1 = D.addDays(today, -4), d2 = D.addDays(today, -3),
        d3 = D.addDays(today, -2), d4 = D.addDays(today, -1);

  // 还原用户操作顺序：先打今天，再从日历乱序补录前 4 天
  const first = await local.checkIn({ childId, taskId, date: today, parentToken: token });
  assert.strictEqual(first.ok, true);
  for (const d of [d3, d4, d1]) {
    const r = await local.checkIn({ childId, taskId, date: d, parentToken: token });
    assert.strictEqual(r.ok, true);   // 补录中间态：流水未连成链，返回值 < 5 是正确行为
  }
  const last = await local.checkIn({ childId, taskId, date: d2, parentToken: token });
  assert.strictEqual(last.ok, true);
  assert.strictEqual(last.streak, 5);  // 全部补完后：14–18 连成链，返回 5

  const dash = await local.getDashboard({ childId });
  assert.strictEqual(dash.streak, 5);            // 旧计数器口径会算出 3
  assert.strictEqual(dash.level, 2);             // 5 天 → 2 星（阈值 ≥4→2, ≥10→3）

  // 今天没打、只补录了昨天 → 看板显示 1（昨天的连续延续显示，不归零）
  await local.resetAll();
  const login2 = await local.login({});
  const unlock2 = await local.unlockParent({ pin: local.DEFAULT_PIN });
  const created2 = await local.taskCRUD({ op: 'create', parentToken: unlock2.parentToken, payload: { childId: login2.childId, title: '读书', icon: '📚', score: 3, priority: 'high' } });
  await local.checkIn({ childId: login2.childId, taskId: created2.task._id, date: D.addDays(today, -1), parentToken: unlock2.parentToken });
  const dash2 = await local.getDashboard({ childId: login2.childId });
  assert.strictEqual(dash2.streak, 1);
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

test('动态：聚合全部宝宝的打卡/兑换，撤销可回退星星·连续天数·限次', async () => {
  const D = require('../miniprogram/utils/domain');
  await local.resetAll();
  const login = await local.login({});
  const unlock = await local.unlockParent({ pin: local.DEFAULT_PIN });
  const token = unlock.parentToken;
  const today = D.ymd(new Date());

  // 建一个任务与一个「仅一次」奖励（避开 seed 数据，便于精确断言）
  const t = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId: login.childId, title: '读书', icon: '📚', score: 3, date: today } });
  const rw = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId: login.childId, title: '冰淇淋', icon: '🍦', cost: 2, resetAfterRedeem: false } });

  // 二宝也打一次卡 → 动态需聚合「全部宝宝」
  const mk = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '二宝', avatar: '🐣' } });
  const c2 = mk.child._id;
  const t2 = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId: c2, title: '刷牙', icon: '🪥', score: 2, date: today } });

  await local.checkIn({ childId: login.childId, taskId: t.task._id, date: today, parentToken: token });
  await local.checkIn({ childId: c2, taskId: t2.task._id, date: today, parentToken: token });

  let feed = await local.feedCRUD({ op: 'list', limit: 30, skip: 0 });
  assert.strictEqual(feed.ok, true);
  assert.strictEqual(feed.total, 2);
  assert.strictEqual(feed.hasMore, false);
  // 时间倒序
  for (let i = 1; i < feed.items.length; i++) {
    assert.ok(feed.items[i - 1].createdAt >= feed.items[i].createdAt);
  }
  const itemA = feed.items.find(i => i.refId === t.task._id);
  assert.strictEqual(itemA.kind, 'checkin');
  assert.strictEqual(itemA.title, '读书');
  assert.strictEqual(itemA.icon, '📚');
  assert.strictEqual(itemA.delta, 3);            // 打卡 +3
  assert.strictEqual(itemA.date, today);
  assert.strictEqual(itemA.childName, '宝宝');   // 默认档案名
  const itemB = feed.items.find(i => i.refId === t2.task._id);
  assert.strictEqual(itemB.childName, '二宝');   // 跨宝宝聚合
  assert.strictEqual(itemB.childAvatar, '🐣');

  // 分页
  const p1 = await local.feedCRUD({ op: 'list', limit: 1, skip: 0 });
  assert.strictEqual(p1.items.length, 1);
  assert.strictEqual(p1.hasMore, true);
  const p2 = await local.feedCRUD({ op: 'list', limit: 1, skip: 1 });
  assert.strictEqual(p2.items.length, 1);
  assert.notStrictEqual(p2.items[0].id, p1.items[0].id);

  // 兑换 → 动态出现扣减记录
  await local.redeem({ childId: login.childId, rewardId: rw.reward._id, parentToken: token });
  feed = await local.feedCRUD({ op: 'list' });
  const itemR = feed.items.find(i => i.kind === 'redeem');
  assert.strictEqual(itemR.title, '冰淇淋');
  assert.strictEqual(itemR.delta, -2);           // 兑换 -2
  assert.strictEqual(itemR.category, 'reward');
  assert.strictEqual(itemR.resetAfterRedeem, false);
  let dash = await local.getDashboard({ childId: login.childId });
  assert.strictEqual(dash.totalStars, 1);        // 3 - 2

  // 限次奖励二次兑换被拒
  const again = await local.redeem({ childId: login.childId, rewardId: rw.reward._id, parentToken: token });
  assert.strictEqual(again.code, 'ALREADY_REDEEMED');

  // 取消兑换：返还星星 + 限次恢复可兑
  const noTok = await local.feedCRUD({ op: 'undoRedeem', id: itemR.id, parentToken: 'x' });
  assert.strictEqual(noTok.code, 'TOKEN_INVALID');
  const ur = await local.feedCRUD({ op: 'undoRedeem', id: itemR.id, parentToken: token });
  assert.strictEqual(ur.ok, true);
  assert.strictEqual(ur.totalStars, 3);          // 返还 2
  dash = await local.getDashboard({ childId: login.childId });
  assert.strictEqual(dash.totalStars, 3);
  assert.strictEqual(dash.rewards.find(r => r._id === rw.reward._id).redeemed, false);  // 恢复可兑
  // 反向流水只作审计，不在动态列表展示
  feed = await local.feedCRUD({ op: 'list' });
  assert.ok(feed.items.every(i => i.kind === 'checkin' || i.kind === 'redeem'));
  assert.ok(!feed.items.some(i => i.id === itemR.id));   // 已取消的兑换记录消失

  // 标记为未完成：扣回星星 + 记录删除 + 任务回到未完成 + 连续天数重算
  const uc = await local.feedCRUD({ op: 'undoCheckIn', id: itemA.id, parentToken: token });
  assert.strictEqual(uc.ok, true);
  assert.strictEqual(uc.totalStars, 0);          // 扣回 3
  assert.strictEqual(uc.streak, 0);              // 唯一打卡被撤销 → 连续归零
  assert.strictEqual(uc.level, 1);
  dash = await local.getDashboard({ childId: login.childId });
  assert.strictEqual(dash.totalStars, 0);
  assert.strictEqual(dash.streak, 0);
  assert.ok(!dash.checkIns.some(c => c.taskId === t.task._id));         // 打卡记录已删
  assert.strictEqual(dash.todayTasks.find(x => x.taskId === t.task._id).checked, false);

  // 重复撤销 → 记录已不存在
  const uc2 = await local.feedCRUD({ op: 'undoCheckIn', id: itemA.id, parentToken: token });
  assert.strictEqual(uc2.code, 'NOT_FOUND');

  // 撤销后可重新打卡
  const redo = await local.checkIn({ childId: login.childId, taskId: t.task._id, date: today, parentToken: token });
  assert.strictEqual(redo.ok, true);
  assert.strictEqual(redo.totalStars, 3);

  // 任务被软删后，历史动态仍能显示名字/图标（不过滤 deleted）
  await local.taskCRUD({ op: 'delete', parentToken: token, payload: { id: t.task._id } });
  const feed3 = await local.feedCRUD({ op: 'list' });
  const it3 = feed3.items.find(i => i.refId === t.task._id && i.kind === 'checkin');
  assert.strictEqual(it3.title, '读书');
  assert.strictEqual(it3.deleted, true);
});

test('R10：本地层 unlockParent 支持 silent 静默解锁（免 PIN）', async () => {
  await local.resetAll();
  const login = await local.login({});
  assert.strictEqual(login.pinSet, true);   // 建号即带默认 PIN
  const CFG = require('../miniprogram/config');

  // 1. 未设 PIN 的账号即便 silent 也拒绝（引导走正常「我」页流程）
  store.xy_user = Object.assign({}, store.xy_user, { pinSet: false, pinHash: '' });
  const noPin = await local.unlockParent({ silent: true });
  assert.strictEqual(noPin.ok, false);
  assert.strictEqual(noPin.code, 'PIN_NOT_SET');

  // 重新登录触发迁移，pinSet 复位为 true
  await local.login({});

  // 2. silent 静默解锁：即便 PIN 错误也能签发令牌（绕过 PIN 校验）
  const silent = await local.unlockParent({ silent: true, pin: '000000' });
  assert.strictEqual(silent.ok, true);
  assert.ok(silent.parentToken);
  // 令牌有效期为 PARENT_IDLE_MS（15 分钟），容差 ±2 秒
  const ttl = silent.expireAt - Date.now();
  assert.ok(ttl > 14 * 60 * 1000 && ttl <= 15 * 60 * 1000 + 2000, 'silent 令牌 TTL 应为 15 分钟，实际 ' + ttl);

  // 3. 非 silent 仍需正确 PIN（silent 之外 PIN 校验一切照旧）
  const wrongPin = await local.unlockParent({ pin: '000000' });
  assert.strictEqual(wrongPin.code, 'PIN_INVALID');
  const rightPin = await local.unlockParent({ pin: local.DEFAULT_PIN });
  assert.strictEqual(rightPin.ok, true);
});
