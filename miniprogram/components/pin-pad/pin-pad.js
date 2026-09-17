// components/pin-pad —— 家长模式 PIN 闸（6 位圆点 + 自定义数字键盘）
const PIN_LENGTH = 6;

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '进入家长模式' },
    sub: { type: String, value: '' },
    error: { type: String, value: '' },
    // 父层每处理完一次提交（无论成败）就 +1，组件据此清空输入重新开始。
    // 【不要用 error 的值来触发清空】同一句错误文案第二次不会发生变化，
    // observer 不再触发 → 输入停在满位数 → 被 length 判定拦住 → 键盘看起来「没反应」。
    attempt: { type: Number, value: 0 },
    // 传了才显示「忘记 PIN」入口（设置/确认 PIN 的场景不需要）
    forgotText: { type: String, value: '' }
  },
  data: {
    dots: [0, 1, 2, 3, 4, 5],
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'],
    input: ''
  },
  observers: {
    show(show) { if (show) this.setData({ input: '' }); },
    attempt() { this.setData({ input: '' }); }
  },
  methods: {
    noop() {},
    onKey(e) {
      const k = e.currentTarget.dataset.k;
      if (k === '' || k == null) return;
      let input = this.data.input;
      if (k === '⌫') {
        this.setData({ input: input.slice(0, -1) });
        return;
      }
      if (!/^\d$/.test(k)) return;              // 非数字忽略
      if (input.length >= PIN_LENGTH) return;   // 超长截断
      input = input + k;
      this.setData({ input });
      if (input.length === PIN_LENGTH) this.triggerEvent('complete', { pin: input });
    },
    forgot() { this.triggerEvent('forgot'); },
    close() { this.triggerEvent('close'); }
  }
});
