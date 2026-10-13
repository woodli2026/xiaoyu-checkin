// cloudfunctions/lib/cloud.js —— 云侧公共助手（依赖 wx-server-sdk，不纳入 index.js）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { pickOwned, pickCurrent } = require('./ownership');

const VEGGIES = ['番茄', '黄瓜', '南瓜', '土豆', '玉米', '胡萝卜', '西兰花', '茄子',
  '菠菜', '豌豆', '蘑菇', '青椒', '白菜', '冬瓜', '莲藕', '山药'];

function ok(o) { return Object.assign({ ok: true }, o || {}); }
function fail(code, message) { return { ok: false, code, message: message || code }; }

function genRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function getUserByOpenid(openid) {
  const r = await db.collection('users').where({ openid }).limit(1).get();
  return r.data[0] || null;
}

// 取该用户名下的孩子列表。
// 内存过滤软删（不用 where deleted:false）——老档案可能没有 deleted 字段，
// where deleted:false 匹配不到缺字段文档（与本地层 services/local/dashboard.js 同口径）。
async function ownedChildren(openid) {
  const user = await getUserByOpenid(openid);
  if (!user) return [];
  const r = await db.collection('children')
    .where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
  return (r.data || []).filter((c) => !c.deleted);
}

// 【A·归属校验】childId 必须属于该用户，否则 null —— 绝不回退到第一个孩子。
// 用于所有写操作与 childSwitch。旧实现此处会回退 r.data[0]，导致越权（候选②）。
async function getOwnedChild(openid, childId) {
  const list = await ownedChildren(openid);
  return pickOwned(list, childId);
}

// 【B·默认选中】childId 命中则用之，否则用第一个（看板「当前宝宝」语义，与本地层一致）。
async function getCurrentChild(openid, childId) {
  const list = await ownedChildren(openid);
  return pickCurrent(list, childId);
}

// 该用户拥有的孩子 id 列表，供 task/reward 等子资源做归属判定
async function childIdsOf(openid) {
  const list = await ownedChildren(openid);
  return list.map((c) => c._id);
}

module.exports = {
  cloud, db, _, VEGGIES,
  ok, fail, genRandomCode,
  getUserByOpenid, ownedChildren, getOwnedChild, getCurrentChild, childIdsOf
};
