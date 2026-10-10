// __tests__/runtime-guard.test.js
// A 守卫：验证候选 A 新增的授权/上下文深模块 cloudfunctions/lib/runtime.js 三原语语义：
//   resolveCaller —— 归一 AUTH_FAIL（缺 OPENID / 未登录）
//   assertToken  —— 家长令牌校验（失败返回 TOKEN_INVALID）
//   ownedChild   —— 归属孩子解析（找不到返回 null，由调用方决定失败码）
//
// 用 vm 编译**真实的 runtime.js 源码**，require 桩解析 './cloud' / './token' 为可控 mock，
// 不经过 wx-server-sdk，纯逻辑验证三原语行为。
//
// 零运行时风险：纯新增测试文件，不改动任何被测代码。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let CURRENT_OPENID = 'o1';
let USER_EXISTS = true;
let MOCK_USER = { _id: 'u1', pinSet: true };
let MOCK_CHILD = { _id: 'c1', ownerId: 'u1' };

const cloudMock = { getWXContext: () => ({ OPENID: CURRENT_OPENID }) };
const failStub = (code, message) => ({ code, message: message || code });
const getUserByOpenid = (openid) => Promise.resolve(USER_EXISTS ? MOCK_USER : null);
const verifyToken = (token, openid) => token === 'good' && openid === CURRENT_OPENID;
const getOwnedChild = (openid, childId) => Promise.resolve(childId === 'c1' ? MOCK_CHILD : null);

const sandbox = {
  String, Number, Date, Object, Math, Array, Promise, RegExp, console,
  module: { exports: {} },
  require: (p) => {
    if (p === './cloud') return { cloud: cloudMock, fail: failStub, getUserByOpenid, getOwnedChild };
    if (p === './token') return { verifyToken };
    throw new Error('unexpected require: ' + p);
  }
};
const runtime = vm.runInNewContext(
  read('cloudfunctions/lib/runtime.js') + '\n;({ resolveCaller, assertToken, ownedChild })',
  sandbox
);

test('resolveCaller：缺 OPENID → AUTH_FAIL', async () => {
  CURRENT_OPENID = '';
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail && r.fail.code, 'AUTH_FAIL', '缺 OPENID 应返回 AUTH_FAIL');
});

test('resolveCaller：未登录 → AUTH_FAIL', async () => {
  CURRENT_OPENID = 'oX';
  USER_EXISTS = false;
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail && r.fail.code, 'AUTH_FAIL', '未登录应返回 AUTH_FAIL');
  USER_EXISTS = true;
});

test('resolveCaller：正常 → { OPENID, user }', async () => {
  CURRENT_OPENID = 'o1';
  const r = await runtime.resolveCaller({});
  assert.strictEqual(r.fail, undefined, '正常不应有 fail');
  assert.strictEqual(r.OPENID, 'o1');
  assert.strictEqual(r.user._id, 'u1');
});

test('assertToken：无效令牌 → TOKEN_INVALID', () => {
  const f = runtime.assertToken({ parentToken: 'bad' }, 'o1');
  assert.strictEqual(f && f.code, 'TOKEN_INVALID', '无效令牌应返回 TOKEN_INVALID');
});

test('assertToken：有效令牌 → null', () => {
  const f = runtime.assertToken({ parentToken: 'good' }, 'o1');
  assert.strictEqual(f, null, '有效令牌应返回 null');
});

test('ownedChild：找到 → child 对象', async () => {
  const c = await runtime.ownedChild('o1', 'c1');
  assert.strictEqual(c && c._id, 'c1');
});

test('ownedChild：找不到 → null', async () => {
  const c = await runtime.ownedChild('o1', 'zzz');
  assert.strictEqual(c, null);
});
