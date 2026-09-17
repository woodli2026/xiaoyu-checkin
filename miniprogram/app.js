// app.js —— 全局基座：云初始化 / 静默登录 / 双模式态 / 家长Token生命周期
const { callApi, setUseCloud } = require('./utils/api');
const { CLOUD_ENV, APP_VERSION } = require('./config');

App({
  globalData: {
    user: null,            // { _id, openid, nickname, avatar, pinSet, randomCode, ... }
    childId: null,         // 当前管理的孩子档案 _id
    mode: 'display',       // 'display' 展示模式(只读) | 'parent' 家长模式(可写)
    parentToken: null,     // 家长模式令牌（内存，不落库；切后台/过期即清空）
    parentTokenExpire: 0,
    useCloud: false,       // 是否启用云端（填了 CLOUD_ENV 且 init 成功才 true）
    version: APP_VERSION
  },

  onLaunch() {
    if (CLOUD_ENV && CLOUD_ENV !== 'YOUR_CLOUD_ENV_ID') {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
        this.globalData.useCloud = true;
      } catch (e) {
        console.warn('[xiaoyu] 云初始化失败，降级本地兜底', e);
        this.globalData.useCloud = false;
      }
    } else {
      console.info('[xiaoyu] 未配置 CLOUD_ENV，使用本地兜底数据层（可在开发者工具/真机预览直接跑通）');
    }
    setUseCloud(this.globalData.useCloud);
    this.loginPromise = this.login();
  },

  // 静默登录：云端按 OPENID 查重/建号；本地兜底生成匿名身份
  async login() {
    try {
      const res = await callApi('login', {});
      this.globalData.user = res.user;
      this.globalData.childId = res.childId;
      return res;
    } catch (e) {
      console.error('[xiaoyu] 登录失败', e);
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      throw e;
    }
  },

  // 等待登录完成（页面 onShow 时调用，避免全局态未就绪）
  whenReady() {
    if (this.globalData.user) return Promise.resolve(this.globalData);
    return this.loginPromise || this.login();
  },

  onHide() {
    // 切后台即失效家长模式（PRD-ACC-03：空闲5分钟或切后台，取较短）
    this.clearParent();
  },

  onShow() {
    if (this.globalData.parentTokenExpire && Date.now() > this.globalData.parentTokenExpire) {
      this.clearParent();
    }
  },

  clearParent() {
    this.globalData.parentToken = null;
    this.globalData.parentTokenExpire = 0;
    this.globalData.mode = 'display';
  },

  setMode(mode) { this.globalData.mode = mode; },
  isParent() { return this.globalData.mode === 'parent' && !!this.globalData.parentToken; }
});
