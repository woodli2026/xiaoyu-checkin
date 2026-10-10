// @ts-check
// utils/domain.js —— 前端纯逻辑（无 wx / 无 IO，可被前端兜底层与测试直接复用）
// 覆盖：日期工具 / 连续天数 / 星级 / 令牌签发校验 / 打卡核 / 兑换核
//
// 【D1 单源（2026-10-10）】下方 SLOT 段落由 `npm run gen:mirror` 从 cloudfunctions/lib/*
// 注入，请勿手改 SLOT 内内容（改源后跑 gen:mirror；`npm run verify:mirror` 会校验）。
// 令牌（Map/对象版，本地兜底专用）与家长空闲计时是前端特有逻辑，保留手写。

// ==MIRROR-SLOT:util (AUTO-GENERATED ← cloudfunctions/lib/util.js)==
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, n) {
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2]);
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}
// ==MIRROR-SLOT-END==

// ==MIRROR-SLOT:streak (AUTO-GENERATED ← cloudfunctions/lib/streak.js)==
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
// ==MIRROR-SLOT-END==

// ==MIRROR-SLOT:level (AUTO-GENERATED ← cloudfunctions/lib/level.js)==
// 星级评定：≥25→5, ≥18→4, ≥10→3, ≥4→2, 否则 1
function levelOf(streak) {
  const n = Number(streak) || 0;
  if (n >= 25) return 5;
  if (n >= 18) return 4;
  if (n >= 10) return 3;
  if (n >= 4) return 2;
  return 1;
}
// ==MIRROR-SLOT-END==

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

// ==MIRROR-SLOT:checkInCore (AUTO-GENERATED ← cloudfunctions/lib/checkInCore.js)==
// 打卡核心：child { totalStars } + score + date -> 新字段
// 规则：只累加星星；同日不重复计（外部已拦截）。
// 连续天数**不再落库**：历史 child.streak 增量计数器在补打卡场景会算错，
// 展示一律由打卡流水重推 displayStreak（见 lib/streak.js；2026-09-18 修复口径、
// 2026-10-10 移除该死字段）。
function applyCheckIn(child, score, date) {
  const totalStars = (child.totalStars || 0) + (Number(score) || 0);
  return { totalStars, lastCheckInDate: date };
}
// ==MIRROR-SLOT-END==

// ==MIRROR-SLOT:redeemCore (AUTO-GENERATED ← cloudfunctions/lib/redeemCore.js)==
// 兑换核心（2026-09-17 调整）：奖励**不再有库存**，限次改由「是否已兑换过」承担。
//   resetAfterRedeem = true  → 兑换后不记完成，可反复兑换（只受星星余额约束）
//   resetAfterRedeem = false → 每位孩子只能兑换一次
function applyRedeem(child, reward) {
  const totalStars = (child.totalStars || 0) - (Number(reward && reward.cost) || 0);
  return { totalStars };
}

// 能否兑换：返回 null 表示可以，否则返回错误码
function redeemBlockReason(child, reward, alreadyRedeemed) {
  if (!reward) return 'REWARD_NOT_FOUND';
  const cost = Number(reward.cost) || 0;
  if (cost < 1) return 'INVALID';
  if (!reward.resetAfterRedeem && alreadyRedeemed) return 'ALREADY_REDEEMED';
  if (((child && child.totalStars) || 0) < cost) return 'INSUFFICIENT';
  return null;
}
// ==MIRROR-SLOT-END==

// 家长模式空闲计时：最后一次交互后超过 idleMs 即判定超时（用于 15 分钟自动关闭）
function isIdleExpired(lastActive, now, idleMs) {
  if (!lastActive) return false;          // 未进入家长模式 / 无交互记录 → 不超时
  return (now || Date.now()) - lastActive > idleMs;
}

module.exports = {
  ymd, addDays, streakOf, displayStreak, levelOf,
  randHex, issueToken, verifyToken, isIdleExpired,
  applyCheckIn, applyRedeem, redeemBlockReason
};
