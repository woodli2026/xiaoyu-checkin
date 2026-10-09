// cloudfunctions/setup.js
// 作用：1) 为每个云函数生成 package.json；2) 把共享 lib/ 同步进每个函数目录。
// 原因：微信开发者工具「上传并部署」只打包所选函数目录，跨目录 require 不会被上传，
//       因此每个函数必须自带一份 lib/（本地副本）。改动 lib/ 后请重新执行：node cloudfunctions/setup.js
//
// 新增 --check 模式（2026-10-09，候选②-A）：比对 lib/ 源与 13 个函数目录副本是否
//   逐字节一致，不一致即非零退出。防止「改了 lib 忘跑 sync」导致的静默漂移。
//   用法：node cloudfunctions/setup.js --check
const fs = require('fs');
const path = require('path');

const root = __dirname;
const libDir = path.join(root, 'lib');
const FUNCTIONS = ['login', 'unlockParent', 'getDashboard', 'checkIn', 'redeem',
  'taskCRUD', 'rewardCRUD', 'childSwitch', 'childCRUD', 'feedCRUD', 'petCRUD', 'setPin', 'resetPin'];

const pkg = (name) => JSON.stringify({
  name,
  version: '1.0.0',
  description: '雨宝记云函数 - ' + name,
  main: 'index.js',
  dependencies: { 'wx-server-sdk': '~2.6.3' }
}, null, 2) + '\n';

// 行尾归一化：git 可能做 CRLF 归一，源与副本两侧同等处理即可，
// 不会掩盖真实内容漂移（真实漂移是字符级差异，不是单纯 \\r）。
const norm = (s) => s.replace(/\r\n/g, '\n');

function getLibFiles() {
  const files = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
  if (!files.length) { console.error('lib/ 为空'); process.exit(1); }
  return files.sort();
}

function runSync() {
  const libFiles = getLibFiles();
  FUNCTIONS.forEach((fn) => {
    const dir = path.join(root, fn);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), pkg(fn), 'utf8');
    const dest = path.join(dir, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    libFiles.forEach((f) => fs.copyFileSync(path.join(libDir, f), path.join(dest, f)));
    console.log('  ✓', fn, '-> package.json + lib/ (' + libFiles.length + ' files)');
  });
  console.log('\n完成：' + FUNCTIONS.length + ' 个云函数已就绪。');
}

// --check：比对 lib 源与每个函数目录副本，不一致即报错（防忘 sync 漂移）
function runCheck() {
  const libFiles = getLibFiles();
  const problems = [];
  for (const fn of FUNCTIONS) {
    const destDir = path.join(root, fn, 'lib');
    for (const f of libFiles) {
      const src = path.join(libDir, f);
      const dst = path.join(destDir, f);
      if (!fs.existsSync(dst)) { problems.push('缺失副本 ' + fn + '/lib/' + f); continue; }
      const a = norm(fs.readFileSync(src, 'utf8'));
      const b = norm(fs.readFileSync(dst, 'utf8'));
      if (a !== b) problems.push('漂移 ' + fn + '/lib/' + f);
    }
    // 反向：副本目录不得多出源里没有的文件（防止误增/误留）
    if (fs.existsSync(destDir)) {
      for (const extra of fs.readdirSync(destDir)) {
        if (extra.endsWith('.js') && !libFiles.includes(extra)) {
          problems.push('多余文件 ' + fn + '/lib/' + extra);
        }
      }
    }
  }
  if (problems.length) {
    console.error('✗ lib 副本与源不一致，请运行 `npm run sync` 重建副本：');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('✓ lib 副本与源全部一致（' + FUNCTIONS.length + ' 函数 × ' + libFiles.length + ' 文件）。');
}

// 仅当作为主模块直接运行才执行（被测试 require 时只导出，不触发复制/校验）
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--check') runCheck();
  else runSync();
}

module.exports = { FUNCTIONS, getLibFiles, runSync, runCheck };
