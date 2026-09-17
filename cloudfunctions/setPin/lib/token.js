// cloudfunctions/lib/token.js —— 家长令牌：无状态 HMAC 签名
//
// 【设计说明 / 对详细计划的修正】
// 详细计划原定用「服务端 Map 作 store」。但在微信云开发中，8 个云函数各自运行在
// 独立实例、内存不共享，unlockParent 写入的 Map 在 checkIn 中读不到，方案不可行。
// 因此改为「无状态签名令牌」：unlockParent 用服务端密钥对 {openid, expireAt} 做
// HMAC-SHA256 签名，任何写函数都能独立校验签名与过期时间，无需共享内存 —— 且
// 仍满足「必须持有效 parentToken 才能写」的防越权要求（PRD §3 安全）。
const crypto = require('crypto');

const SECRET = process.env.XY_TOKEN_SECRET || 'xiaoyu-dev-secret-change-me';

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret || SECRET).update(payload).digest('hex');
}

function randHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

// 签发：token = base64url(payload) + '.' + hmac
function issueToken(openid, ttlMs, secret) {
  const expireAt = Date.now() + (ttlMs || 5 * 60 * 1000);
  const payload = Buffer.from(JSON.stringify({ openid, expireAt })).toString('base64url');
  const token = payload + '.' + sign(payload, secret);
  return { token, expireAt };
}

// 校验：签名一致 + 未过期 + openid 匹配
function verifyToken(token, openid, secret, now) {
  if (!token || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.');
  if (i <= 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (sign(payload, secret) !== sig) return false;
  let obj;
  try { obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch (e) { return false; }
  if (!obj || !obj.expireAt || obj.expireAt <= (now || Date.now())) return false;
  if (openid && obj.openid !== openid) return false;
  return true;
}

module.exports = { SECRET, sign, randHex, issueToken, verifyToken };
