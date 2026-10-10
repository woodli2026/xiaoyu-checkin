// cloudfunctions/lib/pets.js —— 宠物模块纯逻辑（云端版）
// 与 miniprogram/utils/pets.js 是两份实现（云函数无法跨目录 require），
// 由 __tests__/pet.test.js 的「双份实现一致」用例守卫，任一侧漂移都会让 npm test 变红。
// 覆盖：物种 / 五阶段 / 命名校验 / 心情衰减 / 互动连续天数 / 互动统计

const U = require('./util');
const S = require('./streak');
const D = Object.assign({}, U, S);   // 前端对应 require('../utils/domain')

// 品种即花色（2026-09 升级）：领养时选物种（cat/dog），品种在物种内随机 5 选 1 入库。
// SPECIES 为 10 个品种 key（5 猫 / 5 狗）；emoji 保留作兜底渲染与老弹层文案。
// imgBaby/imgAdult 为两档形态图路径（云函数用不到，仅为与前端 utils/pets.js 逐字段一致，防漂移守卫比对）。
const SPECIES = [
  { key: 'cat_lihua',    species: 'cat', name: '狸花猫',   emoji: '🐱', imgBaby: '/images/pets/cat_lihua_baby.png',   imgAdult: '/images/pets/cat_lihua_adult.png' },
  { key: 'cat_orange',   species: 'cat', name: '橘猫',     emoji: '🐱', imgBaby: '/images/pets/cat_orange_baby.png',  imgAdult: '/images/pets/cat_orange_adult.png' },
  { key: 'cat_british',  species: 'cat', name: '英短蓝猫', emoji: '🐱', imgBaby: '/images/pets/cat_british_baby.png', imgAdult: '/images/pets/cat_british_adult.png' },
  { key: 'cat_american', species: 'cat', name: '美短银虎斑', emoji: '🐱', imgBaby: '/images/pets/cat_american_baby.png', imgAdult: '/images/pets/cat_american_adult.png' },
  { key: 'cat_ragdoll',  species: 'cat', name: '布偶猫',   emoji: '🐱', imgBaby: '/images/pets/cat_ragdoll_baby.png', imgAdult: '/images/pets/cat_ragdoll_adult.png' },
  { key: 'dog_yellow',   species: 'dog', name: '田园犬黄', emoji: '🐶', imgBaby: '/images/pets/dog_yellow_baby.png',  imgAdult: '/images/pets/dog_yellow_adult.png' },
  { key: 'dog_labrador', species: 'dog', name: '拉布拉多', emoji: '🐶', imgBaby: '/images/pets/dog_labrador_baby.png', imgAdult: '/images/pets/dog_labrador_adult.png' },
  { key: 'dog_shepherd', species: 'dog', name: '牧羊犬',   emoji: '🐶', imgBaby: '/images/pets/dog_shepherd_baby.png', imgAdult: '/images/pets/dog_shepherd_adult.png' },
  { key: 'dog_poodle',   species: 'dog', name: '贵宾犬',   emoji: '🐶', imgBaby: '/images/pets/dog_poodle_baby.png',  imgAdult: '/images/pets/dog_poodle_adult.png' },
  { key: 'dog_beagle',   species: 'dog', name: '比格犬',   emoji: '🐶', imgBaby: '/images/pets/dog_beagle_baby.png',  imgAdult: '/images/pets/dog_beagle_adult.png' }
];

// 物种二选一弹层仍用组口径（cat/dog）：组默认名沿用旧文案（小猫/小狗）
const SPECIES_GROUPS = [
  { key: 'cat', emoji: '🐱', defName: '小猫' },
  { key: 'dog', emoji: '🐶', defName: '小狗' }
];

// 老 key 兼容默认品种（读取时映射，不改写历史数据）：cat→狸花猫、dog→田园犬黄
const DEFAULT_BREED_KEY = { cat: 'cat_lihua', dog: 'dog_yellow' };

const PET_FEED_COST = 1;            // 投喂消耗星星（2026-10-08 由 5 改为 1：降低孩子养宠门槛）
const PET_GROWTH_PER_FEED = 10;     // 每次投喂 +10 成长值
const GROWTH_MAX = 300;            // 成年阈值 = 成长「血条」总框（当前经验进度作为当前血量）
const MOOD_INIT = 60;               // 领养初始心情（2026-09 调整：80 → 60）
const MOOD_PER_FEED = 8;            // 投喂 +8 心情
const MOOD_PER_STROKE = 6;          // 抚摸 +6 心情（免费互动）
const MOOD_MAX = 100;
const MOOD_DECAY_PER_HOUR = 1;      // 久不互动：每小时 -1（不足 1 小时不扣；2026-09 调整：原每 20 分钟 -1 放慢）
const PET_FEED_DAILY_LIMIT = 3;     // 每日有效投喂上限（3 次 = 30 成长值/天），达限返回 FEED_LIMIT
const PET_NAME_MAX = 8;
const DAILY_KEEP_DAYS = 60;         // daily 按日统计保留天数（防无限增长）

// 阶段制两档（2026-09 拍板）：幼崽（0-299）→ 成年（300 起，投喂 +10/次）。
// 原「破壳/成长体/成年体/传奇伙伴」中间阶段与全部配饰废弃。
const STAGES = [
  { stage: 1, name: '幼崽', min: 0, max: 299 },
  { stage: 2, name: '成年', min: 300, max: Infinity }
];

function speciesOf(key) {
  return SPECIES.find(s => s.key === key) || null;
}

function isValidSpecies(key) {
  return !!speciesOf(key);
}

function groupOf(key) {
  return SPECIES_GROUPS.find(g => g.key === key) || null;
}

function isValidSpeciesGroup(key) {
  return !!groupOf(key);
}

// 老 key 兼容（读取时映射，不改写历史数据）：
//   品种 key → 原样；'cat'/'dog' → 物种默认品种；未知 key → 按前缀猜物种后兜底
//   （无法识别前缀时兜底猫默认品种，保证渲染永不落空）
function resolveSpeciesKey(key) {
  const k = String(key == null ? '' : key).trim();
  if (speciesOf(k)) return k;
  if (k.indexOf('dog') === 0) return DEFAULT_BREED_KEY.dog;
  return DEFAULT_BREED_KEY.cat;
}

// 领养随机：物种组（'cat'|'dog'）内 5 选 1，返回品种 key。
// rng 可注入（单测确定性）；默认 Math.random。
function randomBreedKey(species, rng) {
  const pool = SPECIES.filter(s => s.species === species);
  if (!pool.length) return DEFAULT_BREED_KEY.cat;
  const r = typeof rng === 'function' ? rng : Math.random;
  return pool[Math.floor(r() * pool.length) % pool.length].key;
}

// stage 由 growthValue 派生，不入库（防漂移）
// 阶段内进度 stagePct：成长瓶按「到下一阶段还差多少」填充，每投喂一次液面上升
// 1/(阶段所需成长值/10)，反馈可见。两档制下只有幼崽段有下一阶段：
// 成年段 stageNeed=null（页面显示 MAX）、stagePct 恒 100（瓶满）、stageHave 继续累计（g-300，仅数据口径）。
function stageInfo(growthValue, speciesKey) {
  const g = Number(growthValue) || 0;
  // 经 resolveSpeciesKey 兼容老数据（species='cat'/'dog'）与未知 key
  const sp = speciesOf(resolveSpeciesKey(speciesKey)) || SPECIES[0];
  const st = STAGES.find(x => g >= x.min && g <= x.max) || STAGES[STAGES.length - 1];
  const next = st.stage < STAGES.length ? STAGES[st.stage] : null;
  const stageHave = g - st.min;                       // 本阶段内已获得的成长值
  const stageNeed = next ? next.min - st.min : null;  // 升到下一阶段共需的成长值（满级为 null）
  const stagePct = next ? Math.min(100, Math.max(0, stageHave / stageNeed * 100)) : 100;
  return {
    stage: st.stage,
    name: st.name,
    // 两档制本体均为品种图，emoji 字段仅作数据兼容保留（物种 emoji，不再有蛋形态）
    emoji: sp.emoji,
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
  const sp = speciesOf(resolveSpeciesKey(speciesKey));
  return sp ? sp.name : '小伙伴';
}

function clampMood(v) {
  return Math.max(0, Math.min(MOOD_MAX, Math.round(v)));
}

// 按真实时间衰减：久不互动缓慢下降；无 lastMoodAt 时不衰减。
// 每小时 -1，不足 1 小时不扣（floor）；时钟回拨（now < lastMoodAt）时 Math.max(0, ...) 保证不因负时长反而加心情。
function applyMoodDecay(mood, lastMoodAt, now) {
  const m = (mood == null) ? MOOD_INIT : Number(mood);
  if (!lastMoodAt) return clampMood(m);
  const hours = Math.max(0, Math.floor((Number(now) - Number(lastMoodAt)) / 3600000));
  return clampMood(Math.max(0, m - hours * MOOD_DECAY_PER_HOUR));
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

// 今日有效投喂次数（复用 daily 口径）——本地兜底层与云函数共用的唯一来源
function feedCountToday(pet, today) {
  return (((pet || {}).daily || {})[today] || {}).feed || 0;
}

// 今日是否还能投喂（未达每日上限）——消除「本地/云端各自内联 >= 比较」的漂移盲区
// （与 D13「聚合双份手写」同类的收敛：判定下沉 pets.js 单源，两处调用点只调本函数）
function canFeed(pet, today) {
  return feedCountToday(pet, today) < PET_FEED_DAILY_LIMIT;
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
  SPECIES, SPECIES_GROUPS, DEFAULT_BREED_KEY, STAGES,
  PET_FEED_COST, PET_GROWTH_PER_FEED, GROWTH_MAX,
  MOOD_INIT, MOOD_PER_FEED, MOOD_PER_STROKE, MOOD_MAX, MOOD_DECAY_PER_HOUR,
  PET_FEED_DAILY_LIMIT,
  PET_NAME_MAX, DAILY_KEEP_DAYS,
  speciesOf, isValidSpecies, groupOf, isValidSpeciesGroup,
  resolveSpeciesKey, randomBreedKey, stageInfo,
  isValidPetName, normalizePetName,
  clampMood, applyMoodDecay, moodAfterFeed, moodAfterStroke,
  interactionStreak, bumpDaily, pruneDaily, feedCountToday, canFeed, weekTotals, computePetStats
};
