// components/day-sheet —— 日历日明细弹层
// 待打卡在上、已完成在下，中间 2px 淡分隔线（无文字标签）
// 打卡控件统一为圆形勾选：待打卡=空心蓝环，已完成=绿底白✓
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    todo: { type: Array, value: [] },
    done: { type: Array, value: [] },
    mode: { type: String, value: 'display' },
    // 诊断信息：列表为空时一并显示，用于区分
    // 「确实没有任务」/「有任务但被可见性规则过滤掉」/「有数据却没渲染」
    diag: { type: String, value: '' }
  },
  methods: {
    noop() {},
    // 点弹层外的蒙层 → 关闭（catchtap 保证不会穿透到页面）
    onMask() { this.triggerEvent('close'); },
    onPick(e) {
      const id = e.currentTarget.dataset.id;
      const item = (this.data.todo || []).find(t => t.taskId === id);
      this.triggerEvent('pick', { taskId: id, task: item });
    },
    onScroll(e) { this.triggerEvent('scroll', { scrollTop: e.detail.scrollTop }); },
    close() { this.triggerEvent('close'); }
  }
});
