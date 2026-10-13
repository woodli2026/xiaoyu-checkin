// __tests__/ownership-guard.test.js
//
// 归属语义守卫（候选②，2026-10-10）。
//
// 背景：cloud.js#getOwnedChild 末尾的 `|| r.data[0]` 把两重语义塞进了同一个函数：
//   A·归属校验 —— 「这个 childId 是我的吗」→ 不属于必须拒绝（回退是错的）
//   B·默认选中 —— 「没指定就给我第一个宝宝」→ 回退是设计意图
// 结果：checkIn/redeem 用 A 的语义却拿到 B 的行为 → 越权；
//       taskCRUD/rewardCRUD 的 FORBIDDEN 分支因回退永远不可达 → 可改删他人资源。
//
// 修法：把「从 children 列表里选哪个孩子」抽成纯函数（lib/ownership.js），
//       cloud.js 只负责取数据、不再夹带决策。纯函数不依赖 wx-server-sdk，可直接测。
//
// 本文件是「接口即测试面」的实践：归属判定这个安全关键决策，测试与调用方走同一条缝。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, read, strip } = require('./helpers/js-source');
const OWN = require('../cloudfunctions/lib/ownership');

const C1 = { _id: 'c1', ownerId: 'u1', name: '大宝' };
const C2 = { _id: 'c2', ownerId: 'u1', name: '二宝' };
const MINE = [C1, C2];

// ---------- A·归属校验：严格，绝不回退 ----------

test('pickOwned：childId 属于自己 → 返回该 child', () => {
  assert.strictEqual(OWN.pickOwned(MINE, 'c2'), C2);
});

test('pickOwned：childId 不属于自己 → null（严禁回退第一个）', () => {
  // 这是本次修复的核心：旧实现会返回 c1，导致越权
  assert.strictEqual(OWN.pickOwned(MINE, 'someone-elses-child'), null);
});

test('pickOwned：childId 为空 → null', () => {
  assert.strictEqual(OWN.pickOwned(MINE, ''), null);
  assert.strictEqual(OWN.pickOwned(MINE, null), null);
  assert.strictEqual(OWN.pickOwned(MINE, undefined), null);
});

test('pickOwned：列表为空 → null', () => {
  assert.strictEqual(OWN.pickOwned([], 'c1'), null);
});

// ---------- B·默认选中：允许回退第一个 ----------

test('pickCurrent：childId 属于自己 → 返回该 child', () => {
  assert.strictEqual(OWN.pickCurrent(MINE, 'c2'), C2);
});

test('pickCurrent：childId 缺失或不匹配 → 回退第一个（看板默认宝宝语义）', () => {
  assert.strictEqual(OWN.pickCurrent(MINE, 'someone-elses-child'), C1);
  assert.strictEqual(OWN.pickCurrent(MINE, ''), C1);
});

test('pickCurrent：列表为空 → null', () => {
  assert.strictEqual(OWN.pickCurrent([], 'c1'), null);
});

// ---------- 资源归属：task/reward 必须属于该孩子 ----------

test('isOwnedResource：doc.childId 在授权列表内 → true', () => {
  assert.strictEqual(OWN.isOwnedResource({ childId: 'c1' }, ['c1', 'c2']), true);
});

test('isOwnedResource：doc.childId 不在授权列表 → false', () => {
  assert.strictEqual(OWN.isOwnedResource({ childId: 'others' }, ['c1', 'c2']), false);
});

test('isOwnedResource：doc 缺失或没有 childId → false', () => {
  assert.strictEqual(OWN.isOwnedResource(null, ['c1']), false);
  assert.strictEqual(OWN.isOwnedResource({}, ['c1']), false);
});

// ---------- 静态守卫：归属决策不得在别处重写 ----------

test('静态守卫：cloud.js 的归属实现不得再出现「回退第一个孩子」', () => {
  const src = strip(read('cloudfunctions/lib/cloud.js'));
  // 覆盖各种回退写法：|| r.data[0] / || list[0] / || children[0] ...
  assert.ok(!/\|\|\s*[A-Za-z_$][\w$.]*\[0\]/.test(src),
    'cloud.js 仍存在「找不到就回退第一个孩子」的写法——归属校验必须走 ownership.pickOwned');
});

test('静态守卫：13 个云函数不得自写归属实现（必须走 runtime 原语）', () => {
  const dir = path.join(ROOT, 'cloudfunctions');
  const fns = fs.readdirSync(dir).filter((n) => {
    if (n === 'lib' || n === 'setup.js') return false;
    return fs.existsSync(path.join(dir, n, 'index.js'));
  });
  const offenders = fns.filter((n) => {
    const src = strip(read('cloudfunctions/' + n + '/index.js'));
    return /function\s+ownedChild/.test(src);
  });
  assert.deepStrictEqual(offenders, [],
    '以下云函数自写了 ownedChild，归属语义必须统一走 lib/runtime.js: ' + offenders.join(', '));
});

test('静态守卫：runtime.js 必须同时导出严格与默认选中两个原语', () => {
  const src = read('cloudfunctions/lib/runtime.js');
  assert.ok(/ownedChild/.test(src), 'runtime.js 应导出 ownedChild（严格）');
  assert.ok(/currentChild/.test(src), 'runtime.js 应导出 currentChild（默认选中）');
});

// 防回归：光有正确的原语不够，调用点不能退回「直取文档」绕过归属校验
test('静态守卫：checkIn / redeem 必须走 runtime 归属原语，不得直取 task / reward 文档', () => {
  const ci = strip(read('cloudfunctions/checkIn/index.js'));
  assert.ok(/ownedTask\(/.test(ci), 'checkIn 必须走 runtime.ownedTask（否则可用他人 taskId 打卡）');
  assert.ok(!/collection\('tasks'\)\s*\.doc\(/.test(ci), 'checkIn 不得绕过归属校验直取 tasks 文档');

  const rd = strip(read('cloudfunctions/redeem/index.js'));
  assert.ok(/ownedReward\(/.test(rd), 'redeem 必须走 runtime.ownedReward（否则可兑换他人奖励）');
  assert.ok(!/collection\('rewards'\)\s*\.doc\(/.test(rd), 'redeem 不得绕过归属校验直取 rewards 文档');
});

test('静态守卫：taskCRUD / rewardCRUD 的改删必须走归属原语（FORBIDDEN 分支曾因回退不可达）', () => {
  const tc = strip(read('cloudfunctions/taskCRUD/index.js'));
  assert.ok(/ownedTask\(/.test(tc), 'taskCRUD 改删必须走 runtime.ownedTask');
  const rc = strip(read('cloudfunctions/rewardCRUD/index.js'));
  assert.ok(/ownedReward\(/.test(rc), 'rewardCRUD 改删必须走 runtime.ownedReward');
});

// 候选③顺带：软删一律内存过滤，不得用 deleted:false 谓词（缺该字段的文档会静默消失）
test('静态守卫：云端查询不得用 deleted:false 作为数据库谓词', () => {
  const dir = path.join(ROOT, 'cloudfunctions');
  const fns = fs.readdirSync(dir).filter((n) => {
    if (n === 'lib' || n === 'setup.js') return false;
    return fs.existsSync(path.join(dir, n, 'index.js'));
  });
  const offenders = fns.filter((n) => {
    const src = strip(read('cloudfunctions/' + n + '/index.js'));
    // 只匹配「查询谓词」里的 deleted:false（where({...}) 内）；
    // create 时写入文档字段的 deleted:false 是合法的，不算违规
    return /\.where\(\s*\{[^}]*deleted\s*:\s*false/.test(src);
  });
  assert.deepStrictEqual(offenders, [],
    '以下云函数用 deleted:false 作查询谓词，缺该字段的文档会被静默过滤：' + offenders.join(', '));
});
