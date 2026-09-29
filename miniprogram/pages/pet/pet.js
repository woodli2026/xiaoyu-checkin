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

// 阶段 → 宠物类（s1~s5：同时驱动本体的常驻动画与外层 .pet-scale 的阶段尺寸；
// 本体全阶段均为品种全身图，蛋 emoji 分支已删除）
function petClsOf(pet) {
  return 's' + (pet ? pet.stage : 1);
}

// 互动动画时长（纯表现层）：结束后 setTimeout 清 class 兜底，不依赖 animationend
const ANIM_MS = { stroke: 1600, feed: 1800 };
// 注：吃食无独立食盆叠加图——_eat 差分图已把食盆画进图里（头低向两前爪间的食盆）

Page({
  data: {
    mode: 'display',
    useCloud: false,
    totalStars: 0,
    pet: null,
    petCls: 's1',
    canFeed: false,
    // 每日投喂上限（服务端 petView 透出口径）：todayFeedCount=今日已喂次数，feedLimited=已达上限
    feedLimited: false,
    todayFeedCount: 0,
    feedDailyLimit: P.PET_FEED_DAILY_LIMIT,
    // 玻璃瓶液面（成长=阶段内进度 / 心情=mood）
    growthPct: 0,
    moodPct: 0,
    growthTxt: '0/' + (P.STAGES[1].min - P.STAGES[0].min),
    moodTxt: '0',
    feedCost: P.PET_FEED_COST,
    nameMax: P.PET_NAME_MAX,
    adoptOptions: P.SPECIES_GROUPS,   // 领养选择卡仍为物种二选一（cat/dog），品种领养时随机
    petImg: '',
    breedName: '',
    // 互动动画（纯表现层）：animType='' | 'stroke'(抚摸) | 'feed'(吃食)；
    // animPhase='a'|'b'（attempt 交替，同元素 animation-name 变化即强制重播，无时序依赖）；
    // animFx=粒子数据（爱心/金星，≤3 个，id 每次全新保证 wx:key 列表项重建）；
    // petSrc=主区本体图（互动时切动作图 _happy/_eat，超时切回默认）；吃食无独立食盆图（已画进 _eat 图）
    animType: '',
    animPhase: '',
    animN: 0,
    animFx: [],
    floatText: '',
    petSrc: '',
    petSrcHappy: '',
    petSrcEat: '',
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
    // showName=领养起名弹层（主区点物种卡片 → 起名 → 确认即领养）
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

  // 任意点击重置家长模式空闲计时（R10）
  onAppTouch() { getApp().touch(); },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    attachTabBarSync(this);
    this.refresh();
  },

  // 离页即停动画计时（回来后类已清、本体已回默认图，不会残留半截动画）
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

  // 把「星星余额 + 宠物视图」落到 data（统计条数/占比一并算好，模板不做运算）
  apply(totalStars, pet) {
    const stats = (pet && pet.stats) || {};
    const week = stats.week || { feed: 0, stroke: 0 };
    const max = Math.max(week.feed, week.stroke, 1);
      // 品种视图预计算（模板不做运算）：
      //   petImg = 默认形态图（kidbar 头像用，不跟随动作）
      //   petSrc = 主区本体图（默认态）；petSrcHappy/petSrcEat = 抚摸/吃食动作图
      //   动作图按约定路径生成：<key>_<form>[_happy|_eat].png，与 SPECIES imgBaby/imgAdult 同前缀
      // pet.breedName 由服务端 petView 透出；此处兜底本地重算，兼容旧版服务端
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
    // 每日投喂上限：达限本地直接拦截（服务端 FEED_LIMIT 双保险，res.pet 回来后 apply 已即时置灰）
    if (this.data.feedLimited) {
      wx.showToast({ title: '今天吃饱啦，明天再喂吧', icon: 'none' });
      return;
    }
    const beforeStage = this.data.pet ? this.data.pet.stage : 0;
    try {
      const res = await callApi('petCRUD', {
        op: 'feed', childId: app.globalData.childId, parentToken: app.globalData.parentToken
      });
      this.apply(res.totalStars, res.pet);
      this.burst();
      this.triggerAnim('feed');
      // 仅升档（幼崽→成年）弹 toast；普通投喂的反馈由 HUD 浮动数值「+N 经验」承担
      if (beforeStage !== res.pet.stage) {
        wx.showToast({ title: '长大啦！' + res.pet.name + ' 成年了 🎉', icon: 'none' });
      }
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
      this.triggerAnim('stroke');
      // 反馈由 HUD 浮动数值「+N 心情」承担，不再弹 toast
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

  // ============ 领养 / 改名 ============

  // 顶部信息条右侧 ✏️：没有宠物 → 引导到主区领养选择卡；已有 → 改名
  onPetEdit() {
    if (!this.data.pet) {
      wx.showToast({ title: '在下方选一只小伙伴领养吧 🐾', icon: 'none' });
      return;
    }
    this.openRename();
  },

  // 未领养态页内选择卡：点物种卡片 → 起名弹层（预填该物种默认名）→ 确认即领养
  // （起名弹层本身即确认步骤，不再叠加 showModal 二次确认；保留「需家长模式」守卫）
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
    // 命名口径对齐 normalizePetName：trim、空回物种默认名；超长在此拦截（弹层保持打开）
    const name = P.normalizePetName(this.data.adoptName, g.key);
    if (name.length > P.PET_NAME_MAX) {
      wx.showToast({ title: '名字最多 ' + P.PET_NAME_MAX + ' 个字', icon: 'none' });
      return;
    }
    try {
      // 只传物种组（cat/dog）；品种由服务端在物种内随机 5 选 1 后入库
      const res = await callApi('petCRUD', {
        op: 'adopt', childId: app.globalData.childId, parentToken: app.globalData.parentToken,
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
      content: name + ' 会回到幼崽，累计投喂/抚摸与成长值清零（名字保留）。',
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

  // ============ 互动动画（纯表现层，业务接口不动）============

  // 触发抚摸/吃食动画（单次 setData，零时序依赖）。
  // 主视觉 = 动作差分图切换：stroke → <key>_<form>_happy.png（眯眼歪头笑）、
  // feed → <key>_<form>_eat.png（低头吃）—— setData 生效即 100% 可见，不依赖 CSS 动画；
  // 结束时 _animTimer 把 petSrc 切回默认图（petImg，与清 animType 同一次 setData）。
  // CSS 增强动画照旧（A/B 相位交替：animation-name 变化即强制重播 + 粒子全新 id 重建）：
  // 手摸头、爱心/星星上浮；若真机 CSS 动画仍不播，
  // 静态出现的手 + 表情图切换已是完整效果。
  // 粒子 animFx 的 id 每次全新（attempt 前缀），wx:key=id 使列表项整体重建，同样必重播。
  // HUD 浮动数值 floatText 与动画同一次 setData 写入：feed → +N 经验（成长瓶上方）、
  // stroke → +N 心情（心情瓶上方），清 animType 时一并清空。
  // 500ms 内快速重复同一动作直接忽略（防叠加错乱）；两种动画互斥（后触发覆盖前者）。
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
    // 结束兜底：setTimeout 恢复默认图 + 清 class/浮动数值，不依赖 animationend（低端机可能丢事件）
    this._animTimer = setTimeout(() => {
      this._animType = '';
      this.setData({ animType: '', animPhase: '', petSrc: this.data.petImg, floatText: '' });
    }, ANIM_MS[type] || 1600);
  },

  // 粒子数据（≤3 个）：宠物上方区域随机偏移 + 错峰上浮；id 带 attempt 防同 key 复用节点
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
