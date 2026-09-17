// cloudfunctions/lib/seed.js —— 新账号「开箱预置数据」（3 个任务 + 2 个奖励）
//
// 【设计说明 / 对 PRD 的偏离 #7】
// PRD 未规定初始任务与奖励（原实现为新账号空列表，需家长手建后才能打卡验收）。
// 经确认改为：新账号首次建号时预置一组可直接打卡/兑换的数据，做到「导入即验收」。
// 云端（本文件）与本地兜底（miniprogram/utils/seed.js）必须保持一致 ——
// __tests__/seed.test.js 对两份实现做结构一致性校验，防止双份实现漂移。
//
// 纯函数：不依赖 wx-server-sdk / 数据库 / 时间，仅接收 ownerId / childId / date / now。

// 每日重复规则（任务每天都需要打卡）
const DAILY = { enabled: true, type: 'day', interval: 1, weekdays: [] };

function cloneDaily() {
  return { enabled: DAILY.enabled, type: DAILY.type, interval: DAILY.interval, weekdays: [] };
}

function taskDoc(o) {
  return {
    ownerId: o.ownerId,
    childId: o.childId,
    title: o.title,
    type: o.type,
    icon: o.icon,
    date: o.date,                       // 起始日 = 建号当日，配合每日重复即当天可见
    repeat: cloneDaily(),
    score: o.score,
    priority: o.priority,
    createdAt: o.now,
    deleted: false
  };
}

function rewardDoc(o) {
  return {
    ownerId: o.ownerId,
    childId: o.childId,
    title: o.title,
    icon: o.icon,
    category: 'reward',                 // 均为「奖励」类（惩罚类留给家长自建）
    resetAfterRedeem: !!o.resetAfterRedeem,  // true=可反复兑换；false=每位孩子仅一次
    cost: o.cost,
    createdAt: o.now,
    deleted: false
  };
}

// 3 个任务：覆盖 高/中/低 三档优先级与 1/2/3 星，便于验收星星累加与旗子展示
function seedTasks(o) {
  const base = { ownerId: o.ownerId, childId: o.childId, date: o.date, now: o.now };
  return [
    taskDoc(Object.assign({}, base, { title: '完成作业', type: 'habit', icon: '✏️', score: 3, priority: 'high' })),
    taskDoc(Object.assign({}, base, { title: '课外阅读 30 分钟', type: 'habit', icon: '📚', score: 2, priority: 'mid' })),
    taskDoc(Object.assign({}, base, { title: '户外运动', type: 'habit', icon: '🏃', score: 2, priority: 'low' }))
  ];
}

// 2 个奖励：覆盖「可反复兑换」与「每位孩子仅一次」两种行为（已无库存概念）
function seedRewards(o) {
  const base = { ownerId: o.ownerId, childId: o.childId, now: o.now };
  return [
    rewardDoc(Object.assign({}, base, { title: '自由玩耍 20 分钟', icon: '🎈', cost: 8, resetAfterRedeem: true })),
    rewardDoc(Object.assign({}, base, { title: '买一本新书', icon: '📚', cost: 30, resetAfterRedeem: false }))
  ];
}

const SEED_TASK_COUNT = 3;
const SEED_REWARD_COUNT = 2;

module.exports = { DAILY, seedTasks, seedRewards, SEED_TASK_COUNT, SEED_REWARD_COUNT };
