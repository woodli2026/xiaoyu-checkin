// pages/mine —— Tab3：家长模式切换 / PIN 设置重置 / 多孩子 / 帮助 / 关于 / 邀请码
const { callApi } = require('../../utils/api');
const { setTabBarHidden, attachTabBarSync } = require('../../utils/tabbar');

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
    user: { nickname: '', avatar: '🧒', randomCode: '' },
    child: null, childId: '', children: [],
    version: '1.0.0',
    showPin: false, pinError: '', pinAttempt: 0,
    showSetPin: false, setPinStage: 'new', pendingPin: '', setPinErr: '',
    showEditChild: false, editName: '', editAvatar: '🧒', editErr: '', showEditAvatar: false,
    showHelp: false, showAbout: false
  },

  noop() {},

  onShow() {
    // 自定义 tabBar 需由页面主动同步选中态。
    // tabBar 的显隐不再靠人工配对：attachTabBarSync 会在每次 setData 后
    // 按弹层开关自动重算，因此不存在「忘了恢复」的可能（详见 utils/tabbar.js）
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    attachTabBarSync(this);
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    try { await app.whenReady(); } catch (e) { return; }
    const u = app.globalData.user || {};
    this.setData({
      mode: app.globalData.mode,
      pinSet: !!u.pinSet,
      useCloud: app.globalData.useCloud,
      user: { nickname: u.nickname || '', avatar: u.avatar || '🧒', randomCode: u.randomCode || '' },
      childId: app.globalData.childId,
      version: app.globalData.version
    });
    await this.load();
  },

  async load() {
    const app = getApp();
    try {
      const res = await callApi('getDashboard', { childId: app.globalData.childId });
      this.setData({ children: res.children || [], child: res.child || null });
    } catch (e) { /* 忽略 */ }
  },

  // —— 家长模式开关（与首页锁图标同逻辑）——
  toggleParent() {
    const app = getApp();
    if (this.data.mode === 'parent') {
      app.clearParent();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已退出家长模式', icon: 'none' });
      return;
    }
    if (!this.data.pinSet) {
      wx.showToast({ title: '请先设置家长 PIN', icon: 'none' });
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
      // attempt 必须递增：同一句错误文案第二次不变化，仅靠 error 无法让输入复位
      this.setData({
        pinError: (err && err.message) || 'PIN 不正确',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onPinClose() { this.setData({ showPin: false, pinError: '' }); setTabBarHidden(this, false); },

  // PIN 面板上的自救入口：不需要家长模式即可把 PIN 恢复为默认值
  async onPinForgot() {
    try {
      const res = await callApi('resetPin', {});
      const def = (res && res.defaultPin) || '123456';
      this.setData({ pinError: '', pinAttempt: this.data.pinAttempt + 1 });
      wx.showModal({
        title: 'PIN 已恢复默认',
        content: '已重置为 ' + def + '，请重新输入。建议进入家长模式后到本页改成自己的。',
        showCancel: false
      });
    } catch (err) {
      this.setData({
        pinError: (err && err.message) || '重置失败，请重试',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },

  // —— 设置 / 修改 PIN（需家长模式）——
  openSetPin() {
    const app = getApp();
    if (app.globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return;
    }
    this.setData({ showSetPin: true, setPinStage: 'new', pendingPin: '', setPinErr: '' });
    setTabBarHidden(this, true);
  },
  onSetPinComplete(e) {
    if (this.data.setPinStage === 'new') {
      this.setData({ showSetPin: false, pendingPin: e.detail.pin, setPinErr: '' });
      setTimeout(() => this.setData({ showSetPin: true, setPinStage: 'confirm' }), 60);
      return;
    }
    if (e.detail.pin !== this.data.pendingPin) {
      this.setData({ showSetPin: false, setPinStage: 'new', pendingPin: '' });
      setTimeout(() => this.setData({ showSetPin: true, setPinErr: '两次输入不一致，请重试' }), 60);
      return;
    }
    this.doSetPin(this.data.pendingPin);
  },
  async doSetPin(pin) {
    const app = getApp();
    try {
      await callApi('setPin', { pin, parentToken: app.globalData.parentToken });
      if (app.globalData.user) app.globalData.user.pinSet = true;
      this.setData({ showSetPin: false, pinSet: true, pendingPin: '' });
      setTabBarHidden(this, false);
      wx.showToast({ title: 'PIN 已设置', icon: 'success' });
    } catch (err) {
      // 设置失败时弹层仍开着，必须复位输入，否则键盘同样会被锁死
      this.setData({
        setPinErr: (err && err.message) || '设置失败',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onSetPinClose() { this.setData({ showSetPin: false, setPinStage: 'new', pendingPin: '' }); setTabBarHidden(this, false); },

  // 重置口径（与云函数 resetPin 一致）：恢复为内置默认 PIN，而非把账号置为「无 PIN」
  async forgotPin() {
    const r = await modal({
      title: '重置 PIN',
      content: '将把家长 PIN 恢复为默认值 123456，重置后请尽快改成自己的。确定？'
    });
    if (!r.confirm) return;
    try {
      await callApi('resetPin', {});
      const app = getApp();
      if (app.globalData.user) app.globalData.user.pinSet = true;
      app.clearParent();
      this.setData({ pinSet: true, mode: 'display' });
      wx.showToast({ title: '已恢复默认 PIN', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '重置失败', icon: 'none' });
    }
  },

  // —— 多孩子切换（点横排头像卡，需家长模式）——
  async pickChild(e) {
    const app = getApp();
    const childId = e.currentTarget.dataset.id;
    if (childId === this.data.childId) return;
    if (app.globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return;
    }
    try {
      await callApi('childSwitch', { childId, parentToken: app.globalData.parentToken });
      app.globalData.childId = childId;
      this.setData({ childId });
      wx.showToast({ title: '已切换', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' });
    }
  },

  // —— 编辑孩子档案：昵称 / 头像（需家长模式）——
  // 注：PRD 的 MVP 清单未含此入口，属本轮确认新增（见 README §8 偏差 #6）
  openEditChild() {
    const app = getApp();
    if (app.globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return;
    }
    const c = this.data.child || {};
    this.setData({
      showEditChild: true,
      editName: c.name || '宝宝',
      editAvatar: c.avatar || '🧒',
      editErr: ''
    });
    setTabBarHidden(this, true);
  },
  closeEditChild() {
    this.setData({ showEditChild: false, editErr: '', showEditAvatar: false });
    setTabBarHidden(this, false);
  },
  onEditNameInput(e) { this.setData({ editName: e.detail.value, editErr: '' }); },
  // 头像选择器从编辑档案弹层里打开，关闭后编辑弹层仍在，故此处不恢复 tabBar
  openEditAvatar() { this.setData({ showEditAvatar: true }); setTabBarHidden(this, true); },
  onEditAvatarClose() { this.setData({ showEditAvatar: false }); },
  onEditAvatarPick(e) { this.setData({ showEditAvatar: false, editAvatar: e.detail.icon }); },

  async saveChildProfile() {
    const app = getApp();
    const name = String(this.data.editName || '').trim();
    if (!name) { this.setData({ editErr: '昵称不能为空' }); return; }
    if (name.length > 12) { this.setData({ editErr: '昵称最多 12 个字' }); return; }
    try {
      const res = await callApi('childCRUD', {
        op: 'update',
        childId: this.data.childId,
        parentToken: app.globalData.parentToken,
        payload: { name, avatar: this.data.editAvatar }
      });
      this.setData({ showEditChild: false, editErr: '', child: res.child });
      setTabBarHidden(this, false);
      wx.showToast({ title: '已保存', icon: 'success' });
      await this.load();
    } catch (err) {
      this.setData({ editErr: (err && err.message) || '保存失败' });
    }
  },

  // —— 邀请码（内测阶段仅展示，点击复制）——
  copyInvite() {
    const code = (this.data.user && this.data.user.randomCode) || '';
    if (!code) return;
    wx.setClipboardData({ data: code });   // 系统自带「内容已复制」提示
  },

  // —— 帮助 / 关于 ——
  openHelp() { this.setData({ showHelp: true }); setTabBarHidden(this, true); },
  closeHelp() { this.setData({ showHelp: false }); setTabBarHidden(this, false); },
  openAbout() { this.setData({ showAbout: true }); setTabBarHidden(this, true); },
  closeAbout() { this.setData({ showAbout: false }); setTabBarHidden(this, false); },

  // —— 本地演示数据重置（仅本地模式）——
  async resetDemo() {
    const r = await modal({ title: '重置本地演示数据', content: '将清空本机所有任务/奖励/打卡记录并重新生成账号。确定？' });
    if (!r.confirm) return;
    const app = getApp();
    try {
      await callApi('resetAll', {});
      app.clearParent();
      await app.login();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已重置', icon: 'success' });
      this.refresh();
    } catch (e) {
      wx.showToast({ title: '重置失败', icon: 'none' });
    }
  }
});
