// __tests__/session.test.js —— 家长会话（ADR-0001）：注入 / 豁免 / 恢复流程 / 页面守卫
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// —— mock wx.storage ——
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

// —— mock 全局 App 环境（家长会话经 getApp() 读写令牌态）——
let syncModeCalls = 0;
const fakeApp = {
  globalData: { parentToken: null, parentTokenExpire: 0, mode: 'display', useCloud: false, user: null },
  lastActive: 0,
  syncMode() { syncModeCalls++; }
};
global.getApp = () => fakeApp;
let currentPages = [];
global.getCurrentPages = () => currentPages;

const session = require('../miniprogram/utils/parent-session');
const { callApi } = require('../miniprogram/utils/api');
const local = require('../miniprogram/services/local');

test('守卫：pages 下不得出现 parentToken（ADR-0001，令牌由 seam 注入）', () => {
  const pagesDir = path.join(__dirname, '..', 'miniprogram', 'pages');
  const offenders = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) {
        if (fs.readFileSync(full, 'utf8').includes('parentToken')) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    }
  })(pagesDir);
  assert.deepStrictEqual(offenders, [], '页面不得直接接触家长令牌，违规文件: ' + offenders.join(', '));
});

test('豁免表：纯公开函数按 name，混合 op 函数按 name+op 判定（fail-safe 方向）', () => {
  assert.strictEqual(session.isPublic('login'), true);
  assert.strictEqual(session.isPublic('unlockParent'), true);
  assert.strictEqual(session.isPublic('resetPin'), true);
  assert.strictEqual(session.isPublic('getDashboard'), true);
  assert.strictEqual(session.isPublic('resetAll'), true);
  assert.strictEqual(session.isPublic('childCRUD', { op: 'list' }), true);
  assert.strictEqual(session.isPublic('childCRUD', { op: 'create' }), false);
  assert.strictEqual(session.isPublic('feedCRUD', { op: 'list' }), true);
  assert.strictEqual(session.isPublic('feedCRUD', { op: 'undoCheckIn' }), false);
  assert.strictEqual(session.isPublic('feedCRUD', { op: 'undoRedeem' }), false);
  assert.strictEqual(session.isPublic('petCRUD', { op: 'info' }), true);
  assert.strictEqual(session.isPublic('petCRUD', { op: 'stroke' }), true);
  assert.strictEqual(session.isPublic('petCRUD', { op: 'feed' }), false);
  assert.strictEqual(session.isPublic('checkIn'), false);
  assert.strictEqual(session.isPublic('redeem'), false);
  assert.strictEqual(session.isPublic('setPin'), false);
  // 未知操作默认不豁免（fail-safe：宁可多带一个无害 token，不可漏带）
  assert.strictEqual(session.isPublic('未来新函数'), false);
});

test('inject：非公开操作注入当前令牌；公开操作不动 params', () => {
  fakeApp.globalData.parentToken = 'tok-abc';
  const p1 = {};
  session.inject('checkIn', p1);
  assert.strictEqual(p1.parentToken, 'tok-abc');

  const p2 = { op: 'list' };
  session.inject('feedCRUD', p2);
  assert.strictEqual('parentToken' in p2, false);

  fakeApp.globalData.parentToken = '';
  const p3 = {};
  session.inject('checkIn', p3);
  assert.strictEqual(p3.parentToken, '');   // 无令牌带空串 → 服务端 TOKEN_INVALID → 走恢复
});

test('adopt：写令牌/过期/模式 + 重置空闲基准 + 广播一次', () => {
  syncModeCalls = 0;
  fakeApp.lastActive = 0;
  session.adopt({ parentToken: 't1', expireAt: 123 }, fakeApp);
  assert.strictEqual(fakeApp.globalData.parentToken, 't1');
  assert.strictEqual(fakeApp.globalData.parentTokenExpire, 123);
  assert.strictEqual(fakeApp.globalData.mode, 'parent');
  assert.ok(fakeApp.lastActive > 0, 'adopt 应重置 R10 空闲基准');
  assert.strictEqual(syncModeCalls, 1);
  // 非法入参不生效
  session.adopt(null, fakeApp);
  assert.strictEqual(fakeApp.globalData.parentToken, 't1');
});

test('seam 恢复：TOKEN_INVALID → 弹 PIN → 重试原操作一次（端到端）', async () => {
  await local.resetAll();
  const login = await local.login({});
  fakeApp.user = login.user;

  // 正常解锁并建任务（令牌经 adopt 进 globalData，页面/调用不传）
  const un = await callApi('unlockParent', { pin: '123456' });
  session.adopt(un, fakeApp);
  const created = await callApi('taskCRUD', { op: 'create', payload: { childId: login.childId, title: '读书', icon: '📚', score: 3 } });
  assert.strictEqual(created.ok, true);

  // 模拟「写操作进行中令牌失效」（如选照片期间过期）：globalData 令牌清空
  fakeApp.globalData.parentToken = null;
  fakeApp.globalData.mode = 'display';

  // 栈顶页接入恢复入口：收到通知后自动用默认 PIN 提交（模拟页面 pin-pad 回调）
  let notified = false;
  currentPages = [{
    onReauthNeed() {
      notified = true;
      session.submitReauthPin('123456');   // 异步放行，不 await（模拟用户输入完成）
    }
  }];

  const res = await callApi('checkIn', { childId: login.childId, taskId: created.task._id });
  assert.strictEqual(notified, true);
  assert.strictEqual(res.ok, true);          // 自动重试成功
  assert.strictEqual(res.totalStars, 3);
  assert.strictEqual(fakeApp.globalData.mode, 'parent');   // 会话已恢复
  assert.ok(fakeApp.globalData.parentToken);               // 新令牌已换发
});

test('seam 恢复：用户取消（关闭面板）→ 原错误 TOKEN_INVALID 照常抛出', async () => {
  fakeApp.globalData.parentToken = null;
  currentPages = [{
    onReauthNeed() { session.cancelReauth(); }   // 模拟用户立即关闭
  }];
  await assert.rejects(
    () => callApi('checkIn', { childId: 'x', taskId: 'y' }),
    (e) => e.code === 'TOKEN_INVALID'
  );
  assert.strictEqual(session.hasPendingReauth(), false);
});

test('结构守卫：五个 tab 页均通过 pin-reauth Behavior 提供 onReauthNeed 恢复入口（ADR-0001 + Phase B）', () => {
  const pages = ['home/home', 'pet/pet', 'tasks/tasks', 'feed/feed', 'mine/mine'];
  const missing = pages.filter(p => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', p + '.js'), 'utf8');
    return !/behaviors:\s*\[/.test(src) || src.indexOf('pin-reauth') < 0;
  });
  assert.deepStrictEqual(missing, [], '以下页面未接入 pin-reauth Behavior（恢复入口由 Behavior 提供）: ' + missing.join(', '));
});

test('seam 恢复：栈顶页未接入 onReauthNeed → 不挂起，原样抛 TOKEN_INVALID', async () => {
  fakeApp.globalData.parentToken = null;
  currentPages = [{}];   // 模拟未实现恢复入口的页面（session 的防御路径）
  await assert.rejects(
    () => callApi('checkIn', { childId: 'x', taskId: 'y' }),
    (e) => e.code === 'TOKEN_INVALID'
  );
  assert.strictEqual(session.hasPendingReauth(), false);
});

test('seam 恢复：PIN 错误不终止等待（面板保持），取消后才放行', async () => {
  fakeApp.globalData.parentToken = null;
  let reauthNeeded = false;
  currentPages = [{ onReauthNeed() { reauthNeeded = true; } }];
  const pending = session.requestReunlock();
  assert.strictEqual(reauthNeeded, true);
  assert.strictEqual(await session.submitReauthPin('000000'), false);   // 错误 PIN
  assert.strictEqual(session.hasPendingReauth(), true);                 // seam 继续等待
  session.cancelReauth();
  assert.strictEqual(await pending, null);
});
