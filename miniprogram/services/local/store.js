// services/local/store.js —— 本地兜底数据层：通用返回件 + 存储访问 + 令牌校验
// （2026-10-10 D3 拆分：原 services/local.js 单体的公共低层，供各域模块 require）
const s = require('../../utils/storage');

// —— 工具 ——
function ok(o) { return Object.assign({ ok: true }, o || {}); }
function fail(code, message) { return { ok: false, code, message: message || code }; }

// —— 存取 ——
function currentUser() { return s.read(s.KEYS.user, null); }
function saveUser(u) { s.write(s.KEYS.user, u); }
function allChildren() { return s.read(s.KEYS.children, []); }
function saveChildren(l) { s.write(s.KEYS.children, l); }
function allTasks() { return s.read(s.KEYS.tasks, []); }
function saveTasks(l) { s.write(s.KEYS.tasks, l); }
function allRewards() { return s.read(s.KEYS.rewards, []); }
function saveRewards(l) { s.write(s.KEYS.rewards, l); }
function allCheckIns() { return s.read(s.KEYS.checkIns, []); }
function saveCheckIns(l) { s.write(s.KEYS.checkIns, l); }
function allPoints() { return s.read(s.KEYS.pointsLog, []); }
function savePoints(l) { s.write(s.KEYS.pointsLog, l); }
function allRedemptions() { return s.read(s.KEYS.redemptions, []); }
function saveRedemptions(l) { s.write(s.KEYS.redemptions, l); }
function allPets() { return s.read(s.KEYS.pets, []); }
function savePets(l) { s.write(s.KEYS.pets, l); }

function verifyLocalToken(token) {
  const t = s.read(s.KEYS.token, null);
  return !!(t && token && t.token === token && t.expireAt > Date.now());
}

module.exports = {
  s,
  ok, fail,
  currentUser, saveUser,
  allChildren, saveChildren,
  allTasks, saveTasks,
  allRewards, saveRewards,
  allCheckIns, saveCheckIns,
  allPoints, savePoints,
  allRedemptions, saveRedemptions,
  allPets, savePets,
  verifyLocalToken
};
