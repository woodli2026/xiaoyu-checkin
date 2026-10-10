// @ts-check
// utils/pet-page.js —— 宠物页 data 映射（无 wx / 无 IO，可单测）
const P = require('./pets');

/**
 * 由 stage 派生 CSS 阶段类（无宠物 → s1）
 * @param {any} pet
 * @returns {string}
 */
function petClsOf(pet) {
  return 's' + (pet ? pet.stage : 1);
}

/**
 * 由 {totalStars, pet} 生成页面 setData 字段（视图契约，集中于此勿散落到页面）。
 * 字段口径与 cloudfunctions/petCRUD 的 petView 对齐，页面只做透传。
 * @param {number} totalStars
 * @param {any} pet petView 输出或 null
 * @returns {Record<string, any>}
 */
function pagePetData(totalStars, pet) {
  const stats = (pet && pet.stats) || {};
  const week = stats.week || { feed: 0, stroke: 0 };
  const max = Math.max(week.feed, week.stroke, 1);
  const breedKey = pet ? P.resolveSpeciesKey(pet.species) : '';
  const breed = breedKey ? P.speciesOf(breedKey) : null;
  const form = pet && pet.stage >= 2 ? 'adult' : 'baby';
  const baseSrc = breed ? '/images/pets/' + breedKey + '_' + form : '';
  return {
    totalStars,
    pet,
    petCls: petClsOf(pet),
    petImg: breed ? (pet.stage >= 2 ? breed.imgAdult : breed.imgBaby) : '',
    petSrc: breed ? baseSrc + '.png' : '',
    petSrcHappy: breed ? baseSrc + '_happy.png' : '',
    petSrcEat: breed ? baseSrc + '_eat.png' : '',
    breedName: pet ? (pet.breedName || (breed ? breed.name : '')) : '',
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
  };
}

module.exports = { petClsOf, pagePetData };
