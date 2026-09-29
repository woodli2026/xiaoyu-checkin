// cloudfunctions/setup.js
// 作用：1) 为每个云函数生成 package.json；2) 把共享 lib/ 同步进每个函数目录。
// 原因：微信开发者工具「上传并部署」只打包所选函数目录，跨目录 require 不会被上传，
//       因此每个函数必须自带一份 lib/（本地副本）。改动 lib/ 后请重新执行：node cloudfunctions/setup.js
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

const libFiles = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
if (!libFiles.length) { console.error('lib/ 为空'); process.exit(1); }

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
