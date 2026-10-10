// @ts-check
// utils/storage.js —— 本地兜底存储（wx.storage 轻封装）
// 云端模式下不使用；未配置 CLOUD_ENV 时作为完整可用的数据层
// （wx 全局由 miniprogram/types/globals.d.ts 声明，供编辑器类型检查）

const KEYS = {
  user: 'xy_user',
  children: 'xy_children',
  childId: 'xy_childId',
  tasks: 'xy_tasks',
  rewards: 'xy_rewards',
  checkIns: 'xy_checkIns',
  redemptions: 'xy_redemptions',
  pointsLog: 'xy_pointsLog',
  pets: 'xy_pets',
  token: 'xy_parent_token',
  startInParent: 'xy_start_in_parent',
  seq: 'xy_seq'
};

/**
 * 读取一个存储键；空 / 未设置时返回默认值
 * @param {string} key
 * @param {*} [def]
 * @returns {*}
 */
function read(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? def : v;
  } catch (e) { return def; }
}

/**
 * 写入一个存储键
 * @param {string} key
 * @param {*} val
 * @returns {boolean} 是否写入成功
 */
function write(key, val) {
  try { wx.setStorageSync(key, val); return true; } catch (e) { return false; }
}

/**
 * 删除一个存储键
 * @param {string} key
 * @returns {void}
 */
function remove(key) {
  try { wx.removeStorageSync(key); } catch (e) {}
}

/**
 * 自增 ID（本地模式主键）
 * @param {string} [prefix]
 * @returns {string}
 */
function nextId(prefix) {
  const n = (read(KEYS.seq, 0) || 0) + 1;
  write(KEYS.seq, n);
  return `${prefix || 'id'}_${Date.now().toString(36)}_${n}`;
}

module.exports = { KEYS, read, write, remove, nextId };
