// utils/points.js —— pointsLog 聚合（候选④：O2「星星收支」数据源，V1.1b 统计后台地基）
//
// 纯函数，无 wx / 存储依赖，可单测。本地 / 云端共用同一聚合口径（云端当前只写不读，O2；
// 待 V1.1b 统计后台启用时，本文件升格为 cloudfunctions/lib 唯一源并镜像到此处）。
//
// 设计要点：
//   · earned = 所有正 delta 之和；spent = 所有负 delta 的绝对值之和；net = 二者之差。
//   · count = 参与聚合的流水条数；byRefType 按 refType 再分桶，供「按来源看收支」使用。
//   · 支持 childId 过滤与时间窗（sinceMs/untilMs，单位 epoch ms），时间窗用于「本月 / 近 30 天」等统计。
//   · 不依赖流水完整性：running balance（child.totalStars）存在 child 上，裁剪旧流水不影响余额。
function aggregatePointsLog(entries, opts) {
  opts = opts || {};
  const childId = opts.childId;
  const sinceMs = (typeof opts.sinceMs === 'number') ? opts.sinceMs : null;
  const untilMs = (typeof opts.untilMs === 'number') ? opts.untilMs : null;
  const list = Array.isArray(entries) ? entries : [];
  let earned = 0;
  let spent = 0;
  let count = 0;
  const byRefType = {};
  for (const e of list) {
    if (childId != null && e.childId !== childId) continue;
    const t = (typeof e.createdAt === 'number') ? e.createdAt : null;
    if (sinceMs != null && t != null && t < sinceMs) continue;
    if (untilMs != null && t != null && t > untilMs) continue;
    const d = Number(e.delta) || 0;
    if (d > 0) earned += d;
    else if (d < 0) spent += -d;
    count++;
    const rt = e.refType || 'unknown';
    if (!byRefType[rt]) byRefType[rt] = { delta: 0, count: 0 };
    byRefType[rt].delta += d;
    byRefType[rt].count++;
  }
  return { earned, spent, net: earned - spent, count, byRefType };
}

module.exports = { aggregatePointsLog };
