// services/local/dashboard.js —— 本地兜底层：看板（D3 拆分）
const { ok, fail, allChildren, allTasks, allRewards, allCheckIns, allRedemptions } = require('./store');
const D = require('../../utils/domain');
const Dash = require('../../utils/dashboard');

// ============ 看板 ============

async function getDashboard({ childId }) {
  // 过滤软删宝宝：与云端 getDashboard 同口径
  const children = allChildren().filter(c => !c.deleted);
  const child = children.find(c => c._id === childId) || children[0];
  if (!child) return fail('NO_CHILD', '无孩子档案');
  const today = D.ymd(new Date());
  const tasks = allTasks().filter(t => t.childId === child._id && !t.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
  const rewards = allRewards().filter(r => r.childId === child._id && !r.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
  const checkIns = allCheckIns().filter(c => c.childId === child._id);
  const redemptions = allRedemptions().filter(r => r.childId === child._id);

  // 纯视图聚合（与云端 buildDashboard 双份镜像，aggregate-guard 守卫）
  return ok(Dash.buildDashboard({
    today, children, child, tasks, rewards, redemptions, checkIns
  }));
}

module.exports = { getDashboard };
