// cloudfunctions/lib/runtime.js
//
// 授权与执行上下文深模块（候选 A 深化落地）。
//
// 背景：13 个云函数 index.js 各自内联手写了「OPENID 解析 → 用户解析 → 令牌校验 →
// 归属校验」的横切逻辑，字面同源但无单一来源——这正是 B/B′ 之前"人工对齐、
// 测试全绿却线上漂移"的同一种病。本模块把它们收敛成单一来源，让 13 个云函数
// 退化成纯业务编排薄壳。
//
// 设计边界（重要）：
//   - 只收敛「前置校验」这一浅且重复的接缝；业务 db 编排（读哪些集合、事务写哪些、
//     投影形状）各自独特，留在各 index.js，不被表驱动压平（那会反成巨型 switch，更浅）。
//   - 不侵入业务错误语义：resolveCaller 只归一 AUTH_FAIL；assertToken 只归一口径；
//     ownedChild 返回 child|null，由调用方决定 CHILD_NOT_FOUND / FORBIDDEN 等码。
//   - 特例（setPin 条件性 token、login 自建号、unlockParent 签发 token）保留在各自
//     index.js 手写字面，不强行进表。
const { cloud, fail, getUserByOpenid, getOwnedChild } = require('./cloud');
const { verifyToken } = require('./token');

// 解析调用方身份。返回 { OPENID, user } 或 { fail }。
async function resolveCaller(event) {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { fail: fail('AUTH_FAIL', '缺少 openid') };
  const user = await getUserByOpenid(OPENID);
  if (!user) return { fail: fail('AUTH_FAIL', '未登录') };
  return { OPENID, user };
}

// 校验家长令牌（无条件）。通过返回 null，失败返回 fail 对象。
function assertToken(event, OPENID) {
  if (!verifyToken(event.parentToken, OPENID)) {
    return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  }
  return null;
}

// 取归属孩子。返回 child 或 null（由调用方决定失败码）。
async function ownedChild(OPENID, childId) {
  const child = await getOwnedChild(OPENID, childId);
  return child || null;
}

module.exports = { resolveCaller, assertToken, ownedChild };
