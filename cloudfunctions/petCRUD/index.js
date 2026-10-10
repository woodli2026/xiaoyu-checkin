// cloudfunctions/petCRUD —— 宠物（第二阶段：宠物 tab）
//
// 宠物 per-child：每个宝宝同时最多 1 只（放生后旧档案软删保留，可重新领养）
//   op=info    —— 只读、免令牌；返回宠物视图（含派生阶段 / 衰减后心情 / 互动统计）
//   op=adopt   —— 领养（需家长令牌）；每宝宝仅 1 只，重复领养 ALREADY_HAS_PET
//   op=feed    —— 投喂（需家长令牌）：-5 星星 / +10 成长 / +8 心情 / 写 pet_feed 流水；每日上限 PET_FEED_DAILY_LIMIT 次
//   op=stroke  —— 抚摸（免令牌，孩子也能玩）：免费，+6 心情，不扣星星、不写流水
//   op=rename  —— 改名（需家长令牌）：非空且 ≤8 字
//   op=reset   —— 重置（需家长令牌）：成长/心情/计数清零，保留名字与物种
//   op=release —— 放生（需家长令牌）：软删 released:true，可重新领养
//
// 口径要点（与 miniprogram/services/local.js 的 petCRUD 逐条对齐，由单测守卫）：
//   ① stage 由 growthValue 派生，不入库（防漂移）；
//   ② mood 按真实时间衰减：读取前 applyMoodDecay 重算，仅在互动（写）时落库；
//   ③ 投喂消耗星星 → 需家长令牌 + 一条 refType='pet_feed' 的积分流水。
const { cloud, db, ok, fail } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { resolveCaller, assertToken } = require('./lib/runtime');
const P = require('./lib/pets');

function petView(pet, today) {
  if (!pet) return null;
  // 老 key 兼容：读取时映射为品种 key（不改写历史数据），未入库品种回落物种默认
  const breedKey = P.resolveSpeciesKey(pet.species);
  const info = P.stageInfo(pet.growthValue, breedKey);
  const breed = P.speciesOf(breedKey);
  // 每日投喂上限：今日已喂次数与是否达限（口径下沉 pets.js 单源 P.feedCountToday/P.canFeed，与本地兜底层共用）
  const todayFeedCount = P.feedCountToday(pet, today);
  return {
    _id: pet._id, childId: pet.childId, species: breedKey,
    breedName: breed ? breed.name : '', name: pet.name,
    growthValue: info.growthValue, growthPct: info.growthPct,
    // 成长瓶：按「到下一阶段」的阶段内进度填充（每投喂一次液面可见上升）；满级为满瓶
    stageHave: info.stageHave, stageNeed: info.stageNeed, stagePct: info.stagePct,
    stage: info.stage, stageName: info.name,
    emoji: info.emoji, speciesEmoji: info.speciesEmoji, nextStageAt: info.nextStageAt,
    mood: P.applyMoodDecay(pet.mood, pet.lastMoodAt, Date.now()), moodMax: P.MOOD_MAX,
    feedCount: Number(pet.feedCount) || 0, strokeCount: Number(pet.strokeCount) || 0,
    todayFeedCount, feedLimited: !P.canFeed(pet, today),
    adoptedAt: pet.createdAt || 0,
    stats: P.computePetStats(pet, today)
  };
}

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID, user } = r;

  const today = ymd(new Date());
  const pets = db.collection('pets');
  const children = db.collection('children');

  // 严格归属校验：不属于该用户的宝宝一律 FORBIDDEN（不做回退）
  const cdoc = event.childId ? await children.doc(event.childId).get().catch(() => null) : null;
  const child = cdoc && cdoc.data;
  if (!child || child.ownerId !== user._id || child.deleted) return fail('FORBIDDEN', '无权访问该宝宝档案');

  // 内存过滤 released：老档案可能没有该字段，where released:false 不匹配缺字段文档
  async function findPet() {
    const r = await pets.where({ childId: child._id }).limit(50).get();
    return r.data.filter(p => !p.released)[0] || null;
  }

  const p = event.payload || {};

  if (event.op === 'info') {
    return ok({ pet: petView(await findPet(), today) });
  }

  if (event.op === 'adopt') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    if (await findPet()) return fail('ALREADY_HAS_PET', '该宝宝已经有一只宠物啦');
    // 品种即花色（2026-09 升级）：入参为物种组（'cat'|'dog'），品种在物种内随机 5 选 1 后入库
    const group = String(p.species || 'cat');
    if (!P.isValidSpeciesGroup(group)) return fail('INVALID', '不支持的宠物种类');
    const species = P.randomBreedKey(group);
    let name;
    if (p.name == null) {
      name = P.normalizePetName('', species);
    } else {
      const v = String(p.name).trim();
      if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
      name = v;
    }
    const now = Date.now();
    const doc = {
      ownerId: user._id, childId: child._id, species, name,
      growthValue: 0, feedCount: 0, strokeCount: 0,
      mood: P.MOOD_INIT, lastMoodAt: now,
      daily: {}, createdAt: now, released: false
    };
    const add = await pets.add({ data: doc });
    return ok({ pet: petView(Object.assign({ _id: add._id }, doc), today) });
  }

  if (event.op === 'feed') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const pet = await findPet();
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    // 每日投喂上限：当日有效投喂达上限即拒绝（不扣星、不加成长值、不写流水）；判定走 P.canFeed 单源
    if (!P.canFeed(pet, today)) {
      return fail('FEED_LIMIT', '今天吃饱啦，明天再喂吧');
    }
    if ((child.totalStars || 0) < P.PET_FEED_COST) return fail('INSUFFICIENT', '星星不够啦');

    const now = Date.now();
    const totalStars = (child.totalStars || 0) - P.PET_FEED_COST;
    const patch = {
      mood: P.moodAfterFeed(pet.mood, pet.lastMoodAt, now),
      growthValue: (Number(pet.growthValue) || 0) + P.PET_GROWTH_PER_FEED,
      feedCount: (Number(pet.feedCount) || 0) + 1,
      daily: P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'feed'), today),
      lastMoodAt: now
    };
    await db.runTransaction(async (t) => {
      await t.collection('children').doc(child._id).update({ data: { totalStars } });
      await t.collection('pets').doc(pet._id).update({ data: patch });
      await t.collection('pointsLog').add({
        data: {
          ownerId: user._id, childId: child._id, delta: -P.PET_FEED_COST,
          reason: '投喂:' + pet.name, refType: 'pet_feed', refId: pet._id, createdAt: now
        }
      });
    });
    return ok({ pet: petView(Object.assign({}, pet, patch), today), totalStars });
  }

  if (event.op === 'stroke') {
    // 免费互动：免家长令牌，孩子也能摸（不扣星星 / 不写流水）
    const pet = await findPet();
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    const patch = {
      mood: P.moodAfterStroke(pet.mood, pet.lastMoodAt, now),
      strokeCount: (Number(pet.strokeCount) || 0) + 1,
      daily: P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'stroke'), today),
      lastMoodAt: now
    };
    await pets.doc(pet._id).update({ data: patch });
    return ok({ pet: petView(Object.assign({}, pet, patch), today) });
  }

  if (event.op === 'rename') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const pet = await findPet();
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const v = String(p.name == null ? '' : p.name).trim();
    if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
    await pets.doc(pet._id).update({ data: { name: v } });
    return ok({ pet: petView(Object.assign({}, pet, { name: v }), today) });
  }

  if (event.op === 'reset') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const pet = await findPet();
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    const patch = {
      growthValue: 0, feedCount: 0, strokeCount: 0,
      mood: P.MOOD_INIT, lastMoodAt: now, daily: {}
    };
    await pets.doc(pet._id).update({ data: patch });
    return ok({ pet: petView(Object.assign({}, pet, patch), today) });
  }

  if (event.op === 'release') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const pet = await findPet();
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    // 软删：成长历史保留，可重新领养一只新的
    await pets.doc(pet._id).update({ data: { released: true, releasedAt: Date.now() } });
    return ok({ id: pet._id });
  }

  return fail('INVALID', '未知操作');
};
