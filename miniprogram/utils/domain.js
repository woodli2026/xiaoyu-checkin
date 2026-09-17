// utils/domain.js —— 纯逻辑（无 wx / 无 IO，可被前端兜底层与 jest 直接复用）
// 覆盖：日期工具 / 连续天数 / 星级 / 令牌签发校验 / 打卡核 / 兑换核

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 任意 Date|字符串 -> 'YYYY-MM-DD'
function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 'YYYY-MM-DD' 加减天数
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}

// 从 asOf 向前数「连续含打卡」的天数
function streakOf(datesSet, asOf) {
  const set = datesSet instanceof Set ? datesSet : new Set(datesSet || []);
  let s = 0;
  let cur = asOf;
  while (set.has(cur)) { s++; cur = addDays(cur, -1); }
  return s;
}

// 星级评定：≥25→5, ≥18→4, ≥10→3, ≥4→2, 否则 1
function levelOf(streak) {
  const n = Number(streak) || 0;
  if (n >= 25) return 5;
  if (n >= 18) return 4;
  if (n >= 10) return 3;
  if (n >= 4) return 2;
  return 1;
}

function randHex(len) {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

// 令牌签发：32 位 hex + expireAt（默认 5 分钟）
function issueToken(ttlMs) {
  const token = randHex(32);
  const expireAt = Date.now() + (ttlMs || 5 * 60 * 1000);
  return { token, expireAt };
}

// 令牌校验：store 支持 Map 或普通对象
function verifyToken(token, store, now) {
  if (!token || !store) return false;
  const rec = typeof store.get === 'function' ? store.get(token) : store[token];
  if (!rec) return false;
  return rec.expireAt > (now || Date.now());
}

// 打卡核心：child { totalStars, streak, lastCheckInDate } + score + date -> 新字段
// 规则：昨日有打卡则 +1；否则重置为 1；同日不重复计（外部已拦截）
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

// 兑换核心（2026-09-17 调整）：奖励**不再有库存**，限次改由「是否已兑换过」承担。
//   resetAfterRedeem = true  → 兑换后不记完成，可反复兑换（只受星星余额约束）
//   resetAfterRedeem = false → 每位孩子只能兑换一次
function applyRedeem(child, reward) {
  const totalStars = (child.totalStars || 0) - (Number(reward && reward.cost) || 0);
  return { totalStars };
}

// 能否兑换：返回 null 表示可以，否则返回错误码
// （与 cloudfunctions/lib/redeemCore.js 同口径，两处由测试守卫一致）
function redeemBlockReason(child, reward, alreadyRedeemed) {
  if (!reward) return 'REWARD_NOT_FOUND';
  const cost = Number(reward.cost) || 0;
  if (cost < 1) return 'INVALID';
  if (!reward.resetAfterRedeem && alreadyRedeemed) return 'ALREADY_REDEEMED';
  if (((child && child.totalStars) || 0) < cost) return 'INSUFFICIENT';
  return null;
}

module.exports = {
  ymd, addDays, streakOf, levelOf,
  randHex, issueToken, verifyToken,
  applyCheckIn, applyRedeem, redeemBlockReason
};
