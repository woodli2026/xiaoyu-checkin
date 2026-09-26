// cloudfunctions/lib/streak.js —— 连续打卡天数（纯函数）
const { addDays } = require('./util');

// 从 asOf 向前数「连续含打卡」的天数
function streakOf(datesOrSet, asOf) {
  const set = datesOrSet instanceof Set ? datesOrSet : new Set(datesOrSet || []);
  let s = 0;
  let cur = asOf;
  while (set.has(cur)) { s++; cur = addDays(cur, -1); }
  return s;
}

// 展示口径的连续天数：由打卡流水推导（增量计数器 child.streak 在「补打卡」场景不可靠，
// 2026-09-18 修复：日历给过去日期补打卡会把计数器算错，展示一律用流水重推）。
// 规则：今天已打卡 → 从今天往前数；今天还没打 → 从昨天往前数（昨天的连续今天仍延续显示）。
function displayStreak(datesOrSet, today) {
  const set = datesOrSet instanceof Set ? datesOrSet : new Set(datesOrSet || []);
  return streakOf(set, set.has(today) ? today : addDays(today, -1));
}

module.exports = { streakOf, displayStreak };
