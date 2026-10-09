// utils/api.js —— 统一数据入口：云端 / 本地兜底 自动路由
// 契约：所有操作返回 { ok:true, ... } 或 { ok:false, code, message }
//
// 家长令牌（ADR-0001）：页面不传 parentToken，本层按 parent-session 的豁免表自动注入；
// 写操作遇 TOKEN_INVALID 时自动走「弹 PIN 重解锁 → 重试原操作一次」的恢复流程
// （详见 utils/parent-session.js）。本地兜底与云端行为一致。
const local = require('../services/local');
const session = require('./parent-session');

function app() { return getApp(); }

// 由 app.onLaunch 显式写入，避免启动早期 getApp() 时序不确定
let _cloudFlag = null;
function setUseCloud(v) { _cloudFlag = !!v; }

// 是否启用云端（CLOUD_ENV 非空且 wx.cloud.init 成功才为 true）
function useCloud() {
  if (_cloudFlag !== null) return _cloudFlag;
  const a = app();
  return !!(a && a.globalData && a.globalData.useCloud);
}

// 供云函数调用时透传的上下文
function ctx() {
  const a = app();
  return a && a.globalData ? a.globalData : {};
}

// 纯传输：不做注入、不做恢复、不做 ok 拆包（callApi 专用的底层通道）
async function rawCall(name, params) {
  if (useCloud()) {
    const res = await wx.cloud.callFunction({ name, data: params });
    return (res && res.result) || {};
  }
  if (typeof local[name] !== 'function') {
    throw Object.assign(new Error('未实现的数据操作: ' + name), { code: 'NOT_IMPLEMENTED' });
  }
  return (await local[name](params || {})) || {};
}

async function callApi(name, params = {}) {
  session.inject(name, params);
  let result = await rawCall(name, params);

  // TOKEN_INVALID 自动恢复（每次调用最多一次）：家长会话通知栈顶页弹 PIN，
  // 用户输入正确 → 换发令牌 → 重试原操作；取消/页面未接入 → 原错误照常抛出。
  if (result && result.ok === false && result.code === 'TOKEN_INVALID'
      && !session.isPublic(name, params)) {
    const pin = await session.requestReunlock();
    if (pin != null) {
      session.inject(name, params);      // 重取换发后的新令牌
      result = await rawCall(name, params);
    }
  }

  if (result && result.ok === false) {
    const err = new Error(result.message || result.code || 'ERROR');
    err.code = result.code || 'ERROR';
    throw err;
  }
  return result || {};
}

module.exports = { callApi, useCloud, setUseCloud, ctx };
