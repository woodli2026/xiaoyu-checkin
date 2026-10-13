// cloudfunctions/lib/runtime.js
//
// 授权与执行上下文深模块（候选 A 深化落地；候选②归属语义拆分，2026-10-10）。
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
//     ownedChild/currentChild/ownedTask/ownedReward 返回文档或 null，
//     由调用方决定 CHILD_NOT_FOUND / FORBIDDEN / TASK_NOT_FOUND 等码。
//   - 特例（setPin 条件性 token、login 自建号、unlockParent 签发 token）保留在各自
//     index.js 手写字面，不强行进表。
//
// 【候选②】归属判定不再是「一个函数两种语义」：
//   ownedChild   = A·归属校验（严格）：childId 不属于自己 → null，绝不回退
//   currentChild = B·默认选中（回退）：childId 缺失/不匹配 → 用第一个宝宝（看板语义）
//   两者都委托 lib/ownership.js 的纯函数，决策与 db 访问分离，可直接单测。
//   ownedTask/ownedReward 补上子资源归属：task/reward 必须属于该用户的某个孩子，
//   堵住「用别人的 taskId 给自己孩子打卡」。
const { cloud, db, fail, getUserByOpenid, getOwnedChild, getCurrentChild, childIdsOf } = require('./cloud');
const { verifyToken } = require('./token');
const { isOwnedResource } = require('./ownership');

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

// 【A·归属校验】取归属孩子。不属于自己 → null（绝不回退）。
// 用于所有写操作与 childSwitch。
async function ownedChild(OPENID, childId) {
  const child = await getOwnedChild(OPENID, childId);
  return child || null;
}

// 【B·默认选中】取当前孩子。childId 缺失/不匹配 → 第一个宝宝。
// 仅用于看板这类「当前宝宝」解析，与本地层 dashboard 同语义。
async function currentChild(OPENID, childId) {
  const child = await getCurrentChild(OPENID, childId);
  return child || null;
}

// 子资源归属：按 id 直取文档，并校验它属于该用户的某个孩子。
// 返回文档或 null（由调用方决定失败码）。
async function ownedTask(OPENID, taskId) {
  if (!taskId) return null;
  const ids = await childIdsOf(OPENID);
  if (!ids.length) return null;
  const d = await db.collection('tasks').doc(taskId).get().catch(() => null);
  const doc = d && d.data;
  if (!doc || doc.deleted) return null;
  return isOwnedResource(doc, ids) ? doc : null;
}

async function ownedReward(OPENID, rewardId) {
  if (!rewardId) return null;
  const ids = await childIdsOf(OPENID);
  if (!ids.length) return null;
  const d = await db.collection('rewards').doc(rewardId).get().catch(() => null);
  const doc = d && d.data;
  if (!doc || doc.deleted) return null;
  return isOwnedResource(doc, ids) ? doc : null;
}

module.exports = {
  resolveCaller, assertToken,
  ownedChild, currentChild, ownedTask, ownedReward
};
