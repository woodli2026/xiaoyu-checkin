const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 守卫（候选④，2026-10-09）：派生机制 attachTabBarSync → setData → syncTabBar →
// anySheetOpen(SHEET_KEYS) 已全权接管 tabBar 显隐，页面层不得再出现显式 setTabBarHidden
// 调用。历史上 5 页共残留 42 处（含 3 处只按单字段手工重算派生值的错误写法），已全部剥离。
test('页面层不得出现显式 setTabBarHidden 调用（派生机制全权负责）', () => {
  const pagesDir = path.join(__dirname, '..', 'miniprogram', 'pages');
  const violations = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/setTabBarHidden\(this/.test(src)) violations.push(p);
    }
  })(pagesDir);
  assert.deepStrictEqual(
    violations,
    [],
    '以下页面仍存在显式 setTabBarHidden 调用，违反派生机制纪律:\n' + violations.join('\n')
  );
});
