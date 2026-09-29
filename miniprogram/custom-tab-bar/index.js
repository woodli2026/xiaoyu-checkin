// custom-tab-bar —— 自定义底部导航
// 为什么自定义：原生 tabBar 的字号由微信固定（约 20rpx），无法调大，也无法用自定义图标。
// 视觉基线：docs/design-雨宝记-UI.html 的 .tabbar / .tab（选中色为珊瑚粉）。
// 图标：Phosphor Icons（Fill，MIT），已按「未选中 #8C86A3 / 选中 #FF9AA2」各导出一份
//       SVG 放在 /images/tabbar/，颜色直接烘焙进文件，故选中态只需换 src，无需运行时改色。
Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    selected: 0,
    // 页面打开全屏弹层时会置 true —— 页面内的 z-index 压不住本组件，只能主动隐藏
    hidden: false,
    list: [
      { pagePath: '/pages/home/home', icon: '/images/tabbar/house-off.svg', iconOn: '/images/tabbar/house-on.svg', text: '首页' },
      { pagePath: '/pages/pet/pet', icon: '/images/tabbar/pet-off.svg', iconOn: '/images/tabbar/pet-on.svg', text: '宠物' },
      { pagePath: '/pages/tasks/tasks', icon: '/images/tabbar/tasks-off.svg', iconOn: '/images/tabbar/tasks-on.svg', text: '任务屋' },
      { pagePath: '/pages/feed/feed', icon: '/images/tabbar/feed-off.svg', iconOn: '/images/tabbar/feed-on.svg', text: '动态' },
      { pagePath: '/pages/mine/mine', icon: '/images/tabbar/mine-off.svg', iconOn: '/images/tabbar/mine-on.svg', text: '我' }
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
