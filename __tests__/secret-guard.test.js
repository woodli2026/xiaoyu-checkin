// secret-guard.test.js —— D6 密钥治理守卫
// 目的：锁死「环境变量缺失即 fail-fast」，防止有人把硬编码兜底密钥改回来。
//
// 为什么以「行为断言」为主而非纯文本匹配：
// 文本匹配只能证明字符串不在，不能证明真的会拒绝弱密钥；且源码注释里刻意保留了
// 旧实现的字面量用于说明改动背景（见 tools/lint 的踩坑：注释会 100% 误报），
// 故文本检查必须先剥离注释。行为断言才是硬证据。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { strip } = require('../tools/lint');

const ROOT = path.join(__dirname, '..');
const token = require(path.join(ROOT, 'cloudfunctions', 'lib', 'token.js'));
const pin = require(path.join(ROOT, 'cloudfunctions', 'lib', 'pin.js'));

/** 临时清空密钥环境变量执行 fn，结束后恢复（node:test 各文件独立进程，仍显式恢复以防串扰） */
function withoutEnv(fn) {
  const oldT = process.env.XY_TOKEN_SECRET;
  const oldP = process.env.XY_PIN_SALT;
  delete process.env.XY_TOKEN_SECRET;
  delete process.env.XY_PIN_SALT;
  try { return fn(); } finally {
    if (oldT === undefined) delete process.env.XY_TOKEN_SECRET; else process.env.XY_TOKEN_SECRET = oldT;
    if (oldP === undefined) delete process.env.XY_PIN_SALT; else process.env.XY_PIN_SALT = oldP;
  }
}

test('未配置 XY_TOKEN_SECRET 时，签发与校验必须抛错（不得回退弱密钥）', () => {
  withoutEnv(() => {
    assert.throws(() => token.sign('payload'), /XY_TOKEN_SECRET/, 'sign 未 fail-fast');
    assert.throws(() => token.issueToken('openid-1', 60000), /XY_TOKEN_SECRET/, 'issueToken 未 fail-fast');
    assert.throws(() => token.verifyToken('xxx.yyy', 'openid-1'), /XY_TOKEN_SECRET/, 'verifyToken 未 fail-fast');
    // 关键：即使是模块加载也不该因缺密钥而崩（惰性校验），否则会打挂整个测试进程
    assert.strictEqual(typeof token.getSecret, 'function');
  });
});

test('未配置 XY_PIN_SALT 时，PIN 哈希必须抛错（不得回退公开盐）', () => {
  withoutEnv(() => {
    assert.throws(() => pin.hashPin('123456'), /XY_PIN_SALT/, 'hashPin 未 fail-fast');
    assert.throws(() => pin.defaultPinHash(), /XY_PIN_SALT/, 'defaultPinHash 未 fail-fast');
    assert.throws(() => pin.verifyPin('123456', 'deadbeef'), /XY_PIN_SALT/, 'verifyPin 未 fail-fast');
  });
});

test('配置环境变量后，令牌与 PIN 功能正常（fail-fast 不得误伤正常路径）', () => {
  const oldT = process.env.XY_TOKEN_SECRET;
  const oldP = process.env.XY_PIN_SALT;
  process.env.XY_TOKEN_SECRET = 'test-secret';
  process.env.XY_PIN_SALT = 'test-salt';
  try {
    const t = token.issueToken('openid-1', 60000);
    assert.strictEqual(token.verifyToken(t.token, 'openid-1'), true, '同密钥应校验通过');
    assert.strictEqual(token.verifyToken(t.token, 'other-openid'), false, 'openid 不匹配应失败');
    const h = pin.hashPin('123456');
    assert.strictEqual(pin.verifyPin('123456', h), true);
    assert.strictEqual(pin.verifyPin('654321', h), false);
    assert.strictEqual(pin.hashPin('123456'), h, '哈希须确定性');
  } finally {
    if (oldT === undefined) delete process.env.XY_TOKEN_SECRET; else process.env.XY_TOKEN_SECRET = oldT;
    if (oldP === undefined) delete process.env.XY_PIN_SALT; else process.env.XY_PIN_SALT = oldP;
  }
});

test('文本守卫：源码（剥离注释后）不得再出现硬编码兜底密钥', () => {
  const files = [
    path.join(ROOT, 'cloudfunctions', 'lib', 'token.js'),
    path.join(ROOT, 'cloudfunctions', 'lib', 'pin.js')
  ];
  for (const f of files) {
    const code = strip(fs.readFileSync(f, 'utf8'));
    assert.ok(code.indexOf('xiaoyu-dev-secret-change-me') < 0, f + ' 仍含硬编码 token 兜底密钥');
    assert.ok(code.indexOf('xiaoyu-pin-salt') < 0, f + ' 仍含硬编码 PIN 盐');
  }
});

test('PIN 口径常量仍与本地兜底层一致（改 PIN 逻辑不能破坏既有守卫依赖）', () => {
  assert.strictEqual(pin.DEFAULT_PIN, '123456');
  assert.strictEqual(pin.PIN_LENGTH, 6);
  assert.strictEqual(pin.PIN_SCHEME, 'len6-v1');
});
