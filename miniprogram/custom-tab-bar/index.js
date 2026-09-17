// custom-tab-bar —— 自定义底部导航
// 为什么自定义：原生 tabBar 的字号由微信固定（约 20rpx），无法调大，也无法带 emoji 图标。
// 视觉基线：design-小雨记-UI.html 的 .tabbar / .tab（emoji + 文字，选中色为珊瑚粉）。
Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    selected: 0,
    // 页面打开全屏弹层时会置 true —— 页面内的 z-index 压不住本组件，只能主动隐藏
    hidden: false,
    list: [
      { pagePath: '/pages/home/home', emoji: '🏠', text: '首页' },
      { pagePath: '/pages/tasks/tasks', emoji: '📋', text: '任务与奖励' },
      { pagePath: '/pages/mine/mine', emoji: '⚙️', text: '我' }
    ]
  },
  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      wx.switchTab({ url: this.data.list[index].pagePath });
    }
  }
});
