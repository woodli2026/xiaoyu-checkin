// cloudfunctions/lib/ownership.js
//
// 归属判定纯函数（候选②，2026-10-10）。
//
// 为什么单独成文件：
//   原先「从 children 列表里选哪个孩子」的决策夹在 cloud.js#getOwnedChild 里，
//   一行 `|| r.data[0]` 同时承担了两重语义——
//     A·归属校验：「这个 childId 是我的吗」→ 不属于必须拒绝
//     B·默认选中：「没指定就给我第一个宝宝」→ 回退是设计意图（看板用）
//   结果 A 类调用点（checkIn/redeem/CRUD）拿到了 B 的行为 → 越权，
//   且 taskCRUD/rewardCRUD 的 FORBIDDEN 分支因回退永远不可达。
//
// 本模块把这两重语义拆成两个**名字不同**的函数，并把它们从 wx-server-sdk 依赖中剥离，
// 使其成为可直接测试的纯函数（接口即测试面：安全关键决策不该藏在 db 访问里）。
//
// 约定：
//   - 本模块只做「从列表里选哪个」的决策，**不**过滤 deleted（软删由调用方按场景决定）：
//     childSwitch/petCRUD 需要拒绝已删宝宝，而看板/动态按各自口径处理。
//   - 调用方传入的 children 必须是「已按 ownerId 过滤过的列表」，本模块不再校验 ownerId。
//     校验归属的责任在 cloud.js 的查询条件（where ownerId），此处只做选择。

/**
 * A·归属校验（严格）：childId 必须在列表内，否则 null。
 * 用于所有写操作与 childSwitch —— 绝不允许回退到第一个孩子。
 * @param {Array<{_id: string}>} children 已按 ownerId 过滤的孩子列表
 * @param {string} childId 客户端传入的孩子 id
 * @returns {object|null}
 */
function pickOwned(children, childId) {
  if (!childId || !children || !children.length) return null;
  return children.find((c) => c._id === childId) || null;
}

/**
 * B·默认选中（允许回退）：childId 命中则用之，否则用第一个。
 * 用于看板这类「当前宝宝」解析 —— 没指定时展示第一个是刻意的。
 * @param {Array<{_id: string}>} children 已按 ownerId 过滤的孩子列表
 * @param {string} childId 客户端传入的孩子 id（可为空）
 * @returns {object|null}
 */
function pickCurrent(children, childId) {
  if (!children || !children.length) return null;
  if (childId) {
    const hit = children.find((c) => c._id === childId);
    if (hit) return hit;
  }
  return children[0];
}

/**
 * 资源归属判定：task / reward 等子资源是否属于这批孩子之一。
 * 用于堵住「用别人的 taskId 给自己孩子打卡」这类跨资源越权。
 * @param {{childId?: string}|null} doc 待判定的资源文档
 * @param {string[]} ownedChildIds 调用方拥有的孩子 id 列表
 * @returns {boolean}
 */
function isOwnedResource(doc, ownedChildIds) {
  if (!doc || !doc.childId) return false;
  return Array.isArray(ownedChildIds) && ownedChildIds.indexOf(doc.childId) >= 0;
}

module.exports = { pickOwned, pickCurrent, isOwnedResource };
