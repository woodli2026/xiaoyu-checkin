const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const T = require('../../utils/tasks');
const { attachTabBarSync } = require('../../utils/tabbar');
const session = require('../../utils/parent-session');
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
function todayStr() { return D.ymd(new Date()); }
function emptyTaskForm(childId) {
  return {
    childId, title: '', type: 'study', icon: '✏️',
    dateEnabled: true, date: todayStr(),
    repeatEnabled: false, repeatType: 'day', interval: 1,
    weekdays: [false, false, false, false, false, false, false],
    score: 1, priority: 'none'
  };
}
function emptyRewardForm(childId) {
  return { childId, title: '', icon: '🎁', category: 'reward', resetAfterRedeem: true, cost: 5, praise: '' };
}
Page({
  behaviors: [require('../../behaviors/pin-reauth')],
  data: {
    mode: 'display', pinSet: false, subTab: 'task',
    tasks: [], rewards: [],
    types: T.TYPE_OPTIONS, priorities: T.PRIORITY_OPTIONS, categories: T.CATEGORY_OPTIONS,
    weekdayLabels: WEEKDAY_LABELS,
    showEditor: false, editorKind: 'task', editing: false, form: {},
    showIcon: false,
    showConfirm: false, confirmKind: '', confirmId: '', confirmTitle: ''
  },
  onAppTouch() { getApp().touch(); },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    attachTabBarSync(this);
    this.refresh();
  },
  async refresh() {
    const app = getApp();
    try { await app.whenReady(); } catch (e) { return; }
    this.setData({
      mode: app.globalData.mode,
      pinSet: !!(app.globalData.user && app.globalData.user.pinSet)
    });
    await this.load();
  },
  async load() {
    const app = getApp();
    try {
      wx.showLoading({ title: '加载中', mask: true });
      const res = await callApi('getDashboard', { childId: app.globalData.childId });
      const tasks = (res.tasks || []).map(t => Object.assign({}, t, {
        typeLabel: T.TYPE_LABEL[t.type] || '',
        repeatLabel: T.repeatLabel(t)
      }));
      const rewards = (res.rewards || []).map(r => Object.assign({}, r, {
        catLabel: T.CATEGORY_LABEL[r.category] || '奖励'
      }));
      this.setData({ tasks, rewards });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
  switchSub(e) { this.setData({ subTab: e.currentTarget.dataset.tab }); },
  requireParent() {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '请点击首页右上角锁图标开启家长模式', icon: 'none' });
      return false;
    }
    return true;
  },
  onFab() {
    if (!this.requireParent()) return;
    if (this.data.subTab === 'task') this.openCreateTask();
    else this.openCreateReward();
  },
  openCreateTask() {
    if (!this.requireParent()) return;
    this.setData({ showEditor: true, editorKind: 'task', editing: false, form: emptyTaskForm(getApp().globalData.childId) });
  },
  openCreateReward() {
    if (!this.requireParent()) return;
    this.setData({ showEditor: true, editorKind: 'reward', editing: false, form: emptyRewardForm(getApp().globalData.childId) });
  },
  openTask(e) {
    if (!this.requireParent()) return;
    const t = this.data.tasks.find(x => x._id === e.currentTarget.dataset.id);
    if (!t) return;
    const r = t.repeat || {};
    this.setData({
      showEditor: true, editorKind: 'task', editing: true,
      form: {
        _id: t._id, childId: t.childId, title: t.title, type: t.type, icon: t.icon,
        praise: t.praise || '',
        dateEnabled: !!t.date, date: t.date || todayStr(),
        repeatEnabled: !!r.enabled, repeatType: r.type || 'day',
        interval: r.interval || 1,
        weekdays: [0, 1, 2, 3, 4, 5, 6].map(i => (r.weekdays || []).indexOf(i) >= 0),
        score: t.score, priority: t.priority || 'none'
      }
    });
  },
  openReward(e) {
    if (!this.requireParent()) return;
    const r = this.data.rewards.find(x => x._id === e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      showEditor: true, editorKind: 'reward', editing: true,
      form: {
        _id: r._id, childId: r.childId, title: r.title, icon: r.icon,
        category: r.category, resetAfterRedeem: !!r.resetAfterRedeem,
        cost: r.cost, praise: r.praise || ''
      }
    });
  },
  noop() {},
  closeEditor() { this.setData({ showEditor: false }); },
  onInput(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }); },
  onSwitch(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }); },
  onPickDate(e) { this.setData({ 'form.date': e.detail.value }); },
  onSelect(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.currentTarget.dataset.value }); },
  onSelectSwitch(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.currentTarget.dataset.value === 'yes' });
  },
  onNumInput(e) {
    const field = e.currentTarget.dataset.field;
    let v = String(e.detail.value == null ? '' : e.detail.value).replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2);   // 最多两位 → 有效范围 1–99
    this.setData({ ['form.' + field]: v });
  },
  onRepeatMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'none') this.setData({ 'form.repeatEnabled': false });
    else this.setData({ 'form.repeatEnabled': true, 'form.repeatType': mode });
  },
  onInterval(e) { this.setData({ 'form.interval': Number(e.detail.value) || 1 }); },
  toggleWeekday(e) {
    const wd = Number(e.currentTarget.dataset.wd);
    const cur = this.data.form.weekdays || [];
    this.setData({ ['form.weekdays[' + wd + ']']: !cur[wd] });
  },
  openIcon() { this.setData({ showIcon: true }); },
  onIconPick(e) { this.setData({ 'form.icon': e.detail.icon, showIcon: false }); },
  onIconClose() { this.setData({ showIcon: false }); },
  async save() {
    const f = this.data.form;
    if (!f.title || !String(f.title).trim()) { wx.showToast({ title: '请填写标题', icon: 'none' }); return; }
    try {
      if (this.data.editorKind === 'task') {
        const score = Number(f.score);
        if (!(score >= 1) || score > 99) { wx.showToast({ title: '请填写 1–99 的星星数', icon: 'none' }); return; }
        const payload = {
          childId: f.childId, title: f.title, type: f.type, icon: f.icon,
          praise: f.praise || '',
          date: f.dateEnabled ? f.date : todayStr(),
          repeat: {
            enabled: !!f.repeatEnabled, type: f.repeatType,
            interval: Number(f.interval) || 1,
            weekdays: (f.weekdays || []).map((on, i) => (on ? i : -1)).filter(i => i >= 0)
          },
          score, priority: f.priority
        };
        if (this.data.editing) {
          payload.id = f._id;
          await callApi('taskCRUD', { op: 'update', payload });
        } else {
          await callApi('taskCRUD', { op: 'create', payload });
        }
      } else {
        const cost = Number(f.cost);
        if (!(cost >= 1) || cost > 99) { wx.showToast({ title: '请填写 1–99 的星星数', icon: 'none' }); return; }
        const payload = {
          childId: f.childId, title: f.title, icon: f.icon, category: f.category,
          resetAfterRedeem: !!f.resetAfterRedeem, praise: f.praise || '', cost
        };
        if (this.data.editing) {
          payload.id = f._id;
          await callApi('rewardCRUD', { op: 'update', payload });
        } else {
          await callApi('rewardCRUD', { op: 'create', payload });
        }
      }
      this.closeEditor();
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    }
  },
  askDelete(e) {
    if (!this.requireParent()) return;
    const kind = e.currentTarget.dataset.kind;
    const id = e.currentTarget.dataset.id;
    const item = kind === 'task'
      ? this.data.tasks.find(x => x._id === id)
      : this.data.rewards.find(x => x._id === id);
    this.setData({ showConfirm: true, confirmKind: kind, confirmId: id, confirmTitle: (item && item.title) || '' });
  },
  cancelDelete() {
    this.setData({ showConfirm: false });
  },
  async doDelete() {
    const kind = this.data.confirmKind;
    const id = this.data.confirmId;
    try {
      if (kind === 'task') {
        await callApi('taskCRUD', { op: 'delete', payload: { id } });
      } else {
        await callApi('rewardCRUD', { op: 'delete', payload: { id } });
      }
      this.setData({ showConfirm: false, showEditor: false });
      wx.showToast({ title: '已删除', icon: 'none' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' });
    }
  },
});