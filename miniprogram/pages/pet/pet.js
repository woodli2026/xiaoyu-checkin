const { callApi } = require('../../utils/api');
const P = require('../../utils/pets');
const { attachTabBarSync } = require('../../utils/tabbar');
const session = require('../../utils/parent-session');
function petClsOf(pet) {
  return 's' + (pet ? pet.stage : 1);
}
const ANIM_MS = { stroke: 1600, feed: 1800 };
Page({
  behaviors: [require('../../behaviors/pin-reauth')],
  data: {
    mode: 'display',
    useCloud: false,
    totalStars: 0,
    pet: null,
    petCls: 's1',
    canFeed: false,
    feedLimited: false,
    todayFeedCount: 0,
    feedDailyLimit: P.PET_FEED_DAILY_LIMIT,
    growthPct: 0,
    moodPct: 0,
    growthTxt: '0/' + (P.STAGES[1].min - P.STAGES[0].min),
    moodTxt: '0',
    feedCost: P.PET_FEED_COST,
    nameMax: P.PET_NAME_MAX,
    adoptOptions: P.SPECIES_GROUPS,   // 领养选择卡仍为物种二选一（cat/dog），品种领养时随机
    petImg: '',
    breedName: '',
    animType: '',
    animPhase: '',
    animN: 0,
    animFx: [],
    floatText: '',
    petSrc: '',
    petSrcHappy: '',
    petSrcEat: '',
    streakDays: 0,
    feedTotal: 0,
    strokeTotal: 0,
    growthValue: 0,
    weekFeed: 0,
    weekStroke: 0,
    weekFeedPct: 0,
    weekStrokePct: 0,
    showName: false,
    adoptSpecies: 'cat',
    adoptSpeciesEmoji: '🐱',
    adoptName: '小猫',
    showRename: false,
    renameName: '',
    showStats: false,
    showManage: false,
    confetti: []
  },
  onAppTouch() { getApp().touch(); },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    attachTabBarSync(this);
    this.refresh();
  },
  onHide() {
    clearTimeout(this._animTimer);
    this._animType = '';
    if (this.data.animType) {
      this.setData({ animType: '', animPhase: '', animFx: [], petSrc: this.data.petImg, floatText: '' });
    }
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
  apply(totalStars, pet) {
    const stats = (pet && pet.stats) || {};
    const week = stats.week || { feed: 0, stroke: 0 };
    const max = Math.max(week.feed, week.stroke, 1);
      const breedKey = pet ? P.resolveSpeciesKey(pet.species) : '';
      const breed = breedKey ? P.speciesOf(breedKey) : null;
      const form = pet && pet.stage >= 2 ? 'adult' : 'baby';
      const baseSrc = breed ? '/images/pets/' + breedKey + '_' + form : '';
      this.setData({
        totalStars,
        pet,
        petCls: petClsOf(pet),
        petImg: breed ? (pet.stage >= 2 ? breed.imgAdult : breed.imgBaby) : '',
        petSrc: breed ? baseSrc + '.png' : '',
        petSrcHappy: breed ? baseSrc + '_happy.png' : '',
        petSrcEat: breed ? baseSrc + '_eat.png' : '',
        breedName: pet ? ((pet.breedName || (breed ? breed.name : ''))) : '',
        canFeed: totalStars >= P.PET_FEED_COST,
        feedLimited: !!(pet && pet.feedLimited),
        todayFeedCount: pet ? (Number(pet.todayFeedCount) || 0) : 0,
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
    if (this.data.feedLimited) {
      wx.showToast({ title: '今天吃饱啦，明天再喂吧', icon: 'none' });
      return;
    }
    const beforeStage = this.data.pet ? this.data.pet.stage : 0;
    try {
      const res = await callApi('petCRUD', {
        op: 'feed', childId: app.globalData.childId
      });
      this.apply(res.totalStars, res.pet);
      this.burst();
      this.triggerAnim('feed');
      if (beforeStage !== res.pet.stage) {
        wx.showToast({ title: '长大啦！' + res.pet.name + ' 成年了 🎉', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '投喂失败', icon: 'none' });
    }
  },
  async stroke() {
    const app = getApp();
    try {
      const res = await callApi('petCRUD', { op: 'stroke', childId: app.globalData.childId });
      this.apply(this.data.totalStars, res.pet);
      this.triggerAnim('stroke');
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '抚摸失败', icon: 'none' });
    }
  },
  petTap() {
    if (this.data.pet && this.data.pet.stage === 2) {
      this.burst();
      wx.showToast({ title: '成年伙伴向你眨眼 ✨', icon: 'none' });
    }
  },
  onPetEdit() {
    if (!this.data.pet) {
      wx.showToast({ title: '在下方选一只小伙伴领养吧 🐾', icon: 'none' });
      return;
    }
    this.openRename();
  },
  pickSpecies(e) {
    const g = P.groupOf(e.currentTarget.dataset.key);
    if (!g) return;
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '领养需家长模式', icon: 'none' });
      return;
    }
    this.setData({ showName: true, adoptSpecies: g.key, adoptSpeciesEmoji: g.emoji, adoptName: g.defName });
  },
  closeName() { this.setData({ showName: false }); },
  onAdoptName(e) { this.setData({ adoptName: e.detail.value }); },
  async doAdopt() {
    const app = getApp();
    const g = P.groupOf(this.data.adoptSpecies) || P.SPECIES_GROUPS[0];
    const name = P.normalizePetName(this.data.adoptName, g.key);
    if (name.length > P.PET_NAME_MAX) {
      wx.showToast({ title: '名字最多 ' + P.PET_NAME_MAX + ' 个字', icon: 'none' });
      return;
    }
    try {
      const res = await callApi('petCRUD', {
        op: 'adopt', childId: app.globalData.childId,
        payload: { species: g.key, name }
      });
      this.setData({ showName: false });
      this.apply(this.data.totalStars, res.pet);
      this.burst();
      wx.showToast({ title: '欢迎 ' + res.pet.name + '！🎉', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '领养失败', icon: 'none' });
    }
  },
  openRename() {
    this.setData({ showRename: true, renameName: this.data.pet ? this.data.pet.name : '' });
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
        op: 'rename', childId: app.globalData.childId,
        payload: { name: v }
      });
      this.setData({ showRename: false });
      this.apply(this.data.totalStars, res.pet);
      wx.showToast({ title: '改名成功 ✏️', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '改名失败', icon: 'none' });
    }
  },
  openManage() {
    if (this.data.mode !== 'parent') {
      wx.showToast({ title: '需家长模式', icon: 'none' });
      return;
    }
    this.setData({ showManage: true });
  },
  closeManage() { this.setData({ showManage: false }); },
  doReset() {
    const name = this.data.pet ? this.data.pet.name : '宠物';
    wx.showModal({
      title: '重置成长？',
      content: name + ' 会回到幼崽，累计投喂/抚摸与成长值清零（名字保留）。',
      confirmText: '重置',
      success: (r) => { if (r.confirm) this.execReset(); }
    });
  },
  async execReset() {
    const app = getApp();
    try {
      const res = await callApi('petCRUD', {
        op: 'reset', childId: app.globalData.childId
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
        op: 'release', childId: app.globalData.childId
      });
      this.setData({ showManage: false });
      this.apply(this.data.totalStars, null);
      wx.showToast({ title: '已放生 💔', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '放生失败', icon: 'none' });
    }
  },
  openStats() { this.setData({ showStats: true }); },
  closeStats() { this.setData({ showStats: false }); },
  noop() {},
  triggerAnim(type) {
    const now = Date.now();
    if (this._animType === type && now - (this._animAt || 0) < 500) return;
    clearTimeout(this._animTimer);
    this._animType = type;
    this._animAt = now;
    const n = this.data.animN + 1;
    const phase = n % 2 ? 'b' : 'a';
    const fx = type === 'stroke' ? this.makeFx('heart', n, 3)
      : type === 'feed' ? this.makeFx('star', n, 3) : [];
    const petSrc = type === 'stroke' ? this.data.petSrcHappy
      : type === 'feed' ? this.data.petSrcEat : this.data.petImg;
    const floatText = type === 'feed' ? '+' + P.PET_GROWTH_PER_FEED + ' 经验'
      : type === 'stroke' ? '+' + P.MOOD_PER_STROKE + ' 心情' : '';
    this.setData({ animType: type, animPhase: phase, animN: n, animFx: fx, petSrc, floatText });
    this._animTimer = setTimeout(() => {
      this._animType = '';
      this.setData({ animType: '', animPhase: '', petSrc: this.data.petImg, floatText: '' });
    }, ANIM_MS[type] || 1600);
  },
  makeFx(kind, attempt, count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        id: attempt + '-' + i,
        kind,
        left: 15 + Math.round(Math.random() * 70),
        top: Math.round(Math.random() * 30) - 25,
        delay: (i * 0.15).toFixed(2)
      });
    }
    return arr;
  },
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