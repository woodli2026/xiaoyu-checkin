// cloudfunctions/lib/checkInCore.js —— 打卡核心（纯函数）
// 【D1 单源】下方 SECTION 镜像到 miniprogram/utils/domain.js 的 SLOT:checkInCore（gen:mirror 注入）。
// ==MIRROR-SECTION:checkInCore==
// 打卡核心：child { totalStars } + score + date -> 新字段
// 规则：只累加星星；同日不重复计（外部已拦截）。
// 连续天数**不再落库**：历史 child.streak 增量计数器在补打卡场景会算错，
// 展示一律由打卡流水重推 displayStreak（见 lib/streak.js；2026-09-18 修复口径、
// 2026-10-10 移除该死字段）。
function applyCheckIn(child, score, date) {
  const totalStars = (child.totalStars || 0) + (Number(score) || 0);
  return { totalStars, lastCheckInDate: date };
}
// ==MIRROR-SECTION-END==

module.exports = { applyCheckIn };
