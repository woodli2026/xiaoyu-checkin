// utils/storage.js —— 本地兜底存储（wx.storage 轻封装）
// 云端模式下不使用；未配置 CLOUD_ENV 时作为完整可用的数据层

const KEYS = {
  user: 'xy_user',
  children: 'xy_children',
  childId: 'xy_childId',
  tasks: 'xy_tasks',
  rewards: 'xy_rewards',
  checkIns: 'xy_checkIns',
  redemptions: 'xy_redemptions',
  pointsLog: 'xy_pointsLog',
  token: 'xy_parent_token',
  seq: 'xy_seq'
};

function read(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? def : v;
  } catch (e) { return def; }
}

function write(key, val) {
  try { wx.setStorageSync(key, val); return true; } catch (e) { return false; }
}

function remove(key) {
  try { wx.removeStorageSync(key); } catch (e) {}
}

// 自增 ID（本地模式主键）
function nextId(prefix) {
  const n = (read(KEYS.seq, 0) || 0) + 1;
  write(KEYS.seq, n);
  return `${prefix || 'id'}_${Date.now().toString(36)}_${n}`;
}

module.exports = { KEYS, read, write, remove, nextId };
