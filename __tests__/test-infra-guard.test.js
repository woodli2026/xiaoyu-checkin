// __tests__/test-infra-guard.test.js
//
// 候选 ⑥「守卫基建去重」的防回归守卫（2026-10-13）。
//
// 【背景】守卫测试的公共基建——源码文本工具（matchBrace / strip / functionBlock …）、
// wx.storage mock、内存云 db + wx-server-sdk 拦截器——此前在 8 个测试文件里各抄一份，
// 且已悄悄分叉：strip 有「字符串感知」与「朴素正则」两版，functionBlock 有「含签名」
// 与「仅函数体」两版。语义相同的两份实现，正是守卫基建最不该出现的漂移。
//
// 已收敛到 __tests__/helpers/ 单一来源，本守卫防止日后又散回去。
// （helpers/ 下的文件不以 .test.js 结尾，故不被 runner 收集，只作被 import 的模块。）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;
const HELPERS_DIR = path.join(TESTS_DIR, 'helpers');

test('helpers 单一来源：三个共享模块存在且导出预期接口', () => {
  const jsSource = require('./helpers/js-source');
  for (const k of ['ROOT', 'read', 'keysOf', 'strip', 'matchBrace', 'objectLiteralAfter', 'arrowBlock', 'functionBlock', 'evalObj', 'evalInContext']) {
    assert.ok(k in jsSource, 'helpers/js-source 缺少导出: ' + k);
  }
  assert.strictEqual(typeof jsSource.matchBrace, 'function');
  assert.strictEqual(typeof jsSource.strip, 'function');

  assert.strictEqual(typeof require('./helpers/wx-storage').installWxStorageMock, 'function');

  const cdb = require('./helpers/cloud-db');
  assert.strictEqual(typeof cdb.createHarness, 'function');
  assert.strictEqual(typeof cdb.installWxServerSdk, 'function');
});

test('helpers 不被测试 runner 收集（名字不以 .test.js 结尾）', () => {
  const names = fs.readdirSync(HELPERS_DIR).filter((n) => n.endsWith('.js'));
  assert.ok(names.length > 0, 'helpers 目录不应为空');
  const bad = names.filter((n) => n.endsWith('.test.js'));
  assert.deepStrictEqual(bad, [], 'helpers/ 下不应有 .test.js（会被 runner 当用例收集）: ' + bad.join(', '));
});

test('防再复制：测试文件不得重写基建（一律 import helpers/）', () => {
  // 每条模式都以「真实空白」为界，故不会误伤本文件里转义过的正则字面量文本。
  const BANNED = [
    { re: /function\s+matchBrace\s*\(/, what: 'matchBrace → helpers/js-source' },
    { re: /function\s+objectLiteralAfter\s*\(/, what: 'objectLiteralAfter → helpers/js-source' },
    { re: /function\s+arrowBlock\s*\(/, what: 'arrowBlock → helpers/js-source' },
    { re: /function\s+functionBlock\s*\(/, what: 'functionBlock → helpers/js-source' },
    { re: /function\s+(evalObj|evalFn|evalInContext)\s*\(/, what: '沙箱求值 helper → helpers/js-source 的 evalObj/evalInContext' },
    { re: /function\s+strip\s*\(/, what: '注释/字符串剥离 → helpers/js-source 的 strip（勿用朴素正则版）' },
    { re: /const\s+stripComments\s*=/, what: '朴素正则剥离 → helpers/js-source 的 strip' },
    { re: /getStorageSync\s*:/, what: 'wx.storage mock → helpers/wx-storage#installWxStorageMock' },
    { re: /Module\._load\s*=/, what: 'wx-server-sdk 拦截 → helpers/cloud-db#installWxServerSdk' }
  ];
  const testFiles = fs.readdirSync(TESTS_DIR).filter((n) => n.endsWith('.test.js'));
  const offenders = [];
  for (const f of testFiles) {
    const src = fs.readFileSync(path.join(TESTS_DIR, f), 'utf8');
    for (const b of BANNED) if (b.re.test(src)) offenders.push(f + ' → ' + b.what);
  }
  assert.deepStrictEqual(offenders, [],
    '守卫基建被重新复制（应改用 helpers/ 单一来源）：\n' + offenders.join('\n'));
});
