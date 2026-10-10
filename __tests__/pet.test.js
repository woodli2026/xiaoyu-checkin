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

test('pets: 两阶段由成长值派生（幼崽/成年，阈值 300；stage 不入库，防漂移）', () => {
  const cases = [
    [0, 1, '幼崽'], [299, 1, '幼崽'],
    [300, 2, '成年'], [9999, 2, '成年']
  ];
  cases.forEach(([g, stage, name]) => {
    const i = P.stageInfo(g, 'cat');
    assert.strictEqual(i.stage, stage, `成长值 ${g} 应为阶段 ${stage}`);
    assert.strictEqual(i.name, name, `成长值 ${g} 阶段名应为 ${name}`);
  });
  // emoji 字段为物种 emoji（两档制本体均为品种图，蛋形态已废）
  assert.strictEqual(P.stageInfo(0, 'cat').emoji, '🐱');
  assert.strictEqual(P.stageInfo(0, 'dog').emoji, '🐶');
  assert.strictEqual(P.stageInfo(300, 'cat').speciesEmoji, '🐱');
  // 下一阶阈值 / 血条百分比（血条框 = GROWTH_MAX(300)）
  assert.strictEqual(P.stageInfo(0, 'cat').nextStageAt, 300);
  assert.strictEqual(P.stageInfo(299, 'cat').nextStageAt, 300);
  assert.strictEqual(P.stageInfo(300, 'cat').nextStageAt, null);   // 已到顶
  assert.strictEqual(P.stageInfo(150, 'cat').growthPct, 50);
  assert.strictEqual(P.stageInfo(9999, 'cat').growthPct, 100);      // 封顶 100%
});

// 成长瓶口径：按「到下一阶段」的阶段内进度填充，保证每次投喂液面可见上升
// （若用成长总值做分母，幼崽段每次投喂仅 +0.33%，几乎看不到反馈）
test('pets: 成长瓶按阶段内进度 stagePct 填充（每次投喂液面可见上升）', () => {
  // 阶段名（两档制）：幼崽 → 成年，阈值 300
  assert.strictEqual(P.stageInfo(0, 'cat').name, '幼崽');
  assert.strictEqual(P.stageInfo(300, 'cat').name, '成年');
  // 幼崽 → 成年 共需 300（每次投喂 +10 ⇒ 每次涨 1/300）
  assert.strictEqual(P.stageInfo(0, 'cat').stageNeed, 300);
  assert.strictEqual(P.stageInfo(0, 'cat').stageHave, 0);
  assert.strictEqual(P.stageInfo(0, 'cat').stagePct, 0);
  // 百分比取两位小数比对（避免浮点尾数差异）
  const pct = (g, sp) => Math.round(P.stageInfo(g, sp || 'cat').stagePct * 100) / 100;
  assert.strictEqual(pct(100), 33.33);
  assert.strictEqual(pct(200), 66.67);
  assert.strictEqual(pct(299), 99.67);
  // 升级瞬间（growthValue=300）：成年段 stageNeed=null（页面显示 MAX）、瓶恒满
  assert.strictEqual(P.stageInfo(300, 'cat').stageHave, 0);
  assert.strictEqual(P.stageInfo(300, 'cat').stageNeed, null);
  assert.strictEqual(P.stageInfo(300, 'cat').stagePct, 100);
  assert.strictEqual(P.stageInfo(9999, 'cat').stageNeed, null);
  assert.strictEqual(P.stageInfo(9999, 'cat').stagePct, 100);
  // 越界不炸：负数 / 非法值钳到合法区间
  assert.ok(P.stageInfo(-5, 'cat').stagePct >= 0);
  assert.ok(Number.isFinite(P.stageInfo(null, 'cat').stagePct));
  assert.ok(Number.isFinite(P.stageInfo(undefined, 'nope').stagePct));
});

// 品种即花色（2026-09 两档制 + 动作差分图）：10 品种 × 6 图（baby/adult × 默认/happy/eat）= 60 张
// （eat 图已把食盆画进图里，独立 bowl 资产已删除，不得残留）
test('pets: 品种库 10 key（5猫5狗），name≤8，60 张资产存在（形态+动作差分），bowl 已删除', () => {
  const fs = require('fs');
  const path = require('path');
  const assertImg = (rel) => assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'miniprogram', rel.replace(/^\//, '').split('/').join(path.sep))),
    '图片资产缺失: ' + rel
  );
  assert.strictEqual(P.SPECIES.length, 10);
  const cats = P.SPECIES.filter(x => x.species === 'cat');
  const dogs = P.SPECIES.filter(x => x.species === 'dog');
  assert.strictEqual(cats.length, 5, '猫品种应为 5 个');
  assert.strictEqual(dogs.length, 5, '狗品种应为 5 个');
  P.SPECIES.forEach(x => {
    assert.ok(x.key && x.species && x.name && x.emoji && x.imgBaby && x.imgAdult, '品种字段不完整: ' + x.key);
    assert.ok(x.name.length <= 8, '品种名超 8 字: ' + x.name);
    // 两档形态图 + 动作差分图（约定式路径：<key>_<form>[_happy|_eat].png）
    // happy=抚摸（眯眼歪头笑）、eat=投喂（低头吃）；默认图 imgBaby/imgAdult 字段与约定路径同前缀
    ['baby', 'adult'].forEach(form => {
      ['', '_happy', '_eat'].forEach(suffix => {
        assertImg('/images/pets/' + x.key + '_' + form + suffix + '.png');
      });
    });
    // 字段路径必须与约定式生成路径一致（petSrc 由约定生成，防字段漂移）
    assert.strictEqual(x.imgBaby, '/images/pets/' + x.key + '_baby.png');
    assert.strictEqual(x.imgAdult, '/images/pets/' + x.key + '_adult.png');
    assert.strictEqual(P.speciesOf(x.key), x);
  });
  // 独立食盆资产已删除（_eat 差分图已含食盆，叠加会重影）：文件不存在 + 产物目录无 bowl 引用
  ['bowl_cat.png', 'bowl_dog.png'].forEach(f => {
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'miniprogram', 'images', 'pets', f)), 'bowl 资产应已删除: ' + f);
  });
  ['miniprogram', 'cloudfunctions'].forEach(dir => {
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return walk(p);
        if (/\.(js|wxml|wxss|json)$/.test(e.name)) {
          assert.ok(fs.readFileSync(p, 'utf8').indexOf('bowl_') < 0, 'bowl 引用残留: ' + p);
        }
      });
    })(path.join(__dirname, '..', dir));
  });
  // 旧单图口径不得残留
  assert.ok(P.SPECIES.every(x => !x.img), '旧 img 单字段应已改为 imgBaby/imgAdult');
  // 领养弹层仍为物种二选一（组口径），品种由服务端随机
  assert.deepStrictEqual(P.SPECIES_GROUPS.map(g => g.key), ['cat', 'dog']);
  assert.strictEqual(P.isValidSpeciesGroup('cat'), true);
  assert.strictEqual(P.isValidSpeciesGroup('dog'), true);
  assert.strictEqual(P.isValidSpeciesGroup('dragon'), false);
  assert.strictEqual(P.isValidSpeciesGroup(''), false);
  // 组 key 不再是品种 key（品种库扩容后的口径变化）
  assert.strictEqual(P.isValidSpecies('cat'), false);
  assert.strictEqual(P.isValidSpecies('dog'), false);
  assert.strictEqual(P.isValidSpecies('dragon'), false);
  assert.strictEqual(P.speciesOf('dog_yellow').name, '田园犬黄');
  assert.strictEqual(P.speciesOf('nope'), null);
});

test('pets: resolveSpeciesKey 老 key 兼容 + 未知 key 兜底物种默认品种', () => {
  assert.strictEqual(P.resolveSpeciesKey('cat'), 'cat_lihua');          // 老数据不改写、读取时映射
  assert.strictEqual(P.resolveSpeciesKey('dog'), 'dog_yellow');
  assert.strictEqual(P.resolveSpeciesKey('cat_lihua'), 'cat_lihua');    // 品种 key 原样
  assert.strictEqual(P.resolveSpeciesKey('dog_poodle'), 'dog_poodle');
  assert.strictEqual(P.resolveSpeciesKey('cat_xxx'), 'cat_lihua');      // 未知 key 前缀猜物种兜底
  assert.strictEqual(P.resolveSpeciesKey('dog_xxx'), 'dog_yellow');
  assert.strictEqual(P.resolveSpeciesKey('xxx'), 'cat_lihua');          // 无法识别 → 猫默认兜底
  assert.strictEqual(P.resolveSpeciesKey(''), 'cat_lihua');
  assert.strictEqual(P.resolveSpeciesKey(null), 'cat_lihua');
  assert.strictEqual(P.resolveSpeciesKey(undefined), 'cat_lihua');
});

test('pets: randomBreedKey 物种过滤 + rng 注入确定性', () => {
  const catKeys = P.SPECIES.filter(x => x.species === 'cat').map(x => x.key);
  const dogKeys = P.SPECIES.filter(x => x.species === 'dog').map(x => x.key);
  // rng 注入：确定性输出（floor(r*5)）
  assert.strictEqual(P.randomBreedKey('cat', () => 0), catKeys[0]);
  assert.strictEqual(P.randomBreedKey('cat', () => 0.4), catKeys[2]);
  assert.strictEqual(P.randomBreedKey('cat', () => 0.99), catKeys[4]);
  assert.strictEqual(P.randomBreedKey('dog', () => 0.2), dogKeys[1]);
  // 物种过滤：默认 rng 下采样全部落在该物种 5 key 池内
  for (let n = 0; n < 500; n++) assert.ok(catKeys.indexOf(P.randomBreedKey('cat')) >= 0, '随机结果越出猫池');
  for (let n = 0; n < 500; n++) assert.ok(dogKeys.indexOf(P.randomBreedKey('dog')) >= 0, '随机结果越出狗池');
  // 非法物种组：兜底猫默认品种
  assert.strictEqual(P.randomBreedKey('dragon'), 'cat_lihua');
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
  assert.strictEqual(P.normalizePetName('', 'cat'), '狸花猫');          // 老 key 映射到品种默认名
  assert.strictEqual(P.normalizePetName('', 'dog'), '田园犬黄');
  assert.strictEqual(P.normalizePetName('', 'cat_ragdoll'), '布偶猫');  // 品种 key 直接取品种名
});

test('pets: 心情按真实时间衰减（每小时 -1，不足 1 小时不扣）+ 上限 100 + 不为负', () => {
  assert.strictEqual(P.MOOD_INIT, 60);
  assert.strictEqual(P.MOOD_MAX, 100);
  assert.strictEqual(P.MOOD_DECAY_PER_HOUR, 1);
  const now = 1000000000000;
  // 无 lastMoodAt（刚领养 / 老数据）→ 不衰减
  assert.strictEqual(P.applyMoodDecay(80, null, now), 80);
  assert.strictEqual(P.applyMoodDecay(80, 0, now), 80);
  // 不足 1 小时不扣（floor 口径）
  assert.strictEqual(P.applyMoodDecay(80, now - 59 * 60000, now), 80);
  // 60 分钟 -1
  assert.strictEqual(P.applyMoodDecay(80, now - 60 * 60000, now), 79);
  // 100 分钟仍只 -1（不足整小时的部分不扣）
  assert.strictEqual(P.applyMoodDecay(80, now - 100 * 60000, now), 79);
  // 24 小时 -24
  assert.strictEqual(P.applyMoodDecay(80, now - 24 * 3600000, now), 56);
  // 久不互动也不为负（200 小时应 -200 → 夹到 0）
  assert.strictEqual(P.applyMoodDecay(80, now - 200 * 3600000, now), 0);
  // 未来时间戳（时钟回拨）不应把心情加回去
  assert.strictEqual(P.applyMoodDecay(80, now + 60000, now), 80);

  // 互动加成：先衰减再叠加，且封顶 100（2 小时 → -2）
  assert.strictEqual(P.moodAfterFeed(80, now - 2 * 3600000, now), 86);   // 78 + 8
  assert.strictEqual(P.moodAfterStroke(80, now - 2 * 3600000, now), 84); // 78 + 6
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

test('pets: canFeed 每日上限判定（<3 可投，≥3 达限；缺 daily 视为 0，stroke 不计）', () => {
  const today = '2026-09-18';
  assert.strictEqual(P.feedCountToday({ daily: { '2026-09-18': { feed: 2 } } }, today), 2);
  assert.strictEqual(P.feedCountToday({}, today), 0);
  assert.strictEqual(P.feedCountToday(null, today), 0);
  assert.strictEqual(P.canFeed({ daily: { '2026-09-18': { feed: 2 } } }, today), true);
  assert.strictEqual(P.canFeed({ daily: { '2026-09-18': { feed: 3 } } }, today), false);
  assert.strictEqual(P.canFeed({ daily: { '2026-09-18': { stroke: 5 } } }, today), true); // 抚摸不计入投喂上限
  assert.strictEqual(P.canFeed(null, today), true);
});

test('pets 双份实现一致：云端 lib 与前端 utils 必须同口径', () => {
  const cloudPets = require('../cloudfunctions/lib/pets');
  // 品种库/组口径/默认品种映射必须逐字段一致（防漂移）
  assert.deepStrictEqual(cloudPets.SPECIES, P.SPECIES, 'SPECIES 漂移');
  assert.deepStrictEqual(cloudPets.SPECIES_GROUPS, P.SPECIES_GROUPS, 'SPECIES_GROUPS 漂移');
  assert.deepStrictEqual(cloudPets.DEFAULT_BREED_KEY, P.DEFAULT_BREED_KEY, 'DEFAULT_BREED_KEY 漂移');
  // 常量必须逐一相等
  ['PET_FEED_COST', 'PET_GROWTH_PER_FEED', 'GROWTH_MAX', 'MOOD_INIT', 'MOOD_PER_FEED',
    'MOOD_PER_STROKE', 'MOOD_MAX', 'MOOD_DECAY_PER_HOUR', 'PET_FEED_DAILY_LIMIT',
    'PET_NAME_MAX', 'DAILY_KEEP_DAYS']
    .forEach(k => assert.strictEqual(cloudPets[k], P[k], '常量漂移: ' + k));
  // 老 key 兼容与领养随机必须相等
  ['cat', 'dog', 'cat_lihua', 'nope', null].forEach(k =>
    assert.strictEqual(cloudPets.resolveSpeciesKey(k), P.resolveSpeciesKey(k), 'resolveSpeciesKey 漂移: ' + k));
  [['cat', 0], ['dog', 0.7], ['dragon', 0.3]].forEach(([g, r]) => {
    assert.strictEqual(cloudPets.randomBreedKey(g, () => r), P.randomBreedKey(g, () => r), 'randomBreedKey 漂移: ' + g);
  });
  // 阶段派生必须逐一相等
  [0, 299, 300, 3001, 9999].forEach(g => {
    ['cat', 'dog', 'cat_british', 'dog_beagle'].forEach(sp => {
      assert.deepStrictEqual(cloudPets.stageInfo(g, sp), P.stageInfo(g, sp), `stageInfo 漂移 @${g}/${sp}`);
    });
  });
  // 心情函数必须逐一相等
  const now = 1000000000000;
  [[80, null], [80, now - 100 * 60000], [99, now - 90 * 60000]].forEach(([m, last]) => {
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
  // 投喂上限判定（C 收敛）：本地与云端必须为同一纯函数，逐值一致
  [{ daily: {} }, { daily: { '2026-09-18': { feed: 0 } } }, { daily: { '2026-09-18': { feed: 2 } } }, { daily: { '2026-09-18': { feed: 3 } } }]
    .forEach((p, i) => {
      assert.strictEqual(cloudPets.feedCountToday(p, today), P.feedCountToday(p, today), 'feedCountToday 漂移 @' + i);
      assert.strictEqual(cloudPets.canFeed(p, today), P.canFeed(p, today), 'canFeed 漂移 @' + i);
    });
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

  // 4. 领养成功（未传名 → 品种默认名；品种在猫池内随机 5 选 1，品种 key 入库）
  const catKeys = P.SPECIES.filter(x => x.species === 'cat').map(x => x.key);
  const catNames = P.SPECIES.filter(x => x.species === 'cat').map(x => x.name);
  const ad = await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat' } });
  assert.strictEqual(ad.ok, true);
  assert.ok(catNames.indexOf(ad.pet.name) >= 0, '未传名应落到品种默认名');
  assert.ok(catKeys.indexOf(ad.pet.species) >= 0, 'species 应为品种 key（5 选 1）');
  const stored = store[s.KEYS.pets].find(x => x.childId === childId && !x.released);
  assert.ok(catKeys.indexOf(stored.species) >= 0, '入库文档应为品种 key 而非组 key');
  assert.strictEqual(ad.pet.growthValue, 0);
  assert.strictEqual(ad.pet.stage, 1);
  assert.strictEqual(ad.pet.stageName, '幼崽');
  assert.strictEqual(ad.pet.emoji, '🐱');   // 两档制 emoji=物种 emoji（无蛋形态）
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

  // 8. 投喂：-1 星星 / +10 成长 / +8 心情 / 写一条 pet_feed 流水
  const f1 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f1.ok, true);
  assert.strictEqual(f1.totalStars, 19);
  assert.strictEqual(f1.pet.growthValue, P.PET_GROWTH_PER_FEED);
  assert.strictEqual(f1.pet.feedCount, 1);
  assert.strictEqual(f1.pet.mood, P.MOOD_INIT + P.MOOD_PER_FEED);
  const log1 = (store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed');
  assert.strictEqual(log1.length, 1);
  assert.strictEqual(log1[0].delta, -P.PET_FEED_COST);
  assert.strictEqual(log1[0].childId, childId);
  // 成长瓶口径透出：1 次投喂 ⇒ 液面涨 1/300（幼崽→成年共需 300，每次 +10）
  assert.strictEqual(f1.pet.stageHave, P.PET_GROWTH_PER_FEED);
  assert.strictEqual(f1.pet.stageNeed, 300);
  assert.strictEqual(Math.round(f1.pet.stagePct * 100) / 100, 3.33);

  // 9. 抚摸：免费（不扣星星 / 不写流水）、+6 心情
  const st1 = await local.petCRUD({ op: 'stroke', childId });
  assert.strictEqual(st1.ok, true);
  assert.strictEqual(st1.pet.strokeCount, 1);
  assert.strictEqual(st1.pet.mood, P.MOOD_INIT + P.MOOD_PER_FEED + P.MOOD_PER_STROKE);
  assert.strictEqual((store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed').length, 1);
  assert.strictEqual(st1.totalStars, undefined);   // 抚摸不涉及星星，不返回余额

  // 10. 连续投喂 3 次（成长 30，仍在幼崽段；两档制升级需 300，本地测试不灌到满）
  await local.petCRUD({ op: 'feed', childId, parentToken: token });
  const f3 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f3.pet.growthValue, 30);
  assert.strictEqual(f3.pet.stage, 1);
  // 幼崽段内进度：30/300 = 10%
  assert.strictEqual(f3.pet.stageHave, 30);
  assert.strictEqual(f3.pet.stageNeed, 300);
  assert.strictEqual(Math.round(f3.pet.stagePct * 100) / 100, 10);
  assert.strictEqual(f3.pet.stageName, '幼崽');
  assert.strictEqual(f3.pet.emoji, '🐱');
  assert.strictEqual(f3.totalStars, 17);
  // 心情：60+8+6+8+8 = 90（未到 100，不封顶）
  assert.strictEqual(f3.pet.mood, 90);

  // 11. 互动统计：今日 3 次投喂 / 1 次抚摸，连续 1 天；恰好喂满每日上限（3/3，已达限）
  let st = f3.pet.stats;
  assert.strictEqual(st.streakDays, 1);
  assert.strictEqual(st.feedTotal, 3);
  assert.strictEqual(st.strokeTotal, 1);
  assert.deepStrictEqual(st.week, { feed: 3, stroke: 1 });
  assert.strictEqual(f3.pet.todayFeedCount, 3);
  assert.strictEqual(f3.pet.feedLimited, true);

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

  // 重置：成长/心情/计数清零，名字与品种保留
  const rs = await local.petCRUD({ op: 'reset', childId, parentToken: token });
  assert.strictEqual(rs.ok, true);
  assert.strictEqual(rs.pet.name, '旺财');
  assert.ok(P.SPECIES.filter(x => x.species === 'dog').some(x => x.key === rs.pet.species), '重置后品种保留');
  assert.strictEqual(rs.pet.growthValue, 0);
  assert.strictEqual(rs.pet.mood, P.MOOD_INIT);
  assert.strictEqual(rs.pet.feedCount, 0);
  assert.strictEqual(rs.pet.strokeCount, 0);
  assert.deepStrictEqual(rs.pet.stats.week, { feed: 0, stroke: 0 });
  assert.strictEqual(rs.pet.stage, 1);   // 回到幼崽

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

  // 把 lastMoodAt 往回拨 100 分钟 → floor(100/60)=1 小时 → 心情应为 60（MOOD_INIT）- 1 = 59
  const pets = store[s.KEYS.pets];
  pets[0].lastMoodAt = Date.now() - 100 * 60000;
  store[s.KEYS.pets] = pets;

  const info = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info.pet.mood, 59);
  // 衰减后的值不回写（仍以 lastMoodAt 为基准），重复读取结果稳定
  const again = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(again.pet.mood, 59);

  // 互动后落库：以当前时间重算并刷新 lastMoodAt
  const st = await local.petCRUD({ op: 'stroke', childId });
  assert.strictEqual(st.pet.mood, 65);   // 59 + 6
  assert.strictEqual((await local.petCRUD({ op: 'info', childId })).pet.mood, 65);   // 已落库，不再继续衰减
});

// 每日投喂上限（2026-09）：每天最多 3 次有效投喂 = 30 成长值/天，达限 FEED_LIMIT 拒绝
test('petCRUD: 每日投喂上限 3 次——第 4 次 FEED_LIMIT 不扣星不加成长，跨日重置', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '小灰' } });

  // 上限常量 = 3
  assert.strictEqual(P.PET_FEED_DAILY_LIMIT, 3);

  // 给足星星（30 颗足够喂 6 次，确保只有「每日上限」拦截而非星星不足）
  const children = store[s.KEYS.children];
  children.find(c => c._id === childId).totalStars = 30;
  store[s.KEYS.children] = children;

  // 连喂 3 次（每日上限）→ 全部成功
  for (let i = 0; i < 3; i++) {
    const r = await local.petCRUD({ op: 'feed', childId, parentToken: token });
    assert.strictEqual(r.ok, true, `第 ${i + 1} 次投喂应成功`);
  }
  // petView 透出：今日已喂 3/3、已达限
  const info = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info.pet.todayFeedCount, 3);
  assert.strictEqual(info.pet.feedLimited, true);

  // 第 4 次：FEED_LIMIT 拒绝——不扣星 / 不加成长值 / feedCount 停 3 / daily.feed 停 3 / 不写流水
  const starsBefore = store[s.KEYS.children].find(c => c._id === childId).totalStars;
  const petBefore = store[s.KEYS.pets].find(x => x.childId === childId && !x.released);
  const logsBefore = (store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed').length;
  const f4 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f4.ok, false);
  assert.strictEqual(f4.code, 'FEED_LIMIT');
  assert.strictEqual(f4.message, '今天吃饱啦，明天再喂吧');
  assert.strictEqual(store[s.KEYS.children].find(c => c._id === childId).totalStars, starsBefore, '达限不应扣星');
  const petAfter = store[s.KEYS.pets].find(x => x.childId === childId && !x.released);
  assert.strictEqual(petAfter.growthValue, petBefore.growthValue, '达限不应加成长值');
  assert.strictEqual(petAfter.feedCount, 3);
  assert.strictEqual(petAfter.daily[D.ymd(new Date())].feed, 3, 'daily.feed 应停在 3');
  assert.strictEqual((store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed').length, logsBefore, '达限不应写流水');

  // 抚摸不受上限影响（免费互动，仅 feed 计数参与上限）
  const st = await local.petCRUD({ op: 'stroke', childId });
  assert.strictEqual(st.ok, true);
  assert.strictEqual(st.pet.todayFeedCount, 3);
  assert.strictEqual(st.pet.feedLimited, true);

  // 跨日重置：把 daily 换成昨天喂满 3 次 → 今天可继续喂（昨日计数保留）
  const yesterday = D.addDays(D.ymd(new Date()), -1);
  petAfter.daily = {};
  petAfter.daily[yesterday] = { feed: 3, stroke: 0 };
  store[s.KEYS.pets] = store[s.KEYS.pets];
  const f5 = await local.petCRUD({ op: 'feed', childId, parentToken: token });
  assert.strictEqual(f5.ok, true, '昨日喂满不应影响今天');
  assert.strictEqual(f5.pet.todayFeedCount, 1);
  assert.strictEqual(f5.pet.feedLimited, false);
  assert.strictEqual(f5.pet.stats.week.feed, 4);   // 昨天 3 + 今天 1
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
  assert.ok(P.SPECIES.filter(x => x.species === 'cat').some(x => x.key === i1.pet.species), '大宝应为猫品种');
  assert.strictEqual(i1.pet.name, '小灰');
  assert.strictEqual(i1.pet.strokeCount, 0);
  assert.ok(P.SPECIES.filter(x => x.species === 'dog').some(x => x.key === i2.pet.species), '二宝应为狗品种');
  assert.strictEqual(i2.pet.name, '旺财');
  assert.strictEqual(i2.pet.strokeCount, 1);

  // 未知 op
  assert.strictEqual((await local.petCRUD({ op: 'fly', childId, parentToken: token })).code, 'INVALID');
});

test('petCRUD: 老 key 兼容——species=cat/dog 与未知值读取时映射品种，不改写历史数据', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  await local.petCRUD({ op: 'adopt', childId, parentToken: token, payload: { species: 'dog', name: '旺财' } });

  // 把历史文档改回升级前口径 species='cat'（模拟老用户数据）
  const pets = store[s.KEYS.pets];
  pets[0].species = 'cat';
  store[s.KEYS.pets] = pets;

  const info = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info.pet.species, 'cat_lihua');   // 读取时映射为品种 key
  assert.strictEqual(info.pet.breedName, '狸花猫');
  assert.strictEqual(info.pet.emoji, '🐱');            // 两档制 emoji=物种 emoji（数据兼容字段，页面用品种图）
  // 历史数据不改写：库里仍是老 key
  assert.strictEqual(store[s.KEYS.pets][0].species, 'cat');

  // 未知 species 兜底物种默认品种（不炸、可渲染）
  pets[0].species = 'mutant';
  store[s.KEYS.pets] = pets;
  const info2 = await local.petCRUD({ op: 'info', childId });
  assert.strictEqual(info2.pet.species, 'cat_lihua');
  assert.strictEqual(info2.pet.breedName, '狸花猫');
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
  // growthPct / moodPct 映射已下沉 utils/pet-page.js（D4），故合并两文件做视图口径校验
  const js = fs.readFileSync(path.join(root, 'pet.js'), 'utf8') +
    fs.readFileSync(path.join(root, '..', '..', 'utils', 'pet-page.js'), 'utf8');

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

// 配饰零残留守卫（2026-09 两档制：破壳/成长/成年/传奇中间阶段与全部配饰废弃）+ 瓶内数字「描边提号」
test('宠物页：配饰零残留（wxml/wxss 无壳/翅/巾/冠/光环/奖章/腮红），瓶内数字 24rpx 白描边', () => {
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

  // ② 配饰零残留：类名与专属 keyframes（flutter/spinGlow/tw 仅为配饰服务，随配饰一起删）
  ['pet-shell', 'pet-wing', 'pet-scarf', 'pet-crown', 'pet-halo', 'pet-medal',
    'pet-cheek', 'pet-banner', 'flutter', 'spinGlow', 'flutter-l'].forEach(k => {
    assert.ok(wxml.indexOf(k) < 0, 'pet.wxml 残留配饰口径: ' + k);
    assert.ok(wxss.indexOf(k) < 0, 'pet.wxss 残留配饰口径: ' + k);
  });
  // 常驻动画类只剩两档：s1（幼崽轻晃）/ s2（成年摇摆）
  assert.ok(/\.pet\.s1 \{ animation: wob/.test(wxss), '幼崽待机动画丢失');
  assert.ok(/\.pet\.s2 \{ animation: sway/.test(wxss), '成年待机动画丢失');
  assert.ok(!/\.pet\.s3|\.pet\.s4|\.pet\.s5/.test(wxss), '中间阶段待机动画应随配饰一起删除');

  // ③ 瓶内数字「描边提号」：24rpx 深字 + 白描边（液面/玻璃白底双背景可读）
  const fnum = /\.flask \.fnum\s*\{([^}]*)\}/.exec(wxss);
  assert.ok(fnum, '缺少 .flask .fnum 样式');
  assert.ok(/font-size:\s*24rpx/.test(fnum[1]), '瓶内数字应提升到 24rpx 最小口径');
  assert.ok(!/color:\s*#fff/.test(fnum[1]), '瓶内数字不应再用纯白字（液面低于数字位时不可读）');
  assert.ok(/text-shadow:[^;]*#fff/.test(fnum[1]), '瓶内数字应有白描边');
});

// 全身图升级守卫（2026-09）：本体 image 化（模板不做运算）+ 领养选择卡物种二选一保留 + 随机品种说明
test('宠物页：本体为品种全身图 image 渲染，领养选择卡保留二选一并说明随机品种', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxss'), 'utf8');
  // 视图映射（petImg / petSrc* / petCls）已下沉 utils/pet-page.js（D4）；本测试合并页面与映射文件做视图口径校验
  const js = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.js'), 'utf8') +
    fs.readFileSync(path.join(root, 'utils', 'pet-page.js'), 'utf8');

  // ① 本体：两档制全阶段均为 image 渲染（主区绑 petSrc：互动时切动作差分图，kidbar 用默认 petImg），
  //    mode=aspectFit，且外层有 .pet-scale 阶段尺寸包裹层
  assert.ok(/<view class="pet-scale \{\{petCls\}\}">\s*\n\s*<image class="pet pet-img \{\{petCls\}\}" src="\{\{petSrc\}\}" mode="aspectFit" \/>/.test(wxml),
    '宠物本体未改为「pet-scale 包裹层 + petSrc 动作差分图」渲染（或属性口径漂移）');
  assert.ok(!/wx:if="\{\{pet\.stage === 1\}\}" class="pet/.test(wxml), 'stage1 蛋 emoji 本体分支应已删除');
  assert.ok(!/>🥚<\/text>\s*<image/.test(wxml), '本体不应再有蛋 emoji → image 的条件切换');
  // 两档制：wxml 不得残留中间阶段（3/4/5）分支
  assert.ok(!/pet\.stage === 3|pet\.stage === 4|pet\.stage === 5/.test(wxml), '中间阶段（3/4/5）分支应随两档制删除');
  // 阶段尺寸：成年 scale(1.15) 落在包裹层（不得直接落 .pet-img，会与本体的动画 transform 互覆盖）
  assert.ok(/\.pet-scale\.s2 \{ transform: scale\(1\.15\)/.test(wxss), '成年尺寸层 scale(1.15) 丢失');
  assert.ok(!/\.pet-img\.s1|\.pet-img\.s2/.test(wxss), 'scale 不得直接落在 .pet-img 上');
  assert.ok(/breedKey = pet \? P\.resolveSpeciesKey\(pet\.species\) : ''/.test(js),
    '品种 key 未经理 resolveSpeciesKey 兼容');
  // petSrc 口径：约定式路径生成（<key>_<form>[_happy|_eat].png），与 SPECIES imgBaby/imgAdult 同前缀；
  // petImg=默认图（kidbar 用，不跟随动作），petSrc/petSrcHappy/petSrcEat 全部 apply() 预计算（模板零运算）
  assert.ok(/petImg: breed \? \(pet\.stage >= 2 \? breed\.imgAdult : breed\.imgBaby\) : ''/.test(js),
    'petImg（默认图）未按 stage 预计算');
  assert.ok(/baseSrc = breed \? '\/images\/pets\/' \+ breedKey \+ '_' \+ form : ''/.test(js),
    'petSrc 未按约定式路径生成');
  assert.ok(/petSrc: breed \? baseSrc \+ '\.png' : ''/.test(js), 'petSrc（默认态本体图）丢失');
  assert.ok(/petSrcHappy: breed \? baseSrc \+ '_happy\.png' : ''/.test(js), 'petSrcHappy（抚摸动作图）丢失');
  assert.ok(/petSrcEat: breed \? baseSrc \+ '_eat\.png' : ''/.test(js), 'petSrcEat（吃食动作图）丢失');
  // petCls 两档为 s1/s2，不再有 egg 类
  assert.ok(/return 's' \+ \(pet \? pet\.stage : 1\);/.test(js), 'petClsOf 未统一为 s{stage}');
  assert.ok(!/egg/.test(js), 'pet.js 仍残留 egg 蛋形态口径');

  // ①b 顶卡头像：品种图圆形裁剪（不再用 pet.emoji 上屏）；未领养保持蛋占位
  assert.ok(/<image wx:if="\{\{pet\}\}" class="kid-ava-img" src="\{\{petImg\}\}" mode="aspectFill" \/>/.test(wxml),
    '顶卡头像未 image 化（应绑定 petImg 圆形裁剪）');
  assert.ok(!/pet\.emoji/.test(wxml), '顶卡头像不应再用 pet.emoji');
  assert.ok(/\.kid-ava-img\s*\{/.test(fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')), '全局 .kid-ava-img 圆形样式丢失');

  // ② 图片路径拼接不得泄漏到模板
  assert.ok(!/images\/pets/.test(wxml), '图片路径拼接泄漏到模板');

  // ③ 领养选择卡（主区页内）：物种二选一保留（emoji 卡片）+ 随机品种说明文案
  assert.ok(/wx:for="\{\{adoptOptions\}\}"/.test(wxml), '领养选择卡物种二选一丢失');
  assert.ok(/data-key="\{\{item.key\}\}" bindtap="pickSpecies">\{\{item.emoji\}\}/.test(wxml), '物种卡片应保留 emoji');
  assert.ok(/领养后随机获得 5 种品种之一/.test(wxml), '领养选择卡缺少随机品种说明');
  assert.ok(/adoptOptions: P\.SPECIES_GROUPS/.test(js), '领养选项应来自物种组口径（SPECIES_GROUPS）');

  // ④ adopt 入参只传物种组，品种随机由服务端完成；名字来自起名弹层输入（normalizePetName 兜底）
  assert.ok(/payload: \{ species: g\.key, name \}/.test(js), 'adopt 应只传物种组（cat/dog）');

  // ⑤ 顶卡展示品种名（如「狸花猫 · 成年」）
  assert.ok(/breedName \+ ' · ' \+ pet\.stageName/.test(wxml), '顶卡未展示品种名');
});

// 未领养态改版守卫（2026-09）：页内领养选择卡取代「🥚 + 框外领养按钮 + 领养弹层」
test('宠物页：未领养态为主区领养选择卡（二选一+随机文案），旧蛋入口与领养弹层下线', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.js'), 'utf8');

  // ① 主区分支：pet 为 null → adopt-card（物种二选一页内横排 + 随机品种说明）
  assert.ok(/wx:else class="adopt-card"/.test(wxml), '未领养态主区缺少 adopt-card 分支');
  assert.ok(/领养后随机获得 5 种品种之一，品种即花色，终身不变/.test(wxml), '选择卡缺少随机品种说明文案');

  // ② 旧入口下线：框外「🥚 领养」按钮与旧领养弹层（mask）均移除（showAdopt 不回归；
  //    onAdoptName 为新起名弹层的输入处理，属合法存在）
  assert.ok(!/adopt-btn/.test(wxml), '框外领养按钮未移除');
  assert.ok(!/showAdopt|openAdopt|closeAdopt/.test(wxml + js), '旧领养弹层开关/处理函数有残留');
  assert.ok(!/领养一只宠物<\/text>/.test(wxml), '旧弹层标题残留');

  // ③ 主区本体无蛋 emoji 分支（两档制：全阶段品种图，配饰零残留由专属守卫扫描）
  assert.ok(!/wx:if="\{\{pet\.stage === 1\}\}"/.test(wxml), 'stage1 蛋 emoji 本体分支不应回归');
  assert.ok(!/\{\{!pet \|\| pet\.stage === 1\}\}"/.test(wxml), '未领养态仍在渲染初始蛋（应随弹层一起下线）');

  // ④ 未领养时中间技能按钮仍隐藏（skills-empty 占位，HUD 两瓶常驻不回退）
  assert.ok(/class="skills-empty"/.test(wxml), '未领养占位 skills-empty 丢失');

  // ⑤ 弹层登记：showAdopt 不在 SHEET_KEYS（详见 tabbar.test.js）
  const tabbar = fs.readFileSync(path.join(root, 'utils', 'tabbar.js'), 'utf8');
  assert.ok(!/'showAdopt'/.test(tabbar), 'showAdopt 仍在 SHEET_KEYS 登记');
});

// 互动动画守卫（2026-09）：抚摸手 / 吃食 / 粒子（纯表现层，业务接口不动）
test('宠物页：互动动画类与 keyframes 齐备（A/B 相位），attempt 计数器驱动，吃食切 _eat 差分图', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.js'), 'utf8');

  // ① 抚摸：容器类 pet-stroking + 宠物「歪头享受」大幅摇摆 + CSS 自绘卡通小手（禁止 emoji 手）
  //    A/B 成对 keyframes（内容相同、名字不同）+ animPhase 交替挂载 ⇒ animation-name 变化即强制重播
  assert.ok(/\.pet-stroking\.a \.pet \{ animation: petStrokeShakeA[^}]*!important/.test(wxss), '抚摸摇摆 A 相丢失或缺 !important');
  assert.ok(/\.pet-stroking\.b \.pet \{ animation: petStrokeShakeB[^}]*!important/.test(wxss), '抚摸摇摆 B 相丢失或缺 !important');
  assert.ok(/@keyframes petStrokeShakeA\b/.test(wxss) && /@keyframes petStrokeShakeB\b/.test(wxss), 'keyframes petStrokeShake A/B 丢失');
  // 幅度显著化：-10°↔8° + 微缩（明显区别于待机 ±6° 摇晃）
  assert.ok(/rotate\(-10deg\)[^}]*scale\(\.98\)/.test(wxss), '抚摸摇摆幅度未显著化（应 -10°/8° + scale .98）');
  assert.ok(/wx:if="\{\{animType === 'stroke'\}\}" class="pet-hand \{\{animPhase\}\}"><\/view>/.test(wxml), '抚摸手节点应为空 view 且挂 phase 类（CSS 自绘）');
  assert.ok(/\.pet-hand\s*\{/.test(wxss), 'CSS 小手形状样式丢失');
  // 手在头顶上方（top 约 10%）左右往复 ±34rpx + rotate ±10deg，从上方降入/上浮退出
  const handCss = /\.pet-hand\s*\{([^}]*)\}/.exec(wxss);
  assert.ok(handCss && /top:\s*10%/.test(handCss[1]), '抚摸手应在头顶上方（top 10% 一线）');
  assert.ok(handCss && !/right:\s*-\d+rpx/.test(handCss[1]), '抚摸手不应再从右侧滑入');
  assert.ok(/translateY\(-130rpx\)/.test(wxss), '抚摸手应有从上方降入/上浮退出的轨迹');
  assert.ok(/translateX\(-34rpx\)[^}]*rotate\(-10deg\)/.test(wxss), '轻抚往复幅度应 ±34rpx + rotate ±10deg');
  assert.ok(!/pet-hand">[^<]/.test(wxml), '抚摸手不得用 emoji 文本渲染（应为空 view）');

  // ② 吃食：容器类 pet-eating + 埋头点头；主视觉 = petSrc 切 _eat 差分图（食盆已画进图，
  //    独立食盆叠加节点/样式/资产全部下线，避免重影）
  assert.ok(/\.pet-eating\.a \.pet \{ animation: petEatNodA[^}]*!important/.test(wxss), '吃食点头 A 相丢失或缺 !important');
  assert.ok(/\.pet-eating\.b \.pet \{ animation: petEatNodB[^}]*!important/.test(wxss), '吃食点头 B 相丢失或缺 !important');
  assert.ok(/@keyframes petEatNodA\b/.test(wxss) && /@keyframes petEatNodB\b/.test(wxss), 'keyframes petEatNod A/B 丢失');
  assert.ok(/rotate\(5deg\) translateY\(8rpx\)/.test(wxss), '点头幅度应 5deg/8rpx（埋头吃）');
  // pet-food 零残留：wxml 节点、wxss 类与 petFoodEat keyframes 全部移除
  ['pet-food', 'petFoodEat'].forEach(k => {
    assert.ok(wxml.indexOf(k) < 0, 'pet.wxml 残留食盆叠加口径: ' + k);
    assert.ok(wxss.indexOf(k) < 0, 'pet.wxss 残留食盆叠加口径: ' + k);
  });
  assert.ok(!/foodImg|FOOD_IMG/.test(wxml + js), '独立食盆图口径（foodImg/FOOD_IMG）应已删除');
  assert.ok(!/foodEmoji/.test(wxml + js), 'emoji 食物口径应已删除');

  // ③ 互动期间待机动画必须显式让位（!important 压 wob/sway），结束类被清自动恢复
  assert.ok(/\.pet-stroking\.a \.pet[^}]*!important/.test(wxss) && /\.pet-eating\.b \.pet[^}]*!important/.test(wxss),
    '互动动画未用 !important 显式压过待机 wob/sway');

  // ④ 粒子：上浮淡出动画 + 爱心/星星 CSS 自绘形状（外层动画层 + 内层形状层分离）
  assert.ok(/@keyframes fxFloat\b/.test(wxss), '粒子上浮动画丢失');
  assert.ok(/class="fx \{\{item\.kind\}\}"/.test(wxml), '粒子形状层未按 kind 区分');
  assert.ok(/\.fx-heart\s*\{/.test(wxss) && /\.fx-star\s*\{/.test(wxss), '爱心/星星形状样式丢失');
  assert.ok(/CF\.fxParticles\('heart', n, 3\)/.test(js) && /CF\.fxParticles\('star', n, 3\)/.test(js), '粒子应为 3 个（性能口径 ≤3）');

  // ⑤ 驱动机制（单次 setData，零时序依赖）：animType/animPhase 字段 + attempt 计数器 + 500ms 节流
  //    + A/B 相位交替 + setTimeout 兜底；旧 wx.nextTick 双段写法必须已删除（真机合并 setData 翻车根因）
  assert.ok(/animType: ''/.test(js) && /animPhase: ''/.test(js), 'data 缺 animType/animPhase 字段');
  assert.ok(/const n = this\.data\.animN \+ 1;/.test(js), 'attempt 计数器（animN 递增）丢失');
  assert.ok(/const phase = n % 2 \? 'b' : 'a';/.test(js), 'A/B 相位交替（animPhase）丢失');
  assert.ok(/setData\(\{ animType: type, animPhase: phase, animN: n, animFx: fx, petSrc, floatText \}\)/.test(js),
    '应单次 setData 触发动画（含 petSrc 动作图切换 + floatText 浮动数值）');
  // 动作差分图切换（主视觉）：stroke → _happy 图、feed → _eat 图；超时/离页恢复默认 petImg
  assert.ok(/const petSrc = type === 'stroke' \? this\.data\.petSrcHappy/.test(js), '抚摸应切换 _happy 动作图');
  assert.ok(/type === 'feed' \? this\.data\.petSrcEat : this\.data\.petImg/.test(js), '投喂应切换 _eat 动作图（兜底回默认图）');
  assert.ok(/petSrc: this\.data\.petImg, floatText: '' \}\);/.test(js), '动画超时应恢复默认 petSrc 并清 floatText（与清 class 同一次 setData）');
  assert.ok(!/wx\.nextTick/.test(js), 'wx.nextTick 双段卸载重挂写法应已删除（真机时序脆弱）');
  assert.ok(/< 500/.test(js), '500ms 快速重复点击节流丢失');
  assert.ok(/setTimeout\(/.test(js), '动画结束兜底（setTimeout 清 class）丢失');

  // ⑥ 业务接入点：投喂成功 → 'feed'，抚摸成功 → 'stroke'（互斥由 triggerAnim 内部保证）
  assert.ok(/this\.triggerAnim\('feed'\)/.test(js), '投喂成功回调未接入动画');
  assert.ok(/this\.triggerAnim\('stroke'\)/.test(js), '抚摸成功回调未接入动画');
});

// 领养起名弹层守卫（2026-09b，用户拍板保留起名环节）：主区点物种卡片 → showName 弹层起名 → 确认即领养
test('宠物页：领养起名弹层结构齐备（物种提示+input+确认传名），命名口径 normalizePetName', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.js'), 'utf8');
  const tabbar = fs.readFileSync(path.join(root, 'utils', 'tabbar.js'), 'utf8');

  // ① 弹层骨架：mask 点击关闭 + sheet 吞冒泡 + sheet-x 关闭按钮（沿用全站弹层规范）
  assert.ok(/wx:if="\{\{showName\}\}" class="mask" bindtap="closeName"/.test(wxml), '起名弹层 mask 口径异常');
  const nameStart = wxml.indexOf('wx:if="{{showName}}"');
  const nameEnd = wxml.indexOf('<!-- 改名弹层 -->', nameStart);
  assert.ok(nameStart > 0 && nameEnd > nameStart, '未定位到起名弹层区块');
  const nameBlock = wxml.slice(nameStart, nameEnd);
  assert.ok(/catchtap="noop"/.test(nameBlock), '起名弹层 sheet 未吞冒泡');
  assert.ok(/catchtap="closeName"/.test(nameBlock), '起名弹层缺少关闭按钮');

  // ② 已选物种提示（emoji 随选择联动）+ 随机品种说明文案
  assert.ok(/\{\{adoptSpeciesEmoji\}\} 给它起个名字/.test(nameBlock), '起名弹层缺少已选物种提示');
  assert.ok(/领养后随机获得 5 种品种之一，品种即花色，终身不变/.test(nameBlock), '起名弹层缺少随机品种说明');

  // ③ 起名输入框：绑定 adoptName / maxlength=nameMax，复用全局 .inp（显式 height:88rpx，见 app.wxss）
  assert.ok(/class="inp" value="\{\{adoptName\}\}" maxlength="\{\{nameMax\}\}"/.test(nameBlock), '起名 input 绑定口径异常');
  assert.ok(/bindinput="onAdoptName"/.test(nameBlock), '起名 input 未接 onAdoptName');
  const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
  assert.ok(/\.inp \{/.test(appWxss), '全局 .inp 样式丢失');
  assert.ok(/height:\s*88rpx/.test((/\.inp \{[^}]*\}/.exec(appWxss) || [''])[0]), '.inp 应保持显式 height:88rpx');

  // ④ 确认按钮 → doAdopt；名字从 data 取（非入参），经 normalizePetName 兜底（trim/空回默认名）+ 超长拦截
  assert.ok(/bindtap="doAdopt">带它回家/.test(nameBlock), '起名弹层确认按钮缺失');
  assert.ok(/P\.normalizePetName\(this\.data\.adoptName, g\.key\)/.test(js), '命名未走 normalizePetName 口径');
  assert.ok(/name\.length > P\.PET_NAME_MAX/.test(js), '超长名未在弹层侧拦截');
  assert.ok(/payload: \{ species: g\.key, name \}/.test(js), 'doAdopt 未携带输入的名字');

  // ⑤ 打开弹层：预填该物种默认名 + 记录物种 emoji（提示联动）
  assert.ok(/adoptName: g\.defName/.test(js), '打开起名弹层未预填物种默认名');
  assert.ok(/adoptSpeciesEmoji: g\.emoji/.test(js), '物种 emoji 提示未随选择联动');

  // ⑥ 旧 showModal 二次确认已省（起名弹层确认即领养，避免双重确认摩擦）
  assert.ok(!/wx\.showModal\(\{[\s\S]*?领养' \+ g\.defName/.test(js), '不应再叠加 showModal 二次确认');

  // ⑦ 弹层登记：showName 进 SHEET_KEYS（打开时 tabBar 自动隐藏，由 attachTabBarSync 派生）
  assert.ok(/'showName'/.test(tabbar), 'SHEET_KEYS 未登记 showName');
  // ⑧ 弹层打开隐藏 tabBar 的旧式显式调用不回归新代码（派生机制接管）
  assert.ok(!/openName\(\)[\s\S]{0,200}setTabBarHidden/.test(js), '起名弹层应走派生机制而非显式 setTabBarHidden');
});

// HUD 浮动数值守卫（2026-09）：互动反馈从 toast 改为瓶上方「+N 经验/+N 心情」上浮文字
test('宠物页：HUD 浮动数值结构齐备（floatText/两节点/floatUpA/B），普通互动不再弹 toast', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const wxml = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages', 'pet', 'pet.js'), 'utf8');

  // ① 数据与触发：floatText 与动画同一次 setData（单次写入原则），按常量拼接文案
  assert.ok(/floatText = type === 'feed' \? '\+' \+ P\.PET_GROWTH_PER_FEED \+ ' 经验'/.test(js),
    'feed 浮动数值未按 PET_GROWTH_PER_FEED 拼接「+N 经验」');
  assert.ok(/: type === 'stroke' \? '\+' \+ P\.MOOD_PER_STROKE \+ ' 心情'/.test(js),
    'stroke 浮动数值未按 MOOD_PER_STROKE 拼接「+N 心情」');
  assert.ok(/animFx: fx, petSrc, floatText \}/.test(js), 'floatText 应与动画同一次 setData 写入');
  assert.ok(/petSrc: this\.data\.petImg, floatText: '' \}\)/.test(js), '动画清理时应同步清 floatText');

  // ② 普通投喂/抚摸不弹 toast；升档（幼崽→成年）toast 保留
  assert.ok(!/投喂成功/.test(js), '普通投喂不应再弹「投喂成功」toast（改浮动数值）');
  assert.ok(!/宠物好开心/.test(js), '抚摸不应再弹「宠物好开心」toast（改浮动数值）');
  assert.ok(/长大啦！' \+ res\.pet\.name/.test(js), '升档 toast（长大啦）应保留');

  // ③ wxml 两浮动节点：wx:if 绑 animType、phase 类供 A/B 重播、文本绑 floatText
  assert.ok(/wx:if="\{\{animType === 'feed'\}\}" class="growth-float \{\{animPhase\}\}">\{\{floatText\}\}/.test(wxml),
    '成长瓶缺浮动数值节点（+N 经验）');
  assert.ok(/wx:if="\{\{animType === 'stroke'\}\}" class="mood-float \{\{animPhase\}\}">\{\{floatText\}\}/.test(wxml),
    '心情瓶缺浮动数值节点（+N 心情）');

  // ④ wxss：A/B 成对 keyframes + 相位挂载 + 色值走体系变量（零新增色值）+ 瓶容器 relative 锚点
  assert.ok(/@keyframes floatUpA\b/.test(wxss) && /@keyframes floatUpB\b/.test(wxss), 'keyframes floatUpA/B 丢失');
  assert.ok(/\.growth-float\.a, \.mood-float\.a \{ animation: floatUpA/.test(wxss), '浮动数值 A 相挂载丢失');
  assert.ok(/\.growth-float\.b, \.mood-float\.b \{ animation: floatUpB/.test(wxss), '浮动数值 B 相挂载丢失');
  assert.ok(/\.growth-float \{ color: var\(--star\)/.test(wxss) && /\.mood-float \{ color: var\(--coral\)/.test(wxss),
    '浮动数值色值应复用体系变量（--star 暖金 / --coral 珊瑚粉）');
  const flask = /\.flask \{([^}]*)\}/.exec(wxss);
  assert.ok(flask && /position:\s*relative/.test(flask[1]), '瓶容器缺 position:relative（浮动文字定位锚）');
});

// 每日投喂上限 + 心情衰减降速守卫（2026-09）：常量入双镜像 / FEED_LIMIT 双端 / 页面置灰与拦截 / 衰减每小时 -1
test('宠物页：投喂每日上限口径齐备（FEED_LIMIT 双端 / petView 透出 / 按钮置灰+本地拦截）', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  // apply 的视图映射已下沉 utils/pet-page.js（D4）：合并两文件校验 apply 透出字段
  const js = fs.readFileSync(path.join(root, 'miniprogram', 'pages', 'pet', 'pet.js'), 'utf8') +
    fs.readFileSync(path.join(root, 'miniprogram', 'utils', 'pet-page.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram', 'pages', 'pet', 'pet.wxml'), 'utf8');
  const localSrc = fs.readFileSync(path.join(root, 'miniprogram', 'services', 'local', 'pet.js'), 'utf8');
  const cloudSrc = fs.readFileSync(path.join(root, 'cloudfunctions', 'petCRUD', 'index.js'), 'utf8');
  const localPets = fs.readFileSync(path.join(root, 'miniprogram', 'utils', 'pets.js'), 'utf8');
  const cloudPets = fs.readFileSync(path.join(root, 'cloudfunctions', 'lib', 'pets.js'), 'utf8');

  // ① 常量入双镜像（勿散落魔法数字）；旧每分钟衰减常量应已删除
  assert.ok(/const PET_FEED_DAILY_LIMIT = 3;/.test(localPets) && /const PET_FEED_DAILY_LIMIT = 3;/.test(cloudPets),
    'PET_FEED_DAILY_LIMIT 常量应入双镜像');
  assert.ok(/const MOOD_DECAY_PER_HOUR = 1;/.test(localPets) && /const MOOD_DECAY_PER_HOUR = 1;/.test(cloudPets),
    'MOOD_DECAY_PER_HOUR 常量应入双镜像');
  assert.ok(!/MOOD_DECAY_PER_MIN/.test(localPets + cloudPets), '旧每分钟衰减常量 MOOD_DECAY_PER_MIN 应已删除');

  // ② 服务端 FEED_LIMIT（本地兜底 + 云函数同口径）：达限拒绝 / 检查先于扣星 / petView 透出
  [localSrc, cloudSrc].forEach((src, i) => {
    const tag = i === 0 ? '本地兜底层' : '云函数';
    assert.ok(src.indexOf("'FEED_LIMIT', '今天吃饱啦，明天再喂吧'") >= 0, tag + ' 缺少 FEED_LIMIT 拒绝');
    // C 收敛：达限判定改走 pets.js 单源 P.canFeed，禁止再内联 >= 比较（防本地/云端双份手写漂移）
    assert.ok(/!P\.canFeed\(pet, today\)/.test(src), tag + ' 达限判断应走 P.canFeed 单源');
    assert.ok(!/todayFeedCount >= P\.PET_FEED_DAILY_LIMIT/.test(src), tag + ' 不应再内联达限比较（应走 P.canFeed）');
    const fl = src.indexOf('FEED_LIMIT');
    const cost = src.indexOf('PET_FEED_COST)');
    assert.ok(fl > 0 && cost > fl, tag + ' FEED_LIMIT 检查应先于扣星（达限不扣星）');
    assert.ok(/todayFeedCount, feedLimited: !P\.canFeed\(pet, today\)/.test(src),
      tag + ' petView 未透出 todayFeedCount/feedLimited');
  });

  // ③ 页面：apply 透出 + 按钮置灰条件（canFeed && !feedLimited）+ feed() 达限本地拦截 toast
  assert.ok(/feedLimited: !!\(pet && pet\.feedLimited\)/.test(js), 'apply 未透出 feedLimited');
  assert.ok(/todayFeedCount: pet \? \(Number\(pet\.todayFeedCount\) \|\| 0\) : 0/.test(js), 'apply 未透出 todayFeedCount');
  assert.ok(/feedDailyLimit: P\.PET_FEED_DAILY_LIMIT/.test(js), '页面未透出上限常量');
  assert.ok(/class="skill \{\{\(canFeed && !feedLimited\) \? '' : 'disabled'\}\}"/.test(wxml),
    '投喂按钮置灰条件未叠加 feedLimited');
  assert.ok(/if \(this\.data\.feedLimited\) \{/.test(js), 'feed() 缺少达限本地拦截');
  assert.ok(/今天吃饱啦，明天再喂吧/.test(js), '达限 toast 文案缺失');
  // 升档 toast 不回退（上轮拍板保留）
  assert.ok(/长大啦！/.test(js), '升档 toast 不应回退');
});
