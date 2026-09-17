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

module.exports = { streakOf };
