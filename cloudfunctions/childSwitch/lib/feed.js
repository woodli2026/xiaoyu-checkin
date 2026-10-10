// cloudfunctions/lib/feed.js —— 动态（活动流水）列表数据聚合（纯函数，单一来源）
//
// 设计边界：只做「原始记录 → 列表项」的 join/投影 + 排序 + 分页，不碰 db、不读 context。
// 数据获取（db.collection().where().get()，含 _.in 聚合全部宝宝）留在 feedCRUD/index.js；
// 展示层格式化（按天分组、今天/昨天/时间文案）在 miniprogram/utils/feed.js 的 groupByDay 处理。
// 本地镜像见 miniprogram/utils/feed.js#buildFeed，两端共用同一份逻辑防漂移。
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// raw: { children, tasks, rewards, checkIns, redemptions, limit, skip }
//   - children：已按 ownerId 过滤软删的宝宝列表
//   - tasks / rewards：全部宝宝任务/奖励（故意不过滤 deleted，历史动态要显示已删条目的名字与图标）
//   - checkIns / redemptions：全部宝宝打卡/兑换记录
//   - limit / skip：分页参数（未提供则用默认/上限）
function buildFeed(raw) {
  const { children, tasks, rewards, checkIns, redemptions, limit, skip } = raw;
  const childMap = {};
  (children || []).forEach(c => { childMap[c._id] = c; });
  const taskMap = {};
  (tasks || []).forEach(t => { taskMap[t._id] = t; });
  const rewardMap = {};
  (rewards || []).forEach(r => { rewardMap[r._id] = r; });

  const items = [];
  (checkIns || []).forEach(ci => {
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
  (redemptions || []).forEach(rd => {
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
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sk = Math.max(Number(skip) || 0, 0);
  const page = items.slice(sk, sk + lim);
  return { items: page, hasMore: sk + page.length < total, total };
}

module.exports = { buildFeed, DEFAULT_LIMIT, MAX_LIMIT };
