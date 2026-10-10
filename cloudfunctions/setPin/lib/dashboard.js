// cloudfunctions/lib/dashboard.js —— 看板视图聚合（纯函数，单一来源）
//
// 设计边界：只做「原始记录 → 视图模型」的投影/组装，不碰 db、不读 context。
// 数据获取（db.collection().where().get()）留在各端 index.js；本模块是纯计算层，
// 因此云端与本地可共用同一份逻辑（本地镜像见 miniprogram/utils/dashboard.js），
// 从根上消除「两端各写一遍看板组装」的漂移风险。
const { taskVisibleOn } = require('./visibility');
const { displayStreak } = require('./streak');
const { levelOf } = require('./level');

// 宝宝档案投影（看板返回的 child / children 共用）
function childView(c) {
  return {
    _id: c._id, name: c.name, avatar: c.avatar, photo: c.photo || '',
    gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
  };
}

// raw: { today, children, child, tasks, rewards, redemptions, checkIns }
//   - children / child：已按 ownerId 过滤软删后的宝宝列表与当前选中宝宝
//   - tasks：已按 childId 过滤软删、按 createdAt 升序的任务文档（原始 doc，原样透出）
//   - rewards：同上（原始 doc），本函数补 redeemed / redeemId
//   - redemptions：该孩子的兑换记录（原始 doc）
//   - checkIns：该孩子的打卡记录（原始 doc）
function buildDashboard(raw) {
  const { today, children, child, tasks, rewards, redemptions, checkIns } = raw;

  // 限次奖励「是否已兑换过」：取代原库存概念
  const redeemedIds = new Set((redemptions || []).map(r => r.rewardId));
  const redMap = {};
  (redemptions || []).forEach(r => { redMap[r.rewardId] = r._id; });
  const rewardsView = (rewards || []).map(r =>
    Object.assign({}, r, { redeemed: redeemedIds.has(r._id), redeemId: redMap[r._id] || null }));

  // 今日任务（按可见性规则过滤 + 投影）
  const doneToday = new Set((checkIns || []).filter(c => c.date === today).map(c => c.taskId));
  const todayTasks = (tasks || [])
    .filter(t => taskVisibleOn(t, today))
    .map(t => ({
      taskId: t._id, title: t.title, icon: t.icon, score: t.score,
      priority: t.priority, type: t.type, checked: doneToday.has(t._id)
    }));

  // 当月点亮日期（去重升序）
  const ym = today.slice(0, 7);
  const monthLit = Array.from(new Set(
    (checkIns || []).filter(c => String(c.date).slice(0, 7) === ym).map(c => c.date)
  )).sort();

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const streak = displayStreak(new Set((checkIns || []).map(c => c.date)), today);

  return {
    totalStars: child.totalStars || 0,
    streak,
    level: levelOf(streak),
    monthLit,
    todayTasks,
    tasks: tasks || [],
    rewards: rewardsView,
    checkIns: (checkIns || []).map(c => ({ id: c._id, taskId: c.taskId, date: c.date })),
    child: childView(child),
    children: (children || []).map(childView)
  };
}

module.exports = { childView, buildDashboard };
