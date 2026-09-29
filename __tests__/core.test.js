// __tests__/core.test.js —— 云函数纯逻辑单测（node:test，零依赖）
// 运行：node --test __tests__
const test = require('node:test');
const assert = require('node:assert');
const lib = require('../cloudfunctions/lib');

test('util: ymd / addDays 跨月跨年', () => {
  assert.strictEqual(lib.ymd(new Date(2026, 8, 17)), '2026-09-17');
  assert.strictEqual(lib.addDays('2026-09-17', -1), '2026-09-16');
  assert.strictEqual(lib.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(lib.addDays('2026-01-01', -1), '2025-12-31');
});

test('streakOf: 连续 / 中断 / 无', () => {
  const set = new Set(['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.strictEqual(lib.streakOf(set, '2026-09-17'), 3);
  assert.strictEqual(lib.streakOf(set, '2026-09-18'), 0);
  const broken = new Set(['2026-09-17', '2026-09-15']);
  assert.strictEqual(lib.streakOf(broken, '2026-09-17'), 1);
});

test('displayStreak: 补打卡场景由流水推导（2026-09-18 修复）', () => {
  // 用户真实场景：1–18 的打卡多为日历补录，14–18 连续 5 天；旧计数器只算出 3
  const set = new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  assert.strictEqual(lib.displayStreak(set, '2026-09-18'), 5);
  assert.strictEqual(lib.displayStreak(set, '2026-09-19'), 5);   // 今天还没打：昨天的连续延续显示
  assert.strictEqual(lib.displayStreak(set, '2026-09-20'), 0);   // 隔天未打：归零
  assert.strictEqual(lib.displayStreak(new Set(), '2026-09-18'), 0);
  assert.strictEqual(lib.displayStreak(['2026-09-10', '2026-09-11'], '2026-09-11'), 2); // 也接受数组
});

test('displayStreak 双份实现一致：云端 lib 与前端 domain 必须同口径', () => {
  const D = require('../miniprogram/utils/domain');
  const cases = [
    [new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']), '2026-09-18'],
    [new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']), '2026-09-19'],
    [new Set(['2026-09-17', '2026-09-15']), '2026-09-17'],
    [new Set(), '2026-09-18'],
    [['2026-09-10', '2026-09-11'], '2026-09-11']
  ];
  cases.forEach(([dates, today]) => {
    assert.strictEqual(
      lib.displayStreak(dates, today), D.displayStreak(dates, today),
      'displayStreak 双份实现不一致 @ ' + today
    );
  });
});

test('icons: 任务/奖励两套各 144 个（6 类 × 24）、分类正确、套内不重复、全部单码位、tab 齐全', () => {
  const { ICON_SETS } = require('../miniprogram/utils/icons');
  const want = {
    task: ['活动', '学习', '生活', '自然', '旅行', '物品'],
    reward: ['食物与饮品', '玩乐', '活动', '旅行', '物品', '装扮']
  };
  const singleCodepoint = (ic) => Array.from(ic.replace(/\uFE0F/g, '')).length === 1;
  Object.keys(want).forEach((kind) => {
    const groups = ICON_SETS[kind];
    assert.deepStrictEqual(groups.map(g => g.name), want[kind], kind + ' 的分类须为 ' + want[kind].join('/'));
    const all = [];
    groups.forEach((g) => {
      assert.strictEqual(g.icons.length, 24, kind + '/' + g.name + ' 应为 24 个');
      assert.ok(g.tabIcon && singleCodepoint(g.tabIcon), kind + '/' + g.name + ' 分类栏 tabIcon 须为单码位 emoji');
      all.push(...g.icons);
    });
    assert.strictEqual(all.length, 144, kind + ' 应为 144 个');
    assert.strictEqual(new Set(all).size, 144, kind + ' 套内图标不得重复');
    all.forEach((ic) => {
      assert.ok(!/[\u200D]/.test(ic), '不得含 ZWJ 组合: ' + ic);
      assert.strictEqual(Array.from(ic.replace(/\uFE0F/g, '')).length, 1, '应为单码位 emoji: ' + ic);
    });
  });
  // 开箱种子数据的图标必须仍在各自候选集内（否则编辑时不高亮、观感突兀）
  const seed = require('../miniprogram/utils/seed');
  const inSet = (kind, ic) => ICON_SETS[kind].some(g => g.icons.indexOf(ic) >= 0);
  seed.seedTasks({ ownerId: 'o', childId: 'c', date: '2026-09-18', now: 0 }).forEach(t => {
    assert.ok(inSet('task', t.icon), '种子任务图标不在任务候选集: ' + t.icon);
  });
  seed.seedRewards({ ownerId: 'o', childId: 'c', now: 0 }).forEach(r => {
    assert.ok(inSet('reward', r.icon), '种子奖励图标不在奖励候选集: ' + r.icon);
  });
});

test('feed: 归属日分组 / 相对时间 / 星星文案', () => {
  const F = require('../miniprogram/utils/feed');
  const today = '2026-09-18';
  // 分组标题
  assert.strictEqual(F.dayLabel('2026-09-18', today), '今天');
  assert.strictEqual(F.dayLabel('2026-09-17', today), '昨天');
  assert.strictEqual(F.dayLabel('2026-09-01', today), '9月1日');
  assert.strictEqual(F.dayLabel('2025-12-03', today), '2025年12月3日');
  assert.strictEqual(F.dayLabel('', today), '未知日期');
  // 星星文案
  assert.strictEqual(F.deltaText(3), '+3');
  assert.strictEqual(F.deltaText(-5), '-5');
  assert.strictEqual(F.deltaText(0), '0');
  assert.strictEqual(F.kindLabel('checkin'), '打卡');
  assert.strictEqual(F.kindLabel('redeem'), '兑换');
  // 相对时间
  const ts = new Date(2026, 8, 18, 14, 30).getTime();
  assert.strictEqual(F.clockText(ts), '14:30');
  assert.strictEqual(F.timeText(ts, today), '今天 14:30');
  assert.strictEqual(F.timeText(new Date(2026, 8, 17, 9, 5).getTime(), today), '昨天 09:05');
  assert.strictEqual(F.timeText(new Date(2026, 7, 3, 8, 0).getTime(), today), '8月3日 08:00');
  assert.strictEqual(F.timeText(0, today), '');
  // 补录识别（打卡归属日 ≠ 记录日）
  assert.strictEqual(F.isBackfill({ kind: 'checkin', date: '2026-09-01', createdAt: ts }), true);
  assert.strictEqual(F.isBackfill({ kind: 'checkin', date: '2026-09-18', createdAt: ts }), false);
  assert.strictEqual(F.isBackfill({ kind: 'redeem', date: null, createdAt: ts }), false);
  assert.strictEqual(F.isBackfill({ kind: 'checkin', date: null, createdAt: ts }), false);
  // 分组：按归属日聚合（兑换取记录日），组内保持传入顺序
  const items = [
    { id: 'a', kind: 'checkin', date: '2026-09-18', createdAt: ts, delta: 3 },
    { id: 'b', kind: 'redeem', date: null, createdAt: ts, delta: -2 },
    { id: 'c', kind: 'checkin', date: '2026-09-01', createdAt: ts, delta: 1 }
  ];
  const groups = F.groupByDay(items, today);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].label, '今天');
  assert.strictEqual(groups[0].items.length, 2);      // 打卡与兑换落在同一天
  assert.strictEqual(groups[0].items[0].deltaText, '+3');
  assert.strictEqual(groups[0].items[0].backfill, false);
  assert.strictEqual(groups[1].label, '9月1日');
  assert.strictEqual(groups[1].items[0].id, 'c');
  assert.strictEqual(groups[1].items[0].backfill, true);   // 归属日 9-01 ≠ 记录日 9-18
});

test('levelOf: 阈值 25/18/10/4/0', () => {
  assert.strictEqual(lib.levelOf(25), 5);
  assert.strictEqual(lib.levelOf(18), 4);
  assert.strictEqual(lib.levelOf(10), 3);
  assert.strictEqual(lib.levelOf(4), 2);
  assert.strictEqual(lib.levelOf(3), 1);
  assert.strictEqual(lib.levelOf(0), 1);
});

test('token: 签发 / 正常校验 / 篡改 / 过期 / openid 不符', () => {
  const t = lib.issueToken('openid-1', 300000, 'secret');
  assert.ok(t.token.indexOf('.') > 0);
  assert.ok(t.expireAt > Date.now());
  assert.strictEqual(lib.verifyToken(t.token, 'openid-1', 'secret'), true);
  assert.strictEqual(lib.verifyToken(t.token, 'other', 'secret'), false);
  assert.strictEqual(lib.verifyToken(t.token + 'x', 'openid-1', 'secret'), false);
  assert.strictEqual(lib.verifyToken(t.token, 'openid-1', 'wrong-secret'), false);
  assert.strictEqual(lib.verifyToken(t.token, 'openid-1', 'secret', t.expireAt + 1), false);
  assert.strictEqual(lib.verifyToken('', 'openid-1', 'secret'), false);
});

test('pin: 哈希 / 校验 / 6 位数字约束 / 默认 PIN 口径', () => {
  const h = lib.hashPin('123456', 'salt');
  assert.strictEqual(lib.verifyPin('123456', h, 'salt'), true);
  assert.strictEqual(lib.verifyPin('654321', h, 'salt'), false);
  assert.strictEqual(lib.isValidPin('123456'), true);
  assert.strictEqual(lib.isValidPin('12345'), false);     // 5 位不允许
  assert.strictEqual(lib.isValidPin('1234567'), false);   // 7 位不允许
  assert.strictEqual(lib.isValidPin('12345a'), false);    // 含非数字
  // 默认 PIN：常量、长度、派生哈希三者必须自洽
  assert.strictEqual(lib.DEFAULT_PIN, '123456');
  assert.strictEqual(lib.PIN_LENGTH, 6);
  assert.strictEqual(lib.isValidPin(lib.DEFAULT_PIN), true);
  assert.strictEqual(lib.verifyPin(lib.DEFAULT_PIN, lib.defaultPinHash('salt'), 'salt'), true);
});

test('dayAllDone: 日历对号依据——仅「当日所有可见任务都完成」为真（2026-09-18 新增）', () => {
  const T = require('../miniprogram/utils/tasks');
  const tasks = [
    { _id: 'a', date: '2026-09-01', repeat: { enabled: false }, deleted: false },
    { _id: 'b', date: '2026-09-01', repeat: { enabled: false }, deleted: false },
    { _id: 'c', date: '2026-10-01', repeat: { enabled: false }, deleted: false }  // 10月才生效
  ];
  const ci = [
    { taskId: 'a', date: '2026-09-17' },
    { taskId: 'b', date: '2026-09-17' }
  ];
  assert.strictEqual(T.dayAllDone(tasks, ci, '2026-09-17'), true);     // a、b 都打卡
  assert.strictEqual(T.dayAllDone(tasks, ci, '2026-09-18'), false);    // 当天 a、b 可见但没打 → 不对号
  assert.strictEqual(T.dayAllDone(tasks, [{ taskId: 'a', date: '2026-09-17' }], '2026-09-17'), false); // 只完成一半
  assert.strictEqual(T.dayAllDone(tasks, [], '2026-08-01'), false);    // 生效前无可见任务 → 不对号
  assert.strictEqual(T.dayAllDone(tasks, [], '2026-10-01'), false);    // 10-01 当天 a/b/c 都可打卡但都没打 → 不对号
  const all = [
    { taskId: 'a', date: '2026-10-01' },
    { taskId: 'b', date: '2026-10-01' },
    { taskId: 'c', date: '2026-10-01' }
  ];
  assert.strictEqual(T.dayAllDone(tasks, all, '2026-10-01'), true);    // 当日 a/b/c 全完成 → 对号
});

test('repeatLabel: 任务副标题的重复描述', () => {
  const T = require('../miniprogram/utils/tasks');
  assert.strictEqual(T.repeatLabel(null), '不限日期');
  assert.strictEqual(T.repeatLabel({ date: '2026-09-17', repeat: { enabled: false } }), '仅 2026-09-17');
  assert.strictEqual(T.repeatLabel({ repeat: { enabled: true, type: 'day', interval: 1 } }), '每日');
  assert.strictEqual(T.repeatLabel({ repeat: { enabled: true, type: 'day', interval: 3 } }), '每 3 天');
  assert.strictEqual(T.repeatLabel({ repeat: { enabled: true, type: 'week', weekdays: [1, 3, 5] } }), '每周一三五');
  assert.strictEqual(T.repeatLabel({ repeat: { enabled: true, type: 'week', weekdays: [] } }), '每周');
});

test('checkInCore: 首登 / 连续 / 隔日重置', () => {
  const first = lib.applyCheckIn({ totalStars: 0, streak: 0, lastCheckInDate: null }, 2, '2026-09-17');
  assert.strictEqual(first.totalStars, 2);
  assert.strictEqual(first.streak, 1);

  const consecutive = lib.applyCheckIn({ totalStars: 5, streak: 1, lastCheckInDate: '2026-09-16' }, 3, '2026-09-17');
  assert.strictEqual(consecutive.totalStars, 8);
  assert.strictEqual(consecutive.streak, 2);

  const gap = lib.applyCheckIn({ totalStars: 5, streak: 4, lastCheckInDate: '2026-09-10' }, 1, '2026-09-17');
  assert.strictEqual(gap.streak, 1);
});

test('redeemCore: 只扣星星 / 限次由「是否已兑换过」承担（无库存）', () => {
  // 只扣星星，不再产生任何库存字段
  const a = lib.applyRedeem({ totalStars: 10 }, { cost: 3, resetAfterRedeem: false });
  assert.strictEqual(a.totalStars, 7);
  assert.strictEqual(a.stock, undefined);

  const R = (cost, reset) => ({ cost, resetAfterRedeem: reset });
  // 可反复兑换：已兑换过也允许
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 10 }, R(3, true), true), null);
  // 仅一次：已兑换过 → 拒绝
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 10 }, R(3, false), true), 'ALREADY_REDEEMED');
  // 仅一次但还没兑换过 → 允许
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 10 }, R(3, false), false), null);
  // 星星不足 → 拒绝（无论限次与否）
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 2 }, R(3, true), false), 'INSUFFICIENT');
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 3 }, R(3, true), false), null);   // 刚好够
  // 奖励缺失 / cost 非法
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 10 }, null, false), 'REWARD_NOT_FOUND');
  assert.strictEqual(lib.redeemBlockReason({ totalStars: 10 }, R(0, true), false), 'INVALID');
});

test('visibility: 生效后每天可见 / 每N天 / 每周多选 / 生效前不可见', () => {
  // 未设重复 → 生效后「每天」都可见（2026-09-17 调整：原为仅生效当天，
  // 会导致任务只在创建当天能打卡、第二天就消失）
  const once = { date: '2026-09-17', repeat: { enabled: false } };
  assert.strictEqual(lib.taskVisibleOn(once, '2026-09-16'), false);   // 还没生效
  assert.strictEqual(lib.taskVisibleOn(once, '2026-09-17'), true);    // 生效当天
  assert.strictEqual(lib.taskVisibleOn(once, '2026-09-18'), true);    // 生效后持续可见
  assert.strictEqual(lib.taskVisibleOn(once, '2026-12-31'), true);    // 很久以后仍在

  // 每 N 天：从生效日起按间隔出现
  const daily = { date: '2026-09-15', repeat: { enabled: true, type: 'day', interval: 2, weekdays: [] } };
  assert.strictEqual(lib.taskVisibleOn(daily, '2026-09-15'), true);
  assert.strictEqual(lib.taskVisibleOn(daily, '2026-09-16'), false);
  assert.strictEqual(lib.taskVisibleOn(daily, '2026-09-17'), true);

  // 按周多选
  const weekly = { date: '2026-09-01', repeat: { enabled: true, type: 'week', interval: 1, weekdays: [4] } };
  assert.strictEqual(lib.taskVisibleOn(weekly, '2026-09-17'), true);  // 周四
  assert.strictEqual(lib.taskVisibleOn(weekly, '2026-09-18'), false); // 周五

  // 生效日期晚于所选日期 → 一律不可见（不论有没有重复规则）
  const future = { date: '2026-09-20', repeat: { enabled: true, type: 'day', interval: 1 } };
  assert.strictEqual(lib.taskVisibleOn(future, '2026-09-17'), false);
  const futureOnce = { date: '2026-09-20', repeat: { enabled: false } };
  assert.strictEqual(lib.taskVisibleOn(futureOnce, '2026-09-17'), false);

  // 已删除的任务永远不可见
  assert.strictEqual(lib.taskVisibleOn({ date: '2026-09-01', deleted: true }, '2026-09-17'), false);
});

test('visibility 双份实现一致：前端 utils/tasks 与云端 lib 必须同口径', () => {
  const T = require('../miniprogram/utils/tasks');
  const cases = [
    { date: '2026-09-17', repeat: { enabled: false } },
    { date: '2026-09-15', repeat: { enabled: true, type: 'day', interval: 2, weekdays: [] } },
    { date: '2026-09-01', repeat: { enabled: true, type: 'week', weekdays: [4] } },
    { date: '2026-09-20', repeat: { enabled: false } },
    { date: '2026-09-01', deleted: true }
  ];
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-12-31'];
  cases.forEach(task => {
    dates.forEach(d => {
      assert.strictEqual(
        T.taskVisibleOn(task, d), lib.taskVisibleOn(task, d),
        '双份实现不一致: ' + JSON.stringify(task) + ' @ ' + d
      );
    });
  });
});

test('isIdleExpired: 家长模式空闲 15 分钟自动关闭（R10 纯函数）', () => {
  const D = require('../miniprogram/utils/domain');
  const IDLE = 15 * 60 * 1000;
  // 无 lastActive（未进入家长模式 / 无交互记录）→ 不超时
  assert.strictEqual(D.isIdleExpired(0, Date.now(), IDLE), false);
  assert.strictEqual(D.isIdleExpired(undefined, Date.now(), IDLE), false);
  // 刚交互过 → 不超时
  const now = Date.now();
  assert.strictEqual(D.isIdleExpired(now, now, IDLE), false);
  assert.strictEqual(D.isIdleExpired(now - 14 * 60 * 1000, now, IDLE), false);
  // 恰好超过 15 分钟 → 超时
  assert.strictEqual(D.isIdleExpired(now - 16 * 60 * 1000, now, IDLE), true);
  // 边界：恰好等于 15 分钟 → 不算超过（严格大于）
  assert.strictEqual(D.isIdleExpired(now - 15 * 60 * 1000, now, IDLE), false);
});
