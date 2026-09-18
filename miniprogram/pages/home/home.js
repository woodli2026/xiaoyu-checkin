// pages/home —— Tab1：打卡页签 + 兑换页签（展示模式只读；家长模式可写）
const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const { PRIVACY_KEY } = require('../../config');
const { setTabBarHidden, attachTabBarSync } = require('../../utils/tabbar');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 构建任意月份的日历：lit=当天有任意打卡（背景色）；done=当天所有可见任务都已完成（右上角对号）
// 依赖完整 tasks / checkIns，因此可渲染当前月份之外的历史月（打卡流水与任务清单均全量返回）。
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
    showPin: false,
    pinError: '',
    pinAttempt: 0,
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

  // 任意点击重置家长模式空闲计时（R10）
  onAppTouch() { getApp().touch(); },

  onShow() {
    // 自定义 tabBar 需由页面主动同步选中态。
    // tabBar 的显隐不再靠人工配对：attachTabBarSync 会在每次 setData 后
    // 按弹层开关自动重算，因此不存在「忘了恢复」的可能（详见 utils/tabbar.js）
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

  // —— 合规：首次启动隐私协议 + 每日首次使用提醒 ——
  checkPrivacy() {
    let agreed = false;
    try { agreed = !!wx.getStorageSync(PRIVACY_KEY); } catch (e) {}
    this.setData({ showPrivacy: !agreed });
  },
  agreePrivacy() {
    try { wx.setStorageSync(PRIVACY_KEY, true); } catch (e) {}
    this.setData({ showPrivacy: false });
    this.restTip();
  },
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

  // —— 日历月份切换（左右滑动 + 箭头）——
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

  // 横向滑动手势：右滑(Δx>0)→前一个月；左滑(Δx<0)→下一个月。需满足横向位移明显大于纵向，避免与页面滚动冲突。
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

  // —— 子页签 ——
  switchSub(e) { this.setData({ subTab: e.currentTarget.dataset.tab }); },

  // —— 家长模式开关（首页右上角锁图标，与「我」页切换行同逻辑）——
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
    setTabBarHidden(this, true);
  },

  async onPinComplete(e) {
    const app = getApp();
    try {
      const res = await callApi('unlockParent', { pin: e.detail.pin });
      app.globalData.parentToken = res.parentToken;
      app.globalData.parentTokenExpire = res.expireAt;
      app.globalData.mode = 'parent';
      this.setData({ showPin: false, pinError: '', mode: 'parent' });
      setTabBarHidden(this, false);
      this.burst();
      wx.showToast({ title: '已进入家长模式', icon: 'success' });
    } catch (err) {
      // attempt 必须递增：同一句错误文案第二次不会变化，仅靠 error 无法让输入复位，
      // 会导致满位数后键盘被锁死（用户表现为「输了没反应」）。
      this.setData({
        pinError: (err && err.message) || 'PIN 不正确',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onPinClose() { this.setData({ showPin: false, pinError: '' }); setTabBarHidden(this, false); },

  // PIN 面板上的自救入口：不需要家长模式即可把 PIN 恢复为默认值
  async onPinForgot() {
    try {
      const res = await callApi('resetPin', {});
      const def = (res && res.defaultPin) || '123456';
      this.setData({ pinError: '', pinAttempt: this.data.pinAttempt + 1 });
      wx.showModal({
        title: 'PIN 已恢复默认',
        content: '已重置为 ' + def + '，请重新输入。进入家长模式后建议到「我」页改成自己的。',
        showCancel: false
      });
    } catch (err) {
      this.setData({
        pinError: (err && err.message) || '重置失败，请重试',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },

  // —— 日历日明细 ——
  openDay(e) { this.renderDay(e.currentTarget.dataset.date); },
  onDayClose() { this.setData({ showDay: false }); setTabBarHidden(this, false); },
  onDayScroll(e) { this._dayScrollTop = e.detail.scrollTop; },

  renderDay(date) {
    if (!date) return;
    // 优先用实例缓存；若为空（dashboard 尚未返回、或上一次 load 失败）则回退到 data，
    // 避免出现「弹层打开了但列表是空的」这种无法自查的现象。
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
      // 为空时把真实数量显示出来，一眼分辨「没有任务」/「被可见性规则过滤」/「有数据却没渲染」
      dayDiag: '全部 ' + all.length + ' 个任务 · 该日可见 ' + list.length + ' 个 · ' + date
    });
    setTabBarHidden(this, true);   // 弹层贴底，必须让开底部导航
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
        childId: app.globalData.childId, taskId, date: this.data.dayDate,
        parentToken: app.globalData.parentToken
      });
      this.setData({ totalStars: res.totalStars, streak: res.streak, level: res.level });
      this.burst();
      wx.showToast({ title: '+' + ((task && task.score) || 1) + '⭐', icon: 'none' });
      await this.load();   // 该项即时下移；弹层不关，滚动位保留（组件未卸载）
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '打卡失败', icon: 'none' });
    }
  },

  // —— 兑换 ——
  openRedeem(e) {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '请点击右上角锁图标开启家长模式', icon: 'none' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const target = (this.data.rewards || []).find(r => r._id === id);
    if (!target) return;
    // 限次奖励：已兑换过就直接拦下（替代原「库存不足」）
    if (!target.resetAfterRedeem && target.redeemed) {
      wx.showToast({ title: '该奖励每位孩子只能兑换一次', icon: 'none' });
      return;
    }
    if (this.data.totalStars < target.cost) {
      wx.showToast({ title: '星星不够啦', icon: 'none' });
      return;
    }
    this.setData({ showRedeem: true, redeemTarget: target });
    setTabBarHidden(this, true);
  },
  // 供弹层内部 catchtap 使用：吞掉冒泡，避免点弹层内容时误触发蒙层的「点击关闭」
  noop() {},

  onRedeemClose() {
    this.setData({ showRedeem: false, redeemTarget: null });
    setTabBarHidden(this, false);
  },

  async confirmRedeem() {
    const t = this.data.redeemTarget;
    if (!t) return;
    const app = getApp();
    try {
      const res = await callApi('redeem', {
        childId: app.globalData.childId, rewardId: t._id, parentToken: app.globalData.parentToken
      });
      this.setData({ showRedeem: false, redeemTarget: null, totalStars: res.totalStars });
      setTabBarHidden(this, false);
      this.burst();
      wx.showToast({ title: '兑换成功 🎉', icon: 'none' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '兑换失败', icon: 'none' });
    }
  },

  // —— 撒花动效 ——
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
