// pages/feed —— Tab3：动态（全部宝宝的打卡 + 兑换流水；撤销需家长模式）
const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const F = require('../../utils/feed');
const { setTabBarHidden, attachTabBarSync } = require('../../utils/tabbar');

const PAGE_SIZE = 30;

function modal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (res) => resolve(res),
      fail: () => resolve({ confirm: false })
    }));
  });
}

Page({
  data: {
    mode: 'display', pinSet: false, useCloud: false,
    groups: [], total: 0, loading: false, hasMore: false,
    showDetail: false, detail: null, detailErr: '', busy: false,
    showPin: false, pinError: '', pinAttempt: 0
  },

  // 任意点击重置家长模式空闲计时（R10）
  onAppTouch() { getApp().touch(); },

  onShow() {
    // 自定义 tabBar 需由页面主动同步选中态（本页为第 3 个 tab，索引 2）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
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
    await this.reload();
  },

  // 重新拉第一页（撤销后 / 每次进入页面都会调用）
  async reload() {
    this._items = [];
    await this.loadMore();
  },

  async loadMore() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await callApi('feedCRUD', {
        op: 'list', limit: PAGE_SIZE, skip: (this._items || []).length
      });
      const items = (this._items || []).concat(res.items || []);
      this._items = items;
      this.setData({
        groups: F.groupByDay(items, D.ymd(new Date())),
        total: res.total || items.length,
        hasMore: !!res.hasMore
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() { if (this.data.hasMore) this.loadMore(); },

  // —— 详情 ——
  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const it = (this._items || []).find(x => x.id === id);
    if (!it) return;
    const today = D.ymd(new Date());
    const detail = Object.assign({}, it, {
      time: F.timeText(it.createdAt, today),
      deltaText: F.deltaText(it.delta),
      backfill: F.isBackfill(it)
    });
    if (it.kind === 'checkin') {
      detail.typeLabel = T.TYPE_LABEL[it.taskType] || '—';
      detail.repeatLabel = T.repeatLabel({ date: it.date, repeat: it.repeat || {} });
      detail.priorityLabel = T.priorityInfo(it.priority).label;
    } else {
      detail.categoryLabel = T.CATEGORY_LABEL[it.category] || '奖励';
    }
    this.setData({ showDetail: true, detail, detailErr: '' });
    setTabBarHidden(this, true);
  },
  closeDetail() { this.setData({ showDetail: false, detail: null, detailErr: '' }); setTabBarHidden(this, false); },
  noop() {},

  // —— 家长模式（本页右上角锁图标，与首页同逻辑）——
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
      wx.showToast({ title: '已进入家长模式', icon: 'success' });
    } catch (err) {
      // attempt 必须递增：同一句错误文案第二次不变化会让输入无法复位
      this.setData({
        pinError: (err && err.message) || 'PIN 不正确',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onPinClose() { this.setData({ showPin: false, pinError: '' }); setTabBarHidden(this, false); },

  // —— 撤销：标记为未完成 / 取消兑换 ——
  async undoCheckIn() { await this._undo('undoCheckIn'); },
  async undoRedeem() { await this._undo('undoRedeem'); },

  async _undo(op) {
    const it = this.data.detail;
    if (!it || this.data.busy) return;
    if (this.data.mode !== 'parent') {
      this.setData({ detailErr: '请点击右上角锁图标开启家长模式' });
      return;
    }
    const isCheckin = op === 'undoCheckIn';
    const r = await modal({
      title: isCheckin ? '标记为未完成' : '取消兑换',
      content: isCheckin
        ? '将删除「' + it.childName + '」在 ' + (it.date || '') + ' 的这次打卡，并扣回 ' + it.stars + ' 颗星。确定？'
        : '将取消「' + it.childName + '」兑换的「' + it.title + '」，并返还 ' + it.stars + ' 颗星。确定？'
    });
    if (!r.confirm) return;

    const app = getApp();
    this.setData({ busy: true, detailErr: '' });
    try {
      await callApi('feedCRUD', { op, id: it.id, parentToken: app.globalData.parentToken });
      wx.showToast({ title: isCheckin ? '已标记为未完成' : '已取消兑换', icon: 'none' });
      this.setData({ showDetail: false, detail: null, busy: false });
      await this.reload();
    } catch (err) {
      const msg = (err && err.message) || '操作失败';
      this.setData({ busy: false, detailErr: err && err.code === 'TOKEN_INVALID' ? '家长模式已失效，请重新解锁' : msg });
    }
  }
});
