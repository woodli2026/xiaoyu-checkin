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
