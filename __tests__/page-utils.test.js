// __tests__/page-utils.test.js —— D4 页面纯函数下沉后的单测（零依赖）
// 覆盖：日历格生成 / 月份增减 / 气泡配色 / 礼花粒子 / 宠物页 data 映射。
// 这些原本内联在 home.js、pet.js，抽取后在此做行为级回归，避免「页面行数降了、行为悄悄变了」。
const test = require('node:test');
const assert = require('node:assert');
const cal = require('../miniprogram/utils/calendar');
const bubble = require('../miniprogram/utils/bubble');
const CF = require('../miniprogram/utils/confetti');
const pp = require('../miniprogram/utils/pet-page');
const P = require('../miniprogram/utils/pets');

// 固定序列随机数（循环取值），让随机生成函数可断言
function seq(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

test('calendar.shiftYm：正常增减 / 跨年进位退位', () => {
  assert.strictEqual(cal.shiftYm('2026-10', 1), '2026-11');
  assert.strictEqual(cal.shiftYm('2026-10', -3), '2026-07');
  assert.strictEqual(cal.shiftYm('2026-12', 1), '2027-01', '12 月 +1 应进位到次年 1 月');
  assert.strictEqual(cal.shiftYm('2026-01', -1), '2025-12', '1 月 -1 应退位到上年 12 月');
  assert.strictEqual(cal.shiftYm('2026-03', 0), '2026-03', 'delta=0 应保持');
});

test('calendar.buildCalendar：前置空白 + 每日格 + lit/today/done', () => {
  // 2026-10-01 是周四（getDay=4）；当月唯一任务自 2026-01-01 起每天可见
  const tasks = [{ _id: 't1', title: 'A', date: '2026-01-01', repeat: { enabled: false } }];
  const checkIns = [{ taskId: 't1', date: '2026-10-05' }];
  const r = cal.buildCalendar(tasks, checkIns, '2026-10', '2026-10-05');
  assert.strictEqual(r.label, '2026年10月');
  assert.strictEqual(r.cells.findIndex((c) => c.day === 1), 4, '前置空白数应等于当月 1 号的星期序号');
  assert.ok(r.cells.slice(0, 4).every((c) => c.blank), '前 4 格应为空白占位');
  assert.strictEqual(r.cells.filter((c) => !c.blank).length, 31, '10 月应有 31 个日期格');
  const day5 = r.cells.find((c) => c.date === '2026-10-05');
  assert.strictEqual(day5.lit, true, '10-05 有打卡记录 → lit');
  assert.strictEqual(day5.today, true, '10-05 === today → today');
  assert.strictEqual(day5.done, true, '当日唯一可见任务已打卡 → done');
  const day6 = r.cells.find((c) => c.date === '2026-10-06');
  assert.strictEqual(day6.lit, false);
  assert.strictEqual(day6.today, false);
  assert.strictEqual(day6.done, false, '未打卡 → done 为假');
});

test('bubble.bubbleStyleFor：已知品种取专属主题 / 未知回退默认黄', () => {
  const s1 = bubble.bubbleStyleFor('cat_lihua');
  assert.ok(s1.indexOf('--bub-a:#FFD9A0') >= 0, '狸花猫应取专属主题');
  assert.ok(/^--bub-a:#[0-9A-Fa-f]{6};--bub-b:#[0-9A-Fa-f]{6};--bub-ink:#[0-9A-Fa-f]{6};--bub-shadow:rgba\(/.test(s1),
    '气泡样式串格式应稳定（4 个 CSS 变量）');
  assert.ok(bubble.bubbleStyleFor('unknown_xyz').indexOf('--bub-a:#FFD9A0') >= 0, '未知 key 兜底猫默认品种（狸花）');
  assert.ok(bubble.bubbleStyleFor('dog_zzz').indexOf('--bub-a:#D6F0AE') >= 0, '未知 dog 前缀兜底田园犬黄');
  assert.ok(bubble.bubbleStyleFor('').indexOf('--bub-a:#FFE873') >= 0, '空品种回退默认黄');
  assert.ok(bubble.bubbleStyleFor(null).indexOf('--bub-a:#FFE873') >= 0, 'null 回退默认黄');
  assert.strictEqual(bubble.BUBBLE_DEFAULT.a, '#FFE873');
});

test('confetti.cannonPieces：6 炮 × 每炮 16–20 片，字段齐备', () => {
  const pieces = CF.cannonPieces(seq([0.5]));
  assert.strictEqual(CF.CANNON_X.length, 6, '应为 6 个礼花筒发射点');
  assert.strictEqual(pieces.length, 6 * 18, 'rand=0.5 → 每炮 16+floor(2.5)=18 片');
  const p = pieces[0];
  ['id', 'x', 'color', 'shape', 'tx', 'ty', 'rot', 'delay'].forEach((k) => assert.ok(k in p, '缺字段 ' + k));
  assert.ok(CF.CANNON_X.indexOf(p.x) >= 0, 'x 应为发射点之一');
  assert.ok(pieces.every((q, i) => q.id === i), 'id 应连续递增');
});

test('confetti.risePieces：26 片、left 落在 0–100', () => {
  const pieces = CF.risePieces(seq([0.5, 0.25]));
  assert.strictEqual(pieces.length, 26);
  pieces.forEach((p) => assert.ok(p.left >= 0 && p.left <= 100, 'left 越界: ' + p.left));
  assert.deepStrictEqual(pieces.map((p) => p.id).slice(0, 3), [0, 1, 2]);
});

test('confetti.fxParticles：数量 / kind / 错峰 delay', () => {
  const arr = CF.fxParticles('heart', 3, 3, seq([0.5]));
  assert.strictEqual(arr.length, 3, '粒子应为 3 个（性能口径 ≤3）');
  assert.deepStrictEqual(arr.map((p) => p.id), ['3-0', '3-1', '3-2']);
  assert.deepStrictEqual(arr.map((p) => p.kind), ['heart', 'heart', 'heart']);
  assert.deepStrictEqual(arr.map((p) => p.delay), ['0.00', '0.15', '0.30'], 'delay 应逐片错峰 0.15s');
});

const PET_PAGE_KEYS = [
  'totalStars', 'pet', 'petCls', 'petImg', 'petSrc', 'petSrcHappy', 'petSrcEat', 'breedName',
  'canFeed', 'feedLimited', 'todayFeedCount', 'growthPct', 'moodPct', 'growthTxt', 'moodTxt',
  'streakDays', 'feedTotal', 'strokeTotal', 'growthValue',
  'weekFeed', 'weekStroke', 'weekFeedPct', 'weekStrokePct'
].sort();

test('pet-page.pagePetData：无宠物 → 默认视图（s1 / 不可投喂 / 空图）', () => {
  const d = pp.pagePetData(0, null);
  assert.deepStrictEqual(Object.keys(d).sort(), PET_PAGE_KEYS, '视图字段集漂移');
  assert.strictEqual(d.petCls, 's1');
  assert.strictEqual(d.canFeed, false);
  assert.strictEqual(d.todayFeedCount, 0);
  assert.strictEqual(d.petImg, '');
  assert.strictEqual(d.breedName, '');
  assert.strictEqual(d.growthTxt, '0/' + (P.STAGES[1].min - P.STAGES[0].min));
  assert.strictEqual(d.moodTxt, '0');
});

test('pet-page.pagePetData：有宠物 → 品种图 / 进度 / 周统计百分比', () => {
  const pet = {
    stage: 2, species: 'cat_lihua', breedName: '狸花猫', mood: 66, stagePct: 42,
    stageHave: 100, stageNeed: 200, feedLimited: true, todayFeedCount: 2,
    stats: { streakDays: 5, feedTotal: 9, strokeTotal: 4, growthValue: 320, week: { feed: 4, stroke: 2 } }
  };
  const d = pp.pagePetData(30, pet);
  assert.strictEqual(d.petCls, 's2');
  assert.strictEqual(d.canFeed, true, '30 ≥ PET_FEED_COST → 可投喂');
  assert.strictEqual(d.petImg, '/images/pets/cat_lihua_adult.png', '成年应取 imgAdult');
  assert.strictEqual(d.petSrc, '/images/pets/cat_lihua_adult.png');
  assert.strictEqual(d.petSrcHappy, '/images/pets/cat_lihua_adult_happy.png');
  assert.strictEqual(d.petSrcEat, '/images/pets/cat_lihua_adult_eat.png');
  assert.strictEqual(d.growthPct, 42);
  assert.strictEqual(d.growthTxt, '100/200');
  assert.strictEqual(d.moodTxt, '66');
  assert.strictEqual(d.feedLimited, true);
  assert.strictEqual(d.todayFeedCount, 2);
  assert.strictEqual(d.weekFeed, 4);
  assert.strictEqual(d.weekStroke, 2);
  assert.strictEqual(d.weekFeedPct, 100, 'feed 为本周较大值 → 100%');
  assert.strictEqual(d.weekStrokePct, 50);
});

test('pet-page.petClsOf：stage 派生 s{stage}，无宠物回退 s1', () => {
  assert.strictEqual(pp.petClsOf(null), 's1');
  assert.strictEqual(pp.petClsOf({ stage: 1 }), 's1');
  assert.strictEqual(pp.petClsOf({ stage: 2 }), 's2');
});
