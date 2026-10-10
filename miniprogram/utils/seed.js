// utils/seed.js —— 新账号「开箱预置数据」（8 个任务 + 8 个奖励）· 本地兜底镜像
//
// 本文件是 cloudfunctions/lib/seed.js 的前端镜像，两份必须保持等价：
// __tests__/seed.test.js 会对两份实现注入相同入参并做深比较，防止双份漂移。
// 修改任一份时，请同步另一份并跑 npm test。

const DAILY = { enabled: true, type: 'day', interval: 1, weekdays: [] };

// 种子生效日期：固定 2026-01-01（用户指定，不再随建号日变化）
const SEED_START_DATE = '2026-01-01';

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
    date: SEED_START_DATE,              // 生效日期固定 2026-01-01（用户指定；o.date 入参保留向后兼容但不再使用）
    repeat: cloneDaily(),
    score: o.score,
    priority: o.priority,
    praise: o.praise || '',
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
    praise: o.praise || '',                   // 兑换后宠物说的正面反馈
    cost: o.cost,
    createdAt: o.now,
    deleted: false
  };
}

// 8 个任务：含风趣幽默的正面反馈（praise），打卡后宠物气泡即展示；星星合计 19
function seedTasks(o) {
  const base = { ownerId: o.ownerId, childId: o.childId, date: o.date, now: o.now };
  return [
    taskDoc(Object.assign({}, base, { title: '作业闪电侠', type: 'study', icon: '📝', score: 3, priority: 'high', praise: '这速度，作业以为自己被施了加速咒！' })),
    taskDoc(Object.assign({}, base, { title: '错题终结者', type: 'study', icon: '🎯', score: 2, priority: 'mid', praise: '错题被你一锅端，它们下次不敢来啦！' })),
    taskDoc(Object.assign({}, base, { title: '阅读小书虫', type: 'study', icon: '📖', score: 2, priority: 'mid', praise: '书页都被你翻出感情啦，故事说你最懂它！' })),
    taskDoc(Object.assign({}, base, { title: '早起小闹钟', type: 'life', icon: '⏰', score: 3, priority: 'high', praise: '今天的太阳，是被你叫醒的吧？' })),
    taskDoc(Object.assign({}, base, { title: '早睡小夜灯', type: 'life', icon: '🌙', score: 2, priority: 'mid', praise: '你一躺下，月亮都安心地打了个哈欠。' })),
    taskDoc(Object.assign({}, base, { title: '收纳魔法师', type: 'life', icon: '🧺', score: 2, priority: 'mid', praise: '东西各回各家，房间开心得直转圈圈！' })),
    taskDoc(Object.assign({}, base, { title: '运动健将', type: 'sport', icon: '🏃', score: 3, priority: 'high', praise: '年轻人，我见你骨骼清奇，今天又突破瓶颈了！' })),
    taskDoc(Object.assign({}, base, { title: '家务小搭档', type: 'growth', icon: '🧹', score: 2, priority: 'mid', praise: '有你搭把手，家务活儿都变轻快了！' }))
  ];
}

// 8 个奖励：6 条不限次（即时光/心理奖励）+ 2 条仅一次（攒星大奖），星星 6–60 星梯度定价
// 顺序由用户指定；图标均在 utils/icons.js 奖励候选集内
// 8 个奖励：兑换后宠物气泡即展示的正面反馈（praise）
function seedRewards(o) {
  const base = { ownerId: o.ownerId, childId: o.childId, now: o.now };
  return [
    rewardDoc(Object.assign({}, base, { title: '一支冰淇淋',     icon: '🍦', cost: 6,  resetAfterRedeem: true,  praise: '甜蜜补给到账，心情甜度爆表！' })),
    rewardDoc(Object.assign({}, base, { title: '今晚的动画片',   icon: '📱', cost: 10, resetAfterRedeem: true,  praise: '动画时间开启，尽情享受吧！' })),
    rewardDoc(Object.assign({}, base, { title: '亲子桌游一局',   icon: '🎲', cost: 12, resetAfterRedeem: true,  praise: '棋盘已就位，来一局巅峰对决！' })),
    rewardDoc(Object.assign({}, base, { title: '家庭电影夜',     icon: '🎬', cost: 18, resetAfterRedeem: true,  praise: '爆米花备好，电影之夜开始啦！' })),
    rewardDoc(Object.assign({}, base, { title: '心愿盲盒一次',   icon: '🎁', cost: 25, resetAfterRedeem: false, praise: '神秘惊喜已发货，拆盒请签收！' })),
    rewardDoc(Object.assign({}, base, { title: '全家出游一次',   icon: '🏖️', cost: 60, resetAfterRedeem: false, praise: '阳光和快乐已打包，出发！' })),
    rewardDoc(Object.assign({}, base, { title: '三明治拥抱',     icon: '🐻', cost: 5,  resetAfterRedeem: true,  praise: '一个超大号拥抱正在派送中！' })),
    rewardDoc(Object.assign({}, base, { title: '小鬼当家',       icon: '🎭', cost: 15, resetAfterRedeem: true,  praise: '今天你说了算，小主人！' }))
  ];
}

const SEED_TASK_COUNT = 8;
const SEED_REWARD_COUNT = 8;

module.exports = { DAILY, seedTasks, seedRewards, SEED_TASK_COUNT, SEED_REWARD_COUNT };
