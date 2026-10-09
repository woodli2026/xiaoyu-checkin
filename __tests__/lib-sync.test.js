// lib-sync.test.js —— 候选②-A 的防漂移守卫
// 比对 cloudfunctions/lib/ 源与 13 个函数目录副本是否逐字节一致。
// 只要有人改了 lib/ 却忘了 `npm run sync`，npm test 立即变红。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
// require.main 守卫保证这里 require 不会触发 setup 的复制/校验逻辑，仅取导出
const { FUNCTIONS, getLibFiles } = require('../cloudfunctions/setup');

const root = path.join(__dirname, '..');
const libDir = path.join(root, 'cloudfunctions', 'lib');
const norm = (s) => s.replace(/\r\n/g, '\n');

test('lib 副本与源逐字节一致（防忘 sync 漂移）', () => {
  const files = getLibFiles();
  const problems = [];
  for (const fn of FUNCTIONS) {
    const destDir = path.join(root, 'cloudfunctions', fn, 'lib');
    for (const f of files) {
      const src = path.join(libDir, f);
      const dst = path.join(destDir, f);
      if (!fs.existsSync(dst)) { problems.push('缺失副本 ' + fn + '/lib/' + f); continue; }
      const a = norm(fs.readFileSync(src, 'utf8'));
      const b = norm(fs.readFileSync(dst, 'utf8'));
      if (a !== b) problems.push('漂移 ' + fn + '/lib/' + f);
    }
    if (fs.existsSync(destDir)) {
      for (const extra of fs.readdirSync(destDir)) {
        if (extra.endsWith('.js') && !files.includes(extra)) {
          problems.push('多余文件 ' + fn + '/lib/' + extra);
        }
      }
    }
  }
  assert.deepStrictEqual(
    problems, [],
    'lib 副本与源不一致，请运行 `npm run sync` 重建：\n' + problems.join('\n')
  );
});
