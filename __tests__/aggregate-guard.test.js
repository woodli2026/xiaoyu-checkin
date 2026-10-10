// __tests__/aggregate-guard.test.js
// E 守卫：看板(buildDashboard) 与 动态(buildFeed) 两份业务聚合的「双份镜像」防漂移。
//
// 背景：这两处聚合原先在「云端 index.js ↔ 本地 services/local.js」各手写一遍，无守卫，
// 只改一端测试全绿却线上漂移。E 把它们抽成纯函数（云端 cloudfunctions/lib/*、本地 miniprogram/utils/*），
// 本测试同时焊死两条缝：
//   ① 纯函数双份镜像对称：同一入参下 local.buildX deepStrictEqual cloud.buildX（契约锁）。
//   ② 端到端一致：feedCRUD op=list 本地↔云端输出完全一致（含条目顺序/形状/分页）。
//
// 零运行时风险：纯新增测试文件，不改动被测代码。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ---------- mock：wx-server-sdk + 内存 db（额外支持 _.in，供 feedCRUD 跨宝宝聚合） ----------
const collections = {};
let CURRENT_OPENID = 'init';
let seq = 0;
const genId = (p) => p + '_' + (++seq);

const command = {
  in: (arr) => ({ $in: arr })
};

function makeQuery(arr) {
  let data = arr.slice();
  const api = {
    where(filter) {
      if (filter) {
        data = data.filter(d => Object.keys(filter).every(k => {
          const fv = filter[k];
          if (fv && typeof fv === 'object' && '$in' in fv) return fv.$in.indexOf(d[k]) >= 0;
          return d[k] === fv;
        }));
      }
      return api;
    },
    orderBy(field, dir) {
      data.sort((a, b) => (dir === 'desc' ? (b[field] - a[field]) : (a[field] - b[field])));
      return api;
    },
    limit(n) { data = data.slice(0, n); return api; },
    get() { return Promise.resolve({ data }); }
  };
  return api;
}

const dbMock = {
  command,
  collection(name) {
    if (!collections[name]) collections[name] = [];
    const arr = collections[name];
    return {
      where(f) { return makeQuery(arr).where(f); },
      orderBy(f, d) { return makeQuery(arr).orderBy(f, d); },
      limit(n) { return makeQuery(arr).limit(n); },
      get() { return makeQuery(arr).get(); },
      add({ data }) {
        const doc = Object.assign({ _id: genId(name[0]) }, data);
        arr.push(doc);
        return Promise.resolve({ _id: doc._id });
      },
      doc(id) {
        const found = arr.find(d => d._id === id);
        return {
          get() { return Promise.resolve({ data: found || null }); },
          update() { return Promise.resolve({}); },
          remove() { return Promise.resolve({}); }
        };
      }
    };
  }
};

const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  database() { return dbMock; },
  getWXContext() { return { OPENID: CURRENT_OPENID }; }
};

// 拦截 require('wx-server-sdk')（必须在 require 云端 module 之前安装）
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudMock;
  return origLoad.apply(this, arguments);
};

// ---------- 本地层 wx.storage mock ----------
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

const storage = require('../miniprogram/utils/storage');
const local = require('../miniprogram/services/local');
const localDash = require('../miniprogram/utils/dashboard');
const cloudDash = require('../cloudfunctions/lib/dashboard');
const localFeed = require('../miniprogram/utils/feed');
const cloudFeed = require('../cloudfunctions/lib/feed');
const cloudFeedCRUD = require('../cloudfunctions/feedCRUD');

const keysOf = (o) => Object.keys(o).sort();

// ---------- ① 纯函数双份镜像对称（同一入参逐字段一致） ----------
const TODAY = '2026-10-10';
function makeFixture() {
  return {
    children: [
      { _id: 'c1', ownerId: 'u1', name: '小明', avatar: '🐱', photo: '', gender: 'male', birthday: '2018-01-01', allergens: '', deleted: false },
      { _id: 'c2', ownerId: 'u1', name: '小红', avatar: '🐰', photo: '', gender: 'female', birthday: '2020-05-05', allergens: '花生', deleted: true }
    ],
    tasks: [
      { _id: 't1', childId: 'c1', title: '背单词', icon: '📚', score: 2, priority: 'high', type: 'study', deleted: false, createdAt: 1, repeat: { enabled: false } },
      { _id: 't2', childId: 'c1', title: '喝水', icon: '💧', score: 1, priority: 'mid', type: 'life', deleted: false, createdAt: 2, repeat: { enabled: false } },
      { _id: 't3', childId: 'c1', title: '旧任务', icon: '❌', score: 3, priority: 'low', type: 'study', deleted: true, createdAt: 3 }
    ],
    rewards: [
      { _id: 'r1', childId: 'c1', title: '冰淇淋', cost: 2, category: 'food', resetAfterRedeem: false, deleted: false, createdAt: 1 },
      { _id: 'r2', childId: 'c1', title: '贴纸', cost: 1, category: 'toy', resetAfterRedeem: true, deleted: false, createdAt: 2 }
    ],
    checkIns: [
      { _id: 'ci1', childId: 'c1', taskId: 't1', score: 2, date: '2026-10-10', createdAt: 100 },
      { _id: 'ci2', childId: 'c1', taskId: 't2', score: 1, date: '2026-10-09', createdAt: 90 },
      { _id: 'ci3', childId: 'c2', taskId: 't2', score: 1, date: '2026-10-08', createdAt: 80 }
    ],
    redemptions: [
      { _id: 'rd1', childId: 'c1', rewardId: 'r1', cost: 2, createdAt: 120 }
    ]
  };
}

test('buildDashboard 双端纯函数输出对称（看板聚合契约锁）', () => {
  const f = makeFixture();
  const raw = {
    today: TODAY, children: f.children.filter(c => !c.deleted), child: f.children[0],
    tasks: f.tasks.filter(t => t.childId === 'c1' && !t.deleted).sort((a, b) => a.createdAt - b.createdAt),
    rewards: f.rewards.filter(r => r.childId === 'c1' && !r.deleted).sort((a, b) => a.createdAt - b.createdAt),
    redemptions: f.redemptions.filter(r => r.childId === 'c1'),
    checkIns: f.checkIns.filter(c => c.childId === 'c1')
  };
  const l = localDash.buildDashboard(raw);
  const c = cloudDash.buildDashboard(raw);
  assert.deepStrictEqual(l, c, 'buildDashboard 双端输出不一致');
  // 关键口径存在性
  assert.strictEqual(l.monthLit.length, 2);
  assert.ok(l.todayTasks.length >= 2, 'todayTasks 应含 2 个可见任务');
  assert.ok(l.rewards.find(r => r.redeemId === 'rd1'), '限次奖励应带 redeemId');
});

test('buildFeed 双端纯函数输出对称（动态聚合契约锁）', () => {
  const f = makeFixture();
  const raw = {
    children: f.children.filter(c => !c.deleted),
    tasks: f.tasks, rewards: f.rewards, checkIns: f.checkIns, redemptions: f.redemptions,
    limit: 30, skip: 0
  };
  const l = localFeed.buildFeed(raw);
  const c = cloudFeed.buildFeed(raw);
  assert.deepStrictEqual(l, c, 'buildFeed 双端输出不一致');
  // c2 之外都保留：ci1/ci2（c1）+ rd1（c1）= 3；ci3 属 c2 但 c2 deleted 已被 children 过滤 → 不计
  assert.strictEqual(l.total, 3);
  assert.strictEqual(l.items[0].id, 'rd1'); // createdAt 最大排最前
  assert.strictEqual(l.items[0].kind, 'redeem');
});

// ---------- ② 端到端：feedCRUD op=list 本地↔云端 完全一致 ----------
const ready = (async () => {
  await local.resetAll();
  await local.login({});
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  const childId = (store[storage.KEYS.children] || [])[0]._id;

  await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '背单词', icon: '📚', score: 2, praise: '好' } });
  await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '喝水', icon: '💧', score: 1 } });
  await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '冰淇淋', cost: 2, resetAfterRedeem: false, praise: '甜' } });
  await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '贴纸', cost: 1 } });
  const tk = await local.taskCRUD({ op: 'create', parentToken: token, payload: { childId, title: '读书', score: 5 } });
  await local.checkIn({ childId, taskId: tk.task._id, parentToken: token });
  const rw = await local.rewardCRUD({ op: 'create', parentToken: token, payload: { childId, title: '全家出游', cost: 3, resetAfterRedeem: false } });
  await local.redeem({ childId, rewardId: rw.reward._id, parentToken: token });

  // 同一份数据灌进云端 mock db
  const user = store[storage.KEYS.user];
  CURRENT_OPENID = user ? user.openid : 'local_openid';
  collections.users = user ? [user] : [];
  collections.children = store[storage.KEYS.children] || [];
  collections.tasks = store[storage.KEYS.tasks] || [];
  collections.rewards = store[storage.KEYS.rewards] || [];
  collections.checkIns = store[storage.KEYS.checkIns] || [];
  collections.redemptions = store[storage.KEYS.redemptions] || [];
  collections.pointsLog = store[storage.KEYS.points] || [];
  return { childId };
})();

test('feedCRUD op=list 输出 本地↔云端 完全一致（形状+顺序+分页）', async () => {
  await ready;
  const localOut = await local.feedCRUD({ op: 'list' });
  const cloudOut = await cloudFeedCRUD.main({ op: 'list' });

  assert.deepStrictEqual(keysOf(localOut), keysOf(cloudOut), 'feed 顶层键不一致');
  assert.ok(localOut.items.length && cloudOut.items.length, 'items 应非空');
  assert.deepStrictEqual(keysOf(localOut.items[0]), keysOf(cloudOut.items[0]), 'item 投影键不一致');
  assert.strictEqual(localOut.total, cloudOut.total, 'total 不一致');
  assert.strictEqual(localOut.hasMore, cloudOut.hasMore, 'hasMore 不一致');
  // 整体逐字段一致（含排序）
  assert.deepStrictEqual(localOut, cloudOut, 'feedCRUD list 双端输出不完全一致');
});

// ---------- ③ 静态守卫：用到 runtime 原语就必须 require（防 A 类漏 require 回归） ----------
// 本守卫由真实 bug 催生：feedCRUD/index.js 曾在 A 改造后使用 resolveCaller 却没 require
// ./lib/runtime，因云端从未实跑、无测试触碰而潜伏。这里对全部 13 个云函数静态扫一遍。
test('云端 13 函数：用到 runtime 原语就必须 require ./lib/runtime', () => {
  const cfRoot = path.resolve(__dirname, '..', 'cloudfunctions');
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const offenders = [];
  for (const d of fs.readdirSync(cfRoot)) {
    const idx = path.join(cfRoot, d, 'index.js');
    if (!fs.existsSync(idx)) continue;
    const src = stripComments(fs.readFileSync(idx, 'utf8'));
    const usesPrimitive = /\bresolveCaller\s*\(|\bassertToken\s*\(/.test(src);
    const hasRequire = /require\(\s*['"]\.\/lib\/runtime['"]\s*\)/.test(src);
    if (usesPrimitive && !hasRequire) offenders.push(d);
  }
  assert.deepStrictEqual(offenders, [], '以下云函数使用 runtime 原语但未 require ./lib/runtime：' + offenders.join(', '));
});
