const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const F = require('../../utils/feed');
const { attachTabBarSync } = require('../../utils/tabbar');
const session = require('../../utils/parent-session');
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
  behaviors: [require('../../behaviors/pin-reauth')],
  data: {
    mode: 'display', pinSet: false, useCloud: false,
    groups: [], total: 0, loading: false, hasMore: false,
    showDetail: false, detail: null, detailErr: '', busy: false
  },
  onAppTouch() { getApp().touch(); },
  onShow() {
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
  },
  closeDetail() { this.setData({ showDetail: false, detail: null, detailErr: '' }); },
  noop() {},
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
      await callApi('feedCRUD', { op, id: it.id });
      wx.showToast({ title: isCheckin ? '已标记为未完成' : '已取消兑换', icon: 'none' });
      this.setData({ showDetail: false, detail: null, busy: false });
      await this.reload();
    } catch (err) {
      const msg = (err && err.message) || '操作失败';
      this.setData({ busy: false, detailErr: err && err.code === 'TOKEN_INVALID' ? '家长模式已失效，请重新解锁' : msg });
    }
  }
});