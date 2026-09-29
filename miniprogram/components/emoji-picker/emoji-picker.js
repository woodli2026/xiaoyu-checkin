// components/emoji-picker —— 弹出式分类图标选择面板（参考微信表情面板：
// 底部分类栏切换，每次只显示当前分类的网格；高亮当前值，选中回写）
// kind 决定候选集：'task'（默认）/ 'reward'，各 6 类 × 24 个（utils/icons.js，core.test.js 有守卫）。
const { ICON_SETS, DEFAULT_SET, groupsOf } = require('../../utils/icons');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: {
      type: Boolean,
      value: false,
      // 每次打开：定位到当前选中图标所在分类，找不到则回第一类
      observer(v) {
        if (v) this._locateCurrent();
      }
    },
    current: {
      type: String,
      value: '',
      observer() { if (this.data.show) this._locateCurrent(); }
    },
    // 用途：'task' | 'reward'。未传或传错一律回退任务集。
    kind: {
      type: String,
      value: DEFAULT_SET,
      observer(v) { this._syncGroups(v); }
    }
  },
  data: {
    groups: ICON_SETS[DEFAULT_SET],
    active: 0,
    setLabel: '任务图标'
  },
  lifetimes: {
    // 属性初始值（父组件 WXML 传入）不一定触发 observer，attached 再同步一次
    attached() { this._syncGroups(this.data.kind); }
  },
  methods: {
    _syncGroups(kind) {
      const key = ICON_SETS[kind] ? kind : DEFAULT_SET;
      const groups = groupsOf(key);
      this.setData({
        groups,
        setLabel: key === 'reward' ? '奖励图标' : '任务图标'
      });
      this._locateCurrent();
    },
    // 打开面板时：把激活分类切到 current 所在组
    _locateCurrent() {
      const cur = this.data.current;
      const idx = this.data.groups.findIndex(g => g.icons.indexOf(cur) >= 0);
      if (idx >= 0 && idx !== this.data.active) this.setData({ active: idx });
      else if (idx < 0 && this.data.active !== 0) this.setData({ active: 0 });
    },
    // 底部分类栏切换
    switchTab(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      if (idx === this.data.active) return;
      this.setData({ active: idx });
    },
    noop() {},
    // 点弹层外的蒙层 → 关闭
    onMask() { this.triggerEvent('close'); },
    pick(e) {
      this.triggerEvent('pick', { icon: e.currentTarget.dataset.icon });
    },
    close() { this.triggerEvent('close'); }
  }
});
