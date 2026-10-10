const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const pets = require('../../utils/pets');
const cal = require('../../utils/calendar');
const CF = require('../../utils/confetti');
const { bubbleStyleFor } = require('../../utils/bubble');
const { PRIVACY_KEY } = require('../../config');
const { attachTabBarSync } = require('../../utils/tabbar');
const session = require('../../utils/parent-session');

Page({
  behaviors: [require('../../behaviors/pin-reauth')],
  data: {
    mode: 'display',
    pinSet: false,
    useCloud: false,
    child: { name: '宝宝', avatar: '🧒' },
    totalStars: 0,
    streak: 0,
    level: 1,
    levelStars: [1, 2, 3, 4, 5],
    subTab: 'checkin',
    calendar: { cells: [], label: '' },
    viewYm: '',            // 当前查看的月份（'YYYY-MM'），留空表示本月
    todayYm: '',           // 真实当前月份，用于判断是否显示「回到本月」
    todayDone: 0,
    todayTotal: 0,
    monthCount: 0,
    rewards: [],
    todayStr: '',
    showDay: false,
    dayTitle: '',
    dayDate: '',
    dayTodo: [],
    dayDone: [],
    dayDiag: '',
    allTasks: [],
    showRedeem: false,
    redeemTarget: null,
    showPrivacy: false,
    confetti: [],
    confettiFlash: false,
    showPraise: false,
    praiseText: '',
    bubbleStyle: '',
    petImage: '',
    petEmoji: '🐣',
    praiseTimer: null
  },
  onAppTouch() { getApp().touch(); },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    attachTabBarSync(this);
    this.refresh();
  },
  async refresh() {
    const app = getApp();
    try { await app.whenReady(); } catch (e) { return; }
    this.setData({
      mode: app.globalData.mode,
      pinSet: !!(app.globalData.user && app.globalData.user.pinSet),
      useCloud: app.globalData.useCloud
    });
    this.checkPrivacy();
    await this.load();
  },
  checkPrivacy() {
    if (typeof wx.getPrivacySetting === 'function') {
      wx.getPrivacySetting({
        success: (res) => this.setData({ showPrivacy: !!res.needAuthorization }),
        fail: () => this.checkPrivacyLocal()
      });
    } else {
      this.checkPrivacyLocal();
    }
  },
  checkPrivacyLocal() {
    let agreed = false;
    try { agreed = !!wx.getStorageSync(PRIVACY_KEY); } catch (e) {}
    this.setData({ showPrivacy: !agreed });
  },
  agreePrivacy() {
    this.setData({ showPrivacy: false });
    this.restTip();
  },
  onPrivacyNeed() { this.setData({ showPrivacy: true }); },
  restTip() {
    const today = D.ymd(new Date());
    try {
      if (wx.getStorageSync('xy_rest_tip_date') !== today) {
        wx.setStorageSync('xy_rest_tip_date', today);
        setTimeout(() => wx.showToast({ title: '注意休息哦～', icon: 'none' }), 400);
      }
    } catch (e) {}
  },
  async load() {
    const app = getApp();
    try {
      wx.showLoading({ title: '加载中', mask: true });
      const res = await callApi('getDashboard', { childId: app.globalData.childId });
      const today = D.ymd(new Date());
      this._allTasks = res.tasks || [];
      this._checkIns = res.checkIns || [];
      const todayTasks = res.todayTasks || [];
      const monthLit = res.monthLit || [];
      const viewYm = today.slice(0, 7);
      this.setData({
        child: res.child,
        totalStars: res.totalStars,
        streak: res.streak,
        level: res.level,
        viewYm,
        todayYm: viewYm,
        calendar: cal.buildCalendar(res.tasks || [], res.checkIns || [], viewYm, today),
        todayDone: todayTasks.filter(t => t.checked).length,
        todayTotal: todayTasks.length,
        monthCount: monthLit.length,
        allTasks: res.tasks || [],
        rewards: res.rewards || [],
        todayStr: today,
        mode: app.globalData.mode
      });
      // 预载宠物（用于打卡后的宠物气泡；独立 try 失败不阻断主流程）
      try {
        const petRes = await callApi('petCRUD', { op: 'info', childId: app.globalData.childId });
        this._pet = (petRes && petRes.pet) || null;
      } catch (e) { this._pet = null; }
      if (this.data.showDay) this.renderDay(this.data.dayDate);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  renderCalendar() {
    const today = D.ymd(new Date());
    const viewYm = this.data.viewYm || today.slice(0, 7);
    this.setData({
      viewYm,
      calendar: cal.buildCalendar(this._allTasks || [], this._checkIns || [], viewYm, today)
    });
  },
  stepMonth(delta) {
    const ym = this.data.viewYm || D.ymd(new Date()).slice(0, 7);
    this.setData({ viewYm: cal.shiftYm(ym, delta) });
    this.renderCalendar();
  },
  prevMonth() { this.stepMonth(-1); },   // 前一个月
  nextMonth() { this.stepMonth(1); },     // 下一个月
  backToToday() {
    const ym = D.ymd(new Date()).slice(0, 7);
    this.setData({ viewYm: ym });
    this.renderCalendar();
  },
  onCalTouchStart(e) {
    const t = e.touches[0];
    this._tx = t.clientX;
    this._ty = t.clientY;
  },
  onCalTouchEnd(e) {
    if (this._tx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    this._tx = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    this.stepMonth(dx < 0 ? 1 : -1);
  },
  switchSub(e) { this.setData({ subTab: e.currentTarget.dataset.tab }); },
  toggleParent() {
    const app = getApp();
    if (this.data.mode === 'parent') {
      app.clearParent();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已退出家长模式', icon: 'none' });
      return;
    }
    if (!this.data.pinSet) {
      wx.showToast({ title: '请先到「我」页设置 PIN', icon: 'none' });
      return;
    }
    this.setData({ showPin: true, pinError: '' });
  },
  openDay(e) { this.renderDay(e.currentTarget.dataset.date); },
  onDayClose() { this.setData({ showDay: false }); },
  onDayScroll(e) { this._dayScrollTop = e.detail.scrollTop; },
  renderDay(date) {
    if (!date) return;
    const cached = this._allTasks || [];
    const all = cached.length ? cached : (this.data.allTasks || []);
    const ci = this._checkIns || [];
    const checked = new Set(ci.filter(c => c.date === date).map(c => c.taskId));
    const list = all.filter(t => T.taskVisibleOn(t, date)).map(t => ({
      taskId: t._id, title: t.title, icon: t.icon, score: t.score, checked: checked.has(t._id),
      praise: t.praise || ''
    }));
    const { todo, done } = T.splitTasks(list);
    const parts = date.split('-').map(Number);
    this.setData({
      showDay: true, dayDate: date,
      dayTitle: parts[1] + '月' + parts[2] + '日',
      dayTodo: todo, dayDone: done,
      dayDiag: '全部 ' + all.length + ' 个任务 · 该日可见 ' + list.length + ' 个 · ' + date
    });
  },
  async onDayPick(e) {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '请点击右上角锁图标开启家长模式', icon: 'none' });
      return;
    }
    const { taskId, task, done } = e.detail;
    const app = getApp();
    const score = (task && task.score) || 1;
    try {
      if (done) {
        // 已打卡 → 再次点击取消打卡（扣回星星）
        const ci = (this._checkIns || []).find(c => c.taskId === taskId && c.date === this.data.dayDate);
        if (!ci) { wx.showToast({ title: '该打卡记录不存在', icon: 'none' }); return; }
        const res = await callApi('feedCRUD', { op: 'undoCheckIn', id: ci.id });
        this.setData({ totalStars: res.totalStars, streak: res.streak, level: res.level });
        wx.showToast({ title: '-' + score + '⭐', icon: 'none' });
      } else {
        const res = await callApi('checkIn', {
          childId: app.globalData.childId, taskId, date: this.data.dayDate
        });
        this.setData({ totalStars: res.totalStars, streak: res.streak, level: res.level });
        this.burst();
        this.showPraise(task);
        wx.showToast({ title: '+' + score + '⭐', icon: 'none' });
      }
      await this.load();   // 该项即时下移；弹层不关，滚动位保留（组件未卸载）
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
    }
  },
  openRedeem(e) {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '请点击右上角锁图标开启家长模式', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const target = (this.data.rewards || []).find(r => r._id === id);
    if (!target) return;
    // 仅一次奖励且已兑换 → 再次点击直接取消兑换（返还星星、恢复可兑），不弹确认
    if (!target.resetAfterRedeem && target.redeemed) {
      this.undoRedeem(target);
      return;
    }
    if (this.data.totalStars < target.cost) {
      wx.showToast({ title: '星星不够啦', icon: 'none' });
      return;
    }
    this.setData({ showRedeem: true, redeemTarget: target });
  },
  async undoRedeem(target) {
    const app = getApp();
    try {
      const res = await callApi('feedCRUD', { op: 'undoRedeem', id: target.redeemId });
      this.setData({ totalStars: res.totalStars });
      wx.showToast({ title: '+' + target.cost + '⭐', icon: 'none' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' });
    }
  },
  noop() {},
  onRedeemClose() {
    this.setData({ showRedeem: false, redeemTarget: null });
  },
  async confirmRedeem() {
    const t = this.data.redeemTarget;
    if (!t) return;
    const app = getApp();
    try {
      const res = await callApi('redeem', {
        childId: app.globalData.childId, rewardId: t._id
      });
      this.setData({ showRedeem: false, redeemTarget: null, totalStars: res.totalStars });
      this.burst();
      this.showPraise(t);   // 兑换成功 → 礼花筒 + 宠物说奖励的正面反馈（与打卡同款）
      wx.showToast({ title: '兑换成功 🎉', icon: 'none' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '兑换失败', icon: 'none' });
    }
  },
  burst() {
    this.setData({ confetti: CF.cannonPieces(), confettiFlash: true });
    setTimeout(() => this.setData({ confetti: [] }), 2000);
    setTimeout(() => this.setData({ confettiFlash: false }), 700);
  },
  // 打卡后弹出宠物气泡：真实宠物走 utils/pets 解析幼/成档图；无宠物 fallback 🐣
  showPraise(task) {
    const praise = (task && task.praise) ? String(task.praise).trim() : '';
    const text = praise || '恭喜完成任务，你是最棒的！';
    let petImage = '';
    const pet = this._pet;
    if (pet && pet.species) {
      const sp = pets.resolveSpeciesKey(pet.species);
      const info = pets.stageInfo(pet.growthValue || 0, sp);
      const spc = pets.speciesOf(sp);
      const base = (info.stage === 2 ? spc.imgAdult : spc.imgBaby) || '';
      // 用「被抚摸后的 happy」姿态图（*_happy.png）替换基础姿态，更开心
      petImage = base ? base.replace(/\.png$/, '_happy.png') : '';
    }
    if (this.data.praiseTimer) clearTimeout(this.data.praiseTimer);
    const bubbleStyle = bubbleStyleFor(pet && pet.species);
    this.setData({ showPraise: true, praiseText: text, petImage, bubbleStyle });
    const t = setTimeout(() => this.setData({ showPraise: false, praiseTimer: null }), 3000);
    this.setData({ praiseTimer: t });
  },
  closePraise() {
    if (this.data.praiseTimer) clearTimeout(this.data.praiseTimer);
    this.setData({ showPraise: false, praiseTimer: null });
  },
});
