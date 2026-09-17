// components/emoji-picker —— 弹出式 64 格图标选择面板（高亮当前值，选中回写）
const { ICONS } = require('../../utils/icons');

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    current: { type: String, value: '' }
  },
  data: { icons: ICONS },
  methods: {
    noop() {},
    // 点弹层外的蒙层 → 关闭
    onMask() { this.triggerEvent('close'); },
    pick(e) {
      this.triggerEvent('pick', { icon: e.currentTarget.dataset.icon });
    },
    close() { this.triggerEvent('close'); }
  }
});
