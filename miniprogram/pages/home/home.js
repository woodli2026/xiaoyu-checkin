const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const { PRIVACY_KEY } = require('../../config');
const { attachTabBarSync } = require('../../utils/tabbar');
const session = require('../../utils/parent-session');
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function buildCalendar(allTasks, checkIns, viewYm, today) {
  const parts = viewYm.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const startWd = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const litSet = new Set(checkIns.map(c => c.date));
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push({ key: 'b' + i, blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${pad2(m)}-${pad2(d)}`;
    cells.push({
      key: ds, day: d, date: ds,
      lit: litSet.has(ds),
      today: ds === today,
      done: T.dayAllDone(allTasks, checkIns, ds)
    });
  }
  return { cells, label: y + '年' + m + '月' };
}
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
    confetti: []
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
        calendar: buildCalendar(res.tasks || [], res.checkIns || [], viewYm, today),
        todayDone: todayTasks.filter(t => t.checked).length,
        todayTotal: todayTasks.length,
        monthCount: monthLit.length,
        allTasks: res.tasks || [],
        rewards: res.rewards || [],
        todayStr: today,
        mode: app.globalData.mode
      });
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
      calendar: buildCalendar(this._allTasks || [], this._checkIns || [], viewYm, today)
    });
  },
  stepMonth(delta) {
    let [y, m] = (this.data.viewYm || D.ymd(new Date()).slice(0, 7)).split('-').map(Number);
    m += delta;
    if (m > 12) { m = 1; y += 1; }
    else if (m < 1) { m = 12; y -= 1; }
    this.setData({ viewYm: `${y}-${pad2(m)}` });
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
      taskId: t._id, title: t.title, icon: t.icon, score: t.score, checked: checked.has(t._id)
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
    const taskId = e.detail.taskId;
    const app = getApp();
    const task = (this._allTasks || []).find(t => t._id === taskId);
    try {
      const res = await callApi('checkIn', {
        childId: app.globalData.childId, taskId, date: this.data.dayDate
      });
      this.setData({ totalStars: res.totalStars, streak: res.streak, level: res.level });
      this.burst();
      wx.showToast({ title: '+' + ((task && task.score) || 1) + '⭐', icon: 'none' });
      await this.load();   // 该项即时下移；弹层不关，滚动位保留（组件未卸载）
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '打卡失败', icon: 'none' });
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
    if (!target.resetAfterRedeem && target.redeemed) {
      wx.showToast({ title: '该奖励每位孩子只能兑换一次', icon: 'none' });
      return;
    }
    if (this.data.totalStars < target.cost) {
      wx.showToast({ title: '星星不够啦', icon: 'none' });
      return;
    }
    this.setData({ showRedeem: true, redeemTarget: target });
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
      wx.showToast({ title: '兑换成功 🎉', icon: 'none' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '兑换失败', icon: 'none' });
    }
  },
  burst() {
    const colors = ['#FFC93C', '#FF9AA2', '#7Fd3ff', '#C8F5DD', '#DDD0FF'];
    const pieces = [];
    for (let i = 0; i < 26; i++) {
      pieces.push({ id: i, left: Math.round(Math.random() * 100), color: colors[i % colors.length], delay: (Math.random() * 0.3).toFixed(2) });
    }
    this.setData({ confetti: pieces });
    setTimeout(() => this.setData({ confetti: [] }), 1600);
  }
});