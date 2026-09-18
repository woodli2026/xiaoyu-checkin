// components/emoji-picker —— 弹出式分类图标选择面板（高亮当前值，选中回写）
// kind 决定候选集：'task'（默认）= 活动/自然/旅行/物品；'reward' = 食物与饮品/活动/旅行/物品。
// 两套各 72 个、分 4 类（utils/icons.js，core.test.js 有守卫）。
const { ICON_SETS, DEFAULT_SET, groupsOf } = require('../../utils/icons');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    current: { type: String, value: '' },
    // 用途：'task' | 'reward'。未传或传错一律回退任务集。
    kind: {
      type: String,
      value: DEFAULT_SET,
      observer(v) { this._syncGroups(v); }
    }
  },
  data: {
    groups: ICON_SETS[DEFAULT_SET],
    setLabel: '任务图标'
  },
  lifetimes: {
    // 属性初始值（父组件 WXML 传入）不一定触发 observer，attached 再同步一次
    attached() { this._syncGroups(this.data.kind); }
  },
  methods: {
    _syncGroups(kind) {
      const key = ICON_SETS[kind] ? kind : DEFAULT_SET;
      this.setData({
        groups: groupsOf(key),
        setLabel: key === 'reward' ? '奖励图标' : '任务图标'
      });
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
