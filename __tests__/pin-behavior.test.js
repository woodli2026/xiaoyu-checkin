// __tests__/pin-behavior.test.js —— Phase B 结构守卫：页面样板收敛
//
// 五页的 onPinClose / onReauthNeed / onPinComplete（home/mine 外加 onPinForgot）已迁移到
// behaviors/pin-reauth.js。守卫确保这些方法不再在页面层本地定义，且页面均通过 behaviors 接入，
// 防止未来改动时样板重新散落到五页（回归防护）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pagesDir = path.join(__dirname, '..', 'miniprogram', 'pages');
const pages = ['home/home', 'mine/mine', 'feed/feed', 'tasks/tasks', 'pet/pet'];

test('页面层不得本地定义已迁移到 Behavior 的 PIN 方法（onPinComplete/onPinClose/onReauthNeed）', () => {
  const offenders = [];
  for (const p of pages) {
    const src = fs.readFileSync(path.join(pagesDir, p + '.js'), 'utf8');
    for (const m of ['onPinComplete', 'onPinClose', 'onReauthNeed']) {
      // 行首缩进 + 方法名 + 左括号 = 方法定义（Behavior 已提供，页面不应再定义）
      if (new RegExp('^\\s*' + m + '\\s*\\(', 'm').test(src)) offenders.push(p + ':' + m);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    '以下页面仍本地定义已迁移到 Behavior 的 PIN 方法，违反样板收敛纪律:\n' + offenders.join('\n')
  );
});

test('五页均通过 behaviors 接入 pin-reauth（行为来源单一）', () => {
  const offenders = [];
  for (const p of pages) {
    const src = fs.readFileSync(path.join(pagesDir, p + '.js'), 'utf8');
    if (!/behaviors:\s*\[/.test(src) || !/pin-reauth/.test(src)) offenders.push(p);
  }
  assert.deepStrictEqual(offenders, [], '以下页面未接入 pin-reauth Behavior: ' + offenders.join(', '));
});
