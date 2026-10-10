// miniprogram/utils/dashboard.js —— 看板视图聚合（纯函数）
// 云端镜像：cloudfunctions/lib/dashboard.js。两端逻辑必须逐字一致（由 aggregate-guard 守卫）。
// 仅做「原始记录 → 视图模型」投影，无 wx / storage 依赖，可单测。
const D = require('./domain');
const T = require('./tasks');

function childView(c) {
  return {
    _id: c._id, name: c.name, avatar: c.avatar, photo: c.photo || '',
    gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
  };
}

// raw: { today, children, child, tasks, rewards, redemptions, checkIns }
function buildDashboard(raw) {
  const { today, children, child, tasks, rewards, redemptions, checkIns } = raw;

  const redeemedIds = new Set((redemptions || []).map(r => r.rewardId));
  const redMap = {};
  (redemptions || []).forEach(r => { redMap[r.rewardId] = r._id; });
  const rewardsView = (rewards || []).map(r =>
    Object.assign({}, r, { redeemed: redeemedIds.has(r._id), redeemId: redMap[r._id] || null }));

  const doneToday = new Set((checkIns || []).filter(c => c.date === today).map(c => c.taskId));
  const todayTasks = (tasks || [])
    .filter(t => T.taskVisibleOn(t, today))
    .map(t => ({
      taskId: t._id, title: t.title, icon: t.icon, score: t.score,
      priority: t.priority, type: t.type, checked: doneToday.has(t._id)
    }));

  const ym = today.slice(0, 7);
  const monthLit = Array.from(new Set(
    (checkIns || []).filter(c => String(c.date).slice(0, 7) === ym).map(c => c.date)
  )).sort();

  const streak = D.displayStreak(new Set((checkIns || []).map(c => c.date)), today);

  return {
    totalStars: child.totalStars || 0,
    streak,
    level: D.levelOf(streak),
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
