// cloudfunctions/lib/checkInCore.js —— 打卡核心（纯函数）
// child { totalStars, streak, lastCheckInDate } + score + date -> 更新字段
// 规则：昨日有打卡则 streak+1；否则重置为 1；同日不重复计（唯一约束在 DB 层拦截）
const { addDays } = require('./util');
const { levelOf } = require('./level');

function applyCheckIn(child, score, date) {
  const totalStars = (child.totalStars || 0) + (Number(score) || 0);
  const last = child.lastCheckInDate;
  let streak;
  if (last === date) {
    streak = child.streak || 1;
  } else if (last === addDays(date, -1)) {
    streak = (child.streak || 0) + 1;
  } else {
    streak = 1;
  }
  return { totalStars, streak, lastCheckInDate: date, level: levelOf(streak) };
}

module.exports = { applyCheckIn };
