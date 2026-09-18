// app.js —— 全局基座：云初始化 / 静默登录 / 双模式态 / 家长Token生命周期
const { callApi, setUseCloud } = require('./utils/api');
const { CLOUD_ENV, APP_VERSION, PARENT_IDLE_MS } = require('./config');
const s = require('./utils/storage');
const D = require('./utils/domain');

App({
  globalData: {
    user: null,            // { _id, openid, nickname, avatar, pinSet, randomCode, ... }
    childId: null,         // 当前管理的孩子档案 _id
    mode: 'display',       // 'display' 展示模式(只读) | 'parent' 家长模式(可写)
    parentToken: null,     // 家长模式令牌（内存，不落库；切后台/过期即清空）
    parentTokenExpire: 0,
    _hiddenAt: 0,          // 最近一次 onHide 时刻；用于区分「真·离场」与「调用系统相机/相册」
    useCloud: false,       // 是否启用云端（填了 CLOUD_ENV 且 init 成功才 true）
    version: APP_VERSION
  },

  // 最近一次用户交互时刻（毫秒）。用于「连续 15 分钟无操作自动回到展示模式」（R10）。
  // 0 表示尚未进入家长模式 / 无交互记录。
  lastActive: 0,

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
    // 每 10s 巡检一次空闲计时：家长模式下连续 15 分钟无交互则自动回到展示模式（R10）
    this._idleTimer = setInterval(() => this.tickIdle(), 10 * 1000);
  },

  // 静默登录：云端按 OPENID 查重/建号；本地兜底生成匿名身份。
  // 登录完成后尝试「启动即家长模式」静默解锁（R10，详见 maybeAutoUnlock）。
  async login() {
    try {
      const res = await callApi('login', {});
      this.globalData.user = res.user;
      this.globalData.childId = res.childId;
      await this.maybeAutoUnlock();
      return res;
    } catch (e) {
      console.error('[xiaoyu] 登录失败', e);
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      throw e;
    }
  },

  // 等待登录（及可能的静默解锁）完成（页面 onShow 时调用，避免全局态未就绪）
  whenReady() {
    if (this.globalData.user) return Promise.resolve(this.globalData);
    return this.loginPromise || this.login();
  },

  // R10：启动即家长模式（静默解锁，免 PIN）。
  // 仅当全部条件满足时才生效：
  //   ① 本地层（云端层设备信任待接入，不静默签发令牌，避免认证绕过）；
  //   ② 账号已设 PIN（未设 PIN 仍走「我」页正常流程）；
  //   ③ 设置项「启动即家长模式」开启（默认开启，见 utils/storage KEYS.startInParent）。
  // 任一不满足 → 不静默解锁，保持展示模式，由用户手动 PIN 进入。
  async maybeAutoUnlock() {
    const g = this.globalData;
    if (g.useCloud) return;
    if (!g.user || !g.user.pinSet) return;
    const startInParent = s.read(s.KEYS.startInParent, true);
    if (!startInParent) return;
    try {
      const res = await callApi('unlockParent', { silent: true });
      g.parentToken = res.parentToken;
      g.parentTokenExpire = res.expireAt;
      g.mode = 'parent';
      this.lastActive = Date.now();
      this.syncMode();
    } catch (e) {
      // 静默解锁失败绝不应阻断启动：回退展示模式即可，用户仍可手动 PIN 进入。
      console.warn('[xiaoyu] 启动自动解锁失败，回退展示模式', e && e.code);
    }
  },

  // 任意用户交互调用：刷新空闲计时基准（由各页根 view 的 bindtap="onAppTouch" 触发）
  touch() { this.lastActive = Date.now(); },

  // 每 10s 巡检：家长模式下连续 15 分钟无交互 → 自动回到展示模式（R10）
  tickIdle() {
    const g = this.globalData;
    if (g.mode !== 'parent' || !g.parentToken) return;
    if (D.isIdleExpired(this.lastActive, Date.now(), PARENT_IDLE_MS)) {
      this.clearParent();
      wx.showToast({ title: '家长模式已自动关闭', icon: 'none' });
    }
  },

  onHide() {
    // 不再在每次 onHide 直接清空家长模式：wx.chooseMedia 调用系统相机/相册等原生能力
    // 同样会触发 onHide，若直接清空会导致「选完照片回来保存时令牌已失效」。
    this.globalData._hiddenAt = Date.now();
  },

  onShow() {
    const g = this.globalData;
    if (g.parentTokenExpire && Date.now() > g.parentTokenExpire) {
      this.clearParent();           // 令牌自然过期（静默解锁签发的也是 15 分钟）
    }
    this.lastActive = Date.now();   // 回到前台视为一次交互，重置空闲计时
    this.globalData._hiddenAt = 0;
  },

  // 广播当前 mode 给所有已渲染页面：覆盖「tickIdle 跨页即时态」等场景，
  // 页面 onShow 也会按 globalData 再次刷新，这里保证后台巡检触发的回退能即时反映到 UI。
  syncMode() {
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    pages.forEach(p => {
      if (p && typeof p.setData === 'function' && p.data && ('mode' in p.data)) {
        p.setData({ mode: this.globalData.mode });
      }
    });
  },

  clearParent() {
    this.globalData.parentToken = null;
    this.globalData.parentTokenExpire = 0;
    this.globalData.mode = 'display';
    this.syncMode();
  },

  setMode(mode) { this.globalData.mode = mode; },
  isParent() { return this.globalData.mode === 'parent' && !!this.globalData.parentToken; }
});
