// components/privacy-sheet —— 官方隐私授权弹层（全站复用）
//
// 场景：① home 首启（页面 onShow 的 getPrivacySetting 预检弹窗）；
//      ② mine 相册选图就地授权（点「从相册选」时预检，需授权则当场弹，同意后直接继续选图）；
//      ③ 竞态兜底：wx.onNeedPrivacyAuthorization 触发时由 app.js 通知栈顶页面弹本组件。
//
// 授权闭环：用户点 open-type="agreePrivacyAuthorization" 按钮 → 微信完成授权并回调
// bindagreeprivacyauthorization → 组件内 agreePrivacy：
//   1) 写本地 PRIVACY_KEY 标记（旧基础库回退口径沿用）；
//   2) 调 getApp().resolvePrivacy() —— 若本次弹窗由 onNeedPrivacyAuthorization 触发，
//      就地 resolve({event:'agree'}) 放行被微信挂起的那次 API 调用；
//   3) triggerEvent('agreed') 通知页面（页面据此关弹层/继续被暂停的业务）。
const { PRIVACY_KEY } = require('../../config');

// 与 wxml 中授权按钮的 id 对应（resolve({event:'agree'}) 时微信校验用）
const AGREE_BTN_ID = 'privacy-agree-btn';

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false }
  },
  observers: {
    // 每次重新弹出时清掉「已同意」标记，确保一次展示只放行一次
    'show'(v) { if (v) this._done = false; }
  },
  methods: {
    // 弹层内容吞冒泡（蒙层不绑点击关闭：隐私弹层必须显式同意，与 home 原行为一致）
    noop() {},
    openPrivacyContract() {
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({ fail: () => wx.showToast({ title: '暂时无法打开指引', icon: 'none' }) });
      } else {
        wx.showToast({ title: '当前微信版本暂不支持查看', icon: 'none' });
      }
    },
    // 同意授权：按钮 open-type="agreePrivacyAuthorization" 在微信侧完成授权并回调本方法。
    // 旧基础库不识别 open-type 时由 bindtap 兜底触发。幂等：一次展示只放行一次，
    // 避免 bindtap 与 bindagreeprivacyauthorization 双触发导致重复打开相册。
    agreePrivacy() {
      if (this._done) return;
      this._done = true;
      try { wx.setStorageSync(PRIVACY_KEY, true); } catch (e) {}
      getApp().resolvePrivacy(AGREE_BTN_ID);
      this.triggerEvent('agreed');
    }
  }
});
