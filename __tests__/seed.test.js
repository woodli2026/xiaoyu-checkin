// __tests__/seed.test.js —— 开箱预置数据（8 任务 + 8 奖励）
// 重点：cloudfunctions/lib/seed.js 与 miniprogram/utils/seed.js 是两份实现，
//       本测试对二者注入相同入参并做深比较，防止「双份实现漂移」。
const test = require('node:test');
const assert = require('node:assert');

const libSeed = require('../cloudfunctions/lib/seed');
const feSeed = require('../miniprogram/utils/seed');
const D = require('../miniprogram/utils/domain');
const T = require('../miniprogram/utils/tasks');

const INPUT = { ownerId: 'u_1', childId: 'c_1', date: '2026-09-17', now: 1758114000000 };

test('seed 双份实现（云端 lib / 前端 utils）结构完全一致', () => {
  assert.deepStrictEqual(feSeed.seedTasks(INPUT), libSeed.seedTasks(INPUT));
  assert.deepStrictEqual(feSeed.seedRewards(INPUT), libSeed.seedRewards(INPUT));
  assert.deepStrictEqual(feSeed.DAILY, libSeed.DAILY);
  assert.strictEqual(feSeed.SEED_TASK_COUNT, libSeed.SEED_TASK_COUNT);
  assert.strictEqual(feSeed.SEED_REWARD_COUNT, libSeed.SEED_REWARD_COUNT);
});

test('seed 任务：8 条、生效日期固定 2026-01-01、每日重复、praise 齐备', () => {
  const tasks = libSeed.seedTasks(INPUT);
  assert.strictEqual(tasks.length, libSeed.SEED_TASK_COUNT);
  assert.strictEqual(tasks.length, 8);

  tasks.forEach(t => {
    assert.strictEqual(t.ownerId, INPUT.ownerId);
    assert.strictEqual(t.childId, INPUT.childId);
    assert.strictEqual(t.date, '2026-01-01'); // 生效日期不随建号日变化（用户指定）
    assert.strictEqual(t.createdAt, INPUT.now);
    assert.strictEqual(t.deleted, false);
    assert.ok(Number(t.score) >= 1);
    assert.ok(t.title && t.icon);
    assert.strictEqual(t.repeat.enabled, true);
    assert.strictEqual(t.repeat.type, 'day');
    assert.strictEqual(t.repeat.interval, 1);
    // praise 齐备：正面反馈是默认任务的核心卖点，不得为空且 ≤60 字（与编辑页 maxlength 同口径）
    assert.ok(t.praise && t.praise.length > 0 && t.praise.length <= 60, 'praise 应非空且 ≤60 字: ' + t.title);
    // 生效日当天可见
    assert.strictEqual(T.taskVisibleOn(t, '2026-01-01'), true);
    // 每日重复 → 次日仍可见
    assert.strictEqual(T.taskVisibleOn(t, '2026-01-02'), true);
    // 生效日之前不可见
    assert.strictEqual(T.taskVisibleOn(t, '2025-12-31'), false);
  });

  // 开箱八件套（顺序固定，用户指定：3 学习 / 3 生活 / 1 运动 / 1 成长）
  assert.deepStrictEqual(tasks.map(t => t.title),
    ['作业闪电侠', '错题终结者', '阅读小书虫', '早起小闹钟', '早睡小夜灯', '收纳魔法师', '运动健将', '家务小搭档']);
  assert.deepStrictEqual(tasks.map(t => t.priority), ['high', 'mid', 'mid', 'high', 'mid', 'mid', 'high', 'mid']);
  assert.strictEqual(tasks.reduce((n, t) => n + t.score, 0), 19); // 3+2+2+3+2+2+3+2
});

test('seed 任务：repeat 每次新建独立对象（修改一条不影响其它/不影响下次调用）', () => {
  const a = libSeed.seedTasks(INPUT);
  a[0].repeat.interval = 7;
  a[0].repeat.weekdays.push(1);
  assert.strictEqual(a[1].repeat.interval, 1);
  assert.strictEqual(a[1].repeat.weekdays.length, 0);

  const b = libSeed.seedTasks(INPUT);
  assert.strictEqual(b[0].repeat.interval, 1);
  assert.strictEqual(b[0].repeat.weekdays.length, 0);
  assert.notStrictEqual(a[0].repeat, b[0].repeat);
});

test('seed 奖励：8 条，覆盖「可反复兑换」（6）与「仅一次」（2）两种行为', () => {
  const rewards = libSeed.seedRewards(INPUT);
  assert.strictEqual(rewards.length, libSeed.SEED_REWARD_COUNT);
  assert.strictEqual(rewards.length, 8);

  // 开箱八奖励（顺序固定，用户指定：物质 6 + 心理 2）
  assert.deepStrictEqual(rewards.map(r => r.title),
    ['一支冰淇淋', '今晚的动画片', '亲子桌游一局', '家庭电影夜', '心愿盲盒一次', '全家出游一次', '三明治拥抱', '小鬼当家']);
  assert.strictEqual(rewards.filter(r => r.resetAfterRedeem === true).length, 6);
  assert.strictEqual(rewards.filter(r => r.resetAfterRedeem === false).length, 2);

  rewards.forEach(r => {
    assert.strictEqual(r.category, 'reward');
    assert.strictEqual(r.deleted, false);
    assert.ok(Number(r.cost) >= 1);
    assert.strictEqual(r.stock, undefined);      // 已不再有库存概念
    assert.strictEqual(r.baseStock, undefined);
    assert.strictEqual(r.createdAt, INPUT.now);
  });

  const unlimited = rewards.find(r => r.resetAfterRedeem === true);
  const once = rewards.find(r => r.resetAfterRedeem === false);
  assert.ok(unlimited, '需有 1 条可反复兑换的奖励');
  assert.ok(once, '需有 1 条仅一次的奖励');

  const child = { totalStars: 100 };
  // 兑换只扣星星
  assert.strictEqual(D.applyRedeem(child, unlimited).totalStars, 100 - unlimited.cost);
  assert.strictEqual(D.applyRedeem(child, once).totalStars, 100 - once.cost);
  // 可反复兑换：即便已兑换过也放行
  assert.strictEqual(D.redeemBlockReason(child, unlimited, true), null);
  // 仅一次：已兑换过则拒绝，没兑换过则放行
  assert.strictEqual(D.redeemBlockReason(child, once, true), 'ALREADY_REDEEMED');
  assert.strictEqual(D.redeemBlockReason(child, once, false), null);
});
