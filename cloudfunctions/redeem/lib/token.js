// cloudfunctions/lib/token.js —— 家长令牌：无状态 HMAC 签名
//
// 【设计说明 / 对详细计划的修正】
// 详细计划原定用「服务端 Map 作 store」。但在微信云开发中，8 个云函数各自运行在
// 独立实例、内存不共享，unlockParent 写入的 Map 在 checkIn 中读不到，方案不可行。
// 因此改为「无状态签名令牌」：unlockParent 用服务端密钥对 {openid, expireAt} 做
// HMAC-SHA256 签名，任何写函数都能独立校验签名与过期时间，无需共享内存 —— 且
// 仍满足「必须持有效 parentToken 才能写」的防越权要求（PRD §3 安全）。
//
// 【D6 安全修复 / 2026-10-09】
// 旧实现为 `const SECRET = process.env.XY_TOKEN_SECRET || 'xiaoyu-dev-secret-change-me'`，
// 即环境变量缺失时**回退到硬编码的公开弱密钥**：云函数照常运行、家长令牌可被任何人伪造，
// 而运维侧完全看不出异常（静默失败，最危险的那种）。
// 现改为：环境变量缺失即在**使用点抛错**（fail-fast）。
// 注意必须是「惰性」校验 —— 若在模块加载时抛错，会打挂 __tests__（测试环境不配密钥），
// 且测试用显式传参绕过。由 __tests__/secret-guard.test.js 守卫，防止回退。
const crypto = require('crypto');

function getSecret(secret) {
  const s = secret || process.env.XY_TOKEN_SECRET;
  if (!s) {
    throw new Error('XY_TOKEN_SECRET 未配置：必须在云函数环境变量中设置家长令牌 HMAC 密钥，否则无法签发/校验令牌');
  }
  return s;
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', getSecret(secret)).update(payload).digest('hex');
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

module.exports = { getSecret, sign, randHex, issueToken, verifyToken };
