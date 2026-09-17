// utils/api.js —— 统一数据入口：云端 / 本地兜底 自动路由
// 契约：所有操作返回 { ok:true, ... } 或 { ok:false, code, message }
const local = require('../services/local');

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

async function callApi(name, params = {}) {
  let result;
  if (useCloud()) {
    const res = await wx.cloud.callFunction({ name, data: params });
    result = (res && res.result) || {};
  } else {
    if (typeof local[name] !== 'function') {
      throw Object.assign(new Error('未实现的数据操作: ' + name), { code: 'NOT_IMPLEMENTED' });
    }
    result = await local[name](params || {});
  }
  if (result && result.ok === false) {
    const err = new Error(result.message || result.code || 'ERROR');
    err.code = result.code || 'ERROR';
    throw err;
  }
  return result || {};
}

module.exports = { callApi, useCloud, setUseCloud, ctx };
