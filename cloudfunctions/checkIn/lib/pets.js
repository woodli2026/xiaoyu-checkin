// cloudfunctions/lib/pets.js —— 宠物模块纯逻辑（云端版）
// 与 miniprogram/utils/pets.js 是两份实现（云函数无法跨目录 require），
// 由 __tests__/pet.test.js 的「双份实现一致」用例守卫，任一侧漂移都会让 npm test 变红。
// 覆盖：物种 / 五阶段 / 命名校验 / 心情衰减 / 互动连续天数 / 互动统计

const U = require('./util');
const S = require('./streak');
const D = Object.assign({}, U, S);   // 前端对应 require('../utils/domain')

// MVP 仅猫、狗两种；后续扩动物只在此追加条目（结构已可扩展）
const SPECIES = [
  { key: 'cat', emoji: '🐱', defName: '小猫' },
  { key: 'dog', emoji: '🐶', defName: '小狗' }
];

const PET_FEED_COST = 5;            // 投喂消耗星星
const PET_GROWTH_PER_FEED = 10;     // 每次投喂 +10 成长值
const GROWTH_MAX = 300;             // 传奇伙伴阈值 = 成长「血条」总框（当前经验进度作为当前血量）
const MOOD_INIT = 80;               // 领养初始心情
const MOOD_PER_FEED = 8;            // 投喂 +8 心情
const MOOD_PER_STROKE = 6;          // 抚摸 +6 心情（免费互动）
const MOOD_MAX = 100;
const MOOD_DECAY_PER_MIN = 0.05;    // 久不互动：约每 20 分钟 -1
const PET_NAME_MAX = 8;
const DAILY_KEEP_DAYS = 60;         // daily 按日统计保留天数（防无限增长）

const STAGES = [
  { stage: 1, name: '蛋蛋', min: 0, max: 29 },
  { stage: 2, name: '破壳幼崽', min: 30, max: 79 },
  { stage: 3, name: '成长体', min: 80, max: 159 },
  { stage: 4, name: '成年体', min: 160, max: 299 },
  { stage: 5, name: '传奇伙伴', min: 300, max: Infinity }
];

function speciesOf(key) {
  return SPECIES.find(s => s.key === key) || null;
}

function isValidSpecies(key) {
  return !!speciesOf(key);
}

// stage 由 growthValue 派生，不入库（防漂移）
// 2026-09-19 调整：新增「阶段内进度」stagePct —— 成长瓶按「到下一阶段还差多少」填充，
// 每投喂一次液面上升 1/(阶段所需投喂次数)，反馈可见；满级（传奇）恒为满瓶。
function stageInfo(growthValue, speciesKey) {
  const g = Number(growthValue) || 0;
  const sp = speciesOf(speciesKey) || SPECIES[0];
  const st = STAGES.find(x => g >= x.min && g <= x.max) || STAGES[STAGES.length - 1];
  const next = st.stage < 5 ? STAGES[st.stage] : null;
  const stageHave = g - st.min;                       // 本阶段内已获得的成长值
  const stageNeed = next ? next.min - st.min : null;  // 升到下一阶段共需的成长值（满级为 null）
  const stagePct = next ? Math.min(100, Math.max(0, stageHave / stageNeed * 100)) : 100;
  return {
    stage: st.stage,
    name: st.name,
    // 蛋蛋阶段显示蛋，其余显示物种 emoji
    emoji: st.stage === 1 ? '🥚' : sp.emoji,
    speciesEmoji: sp.emoji,
    growthValue: g,
    growthPct: Math.min(100, g / GROWTH_MAX * 100),
    nextStageAt: next ? next.min : null,
    stageHave, stageNeed, stagePct
  };
}

// 名称：≤8 字且非空（空串由 normalizePetName 兜底为物种默认名）
function isValidPetName(name) {
  const v = String(name == null ? '' : name).trim();
  return v.length > 0 && v.length <= PET_NAME_MAX;
}

function normalizePetName(name, speciesKey) {
  const v = String(name == null ? '' : name).trim();
  if (v) return v;
  const sp = speciesOf(speciesKey);
  return sp ? sp.defName : '小伙伴';
}

function clampMood(v) {
  return Math.max(0, Math.min(MOOD_MAX, Math.round(v)));
}

// 按真实时间衰减：久不互动缓慢下降；无 lastMoodAt 时不衰减
function applyMoodDecay(mood, lastMoodAt, now) {
  const m = (mood == null) ? MOOD_INIT : Number(mood);
  if (!lastMoodAt) return clampMood(m);
  const mins = (Number(now) - Number(lastMoodAt)) / 60000;
  return clampMood(Math.max(0, m - mins * MOOD_DECAY_PER_MIN));
}

function moodAfterFeed(mood, lastMoodAt, now) {
  return clampMood(applyMoodDecay(mood, lastMoodAt, now) + MOOD_PER_FEED);
}

function moodAfterStroke(mood, lastMoodAt, now) {
  return clampMood(applyMoodDecay(mood, lastMoodAt, now) + MOOD_PER_STROKE);
}

// 互动连续天数：与打卡 displayStreak 同口径
// （今天有互动→从今天往前数；今天还没互动→从昨天往前数，昨天的连续今天仍延续显示）
function interactionStreak(datesOrSet, today) {
  return D.displayStreak(datesOrSet, today);
}

function bumpDaily(daily, date, type) {
  const d = daily || {};
  const cur = d[date] || { feed: 0, stroke: 0 };
  const next = Object.assign({}, cur);
  next[type] = (next[type] || 0) + 1;
  d[date] = next;
  return d;
}

function pruneDaily(daily, today, keepDays) {
  const keep = Number(keepDays) || DAILY_KEEP_DAYS;
  const cut = D.addDays(today, -(keep - 1));
  const out = {};
  Object.keys(daily || {}).forEach(k => { if (k >= cut) out[k] = daily[k]; });
  return out;
}

// 近 7 天（含今天）汇总
function weekTotals(daily, today) {
  const from = D.addDays(today, -6);
  let feed = 0, stroke = 0;
  Object.keys(daily || {}).forEach(k => {
    if (k >= from && k <= today) {
      feed += ((daily[k] || {}).feed || 0);
      stroke += ((daily[k] || {}).stroke || 0);
    }
  });
  return { feed, stroke };
}

// 互动统计报表数据源（点击「N 天连续互动」胶囊展示）
function computePetStats(pet, today) {
  if (!pet) return null;
  const daily = pet.daily || {};
  return {
    streakDays: interactionStreak(Object.keys(daily), today),
    feedTotal: Number(pet.feedCount) || 0,
    strokeTotal: Number(pet.strokeCount) || 0,
    growthValue: Number(pet.growthValue) || 0,
    week: weekTotals(daily, today)
  };
}

module.exports = {
  SPECIES, STAGES,
  PET_FEED_COST, PET_GROWTH_PER_FEED, GROWTH_MAX,
  MOOD_INIT, MOOD_PER_FEED, MOOD_PER_STROKE, MOOD_MAX, MOOD_DECAY_PER_MIN,
  PET_NAME_MAX, DAILY_KEEP_DAYS,
  speciesOf, isValidSpecies, stageInfo,
  isValidPetName, normalizePetName,
  clampMood, applyMoodDecay, moodAfterFeed, moodAfterStroke,
  interactionStreak, bumpDaily, pruneDaily, weekTotals, computePetStats
};
