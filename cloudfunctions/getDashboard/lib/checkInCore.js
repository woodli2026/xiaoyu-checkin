// cloudfunctions/lib/checkInCore.js —— 打卡核心（纯函数）
// child { totalStars } + score + date -> 更新字段
// 规则：只累加星星；同日不重复计（唯一约束在 DB 层拦截）。
// 连续天数**不再落库**：历史 child.streak 增量计数器在「补打卡」场景会算错，
// 展示一律由打卡流水重推（见 lib/streak.js#displayStreak）。2026-09-18 修复展示口径，
// 2026-10-10 移除该死字段（写而不读）。
function applyCheckIn(child, score, date) {
  const totalStars = (child.totalStars || 0) + (Number(score) || 0);
  return { totalStars, lastCheckInDate: date };
}

module.exports = { applyCheckIn };
