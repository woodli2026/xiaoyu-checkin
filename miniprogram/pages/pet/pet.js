// pages/pet —— Tab2：宠物（第二阶段：宠物 + 积分）
//
// 数据全部经 utils/api.callApi('petCRUD', ...)：本地兜底与云函数同契约，页面不感知差异。
// 口径（与 services/local.js 的 petCRUD 逐条对齐）：
//   · stage 由 growthValue 派生，不入库；心情按真实时间衰减，服务端读取前已重算
//   · 投喂：消耗 PET_FEED_COST 颗星星（需家长令牌）；抚摸：免费，免令牌（孩子也能玩）
//   · 互动统计（连续天数 / 累计投喂·抚摸 / 本周）由服务端现算，页面只渲染
const { callApi } = require('../../utils/api');
const P = require('../../utils/pets');
const { setTabBarHidden, attachTabBarSync } = require('../../utils/tabbar');

// 阶段 → 宠物动画类（蛋蛋用 egg+s1，其余按阶段）
function petClsOf(pet) {
  if (!pet) return 'egg s1';
  return pet.stage === 1 ? 'egg s1' : 's' + pet.stage;
}

Page({
  data: {
    mode: 'display',
    useCloud: false,
    totalStars: 0,
    pet: null,
    petCls: 'egg s1',
    canFeed: false,
    // 玻璃瓶液面（成长=阶段内进度 / 心情=mood）
    growthPct: 0,
    moodPct: 0,
    growthTxt: '0/' + (P.STAGES[1].min - P.STAGES[0].min),
    moodTxt: '0',
    feedCost: P.PET_FEED_COST,
    nameMax: P.PET_NAME_MAX,
    species: P.SPECIES,
    // 互动统计
    streakDays: 0,
    feedTotal: 0,
    strokeTotal: 0,
    growthValue: 0,
    weekFeed: 0,
    weekStroke: 0,
    weekFeedPct: 0,
    weekStrokePct: 0,
    // 弹层（新增弹层开关须登记 utils/tabbar.js 的 SHEET_KEYS）
    showAdopt: false,
    adoptSpecies: 'cat',
    adoptName: '小猫',
    showRename: false,
    renameName: '',
    showStats: false,
    showManage: false,
    confetti: []
  },

  // 任意点击重置家长模式空闲计时（R10）
  onAppTouch() { getApp().touch(); },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    attachTabBarSync(this);
    this.refresh();
  },

  async refresh() {
    const app = getApp();
    try { await app.whenReady(); } catch (e) { return; }
    this.setData({ mode: app.globalData.mode, useCloud: app.globalData.useCloud });
    await this.load();
  },

  async load() {
    const app = getApp();
    try {
      const dash = await callApi('getDashboard', { childId: app.globalData.childId });
      const r = await callApi('petCRUD', { op: 'info', childId: app.globalData.childId });
      this.apply(dash.totalStars || 0, r.pet || null);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    }
  },

  // 把「星星余额 + 宠物视图」落到 data（统计条数/占比一并算好，模板不做运算）
  apply(totalStars, pet) {
    const stats = (pet && pet.stats) || {};
    const week = stats.week || { feed: 0, stroke: 0 };
    const max = Math.max(week.feed, week.stroke, 1);
    this.setData({
      totalStars,
      pet,
      petCls: petClsOf(pet),
      canFeed: totalStars >= P.PET_FEED_COST,
      // 玻璃瓶：成长瓶=「到下一阶段」的阶段内进度；心情瓶=mood/100（模板不运算，防 null 时 height:% 非法）
      growthPct: Math.round(pet ? pet.stagePct : 0),
      moodPct: Math.round(pet ? pet.mood : 0),
      growthTxt: pet
        ? (pet.stageNeed ? pet.stageHave + '/' + pet.stageNeed : 'MAX')
        : '0/' + (P.STAGES[1].min - P.STAGES[0].min),
      moodTxt: pet ? String(pet.mood) : '0',
      streakDays: stats.streakDays || 0,
      feedTotal: stats.feedTotal || 0,
      strokeTotal: stats.strokeTotal || 0,
      growthValue: stats.growthValue || 0,
      weekFeed: week.feed,
      weekStroke: week.stroke,
      weekFeedPct: Math.round(week.feed / max * 100),
      weekStrokePct: Math.round(week.stroke / max * 100)
    });
  },

  // ============ 互动 ============

  async feed() {
    const app = getApp();
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '投喂需家长模式', icon: 'none' });
      return;
    }
    if (this.data.totalStars < P.PET_FEED_COST) {
      wx.showToast({ title: '星星不够啦', icon: 'none' });
      return;
    }
    const beforeStage = this.data.pet ? this.data.pet.stage : 0;
    try {
      const res = await callApi('petCRUD', {
        op: 'feed', childId: app.globalData.childId, parentToken: app.globalData.parentToken
      });
      this.apply(res.totalStars, res.pet);
      this.burst();
      const hatched = beforeStage === 1 && res.pet.stage === 2;
      wx.showToast({
        title: hatched ? '破壳啦！' + res.pet.name + ' 出生 🐣' : '投喂成功 +' + P.PET_GROWTH_PER_FEED + ' 成长 🍼',
        icon: 'none'
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '投喂失败', icon: 'none' });
    }
  },

  // 抚摸免费：免家长令牌，不扣星星
  async stroke() {
    const app = getApp();
    try {
      const res = await callApi('petCRUD', { op: 'stroke', childId: app.globalData.childId });
      this.apply(this.data.totalStars, res.pet);
      wx.showToast({ title: '宠物好开心～ ✨', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '抚摸失败', icon: 'none' });
    }
  },

  petTap() {
    if (this.data.pet && this.data.pet.stage === 5) {
      this.burst();
      wx.showToast({ title: '传奇伙伴向你眨眼 ✨', icon: 'none' });
    }
  },

  // ============ 领养 / 改名 ============

  // 顶部信息条右侧 ✏️：没有宠物 → 领养；已有 → 改名
  onPetEdit() {
    if (!this.data.pet) { this.openAdopt(); return; }
    this.openRename();
  },

  openAdopt() {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '领养需家长模式', icon: 'none' });
      return;
    }
    const sp = P.speciesOf('cat');
    this.setData({ showAdopt: true, adoptSpecies: 'cat', adoptName: sp ? sp.defName : '小猫' });
    setTabBarHidden(this, true);
  },
  closeAdopt() { this.setData({ showAdopt: false }); },
  pickSpecies(e) {
    const key = e.currentTarget.dataset.key;
    const sp = P.speciesOf(key);
    this.setData({ adoptSpecies: key, adoptName: sp ? sp.defName : this.data.adoptName });
  },
  onAdoptName(e) { this.setData({ adoptName: e.detail.value }); },

  async doAdopt() {
    const app = getApp();
    const sp = P.speciesOf(this.data.adoptSpecies) || P.SPECIES[0];
    const name = String(this.data.adoptName || '').trim() || sp.defName;
    if (name.length > P.PET_NAME_MAX) {
      wx.showToast({ title: '名字最多 ' + P.PET_NAME_MAX + ' 个字', icon: 'none' });
      return;
    }
    try {
      const res = await callApi('petCRUD', {
        op: 'adopt', childId: app.globalData.childId, parentToken: app.globalData.parentToken,
        payload: { species: sp.key, name }
      });
      this.setData({ showAdopt: false });
      this.apply(this.data.totalStars, res.pet);
      this.burst();
      wx.showToast({ title: '欢迎 ' + res.pet.name + '！🎉', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '领养失败', icon: 'none' });
    }
  },

  openRename() {
    this.setData({ showRename: true, renameName: this.data.pet ? this.data.pet.name : '' });
    setTabBarHidden(this, true);
  },
  closeRename() { this.setData({ showRename: false }); },
  onRenameInput(e) { this.setData({ renameName: e.detail.value }); },

  async doRename() {
    const app = getApp();
    const v = String(this.data.renameName || '').trim();
    if (!v) { wx.showToast({ title: '名字不能为空', icon: 'none' }); return; }
    if (v.length > P.PET_NAME_MAX) {
      wx.showToast({ title: '名字最多 ' + P.PET_NAME_MAX + ' 个字', icon: 'none' });
      return;
    }
    try {
      const res = await callApi('petCRUD', {
        op: 'rename', childId: app.globalData.childId, parentToken: app.globalData.parentToken,
        payload: { name: v }
      });
      this.setData({ showRename: false });
      this.apply(this.data.totalStars, res.pet);
      wx.showToast({ title: '改名成功 ✏️', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '改名失败', icon: 'none' });
    }
  },

  // ============ 管理：重置 / 放生 ============

  openManage() {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '需家长模式', icon: 'none' });
      return;
    }
    this.setData({ showManage: true });
    setTabBarHidden(this, true);
  },
  closeManage() { this.setData({ showManage: false }); },

  doReset() {
    const name = this.data.pet ? this.data.pet.name : '宠物';
    wx.showModal({
      title: '重置成长？',
      content: name + ' 会回到蛋蛋，累计投喂/抚摸与成长值清零（名字保留）。',
      confirmText: '重置',
      success: (r) => { if (r.confirm) this.execReset(); }
    });
  },
  async execReset() {
    const app = getApp();
    try {
      const res = await callApi('petCRUD', {
        op: 'reset', childId: app.globalData.childId, parentToken: app.globalData.parentToken
      });
      this.setData({ showManage: false });
      this.apply(this.data.totalStars, res.pet);
      wx.showToast({ title: '已重置 ✅', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '重置失败', icon: 'none' });
    }
  },

  doRelease() {
    const name = this.data.pet ? this.data.pet.name : '宠物';
    wx.showModal({
      title: '放生 ' + name + '？',
      content: '会送走 ' + name + '，成长清零（可重新领养一只新的）。',
      confirmText: '放生',
      confirmColor: '#e8762f',
      success: (r) => { if (r.confirm) this.execRelease(); }
    });
  },
  async execRelease() {
    const app = getApp();
    try {
      await callApi('petCRUD', {
        op: 'release', childId: app.globalData.childId, parentToken: app.globalData.parentToken
      });
      this.setData({ showManage: false });
      this.apply(this.data.totalStars, null);
      wx.showToast({ title: '已放生 💔', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '放生失败', icon: 'none' });
    }
  },

  // ============ 互动统计报表 ============

  openStats() { this.setData({ showStats: true }); setTabBarHidden(this, true); },
  closeStats() { this.setData({ showStats: false }); },

  // 供弹层内部 catchtap 使用：吞掉冒泡，避免点弹层内容时误触发蒙层的「点击关闭」
  noop() {},

  // —— 撒花动效 ——
  burst() {
    const colors = ['#FFC93C', '#FF9AA2', '#7Fd3ff', '#C8F5DD', '#DDD0FF'];
    const pieces = [];
    for (let i = 0; i < 26; i++) {
      pieces.push({
        id: i, left: Math.round(Math.random() * 100),
        color: colors[i % colors.length], delay: (Math.random() * 0.3).toFixed(2)
      });
    }
    this.setData({ confetti: pieces });
    setTimeout(() => this.setData({ confetti: [] }), 1600);
  }
});
