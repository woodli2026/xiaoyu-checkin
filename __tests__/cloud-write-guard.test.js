// __tests__/cloud-write-guard.test.js
//
// 云端「写路径」双端对拍守卫（架构复盘遗留项：写路径零守卫）。
//
// 【问题】此前所有 guard 里的 db 桩都让 doc().update()/remove() 返回 `Promise.resolve({})`，
// 即**空操作**。因此云端写操作（建/改/删任务奖励、打卡、兑换…）的落库结果从未被验证过——
// 写没写、写对没写对，测试一律全绿。而 CLOUD_ENV 一开启，这些就是生产路径。
//
// 【做法】用 helpers/cloud-db.js 提供的**会真写**的内存库，对每个写操作做双端对拍：
//   初态用本地 API 构造 → 快照 → 本地跑一遍（oracle）→ 云端从同一初态跑一遍
//   → 断言「返回体」与「全部集合末态」双端一致。
// 本地层有完整单测（local.test/pet.test/v108），故**本地是 oracle**；
// 对拍同时验证「云端写路径可用」与「双端不漂移」。
//
// 规范化：_id / createdAt / ownerId 属易变或单端字段，比较前剔除（两端生成方式不同）。
//
// 串行：所有用例共享 global.wx store 与内存库，故包进单个父测试顺序执行。
'use strict';
const test = require('node:test');
const assert = require('node:assert');

// —— 必须在 require 任何云函数之前：拦截 wx-server-sdk + 提供令牌密钥 ——
process.env.XY_TOKEN_SECRET = process.env.XY_TOKEN_SECRET || 'write-guard-test-secret';
const { createHarness, installWxServerSdk } = require('./helpers/cloud-db');

const H = createHarness();
installWxServerSdk(H);

// —— 本地层 wx.storage mock（共享助手，单一来源） ——
const { store } = require('./helpers/wx-storage').installWxStorageMock();

const storage = require('../miniprogram/utils/storage');
const local = require('../miniprogram/services/local');

// —— 云端函数（真实 require；其 ./lib/* 用真实副本，wx-server-sdk 已被拦截） ——
const cloudToken = require('../cloudfunctions/lib/token');
const cloudTask = require('../cloudfunctions/taskCRUD');
const cloudReward = require('../cloudfunctions/rewardCRUD');
const cloudCheckIn = require('../cloudfunctions/checkIn');
const cloudRedeem = require('../cloudfunctions/redeem');
const cloudFeed = require('../cloudfunctions/feedCRUD');
const cloudPet = require('../cloudfunctions/petCRUD');
const P = require('../cloudfunctions/lib/pets');   // 宠物数值单一来源（断言引用常量，避免硬编码漂移）

const K = storage.KEYS;
const MAP = [
  ['children', K.children], ['tasks', K.tasks], ['rewards', K.rewards],
  ['checkIns', K.checkIns], ['redemptions', K.redemptions],
  ['pets', K.pets], ['pointsLog', K.pointsLog]
];

// ---------- 快照 / 规范化 ----------
function localSnapshot() {
  const out = { users: store[K.user] ? [JSON.parse(JSON.stringify(store[K.user]))] : [] };
  for (const [name, key] of MAP) out[name] = JSON.parse(JSON.stringify(store[key] || []));
  return out;
}
function cloudSnapshot() {
  const out = { users: H.rows('users') };
  for (const [name] of MAP) out[name] = H.rows(name);
  return out;
}
function restoreCloud(pre) {
  H.reset();
  if (pre.users[0]) H.setOpenid(pre.users[0].openid);
  H.seed('users', pre.users);
  for (const [name] of MAP) H.seed(name, pre[name]);
}

// 易变/单端字段：两端生成方式不同或含时间戳，比较前剔除。
// 规则：_id（生成主键）、ownerId（本地部分写入不含）、任何以 At 结尾的时间戳（createdAt/lastMoodAt/...）。
const isVolatileKey = (k) => k === '_id' || k === 'ownerId' || /At$/.test(k);
function byJson(a, b) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function clean(v) {
  if (Array.isArray(v)) return v.map(clean).sort(byJson);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!isVolatileKey(k)) o[k] = clean(v[k]);
    return o;
  }
  return v;
}

function assertResEqual(lRes, cRes, label) {
  assert.strictEqual(!!lRes.ok, !!cRes.ok,
    label + '：ok 标志双端不一致\n  本地=' + JSON.stringify(lRes) + '\n  云端=' + JSON.stringify(cRes));
  assert.deepStrictEqual(clean(lRes), clean(cRes), label + '：返回体双端不一致');
}
function assertStateEqual(lState, cState, label) {
  for (const name of Object.keys(lState)) {
    assert.deepStrictEqual(clean(lState[name]), clean(cState[name]),
      label + '：' + name + ' 集合末态双端不一致');
  }
}

// ---------- 双端执行器 ----------
async function runBoth(setup, op) {
  await local.resetAll();
  await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const user = store[K.user];
  const ctx = { token, openid: user.openid, childId: (store[K.children] || [])[0]._id };
  if (setup) await setup(ctx);

  const pre = localSnapshot();

  const lRes = await op.local(ctx);
  const lState = localSnapshot();

  restoreCloud(pre);
  const cCtx = Object.assign({}, ctx, { token: cloudToken.issueToken(ctx.openid, 3600 * 1000).token });
  const cRes = await op.cloud(cCtx);
  const cState = cloudSnapshot();

  return { ctx, lRes, cRes, lState, cState };
}

const run = async (setup, op, label) => {
  const r = await runBoth(setup, op);
  assertResEqual(r.lRes, r.cRes, label);
  assertStateEqual(r.lState, r.cState, label);
  return r;
};

// 造一个任务的本地 API 快捷
const mkTask = (ctx, payload) =>
  local.taskCRUD({ op: 'create', parentToken: ctx.token, payload: Object.assign({ childId: ctx.childId }, payload) });
const mkReward = (ctx, payload) =>
  local.rewardCRUD({ op: 'create', parentToken: ctx.token, payload: Object.assign({ childId: ctx.childId }, payload) });

// ============================================================================
test('云端写路径双端对拍（本地=oracle）', async (t) => {
  await t.test('taskCRUD create：新建任务落库且返回体一致', async () => {
    await run(null, {
      local: (ctx) => local.taskCRUD({ op: 'create', parentToken: ctx.token, payload: { childId: ctx.childId, title: '背单词', icon: '📚', score: 3, praise: '棒', priority: 'high' } }),
      cloud: (ctx) => cloudTask.main({ op: 'create', parentToken: ctx.token, payload: { childId: ctx.childId, title: '背单词', icon: '📚', score: 3, praise: '棒', priority: 'high' } })
    }, 'taskCRUD create');
  });

  await t.test('taskCRUD update：补丁字段落库且返回体一致', async () => {
    let id;
    const setup = async (ctx) => { id = (await mkTask(ctx, { title: '原名', score: 2 })).task._id; };
    await run(setup, {
      local: (ctx) => local.taskCRUD({ op: 'update', parentToken: ctx.token, payload: { id, title: '改名', score: 5, praise: '赞' } }),
      cloud: (ctx) => cloudTask.main({ op: 'update', parentToken: ctx.token, payload: { id, title: '改名', score: 5, praise: '赞' } })
    }, 'taskCRUD update');
  });

  await t.test('taskCRUD delete：软删落库且返回体一致', async () => {
    let id;
    const setup = async (ctx) => { id = (await mkTask(ctx, { title: '待删', score: 1 })).task._id; };
    await run(setup, {
      local: (ctx) => local.taskCRUD({ op: 'delete', parentToken: ctx.token, payload: { id } }),
      cloud: (ctx) => cloudTask.main({ op: 'delete', parentToken: ctx.token, payload: { id } })
    }, 'taskCRUD delete');
  });

  await t.test('rewardCRUD create/update/delete：落库与返回体一致', async () => {
    let id;
    const setup = async (ctx) => { id = (await mkReward(ctx, { title: '冰淇淋', cost: 2 })).reward._id; };
    await run(setup, {
      local: (ctx) => local.rewardCRUD({ op: 'update', parentToken: ctx.token, payload: { id, title: '大冰淇淋', cost: 4 } }),
      cloud: (ctx) => cloudReward.main({ op: 'update', parentToken: ctx.token, payload: { id, title: '大冰淇淋', cost: 4 } })
    }, 'rewardCRUD update');
    await run(null, {
      local: (ctx) => local.rewardCRUD({ op: 'create', parentToken: ctx.token, payload: { childId: ctx.childId, title: '贴纸', cost: 1, resetAfterRedeem: false } }),
      cloud: (ctx) => cloudReward.main({ op: 'create', parentToken: ctx.token, payload: { childId: ctx.childId, title: '贴纸', cost: 1, resetAfterRedeem: false } })
    }, 'rewardCRUD create');
    await run(setup, {
      local: (ctx) => local.rewardCRUD({ op: 'delete', parentToken: ctx.token, payload: { id } }),
      cloud: (ctx) => cloudReward.main({ op: 'delete', parentToken: ctx.token, payload: { id } })
    }, 'rewardCRUD delete');
  });

  await t.test('checkIn 打卡：星星/流水/明细落库且返回体一致', async () => {
    let id;
    const setup = async (ctx) => { id = (await mkTask(ctx, { title: '晨读', score: 4 })).task._id; };
    const r = await run(setup, {
      local: (ctx) => local.checkIn({ childId: ctx.childId, taskId: id, parentToken: ctx.token }),
      cloud: (ctx) => cloudCheckIn.main({ childId: ctx.childId, taskId: id, parentToken: ctx.token })
    }, 'checkIn');
    // 额外：断言落库的星星确实变了（防止「两端都写 0」这类同向漂移）
    const lChild = r.lState.children[0];
    assert.strictEqual(lChild.totalStars, 4, '打卡后孩子星星应为 4');
    assert.strictEqual(r.lState.checkIns.length, 1, '应落 1 条打卡明细');
    assert.strictEqual(r.lState.pointsLog.length, 1, '应落 1 条积分流水');
  });

  await t.test('redeem 兑换：扣星/兑换记录/流水落库且返回体一致', async () => {
    // 初态：任务 5 星 → 打卡得 5 星 → 兑换 2 星奖励
    let rid;
    const setup = async (ctx) => {
      const tk = (await mkTask(ctx, { title: '劳动', score: 5 })).task._id;
      rid = (await mkReward(ctx, { title: '看动画', cost: 2, resetAfterRedeem: false })).reward._id;
      await local.checkIn({ childId: ctx.childId, taskId: tk, parentToken: ctx.token });
    };
    const r = await run(setup, {
      local: (ctx) => local.redeem({ childId: ctx.childId, rewardId: rid, parentToken: ctx.token }),
      cloud: (ctx) => cloudRedeem.main({ childId: ctx.childId, rewardId: rid, parentToken: ctx.token })
    }, 'redeem');
    assert.strictEqual(r.lState.children[0].totalStars, 3, '兑换 2 星后应为 3（5-2）');
    assert.strictEqual(r.lState.redemptions.length, 1, '应落 1 条兑换记录');
  });

  // ---------- 宠物（领养含随机品种，故从「已领养」出发对拍互动类写操作） ----------
  const withPet = async (ctx) => {
    const tk = (await mkTask(ctx, { title: '攒星', score: 20 })).task._id;
    await local.checkIn({ childId: ctx.childId, taskId: tk, parentToken: ctx.token });
    await local.petCRUD({ op: 'adopt', childId: ctx.childId, parentToken: ctx.token, payload: { species: 'cat' } });
  };

  await t.test('petCRUD adopt（不变式）：云端确实落库（品种随机，只验不变式）', async () => {
    await local.resetAll();
    await local.login({});
    const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
    const ctx = { token, openid: store[K.user].openid, childId: (store[K.children] || [])[0]._id };
    restoreCloud(localSnapshot());
    const cToken = cloudToken.issueToken(ctx.openid, 3600 * 1000).token;
    const res = await cloudPet.main({ op: 'adopt', parentToken: cToken, childId: ctx.childId, payload: { species: 'cat' } });
    assert.strictEqual(res.ok, true, '云端领养应成功：' + JSON.stringify(res));
    const pets = H.rows('pets');
    assert.strictEqual(pets.length, 1, '云端应落 1 只宠物');
    assert.strictEqual(pets[0].childId, ctx.childId);
    assert.strictEqual(pets[0].growthValue, 0);
    assert.strictEqual(pets[0].released, false);
    assert.ok(pets[0].name, '领养后应有名字');
  });

  await t.test('petCRUD feed：扣星 / +成长 / 写流水 落库且返回体一致', async () => {
    const r = await run(withPet, {
      local: (ctx) => local.petCRUD({ op: 'feed', childId: ctx.childId, parentToken: ctx.token }),
      cloud: (ctx) => cloudPet.main({ op: 'feed', childId: ctx.childId, parentToken: ctx.token })
    }, 'petCRUD feed');
    assert.strictEqual(r.lState.children[0].totalStars, 20 - P.PET_FEED_COST, '投喂应扣除 PET_FEED_COST 星');
    assert.strictEqual(r.lState.pets[0].growthValue, P.PET_GROWTH_PER_FEED, '成长应 +PET_GROWTH_PER_FEED');
    assert.strictEqual(r.lState.pets[0].feedCount, 1, '投喂计数应 +1');
    assert.strictEqual(r.lState.pointsLog.length, 2, '打卡流水 + 投喂流水 = 2 条');
  });

  await t.test('petCRUD stroke：免令牌 / 不扣星 / 不写流水', async () => {
    const r = await run(withPet, {
      local: (ctx) => local.petCRUD({ op: 'stroke', childId: ctx.childId }),
      cloud: (ctx) => cloudPet.main({ op: 'stroke', childId: ctx.childId })
    }, 'petCRUD stroke');
    assert.strictEqual(r.lState.children[0].totalStars, 20, '抚摸不扣星');
    assert.strictEqual(r.lState.pets[0].strokeCount, 1, '抚摸计数应 +1');
    assert.strictEqual(r.lState.pointsLog.length, 1, '抚摸不写流水（仅打卡那 1 条）');
  });

  await t.test('petCRUD rename / reset / release：落库且返回体一致', async () => {
    await run(withPet, {
      local: (ctx) => local.petCRUD({ op: 'rename', childId: ctx.childId, parentToken: ctx.token, payload: { name: '小白' } }),
      cloud: (ctx) => cloudPet.main({ op: 'rename', childId: ctx.childId, parentToken: ctx.token, payload: { name: '小白' } })
    }, 'petCRUD rename');
    const rReset = await run(withPet, {
      local: (ctx) => local.petCRUD({ op: 'reset', childId: ctx.childId, parentToken: ctx.token }),
      cloud: (ctx) => cloudPet.main({ op: 'reset', childId: ctx.childId, parentToken: ctx.token })
    }, 'petCRUD reset');
    assert.strictEqual(rReset.lState.pets[0].growthValue, 0, '重置后成长归零');
    const rRel = await run(withPet, {
      local: (ctx) => local.petCRUD({ op: 'release', childId: ctx.childId, parentToken: ctx.token }),
      cloud: (ctx) => cloudPet.main({ op: 'release', childId: ctx.childId, parentToken: ctx.token })
    }, 'petCRUD release');
    assert.strictEqual(rRel.lState.pets[0].released, true, '放生应软删 released=true');
  });

  // ---------- 动态撤销（真实 remove） ----------
  await t.test('feedCRUD undoCheckIn：扣回星星并删除明细', async () => {
    let ciId;
    const setup = async (ctx) => {
      const tk = (await mkTask(ctx, { title: '晨跑', score: 3 })).task._id;
      await local.checkIn({ childId: ctx.childId, taskId: tk, parentToken: ctx.token });
      ciId = (store[K.checkIns] || [])[0]._id;
    };
    const r = await run(setup, {
      local: (ctx) => local.feedCRUD({ op: 'undoCheckIn', id: ciId, parentToken: ctx.token }),
      cloud: (ctx) => cloudFeed.main({ op: 'undoCheckIn', id: ciId, parentToken: ctx.token })
    }, 'feedCRUD undoCheckIn');
    assert.strictEqual(r.lState.checkIns.length, 0, '撤销后打卡明细应清空');
    assert.strictEqual(r.lState.children[0].totalStars, 0, '撤销后星星应扣回 0');
  });

  await t.test('feedCRUD undoRedeem：返还星星并删除兑换记录', async () => {
    let rdId;
    const setup = async (ctx) => {
      const tk = (await mkTask(ctx, { title: '劳动', score: 5 })).task._id;
      const rw = (await mkReward(ctx, { title: '看动画', cost: 2, resetAfterRedeem: false })).reward._id;
      await local.checkIn({ childId: ctx.childId, taskId: tk, parentToken: ctx.token });
      await local.redeem({ childId: ctx.childId, rewardId: rw, parentToken: ctx.token });
      rdId = (store[K.redemptions] || [])[0]._id;
    };
    const r = await run(setup, {
      local: (ctx) => local.feedCRUD({ op: 'undoRedeem', id: rdId, parentToken: ctx.token }),
      cloud: (ctx) => cloudFeed.main({ op: 'undoRedeem', id: rdId, parentToken: ctx.token })
    }, 'feedCRUD undoRedeem');
    assert.strictEqual(r.lState.redemptions.length, 0, '取消兑换后记录应删除');
    assert.strictEqual(r.lState.children[0].totalStars, 5, '返还 2 星 → 3+2=5');
  });
});
