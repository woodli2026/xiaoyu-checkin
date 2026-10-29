// services/local/points.js —— 本地版 pointsLog 读取（候选④，本地独占 op）
//
// 云端当前只写不读（O2），故本 op 为本地独占，无云端对应实现。
// 聚合口径全部来自 utils/points.js#aggregatePointsLog（单一来源），本文件只做「读存储 + 调聚合」。
const { allPoints } = require('./store');
const { aggregatePointsLog } = require('../../utils/points');

// 本地独占 op：返回某宝宝的星星收支聚合（O2 数据源）。
// params: { childId: string }
function pointsLog(params) {
  params = params || {};
  const agg = aggregatePointsLog(allPoints(), { childId: params.childId });
  return Object.assign({ ok: true, childId: params.childId || null }, agg);
}

module.exports = { pointsLog };
