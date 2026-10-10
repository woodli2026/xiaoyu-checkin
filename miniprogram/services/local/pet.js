// services/local/pet.js —— 本地兜底层：宠物（D3 拆分）
const { s, ok, fail, currentUser, allChildren, saveChildren, allPets, savePets, allPoints, savePoints, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');
const P = require('../../utils/pets');

// ============ 宠物（第二阶段：宠物 tab）============

// 宠物 per-child：每个宝宝同时最多 1 只（放生后旧档案软删保留，可重新领养）
// 口径要点（与云函数 petCRUD 契约一致）：
//   ① stage 由 growthValue 派生，不入库（防漂移）；
//   ② mood 按真实时间衰减：读取前用 applyMoodDecay 重算，仅在互动（写）时落库；
//   ③ 投喂消耗星星 → 需家长令牌，并写一条 refType='pet_feed' 的积分流水；
//   ④ 抚摸免费 → 免家长令牌（孩子也能玩），不扣星星、不写流水；
//   ⑤ 统计（连续互动/累计投喂·抚摸/近 7 天）由 pet 内的 feedCount/strokeCount/daily 现算。
//   ⑥ 投喂每日上限 PET_FEED_DAILY_LIMIT 次/天（判定走 pets.js 单源 P.canFeed），达限返回 FEED_LIMIT 不扣星。
function findPet(childId) {
  return (allPets() || []).find(p => p.childId === childId && !p.released) || null;
}

function petView(pet, today) {
  if (!pet) return null;
  // 老 key 兼容：读取时映射为品种 key（不改写历史数据），未入库品种回落物种默认
  const breedKey = P.resolveSpeciesKey(pet.species);
  const info = P.stageInfo(pet.growthValue, breedKey);
  const breed = P.speciesOf(breedKey);
  // 每日投喂上限：今日已喂次数与是否达限（口径下沉 pets.js 单源 P.feedCountToday/P.canFeed，与云端 petView 共用）
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

// op: info(只读·免令牌) / adopt / feed / stroke(免令牌) / rename / reset / release
async function petCRUD({ op, childId, parentToken, payload }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const today = D.ymd(new Date());
  const children = allChildren();
  const child = children.find(c => c._id === childId && c.ownerId === user._id && !c.deleted);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
  const p = payload || {};

  if (op === 'info') {
    return ok({ pet: petView(findPet(childId), today) });
  }

  if (op === 'adopt') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    if (findPet(childId)) return fail('ALREADY_HAS_PET', '该宝宝已经有一只宠物啦');
    // 品种即花色（2026-09 升级）：入参为物种组（'cat'|'dog'），品种在物种内随机 5 选 1 后入库
    const group = String(p.species || 'cat');
    if (!P.isValidSpeciesGroup(group)) return fail('INVALID', '不支持的宠物种类');
    const species = P.randomBreedKey(group);
    // 名称：不传 → 用品种默认名；传了就必须非空且 ≤8 字
    let name;
    if (p.name == null) {
      name = P.normalizePetName('', species);
    } else {
      const v = String(p.name).trim();
      if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
      name = v;
    }
    const now = Date.now();
    const pet = {
      _id: s.nextId('pt'), ownerId: user._id, childId,
      species, name,
      growthValue: 0, feedCount: 0, strokeCount: 0,
      mood: P.MOOD_INIT, lastMoodAt: now,
      daily: {}, createdAt: now, released: false
    };
    const pets = allPets();
    pets.push(pet);
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'feed') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    // 每日投喂上限：当日有效投喂达上限即拒绝（不扣星、不加成长值）；判定走 P.canFeed 单源
    if (!P.canFeed(pet, today)) {
      return fail('FEED_LIMIT', '今天吃饱啦，明天再喂吧');
    }
    if ((child.totalStars || 0) < P.PET_FEED_COST) return fail('INSUFFICIENT', '星星不够啦');
    const now = Date.now();
    child.totalStars = (child.totalStars || 0) - P.PET_FEED_COST;
    saveChildren(children);
    pet.mood = P.moodAfterFeed(pet.mood, pet.lastMoodAt, now);
    pet.growthValue = (Number(pet.growthValue) || 0) + P.PET_GROWTH_PER_FEED;
    pet.feedCount = (Number(pet.feedCount) || 0) + 1;
    pet.daily = P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'feed'), today);
    pet.lastMoodAt = now;
    savePets(pets);
    const pts = allPoints();
    pts.push({
      _id: s.nextId('p'), childId, delta: -P.PET_FEED_COST,
      reason: '投喂:' + pet.name, refType: 'pet_feed', refId: pet._id, createdAt: now
    });
    savePoints(pts);
    return ok({ pet: petView(pet, today), totalStars: child.totalStars });
  }

  if (op === 'stroke') {
    // 免费互动：免家长令牌，孩子也能摸（不扣星星 / 不写流水）
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    pet.mood = P.moodAfterStroke(pet.mood, pet.lastMoodAt, now);
    pet.strokeCount = (Number(pet.strokeCount) || 0) + 1;
    pet.daily = P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'stroke'), today);
    pet.lastMoodAt = now;
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'rename') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const v = String(p.name == null ? '' : p.name).trim();
    if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
    pet.name = v;
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'reset') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    pet.growthValue = 0;
    pet.feedCount = 0;
    pet.strokeCount = 0;
    pet.mood = P.MOOD_INIT;
    pet.lastMoodAt = now;
    pet.daily = {};
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'release') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    pet.released = true;              // 软删：成长历史保留，可重新领养一只新的
    pet.releasedAt = Date.now();
    savePets(pets);
    return ok({ id: pet._id });
  }

  return fail('INVALID', '未知操作');
}

module.exports = { petCRUD, petView, findPet };
