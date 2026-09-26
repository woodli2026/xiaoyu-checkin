// cloudfunctions/lib/cloud.js —— 云侧公共助手（依赖 wx-server-sdk，不纳入 index.js）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

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

// 校验 childId 归属当前 openid 的用户；返回 child 或 null
async function getOwnedChild(openid, childId) {
  const user = await getUserByOpenid(openid);
  if (!user) return null;
  const r = await db.collection('children')
    .where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
  if (!r.data.length) return null;
  return r.data.find(c => c._id === childId) || r.data[0];
}

module.exports = {
  cloud, db, _, VEGGIES,
  ok, fail, genRandomCode,
  getUserByOpenid, getOwnedChild
};
