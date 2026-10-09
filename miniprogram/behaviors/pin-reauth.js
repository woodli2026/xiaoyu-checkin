// behaviors/pin-reauth.js —— 小程序原生 Behavior 薄壳（Phase B）
//
// 把 utils/pin-reauth 的纯函数接成页面方法，并提供共享 data 字段。
// 五页通过 behaviors:[require('../../behaviors/pin-reauth')] 接入，从而删除各自
// 重复的 onPinClose / onReauthNeed / onPinComplete（home/mine 外加 onPinForgot）与三行 data。
//
// 【为什么用 Behavior】小程序 Page 无继承机制，Behavior 是官方唯一的跨页逻辑复用原语；
// 页面 methods 优先级高于 Behavior，若某页需自定义可就地覆盖。
const pin = require('../utils/pin-reauth');

module.exports = Behavior({
  data: {
    showPin: false,
    pinError: '',
    pinAttempt: 0
  },
  methods: {
    onPinClose() { pin.onPinClose(this); },
    onReauthNeed() { pin.onReauthNeed(this); },
    onPinComplete(e) { return pin.onPinComplete(this, e); },
    onPinForgot() { return pin.onPinForgot(this); }
  }
});
