// miniprogram/behaviors/parent-gate.js —— 家长模式「开关 + 闸门」薄壳（页面接入用）
//
// 与 behaviors/pin-reauth.js 的分工：
//   parent-gate  —— 「要不要家长模式、怎么进入」：toggleParent（锁图标）/ requireParent（操作前闸门）
//   pin-reauth   —— 「PIN 面板本身的关 / 提交 / 忘记」：onPinClose / onPinComplete / onPinForgot
// 二者是同一条链的前后两段（闸门失败 → 由 toggleParent 打开面板 → pin-reauth 处理输入），
// 但职责不同，故分开两个 behavior；页面同时接入即可。
//
// 用法（页面）：
//   behaviors: [require('../../behaviors/parent-gate')]
//   // wxml 锁图标：bindtap="toggleParent"
//   // 业务分支：if (!this.requireParent()) return;      // 或 requireParent({ msg: '投喂需家长模式' })
//
// 逻辑全部在 utils/parent-gate.js（纯函数，可测），本文件只做转发，不含业务判断。
const gate = require('../utils/parent-gate');

module.exports = Behavior({
  // ⚠️ 页面方法必须放在 methods: {} 内 —— Behavior 顶层只认 data/properties/lifetimes/
  // observers/methods 等固定字段，顶层自定义函数**不会被注册为方法**（曾因此导致
  // this.requireParent 为 undefined → 五页全部写操作抛错）。对照 behaviors/pin-reauth.js。
  methods: {
    toggleParent() {
      gate.toggleParent(this);
    },
    requireParent(opts) {
      return gate.requireParent(this, opts);
    }
  }
});
