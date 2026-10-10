// cloudfunctions/lib/checkInCore.js —— 打卡核心（纯函数）
// 【D1 单源】下方 SECTION 镜像到 miniprogram/utils/domain.js 的 SLOT:checkInCore（gen:mirror 注入）。
// ==MIRROR-SECTION:checkInCore==
// 打卡核心：child { totalStars } + score -> 新字段
// 规则：只累加星星；同日不重复计（外部已拦截）；**不落库任何派生字段**。
// 连续天数由打卡流水重推 displayStreak（见 lib/streak.js，2026-09-18 修复口径）。
// 历史死字段 child.streak 与 child.lastCheckInDate 均已于 2026-10-10 停写移除。
function applyCheckIn(child, score) {
  const totalStars = (child.totalStars || 0) + (Number(score) || 0);
  return { totalStars };
}
// ==MIRROR-SECTION-END==

module.exports = { applyCheckIn };
