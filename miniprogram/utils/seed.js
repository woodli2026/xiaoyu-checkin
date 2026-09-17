// utils/seed.js —— 新账号「开箱预置数据」（3 个任务 + 2 个奖励）· 本地兜底镜像
//
// 本文件是 cloudfunctions/lib/seed.js 的前端镜像，两份必须保持等价：
// __tests__/seed.test.js 会对两份实现注入相同入参并做深比较，防止双份漂移。
// 修改任一份时，请同步另一份并跑 npm test。

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
    date: o.date,
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
    category: 'reward',
    resetAfterRedeem: !!o.resetAfterRedeem,  // true=可反复兑换；false=每位孩子仅一次
    cost: o.cost,
    createdAt: o.now,
    deleted: false
  };
}

function seedTasks(o) {
  const base = { ownerId: o.ownerId, childId: o.childId, date: o.date, now: o.now };
  return [
    taskDoc(Object.assign({}, base, { title: '完成作业', type: 'habit', icon: '✏️', score: 3, priority: 'high' })),
    taskDoc(Object.assign({}, base, { title: '课外阅读 30 分钟', type: 'habit', icon: '📚', score: 2, priority: 'mid' })),
    taskDoc(Object.assign({}, base, { title: '户外运动', type: 'habit', icon: '🏃', score: 2, priority: 'low' }))
  ];
}

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
