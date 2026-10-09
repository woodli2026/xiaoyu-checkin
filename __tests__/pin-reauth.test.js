// __tests__/pin-reauth.test.js —— Phase B：家长 PIN 闸逻辑收拢（utils/pin-reauth 纯函数单测）
//
// 用 require.cache 注入 mock 的 session / api（Node test runner 为每个测试文件启动独立子进程，
// cache 隔离，不污染 session.test.js 等其它文件）。wx 用全局 mock。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');

// —— mock wx（pin-reauth 用 showToast / showModal）——
const wxCalls = [];
global.wx = {
  showToast(o) { wxCalls.push({ kind: 'toast', o }); },
  showModal(o) { wxCalls.push({ kind: 'modal', o }); }
};

// —— mock session（pin-reauth 顶层 require('./parent-session')）——
const sessionPath = require.resolve(path.join(root, 'utils', 'parent-session'));
require(sessionPath);   // 真实加载入 cache，随后覆盖 exports
const sessionMock = {
  REAUTH_HINT: '家长模式已失效，请重新解锁',
  _pending: false,
  _submitOk: true,
  _submitCalls: [],
  _cancel: false,
  _adopt: false,
  hasPendingReauth() { return this._pending; },
  submitReauthPin(pin) { this._submitCalls.push(pin); if (this._submitOk) { this.adopt(); return true; } return false; },
  cancelReauth() { this._cancel = true; },
  adopt() { this._adopt = true; }
};
require.cache[sessionPath].exports = sessionMock;

// —— mock api（pin-reauth 内惰性 require('./api')）——
const apiPath = require.resolve(path.join(root, 'utils', 'api'));
require(apiPath);
const apiMock = {
  _last: null,
  async callApi(name, params) {
    this._last = { name, params };
    if (name === 'resetPin') return { defaultPin: '123456' };
    if (name === 'unlockParent') return { parentToken: 'TOK', expireAt: 999 };
    throw new Error('unexpected ' + name);
  }
};
require.cache[apiPath].exports = apiMock;

const pin = require(path.join(root, 'utils', 'pin-reauth'));

function makeCtx(extra) {
  const e = extra || {};
  const data = Object.assign({ pinAttempt: 0, showPin: false, pinError: '' }, e.data || {});
  const rest = Object.assign({}, e);
  delete rest.data;
  return Object.assign({
    data,
    setData(c) { Object.assign(this.data, c); }
  }, rest);
}

test('bumpPin：设置错误文案并使 pinAttempt +1', () => {
  const ctx = makeCtx({ data: { pinAttempt: 2 } });
  pin.bumpPin(ctx, '错了');
  assert.strictEqual(ctx.data.pinError, '错了');
  assert.strictEqual(ctx.data.pinAttempt, 3);
});

test('onReauthNeed：弹面板 + REAUTH_HINT + bump attempt', () => {
  sessionMock._pending = false;
  const ctx = makeCtx();
  pin.onReauthNeed(ctx);
  assert.strictEqual(ctx.data.showPin, true);
  assert.strictEqual(ctx.data.pinError, sessionMock.REAUTH_HINT);
  assert.strictEqual(ctx.data.pinAttempt, 1);
});

test('onPinClose：有挂起恢复则取消 seam，否则仅关面板', () => {
  sessionMock._pending = true; sessionMock._cancel = false;
  const ctx = makeCtx();
  pin.onPinClose(ctx);
  assert.strictEqual(sessionMock._cancel, true);
  assert.strictEqual(ctx.data.showPin, false);

  sessionMock._pending = false; sessionMock._cancel = false;
  pin.onPinClose(ctx);
  assert.strictEqual(sessionMock._cancel, false);   // 无挂起时不触发取消
});

test('onPinForgot：resetPin + 统一中性文案提示 + bump（不依赖「我」页/本页差异）', async () => {
  wxCalls.length = 0;
  const ctx = makeCtx();
  await pin.onPinForgot(ctx);
  assert.strictEqual(apiMock._last.name, 'resetPin');
  assert.strictEqual(ctx.data.pinAttempt, 1);
  const modal = wxCalls.find(c => c.kind === 'modal');
  assert.ok(modal && /已重置为 123456/.test(modal.o.content));
});

test('onPinComplete：reauth 成功 → 关面板 + 切换 parent 模式 + adopt', async () => {
  sessionMock._pending = true; sessionMock._submitOk = true; sessionMock._adopt = false;
  const ctx = makeCtx();
  await pin.onPinComplete(ctx, { detail: { pin: '123456' } });
  assert.strictEqual(ctx.data.showPin, false);
  assert.strictEqual(ctx.data.mode, 'parent');
  assert.strictEqual(sessionMock._adopt, true);
});

test('onPinComplete：reauth 失败 → 面板保持打开 + 错误文案 + bump（不阻断 seam 等待）', async () => {
  sessionMock._pending = true; sessionMock._submitOk = false;
  const ctx = makeCtx({ data: { showPin: true } });   // 模拟 onReauthNeed 已弹面板（reauth 失败时面板保持打开）
  await pin.onPinComplete(ctx, { detail: { pin: '000000' } });
  assert.strictEqual(ctx.data.showPin, true);
  assert.strictEqual(ctx.data.pinError, 'PIN 不正确');
  assert.strictEqual(ctx.data.pinAttempt, 1);
});

test('onPinComplete：常规解锁（无挂起）→ callApi unlockParent + 进入提示 + 兼容 burst 动效', async () => {
  sessionMock._pending = false;
  wxCalls.length = 0;
  let burstCalled = false;
  const ctx = makeCtx({ burst() { burstCalled = true; } });
  await pin.onPinComplete(ctx, { detail: { pin: '123456' } });
  assert.strictEqual(apiMock._last.name, 'unlockParent');
  assert.strictEqual(ctx.data.showPin, false);
  assert.strictEqual(ctx.data.mode, 'parent');
  assert.strictEqual(burstCalled, true);   // home 的进入动效被调用
  assert.ok(wxCalls.find(c => c.kind === 'toast'));
});

test('onPinComplete：常规解锁失败 → 错误文案 + bump（无 burst 的页面也安全）', async () => {
  sessionMock._pending = false;
  const prev = apiMock.callApi;
  apiMock.callApi = async () => { throw new Error('炸了'); };   // 临时改写
  const ctx = makeCtx();   // 无 burst 方法
  await pin.onPinComplete(ctx, { detail: { pin: '1' } });
  assert.strictEqual(ctx.data.pinError, '炸了');
  assert.strictEqual(ctx.data.pinAttempt, 1);
  apiMock.callApi = prev;
});
