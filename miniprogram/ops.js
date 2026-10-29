// ops.js —— 后端操作单一来源（候选③，2026-10-09 立项；2026-10-17 增 params schema）
//
// 这是「有哪些后端函数 / 各自的 op / 是否需要家长令牌 / 参数形状」的唯一权威清单。
// 此前这份知识散落在 4 处（local.js、各云函数 index.js、parent-session 豁免表、文档），
// 导致「8 个云函数」漂移到 13 无人发现。本文件 + __tests__/ops.test.js 守卫根除该漂移。
//
// 2026-10-17 新增 params schema（全量铺开）：
//   背景：今天的 '[object Object]' bug 就在这条 seam 上——页面传 { json: '<字符串>' } 包装对象，
//   op 入口按「直接收字符串」写，String() 化成 '[object Object]' → BAD_JSON。
//   schema 把形状知识从「散落在 44 个调用点 + 13 个 local 入口」收拢到本表，
//   新守卫 ops-shape-guard.test.js 用 helpers/js-source.js 静态扫描调用点与 schema 对拍。
//
// 标记约定：
//   每个 op 的元数据 = { token: 'public'|'local'|'token', params: { … } }
//   'public' —— 免令牌（如 login / getDashboard）
//   'local'  —— 仅本地实现（无云端对应），免令牌（如 resetAll / backup 3 op）
//   'token'  —— 需令牌（如 checkIn / redeem）
//
// 方向刻意设计为「豁免制」而非「白名单制」：未来新增写操作若忘记登记，
// 结果是多带一个无害的 token 字段（fail-safe），而不是越权失败（fail-open）。
//
// params schema 约定：
//   - 字段值 = 类型字符串：'string' / 'number' / 'object'，必传
//   - 末尾 '?' = 可选（如 'string?'）
//   - 'object' 仅表达「是个对象」，不描述内部键形状（嵌套校验是 v1.1+ 的事）
//   - 横切 key 不进 schema：parentToken（session 注入）、op（已在 op 字面量 key 上表达）

const OPS = {
  // —— 无 op 字段的整函数调用 ——
  login:        { token: 'public', params: {} },
  unlockParent: { token: 'public', params: { pin: 'string?', silent: 'boolean?' } },
  resetPin:     { token: 'public', params: {} },
  getDashboard: { token: 'public', params: { childId: 'string' } },
  resetAll:     { token: 'local',  params: {} },
  exportBackup: { token: 'local',  params: { appVersion: 'string' } },
  pickBackup:   { token: 'local',  params: {} },
  restoreBackup:{ token: 'local',  params: { json: 'string' } },
  pointsLog:    { token: 'local',  params: { childId: 'string' } },  // O2 星星收支数据源（本地独占，云端当前只写不读）
  checkIn:      { token: 'token',  params: { childId: 'string', taskId: 'string', date: 'string?' } },
  redeem:       { token: 'token',  params: { childId: 'string', rewardId: 'string' } },
  childSwitch:  { token: 'token',  params: { childId: 'string' } },
  setPin:       { token: 'token',  params: { pin: 'string' } },

  // —— 按 op 分派的函数 ——
  childCRUD: {
    list:   { token: 'public', params: {} },
    create: { token: 'token',  params: { payload: 'object' } },
    update: { token: 'token',  params: { childId: 'string', payload: 'object' } },
    delete: { token: 'token',  params: { childId: 'string' } }
  },
  taskCRUD: {
    create: { token: 'token', params: { payload: 'object' } },
    update: { token: 'token', params: { payload: 'object' } },
    delete: { token: 'token', params: { payload: 'object' } }
  },
  rewardCRUD: {
    create: { token: 'token', params: { payload: 'object' } },
    update: { token: 'token', params: { payload: 'object' } },
    delete: { token: 'token', params: { payload: 'object' } }
  },
  feedCRUD: {
    list:        { token: 'public', params: { limit: 'number?', skip: 'number?' } },
    undoCheckIn: { token: 'token',  params: { id: 'string' } },
    undoRedeem:  { token: 'token',  params: { id: 'string' } }
  },
  petCRUD: {
    info:    { token: 'public', params: { childId: 'string' } },
    stroke:  { token: 'public', params: { childId: 'string' } },
    adopt:   { token: 'token',  params: { childId: 'string', payload: 'object' } },
    feed:    { token: 'token',  params: { childId: 'string' } },
    rename:  { token: 'token',  params: { childId: 'string', payload: 'object' } },
    reset:   { token: 'token',  params: { childId: 'string' } },
    release: { token: 'token',  params: { childId: 'string' } }
  }
};

// 本地独占、无云端对应的函数名（守卫测试据此放行，不算「云函数表缺项」）
const LOCAL_ONLY = ['resetAll', 'exportBackup', 'pickBackup', 'restoreBackup', 'pointsLog'];

// 返回某次调用的令牌标记：'public' | 'local' | 'token' | null（未知调用）
function callFlag(name, op) {
  const entry = OPS[name];
  if (entry === undefined) return null;
  // 整函数级元数据（无 op 分派）
  if (typeof entry === 'object' && entry !== null && typeof entry.token === 'string') {
    return entry.token;
  }
  // 按 op 分派
  if (op == null) return null;
  const opEntry = entry[op];
  if (opEntry === undefined) return null;
  if (typeof opEntry === 'object' && opEntry !== null && typeof opEntry.token === 'string') return opEntry.token;
  return null;
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

// 取 op 的 params schema（无 schema 的 op 返回 undefined，守卫据此跳过）
function paramsSchema(name, op) {
  const entry = OPS[name];
  if (entry === undefined) return undefined;
  // 整函数级
  if (typeof entry === 'object' && entry !== null && typeof entry.token === 'string' && entry.params) {
    return entry.params;
  }
  // 按 op 分派
  if (op != null && typeof entry === 'object' && entry !== null) {
    const opEntry = entry[op];
    if (typeof opEntry === 'object' && opEntry !== null && opEntry.params) return opEntry.params;
  }
  return undefined;
}

module.exports = { OPS, LOCAL_ONLY, callFlag, isPublic, needsToken, paramsSchema };
