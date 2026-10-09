// ops.js —— 后端操作单一来源（候选③，2026-10-09 立项）
//
// 这是「有哪些后端函数 / 各自的 op / 是否需要家长令牌」的唯一权威清单。
// 此前这份知识散落在 4 处（local.js、各云函数 index.js、parent-session 豁免表、文档），
// 导致「8 个云函数」漂移到 13 无人发现。本文件 + __tests__/ops.test.js 守卫根除该漂移。
//
// 标记约定（fail-safe 方向）：
//   'public' —— 整个函数免令牌（如 login / getDashboard）
//   'local'  —— 仅本地实现（无云端对应），免令牌（如 resetAll）
//   'token'  —— 整个函数需令牌（如 checkIn / redeem）
//   对象字面量 —— 按 op 分派：name => { opName: 'public'|'token' }
//
// 方向刻意设计为「豁免制」而非「白名单制」：未来新增写操作若忘记登记，
// 结果是多带一个无害的 token 字段（fail-safe），而不是越权失败（fail-open）。

const OPS = {
  // —— 无 op 字段的整函数调用 ——
  login: 'public',
  unlockParent: 'public',
  resetPin: 'public',       // 云端 resetPin 不校验 parentToken，按 openid 重置（与旧豁免表一致）
  getDashboard: 'public',
  resetAll: 'local',        // 仅本地：services/local.js 独有，无云端对应
  checkIn: 'token',
  redeem: 'token',
  childSwitch: 'token',
  setPin: 'token',

  // —— 按 op 分派的函数 ——
  childCRUD: { list: 'public', create: 'token', update: 'token', delete: 'token' },
  taskCRUD: { create: 'token', update: 'token', delete: 'token' },
  rewardCRUD: { create: 'token', update: 'token', delete: 'token' },
  feedCRUD: { list: 'public', undoCheckIn: 'token', undoRedeem: 'token' },
  petCRUD: {
    info: 'public', stroke: 'public',
    adopt: 'token', feed: 'token', rename: 'token', reset: 'token', release: 'token'
  }
};

// 本地独占、无云端对应的函数名（守卫测试据此放行，不算「云函数表缺项」）
const LOCAL_ONLY = ['resetAll'];

// 返回某次调用的令牌标记：'public' | 'local' | 'token' | null（未知调用）
function callFlag(name, op) {
  const entry = OPS[name];
  if (entry === undefined) return null;
  if (typeof entry === 'string') return entry;
  // 按 op 分派的函数必须带 op
  if (op == null) return null;
  return entry[op] || null;
}

// 是否免令牌注入：公开或本地独占都视为免令牌
function isPublic(name, op) {
  const f = callFlag(name, op);
  return f === 'public' || f === 'local';
}

// 是否需令牌（其余情况：未知调用按需令牌处理，fail-safe 偏严）
function needsToken(name, op) {
  return callFlag(name, op) === 'token';
}

module.exports = { OPS, LOCAL_ONLY, callFlag, isPublic, needsToken };
