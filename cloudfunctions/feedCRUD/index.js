// cloudfunctions/feedCRUD —— 动态（活动流水）
//
// 【设计说明 / 对 PRD 的偏离 #8】
// PRD 无「动态」页。经确认新增：在第 3 个 tab（「任务屋」之后）展示
// 全部宝宝的打卡与兑换记录，并可撤销（任务→标记为未完成；奖励→取消兑换）。
//
//   op=list        只读，按账号聚合**全部宝宝**的打卡 + 兑换，按时间倒序分页
//   op=undoCheckIn 写，须持有效 parentToken；删除该次打卡 + 扣回星星 + 追加反向流水
//   op=undoRedeem  写，须持有效 parentToken；删除该次兑换 + 返还星星 + 追加反向流水
//
// 【口径要点】
// 1) 任务/奖励**故意不过滤 deleted** —— 历史动态要能显示已删条目的名字与图标。
// 2) 反向流水（refType=checkin_undo / redeem_undo）只作审计留痕，不在动态列表展示。
// 3) 撤销打卡后连续天数/星级由打卡流水推导（lib/streak.displayStreak），自动重算。
// 4) 取消兑换会删除 redemptions 记录 → 限次奖励（resetAfterRedeem=false）自动恢复可兑。
const { cloud, db, _, ok, fail, getUserByOpenid } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');
const { displayStreak } = require('./lib/streak');
const { levelOf } = require('./lib/level');
const { ymd } = require('./lib/util');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
// 单类型最多参与聚合的记录数（客户端分页在内存完成，避免两类记录跨表分页的复杂度）
const SCAN_LIMIT = 500;

async function ownedChild(user, childId) {
  const d = await db.collection('children').doc(childId).get().catch(() => null);
  const c = d && d.data;
  if (!c || c.ownerId !== user._id || c.deleted) return null;
  return c;
}

async function listFeed(user, event) {
  const limit = Math.min(Math.max(Number(event.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const skip = Math.max(Number(event.skip) || 0, 0);

  const childrenRes = await db.collection('children')
    .where({ ownerId: user._id }).limit(50).get();
  const children = childrenRes.data.filter(c => !c.deleted);
  if (!children.length) return ok({ items: [], hasMore: false, total: 0 });

  const childMap = {};
  children.forEach(c => { childMap[c._id] = c; });
  const childIds = children.map(c => c._id);

  // 按 childId 聚合（老记录可能没有 ownerId）；任务/奖励不过滤 deleted
  const [tRes, rRes, ciRes, rdRes] = await Promise.all([
    db.collection('tasks').where({ childId: _.in(childIds) }).limit(SCAN_LIMIT).get(),
    db.collection('rewards').where({ childId: _.in(childIds) }).limit(SCAN_LIMIT).get(),
    db.collection('checkIns').where({ childId: _.in(childIds) }).orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get(),
    db.collection('redemptions').where({ childId: _.in(childIds) }).orderBy('createdAt', 'desc').limit(SCAN_LIMIT).get()
  ]);

  const taskMap = {};
  tRes.data.forEach(t => { taskMap[t._id] = t; });
  const rewardMap = {};
  rRes.data.forEach(r => { rewardMap[r._id] = r; });

  const items = [];
  ciRes.data.forEach(ci => {
    const c = childMap[ci.childId];
    if (!c) return;
    const t = taskMap[ci.taskId];
    const stars = Number(ci.score) || (t ? Number(t.score) : 0) || 0;
    items.push({
      id: ci._id, kind: 'checkin',
      childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
      refId: ci.taskId, title: t ? t.title : '（任务已删除）', icon: t ? t.icon : '❔',
      stars, delta: stars,
      date: ci.date || null, createdAt: ci.createdAt || 0, deleted: !!(t && t.deleted),
      // 详情用
      taskType: t ? (t.type || '') : '', repeat: t && t.repeat ? t.repeat : null,
      priority: t ? (t.priority || 'none') : 'none'
    });
  });
  rdRes.data.forEach(rd => {
    const c = childMap[rd.childId];
    if (!c) return;
    const r = rewardMap[rd.rewardId];
    const cost = Number(rd.cost) || (r ? Number(r.cost) : 0) || 0;
    items.push({
      id: rd._id, kind: 'redeem',
      childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
      refId: rd.rewardId, title: r ? r.title : '（奖励已删除）', icon: r ? r.icon : '❔',
      stars: cost, delta: -cost,
      date: null, createdAt: rd.createdAt || 0, deleted: !!(r && r.deleted),
      // 详情用
      category: r ? (r.category || 'reward') : 'reward',
      resetAfterRedeem: r ? !!r.resetAfterRedeem : true
    });
  });

  items.sort((a, b) => b.createdAt - a.createdAt);
  const total = items.length;
  const page = items.slice(skip, skip + limit);
  return ok({ items: page, hasMore: skip + page.length < total, total });
}

async function undoCheckIn(openid, user, event) {
  if (!verifyToken(event.parentToken, openid)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const ciDoc = await db.collection('checkIns').doc(event.id).get().catch(() => null);
  const ci = ciDoc && ciDoc.data;
  if (!ci) return fail('NOT_FOUND', '打卡记录不存在或已撤销');
  const child = await ownedChild(user, ci.childId);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');

  const taskDoc = await db.collection('tasks').doc(ci.taskId).get().catch(() => null);
  const task = taskDoc && taskDoc.data;
  const stars = Number(ci.score) || (task ? Number(task.score) : 0) || 0;
  const nextStars = Math.max(0, (child.totalStars || 0) - stars);
  const now = Date.now();

  await db.runTransaction(async (t) => {
    await t.collection('children').doc(child._id).update({ data: { totalStars: nextStars } });
    await t.collection('checkIns').doc(ci._id).remove();
    // 反向流水：仅审计留痕，不在动态列表展示
    await t.collection('pointsLog').add({
      data: {
        ownerId: child.ownerId, childId: child._id, delta: -stars,
        reason: '撤销打卡:' + (task ? task.title : ''), refType: 'checkin_undo', refId: ci.taskId, createdAt: now
      }
    });
  });

  const allCi = await db.collection('checkIns').where({ childId: child._id }).limit(1000).get();
  const streak = displayStreak(new Set(allCi.data.map(c => c.date)), ymd(new Date()));
  return ok({ totalStars: nextStars, streak, level: levelOf(streak), id: ci._id });
}

async function undoRedeem(openid, user, event) {
  if (!verifyToken(event.parentToken, openid)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const rdDoc = await db.collection('redemptions').doc(event.id).get().catch(() => null);
  const rd = rdDoc && rdDoc.data;
  if (!rd) return fail('NOT_FOUND', '兑换记录不存在或已取消');
  const child = await ownedChild(user, rd.childId);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');

  const rewardDoc = await db.collection('rewards').doc(rd.rewardId).get().catch(() => null);
  const reward = rewardDoc && rewardDoc.data;
  const cost = Number(rd.cost) || (reward ? Number(reward.cost) : 0) || 0;
  const nextStars = (child.totalStars || 0) + cost;
  const now = Date.now();

  await db.runTransaction(async (t) => {
    await t.collection('children').doc(child._id).update({ data: { totalStars: nextStars } });
    await t.collection('redemptions').doc(rd._id).remove();
    await t.collection('pointsLog').add({
      data: {
        ownerId: child.ownerId, childId: child._id, delta: cost,
        reason: '取消兑换:' + (reward ? reward.title : ''), refType: 'redeem_undo', refId: rd.rewardId, createdAt: now
      }
    });
  });

  return ok({ totalStars: nextStars, rewardId: rd.rewardId, id: rd._id });
}

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID, user } = r;

  if (event.op === 'list') return listFeed(user, event);
  if (event.op === 'undoCheckIn') return undoCheckIn(OPENID, user, event);
  if (event.op === 'undoRedeem') return undoRedeem(OPENID, user, event);
  return fail('INVALID', '未知操作');
};
