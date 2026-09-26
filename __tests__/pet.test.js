// __tests__/pet.test.js —— 宠物 + 积分模块（宠物 tab 第二阶段）
// 覆盖：① utils/pets.js 纯函数（五阶段 / 命名 / 心情衰减 / 互动连续 / 统计）
//       ② services/local.js 的 petCRUD（adopt/feed/stroke/rename/info/release/reset + 权限分支）
//       ③ 云地双份 pets 实现一致性守卫
const test = require('node:test');
const assert = require('node:assert');

// —— mock wx.storage ——
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

const P = require('../miniprogram/utils/pets');
const s = require('../miniprogram/utils/storage');
const D = require('../miniprogram/utils/domain');
const local = require('../miniprogram/services/local');

// ============================================================
// 一、纯函数层
// ============================================================

test('pets: 五阶段由成长值派生（stage 不入库，防漂移）', () => {
  const cases = [
    [0, 1, '蛋蛋', '🥚'], [29, 1, '蛋蛋', '🥚'],
    [30, 2, '破壳幼崽', '🐱'], [79, 2, '破壳幼崽', '🐱'],
    [80, 3, '成长体', '🐱'], [159, 3, '成长体', '🐱'],
    [160, 4, '成年体', '🐱'], [299, 4, '成年体', '🐱'],
    [300, 5, '传奇伙伴', '🐱'], [9999, 5, '传奇伙伴', '🐱']
  ];
  cases.forEach(([g, stage, name, emoji]) => {
    const i = P.stageInfo(g, 'cat');
    assert.strictEqual(i.stage, stage, `成长值 ${g} 应为阶段 ${stage}`);
    assert.strictEqual(i.name, name, `成长值 ${g} 阶段名应为 ${name}`);
    assert.strictEqual(i.emoji, emoji, `成长值 ${g} emoji 应为 ${emoji}`);
  });
  // 蛋蛋阶段无论物种都是蛋；破壳后按物种显示
  assert.strictEqual(P.stageInfo(0, 'dog').emoji, '🥚');
  assert.strictEqual(P.stageInfo(30, 'dog').emoji, '🐶');
  assert.strictEqual(P.stageInfo(30, 'cat').speciesEmoji, '🐱');
  // 下一阶阈值 / 血条百分比
  assert.strictEqual(P.stageInfo(0, 'cat').nextStageAt, 30);
  assert.strictEqual(P.stageInfo(30, 'cat').nextStageAt, 80);
  assert.strictEqual(P.stageInfo(300, 'cat').nextStageAt, null);   // 已到顶
  assert.strictEqual(P.stageInfo(150, 'cat').growthPct, 50);       // 血条框 = GROWTH_MAX(300)
  assert.strictEqual(P.stageInfo(999, 'cat').growthPct, 100);      // 封顶 100%
});

// 成长瓶口径：按「到下一阶段」的阶段内进度填充，保证每次投喂液面可见上升
// （若用 300 总经验做分母，每次投喂仅 +3.3%，几乎看不到反馈）
test('pets: 成长瓶按阶段内进度 stagePct 填充（每次投喂液面可见上升）', () => {
  // 蛋蛋 → 破壳 共需 30（每次投喂 +10 ⇒ 每次涨 1/3）
  assert.strictEqual(P.stageInfo(0, 'cat').stageNeed, 30);
  assert.strictEqual(P.stageInfo(0, 'cat').stageHave, 0);
  assert.strictEqual(P.stageInfo(0, 'cat').stagePct, 0);
  // 百分比取两位小数比对（避免浮点尾数差异）
  const pct = (g, sp) => Math.round(P.stageInfo(g, sp || 'cat').stagePct * 100) / 100;
  assert.strictEqual(pct(10), 33.33);
  assert.strictEqual(pct(20), 66.67);
  // 升阶瞬间：阶段内进度归零，瓶子重新从空开始（视觉上「瓶子见底→换新阶段」）
  assert.strictEqual(P.stageInfo(30, 'cat').stageHave, 0);
  assert.strictEqual(P.stageInfo(30, 'cat').stageNeed, 50);   // 破壳 → 成长体 需 50
  assert.strictEqual(P.stageInfo(30, 'cat').stagePct, 0);
  // 破壳 → 成长体：每投喂 +10 ⇒ 每次涨 1/5
  assert.strictEqual(P.stageInfo(40, 'cat').stagePct, 20);
  assert.strictEqual(P.stageInfo(79, 'cat').stagePct, 98);
  // 成年体 → 传奇：需 140（每投喂 +10 ⇒ 每次涨 1/14）
  assert.strictEqual(P.stageInfo(160, 'cat').stageNeed, 140);
  // 满级：恒为满瓶，stageNeed 为 null（不出现除零 / NaN）
  assert.strictEqual(P.stageInfo(300, 'cat').stageNeed, null);
  assert.strictEqual(P.stageInfo(300, 'cat').stagePct, 100);
  assert.strictEqual(P.stageInfo(9999, 'cat').stagePct, 100);
  // 越界不炸：负数 / 非法值钳到合法区间
  assert.ok(P.stageInfo(-5, 'cat').stagePct >= 0);
  assert.ok(Number.isFinite(P.stageInfo(null, 'cat').stagePct));
  assert.ok(Number.isFinite(P.stageInfo(undefined, 'nope').stagePct));
});

test('pets: 物种 MVP 仅猫狗，非法物种被拒（结构可扩展）', () => {
  assert.strictEqual(P.SPECIES.length, 2);
  assert.deepStrictEqual(P.SPECIES.map(x => x.key), ['cat', 'dog']);
  assert.strictEqual(P.isValidSpecies('cat'), true);
  assert.strictEqual(P.isValidSpecies('dog'), true);
  assert.strictEqual(P.isValidSpecies('dragon'), false);
  assert.strictEqual(P.isValidSpecies(''), false);
  assert.strictEqual(P.speciesOf('dog').defName, '小狗');
  assert.strictEqual(P.speciesOf('nope'), null);
});

test('pets: 命名校验 ≤8 字、非空；缺省回退物种默认名', () => {
  assert.strictEqual(P.PET_NAME_MAX, 8);
  assert.strictEqual(P.isValidPetName('小灰'), true);
  assert.strictEqual(P.isValidPetName(' 小灰 '), true);        // 首尾空格 trim
  assert.strictEqual(P.isValidPetName(''), false);
  assert.strictEqual(P.isValidPetName('   '), false);
  assert.strictEqual(P.isValidPetName('x'.repeat(9)), false);
  assert.strictEqual(P.isValidPetName('x'.repeat(8)), true);
  assert.strictEqual(P.normalizePetName(' 小灰 ', 'cat'), '小灰');
  assert.strictEqual(P.normalizePetName('', 'cat'), '小猫');
  assert.strictEqual(P.normalizePetName('', 'dog'), '小狗');
});

test('pets: 心情按真实时间衰减 + 上限 100 + 不为负', () => {
  assert.strictEqual(P.MOOD_INIT, 80);
  assert.strictEqual(P.MOOD_MAX, 100);
  const now = 1000000000000;
  // 无 lastMoodAt（刚领养 / 老数据）→ 不衰减
  assert.strictEqual(P.applyMoodDecay(80, null, now), 80);
  assert.strictEqual(P.applyMoodDecay(80, 0, now), 80);
  // 20 分钟 -1（0.05/分钟）
  assert.strictEqual(P.applyMoodDecay(80, now - 20 * 60000, now), 79);
  // 100 分钟 -5
  assert.strictEqual(P.applyMoodDecay(80, now - 100 * 60000, now), 75);
  // 久不互动也不为负（2000 分钟应 -100 → 夹到 0）
  assert.strictEqual(P.applyMoodDecay(80, now - 2000 * 60000, now), 0);
  // 未来时间戳（时钟回拨）不应把心情加成负数之外的怪值
  assert.strictEqual(P.applyMoodDecay(80, now + 60000, now), 80);

  // 互动加成：先衰减再叠加，且封顶 100
  assert.strictEqual(P.moodAfterFeed(80, now - 100 * 60000, now), 83);   // 75 + 8
  assert.strictEqual(P.moodAfterStroke(80, now - 100 * 60000, now), 81); // 75 + 6
  assert.strictEqual(P.moodAfterFeed(98, null, now), 100);
  assert.strictEqual(P.moodAfterStroke(99, null, now), 100);
  assert.strictEqual(P.clampMood(-5), 0);
  assert.strictEqual(P.clampMood(120), 100);
});

test('pets: daily 按日累计 / 保留窗口裁剪 / 近 7 天汇总', () => {
  const today = '2026-09-18';
  let daily = {};
  daily = P.bumpDaily(daily, today, 'feed');
  daily = P.bumpDaily(daily, today, 'feed');
  daily = P.bumpDaily(daily, today, 'stroke');
  assert.deepStrictEqual(daily[today], { feed: 2, stroke: 1 });

  // 近 7 天窗口外不计入
  daily = P.bumpDaily(daily, D.addDays(today, -6), 'feed');   // 窗口内（含今天共 7 天）
  daily = P.bumpDaily(daily, D.addDays(today, -7), 'feed');   // 窗口外
  const w = P.weekTotals(daily, today);
  assert.strictEqual(w.feed, 3);    // 2 + 1（窗口内）
  assert.strictEqual(w.stroke, 1);

  // 裁剪：只保留近 60 天（today-59 为窗口边界，保留；today-60 及更早丢弃）
  daily = P.bumpDaily(daily, D.addDays(today, -59), 'feed');
  daily = P.bumpDaily(daily, D.addDays(today, -60), 'feed');
  daily = P.bumpDaily(daily, D.addDays(today, -70), 'feed');
  const pruned = P.pruneDaily(daily, today, 60);
  assert.ok(pruned[D.addDays(today, -59)], '窗口边界日应保留');
  assert.strictEqual(pruned[D.addDays(today, -60)], undefined);
  assert.strictEqual(pruned[D.addDays(today, -70)], undefined);
  assert.ok(pruned[today]);
});

test('pets: 互动连续天数与打卡 displayStreak 同口径', () => {
  const today = '2026-09-18';
  const dates = ['2026-09-16', '2026-09-17', '2026-09-18'];
  assert.strictEqual(P.interactionStreak(dates, today), D.displayStreak(dates, today));
  assert.strictEqual(P.interactionStreak(dates, today), 3);
  // 今天还没互动 → 昨天的连续延续显示
  assert.strictEqual(P.interactionStreak(['2026-09-16', '2026-09-17'], '2026-09-18'), 2);
  // 隔天未互动 → 归零
  assert.strictEqual(P.interactionStreak(['2026-09-16', '2026-09-17'], '2026-09-19'), 0);
  assert.strictEqual(P.interactionStreak([], today), 0);
});

test('pets: computePetStats 汇总报表数据源', () => {
  const today = '2026-09-18';
  const pet = {
    growthValue: 40, feedCount: 4, strokeCount: 6,
    daily: {
      '2026-09-18': { feed: 1, stroke: 2 },
      '2026-09-17': { feed: 2, stroke: 1 },
      '2026-09-16': { feed: 1, stroke: 3 },
      '2026-08-01': { feed: 9, stroke: 9 }      // 窗口外，不计入 week
    }
  };
  const st = P.computePetStats(pet, today);
  assert.strictEqual(st.streakDays, 3);
  assert.strictEqual(st.feedTotal, 4);
  assert.strictEqual(st.strokeTotal, 6);
  assert.strictEqual(st.growthValue, 40);
  assert.deepStrictEqual(st.week, { feed: 4, stroke: 6 });
  assert.strictEqual(P.computePetStats(null, today), null);
});

test('pets 双份实现一致：云端 lib 与前端 utils 必须同口径', () => {
  const cloudPets = require('../cloudfunctions/lib/pets');
  // 常量必须逐一相等
  ['PET_FEED_COST', 'PET_GROWTH_PER_FEED', 'GROWTH_MAX', 'MOOD_INIT', 'MOOD_PER_FEED',
    'MOOD_PER_STROKE', 'MOOD_MAX', 'MOOD_DECAY_PER_MIN', 'PET_NAME_MAX', 'DAILY_KEEP_DAYS']
    .forEach(k => assert.strictEqual(cloudPets[k], P[k], '常量漂移: ' + k));
  // 阶段派生必须逐一相等
  [0, 29, 30, 79, 80, 159, 160, 299, 300, 9999].forEach(g => {
    ['cat', 'dog'].forEach(sp => {
      assert.deepStrictEqual(cloudPets.stageInfo(g, sp), P.stageInfo(g, sp), `stageInfo 漂移 @${g}/${sp}`);
    });
  });
  // 心情函数必须逐一相等
  const now = 1000000000000;
  [[80, null], [80, now - 100 * 60000], [99, now - 20 * 60000]].forEach(([m, last]) => {
    assert.strictEqual(cloudPets.applyMoodDecay(m, last, now), P.applyMoodDecay(m, last, now));
    assert.strictEqual(cloudPets.moodAfterFeed(m, last, now), P.moodAfterFeed(m, last, now));
    assert.strictEqual(cloudPets.moodAfterStroke(m, last, now), P.moodAfterStroke(m, last, now));
  });
  // 连续天数与统计必须相等
  const today = '2026-09-18';
  const daily = { '2026-09-18': { feed: 1 }, '2026-09-17': { feed: 2, stroke: 1 } };
  assert.strictEqual(cloudPets.interactionStreak(Object.keys(daily), today), P.interactionStreak(Object.keys(daily), today));
  assert.deepStrictEqual(cloudPets.weekTotals(daily, today), P.weekTotals(daily, today));
  assert.deepStrictEqual(
    cloudPets.computePetStats({ growthValue: 40, feedCount: 1, strokeCount: 2, daily }, today),
    P.computePetStats({ growthValue: 40, feedCount: 1, strokeCount: 2, daily }, today)
  );
});

// ============================================================
// 二、本地兜底数据层 petCRUD
// ============================================================

test('petCRUD: 领养 → 投喂(扣星星) → 抚摸(免费) → 改名 → 重置 → 放生', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const unlock = await local.unlockParent({ pin: local.DEFAULT_PIN });
  const token = unlock.parentToken;

  // 1. 初始无宠物：info 只读、免令牌
  let info = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.pet, null);

  // 2. 领养需家长令牌
  const noTok = await local.petCRUD({ op: 'adopt', childId, payload: { species: 'cat', name: '小灰' } });
  assert.strictEqual(noTok.code, 'TOKEN_INVALID');

  // 3. 物种非法 / 名称非法
  const badSp = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'dragon', name: '小灰' } });
  assert.strictEqual(badSp.code, 'INVALID');
  const badName = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: 'x'.repeat(9) } });
  assert.strictEqual(badName.code, 'INVALID');
  const blankName = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '   ' } });
  assert.strictEqual(blankName.code, 'INVALID');

  // 4. 领养成功（未传名 → 物种默认名）
  const ad = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat' } });
  assert.strictEqual(ad.ok, true);
  assert.strictEqual(ad.pet.name, '小猫');
  assert.strictEqual(ad.pet.species, 'cat');
  assert.strictEqual(ad.pet.growthValue, 0);
  assert.strictEqual(ad.pet.stage, 1);
  assert.strictEqual(ad.pet.stageName, '蛋蛋');
  assert.strictEqual(ad.pet.emoji, '🥚');
  assert.strictEqual(ad.pet.mood, P.MOOD_INIT);
  assert.strictEqual(ad.pet.moodMax, P.MOOD_MAX);
  assert.strictEqual(ad.pet.stats.streakDays, 0);

  // 5. 每个宝宝只有一只：重复领养被拒
  const dup = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'dog', name: '旺财' } });
  assert.strictEqual(dup.code, 'ALREADY_HAS_PET');

  // 6. 改名（合法 / 非法）
  const rnBad = await local.petCRUD({ op: 'rename', childId, parentToken: token, payload: { name: '' } });
  assert.strictEqual(rnBad.code, 'INVALID');
  const rn = await local.petCRUD({ op: 'rename', childId, parentToken: token, payload: { name: '  小灰  ' } });
  assert.strictEqual(rn.ok, true);
  assert.strictEqual(rn.pet.name, '小灰');

  // 7. 投喂需令牌；星星不足被拒
  const feedNoTok = await local.petCRUD({ op: 'feed', childId });
  assert.strictEqual(feedNoTok.code, 'TOKEN_INVALID');
  const poor = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(poor.code, 'INSUFFICIENT');

  // 给 20 颗星星（直接改档案，避免与打卡流程耦合）
  const children = store[s.KEYS.children];
  const child = children.find(c => c._id === childId);
  child.totalStars = 20;
  store[s.KEYS.children] = children;

  // 8. 投喂：-5 星星 / +10 成长 / +8 心情 / 写一条 pet_feed 流水
  const f1 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f1.ok, true);
  assert.strictEqual(f1.totalStars, 15);
  assert.strictEqual(f1.pet.growthValue, P.PET_GROWTH_PER_FEED);
  assert.strictEqual(f1.pet.feedCount, 1);
  assert.strictEqual(f1.pet.mood, P.MOOD_INIT + P.MOOD_PER_FEED);
  const log1 = (store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed');
  assert.strictEqual(log1.length, 1);
  assert.strictEqual(log1[0].delta, -P.PET_FEED_COST);
  assert.strictEqual(log1[0].childId, childId);
  // 成长瓶口径透出：1 次投喂 ⇒ 液面涨 1/3（蛋蛋→破壳共需 30，每次 +10）
  assert.strictEqual(f1.pet.stageHave, P.PET_GROWTH_PER_FEED);
  assert.strictEqual(f1.pet.stageNeed, 30);
  assert.strictEqual(Math.round(f1.pet.stagePct * 100) / 100, 33.33);

  // 9. 抚摸：免费（不扣星星 / 不写流水）、+6 心情
  const st1 = await local.petCRUD({ op: 'stroke', childId });
  assert.strictEqual(st1.ok, true);
  assert.strictEqual(st1.pet.strokeCount, 1);
  assert.strictEqual(st1.pet.mood, P.MOOD_INIT + P.MOOD_PER_FEED + P.MOOD_PER_STROKE);
  assert.strictEqual((store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed').length, 1);
  assert.strictEqual(st1.totalStars, undefined);   // 抚摸不涉及星星，不返回余额

  // 10. 连续投喂到破壳（成长 30 → 阶段 2）
  await local.petCRUD({ op: 'feed', childId, parentToken: token });
  const f3 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f3.pet.growthValue, 30);
  assert.strictEqual(f3.pet.stage, 2);
  // 升阶瞬间：瓶子见底，换下一阶段的容量（30→80 共需 50）
  assert.strictEqual(f3.pet.stageHave, 0);
  assert.strictEqual(f3.pet.stageNeed, 50);
  assert.strictEqual(f3.pet.stagePct, 0);
  assert.strictEqual(f3.pet.stageName, '破壳幼崽');
  assert.strictEqual(f3.pet.emoji, '🐱');
  assert.strictEqual(f3.totalStars, 5);
  // 心情封顶 100（80+8+6+8+8 = 110 → 100）
  assert.strictEqual(f3.pet.mood, P.MOOD_MAX);

  // 11. 互动统计：今日 3 次投喂 / 1 次抚摸，连续 1 天
  let st = f3.pet.stats;
  assert.strictEqual(st.streakDays, 1);
  assert.strictEqual(st.feedTotal, 3);
  assert.strictEqual(st.strokeTotal, 1);
  assert.deepStrictEqual(st.week, { feed: 3, stroke: 1 });

  // 12. 无宠物时互动被拒
  await local.petCRUD({ op: 'release', childId, parentToken: token });
  assert.strictEqual((await local.petCRUD({ op: 'feed', childId, parentToken: token })).code, 'PET_NOT_FOUND');
  assert.strictEqual((await local.petCRUD({ op: 'stroke', childId })).code, 'PET_NOT_FOUND');
  assert.strictEqual((await local.petCRUD({ op: 'rename', childId, parentToken: token, payload: { name: 'x' } })).code, 'PET_NOT_FOUND');
});

test('petCRUD: 放生=软删可重新领养；重置保留名字但清零成长', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;

  const ad = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'dog', name: '旺财' } });
  assert.strictEqual(ad.ok, true);

  // 先攒一点成长值：注入星星后投喂一次
  const children = store[s.KEYS.children];
  children.find(c => c._id === childId).totalStars = 50;
  store[s.KEYS.children] = children;
  const fed = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(fed.pet.growthValue, 10);
  assert.strictEqual(fed.pet.feedCount, 1);

  // 重置：成长/心情/计数清零，名字与物种保留
  const rs = await local.petCRUD({ op: 'reset', childId, parentToken: token });
  assert.strictEqual(rs.ok, true);
  assert.strictEqual(rs.pet.name, '旺财');
  assert.strictEqual(rs.pet.species, 'dog');
  assert.strictEqual(rs.pet.growthValue, 0);
  assert.strictEqual(rs.pet.mood, P.MOOD_INIT);
  assert.strictEqual(rs.pet.feedCount, 0);
  assert.strictEqual(rs.pet.strokeCount, 0);
  assert.deepStrictEqual(rs.pet.stats.week, { feed: 0, stroke: 0 });
  assert.strictEqual(rs.pet.stage, 1);   // 回到蛋蛋

  // 放生：需令牌；放生后 info 返回 null，且可重新领养（软删，历史保留）
  const relNoTok = await local.petCRUD({ op: 'release', childId });
  assert.strictEqual(relNoTok.code, 'TOKEN_INVALID');
  const rel = await local.petCRUD({ op: 'release', childId, parentToken: token });
  assert.strictEqual(rel.ok, true);
  const petsAll = store[s.KEYS.pets] || [];
  assert.strictEqual(petsAll.length, 1);
  assert.strictEqual(petsAll[0].released, true);           // 软删而非物理删除
  assert.strictEqual((await local.petCRUD({ op: 'info', childId })).pet, null);

  const re = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '小灰' } });
  assert.strictEqual(re.ok, true);
  assert.strictEqual(re.pet.name, '小灰');
  assert.strictEqual(re.pet.growthValue, 0);               // 全新一只，不带旧成长值
  assert.strictEqual((store[s.KEYS.pets] || []).length, 2); // 旧档案仍留存
});

test('petCRUD: 心情按真实时间衰减（读取前重算）', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '小灰' } });

  // 把 lastMoodAt 往回拨 100 分钟 → 读取时心情应为 80 - 5 = 75
  const pets = store[s.KEYS.pets];
  pets[0].lastMoodAt = Date.now() - 100 * 60000;
  store[s.KEYS.pets] = pets;

  const info = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info.pet.mood, 75);
  // 衰减后的值不回写（仍以 lastMoodAt 为基准），重复读取结果稳定
  const again = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(again.pet.mood, 75);

  // 互动后落库：以当前时间重算并刷新 lastMoodAt
  const st = await local.petCRUD({ op: 'stroke', childId });
  assert.strictEqual(st.pet.mood, 81);   // 75 + 6
  assert.strictEqual((await local.petCRUD({ op: 'info', childId })).pet.mood, 81);   // 已落库，不再继续衰减
});

test('petCRUD: 越权与跨宝宝隔离（宠物 per-child）', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;

  // 不属于自己的宝宝 → FORBIDDEN
  assert.strictEqual((await local.petCRUD({ op: 'info', childId: 'not-mine' })).code, 'FORBIDDEN');
  assert.strictEqual((await local.petCRUD({ op: 'adopt', childId: 'not-mine', parentToken: token, payload: { species: 'cat' } })).code, 'FORBIDDEN');

  // 领养大宝的宠物
  await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '小灰' } });

  // 二宝：默认没有宠物
  const mk = await local.childCRUD({ op: 'create', parentToken: token, payload: { name: '二宝', avatar: '🐣' } });
  const c2 = mk.child._id;
  assert.strictEqual((await local.petCRUD({ op: 'info', childId: c2 })).pet, null);

  // 二宝领养狗 → 与大宝的猫互不影响
  const ad2 = await local.petCRUD({ op: 'adopt', childId: c2, parentToken: token, payload: { species: 'dog', name: '旺财' } });
  assert.strictEqual(ad2.ok, true);
  await local.petCRUD({ op: 'stroke', childId: c2 });
  const i1 = await local.petCRUD({ op: 'info', childId });
  const i2 = await local.petCRUD({ op: 'info', childId: c2 });
  assert.strictEqual(i1.pet.species, 'cat');
  assert.strictEqual(i1.pet.name, '小灰');
  assert.strictEqual(i1.pet.strokeCount, 0);
  assert.strictEqual(i2.pet.species, 'dog');
  assert.strictEqual(i2.pet.name, '旺财');
  assert.strictEqual(i2.pet.strokeCount, 1);

  // 未知 op
  assert.strictEqual((await local.petCRUD({ op: 'fly', childId, parentToken: token })).code, 'INVALID');
});

test('petCRUD: 本地兜底函数集与云函数集一一对应', () => {
  const fs = require('fs');
  const path = require('path');
  const setupSrc = fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'setup.js'), 'utf8');
  const m = /const FUNCTIONS = \[([^\]]+)\]/.exec(setupSrc);
  assert.ok(m, 'setup.js 未找到 FUNCTIONS 列表');
  const cloudFns = m[1].split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean);
  const localFns = Object.keys(require('../miniprogram/services/local'))
    .filter(k => typeof require('../miniprogram/services/local')[k] === 'function');
  // 本地层独有的辅助项（resetAll 仅用于测试/演示）不计入对应关系
  const skip = new Set(['resetAll']);
  cloudFns.forEach(fn => {
    assert.ok(localFns.indexOf(fn) >= 0, '云函数 ' + fn + ' 在本地兜底层缺失');
  });
  localFns.filter(f => !skip.has(f)).forEach(fn => {
    assert.ok(cloudFns.indexOf(fn) >= 0, '本地兜底层 ' + fn + ' 缺少对应云函数');
  });
});

// 宠物页 HUD 结构守卫：必须是「常驻玻璃瓶」而非旧版血条/魔法条
// （2026-09-19 用户定稿：成长=心型红瓶 / 心情=水晶蓝瓶，瓶身一直存在）
test('宠物页：HUD 为两瓶常驻（成长瓶按 stagePct、心情瓶按 moodPct），无旧血条', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram', 'pages', 'pet');
  const wxml = fs.readFileSync(path.join(root, 'pet.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pet.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pet.js'), 'utf8');

  // ① 两个瓶子都在，且成长/心情各一（成长=玻璃心 / 心情=玻璃钻石）
  assert.ok(/class="flask heart"/.test(wxml), '缺少成长瓶（玻璃心）');
  assert.ok(/class="flask diamond"/.test(wxml), '缺少心情瓶（玻璃钻石）');
  // ② 液面分别绑定 stagePct 派生值 / mood 派生值（页面不直接算，防 null 时 height:% 非法）
  assert.ok(/liquid growth"\s+style="height:\{\{growthPct\}\}%"/.test(wxml), '成长瓶液面未绑定 growthPct');
  assert.ok(/liquid mood"\s+style="height:\{\{moodPct\}\}%"/.test(wxml), '心情瓶液面未绑定 moodPct');
  assert.ok(/growthPct:\s*Math\.round\(pet \? pet\.stagePct : 0\)/.test(js), 'growthPct 未按 stagePct 派生');
  assert.ok(/moodPct:\s*Math\.round\(pet \? pet\.mood : 0\)/.test(js), 'moodPct 未按 mood 派生');
  // ③ 旧版横向血条已下线
  assert.ok(!/class="hud"/.test(wxml), '旧版 .hud 血条仍在');
  assert.ok(!/\.hud \.track/.test(wxss), '旧版血条样式仍在');
  // ④ 瓶子是「玻璃心 / 玻璃钻石」：有瓶身裁形 + 玻璃高光 + 钻石切面，且常驻（不在 wx:if="{{pet}}" 内）
  assert.ok(/clip-path:\s*polygon/.test(wxss), '缺少瓶身裁形 clip-path');
  assert.ok(/\.flask \.shine/.test(wxss), '缺少玻璃高光样式');
  assert.ok(/\.flask \.facet/.test(wxss), '缺少钻石切面样式');
  assert.ok(/class="facet"/.test(wxml), '心情瓶未挂切面层');
  // ⑤ 无瓶盖（用户定稿：不要瓶塞，就是玻璃心与玻璃钻石）
  assert.ok(!/class="cap/.test(wxml), '瓶盖已废弃，不应再出现');
  assert.ok(!/\.flask \.cap/.test(wxss), '瓶盖样式已废弃，应删除');
  // 取 hud2 区块（到 arena 结束为止），确认其中没有任何「有宠物才显示」的条件
  const hudStart = wxml.indexOf('<view class="hud2">');
  const hudEnd = wxml.indexOf('\n  </view>', hudStart);
  assert.ok(hudStart >= 0 && hudEnd > hudStart, '未定位到 hud2 区块');
  const hudBlock = wxml.slice(hudStart, hudEnd);
  assert.ok(/class="flask heart"/.test(hudBlock) && /class="flask diamond"/.test(hudBlock), '两瓶不在 hud2 区块内');
  // 瓶身自己不带「有宠物才显示」的条件（中间技能按钮可以有，未领养时它本就该隐藏）
  const heartStart = wxml.indexOf('<view class="flask heart">');
  const skillsStart = wxml.indexOf('<view wx:if="{{pet}}" class="skills"');
  const crystalStart = wxml.indexOf('<view class="flask diamond">');
  assert.ok(heartStart > 0 && skillsStart > heartStart && crystalStart > skillsStart, '瓶子/技能按钮顺序异常');
  assert.ok(!/wx:if="\{\{pet\}\}"/.test(wxml.slice(heartStart, skillsStart)), '成长瓶被 wx:if="{{pet}}" 包裹，未领养时会消失');
  assert.ok(!/wx:if="\{\{pet\}\}"/.test(wxml.slice(crystalStart, hudEnd)), '心情瓶被 wx:if="{{pet}}" 包裹，未领养时会消失');
});

// 打磨阶段守卫（2026-09）：传奇翅膀纯 CSS（🪽 跨机型不一致已下线）+ 瓶内数字「描边提号」+ s2 壳位
test('宠物页：传奇翅膀为纯 CSS（🪽 全目录无残留），瓶内数字 24rpx 白描边，s2 壳在下半部', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');

  // ① 🪽 属非基础区段 Unicode（部分机型渲染为方框），产物目录不得残留
  const offenders = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return walk(p);
      if (/\.(wxml|wxss|js|json)$/.test(d.name) && fs.readFileSync(p, 'utf8').indexOf('🪽') >= 0) offenders.push(p);
    });
  })(root);
  assert.deepStrictEqual(offenders, [], '🪽 emoji 不应残留在 miniprogram 产物目录');

  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxss'), 'utf8');

  // ② 翅膀为无内容的 view + CSS 渐变羽翼，振翅动画保留（左右各一）
  assert.ok(/<view class="pet-wing l"><\/view>/.test(wxml), '左翅应为纯 CSS view');
  assert.ok(/<view class="pet-wing r"><\/view>/.test(wxml), '右翅应为纯 CSS view');
  const wing = /\.pet-wing\s*\{([^}]*)\}/.exec(wxss);
  assert.ok(wing && /linear-gradient/.test(wing[1]), '翅膀应为渐变羽翼（金色系）');
  assert.ok(wing && /border-radius/.test(wing[1]), '翅膀轮廓应由 border-radius 组合而成');
  assert.ok(/@keyframes flutter\b/.test(wxss), '振翅动画 flutter 丢失');
  assert.ok(/@keyframes flutter-l\b/.test(wxss), '左翅镜像动画 flutter-l 丢失（animation 会覆盖 transform，镜像必须写进 keyframes）');

  // ③ 瓶内数字「描边提号」：24rpx 深字 + 白描边（液面/玻璃白底双背景可读）
  const fnum = /\.flask \.fnum\s*\{([^}]*)\}/.exec(wxss);
  assert.ok(fnum, '缺少 .flask .fnum 样式');
  assert.ok(/font-size:\s*24rpx/.test(fnum[1]), '瓶内数字应提升到 24rpx 最小口径');
  assert.ok(!/color:\s*#fff/.test(fnum[1]), '瓶内数字不应再用纯白字（液面低于数字位时不可读）');
  assert.ok(/text-shadow:[^;]*#fff/.test(fnum[1]), '瓶内数字应有白描边');

  // ④ s2 破壳：壳贴宠物下半部（头顶位与未领养蛋蛋符号冲突）
  const shell = /\.pet-shell\s*\{([^}]*)\}/.exec(wxss);
  assert.ok(shell, '缺少 .pet-shell 样式');
  assert.ok(/bottom:\s*-?\d+rpx/.test(shell[1]), 's2 壳应定位在宠物下半部（bottom）');
  assert.ok(!/top:\s*-/.test(shell[1]), 's2 壳不应再悬在头顶（top 负值）');
});
