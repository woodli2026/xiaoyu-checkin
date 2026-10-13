// __tests__/helpers/wx-storage.js —— 本地兜底层测试用的 wx.storage mock（单一来源）
//
// 【为什么需要】该 mock 此前在 8 个测试文件里逐字重复（local/pet/session/v108/
// aggregate-guard/child-rules-guard/view-shape-guard/cloud-write-guard）。收敛为一份。
//
// 用法（必须在 require 任何 miniprogram/services/** 之前调用）：
//   const { store } = require('./helpers/wx-storage').installWxStorageMock();
// 各测试文件仍拿到**自己进程内的独立 store**（node:test 每个文件一个子进程）。
function installWxStorageMock() {
  const store = {};
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; }
  };
  return { store };
}

module.exports = { installWxStorageMock };
