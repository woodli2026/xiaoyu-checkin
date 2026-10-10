// tools/gen-mirror.js —— D1 单源试点：从唯一源生成前端镜像
//
// 用法：
//   node tools/gen-mirror.js            # 生成/覆盖镜像（= npm run gen:mirror）
//   node tools/gen-mirror.js --check    # 只校验镜像与源一致（漂移则非零退出 = npm run verify:mirror）
//
// 唯一源：cloudfunctions/lib/seed.js（其 `// ==MIRROR-BODY-START==` 标记之后为镜像正文）
// 产物：miniprogram/utils/seed.js
//
// 为何生成而非共用：小程序不能 require 仓库外路径（cloudfunctions/），故前端只能持有副本；
// 生成式镜像把「两份手写」降为「一份手写 + 一份机生成」，从根上消除漂移。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKER = '// ==MIRROR-BODY-START==';
const norm = (s) => s.replace(/\r\n/g, '\n');

const MIRRORS = [
  {
    name: 'seed',
    src: 'cloudfunctions/lib/seed.js',
    out: 'miniprogram/utils/seed.js',
    banner: [
      '// utils/seed.js —— 开箱预置数据（8 任务 + 8 奖励）· 自动生成的镜像，请勿手改！',
      '//',
      '// 唯一源：cloudfunctions/lib/seed.js',
      '// 生成：npm run gen:mirror      校验：npm run verify:mirror（已接入 npm test）',
      '// 结构一致性另由 __tests__/seed.test.js 守卫（双份 deepStrictEqual）。'
    ]
  }
];

// 取唯一源中标记行之后的正文（去掉标记行与随后的空行）
function bodyOf(src) {
  const idx = src.indexOf(MARKER);
  if (idx < 0) throw new Error('唯一源缺少镜像标记 ' + MARKER);
  const afterMarkerLine = src.slice(src.indexOf('\n', idx) + 1);
  return afterMarkerLine.replace(/^\n+/, '');
}

// 依据唯一源计算镜像应有的完整文本
function buildExpected(m) {
  const src = norm(fs.readFileSync(path.join(ROOT, m.src), 'utf8'));
  return m.banner.join('\n') + '\n\n' + bodyOf(src);
}

// 返回漂移的镜像列表（空 = 全部一致）
function checkAll() {
  const drifts = [];
  for (const m of MIRRORS) {
    const expected = buildExpected(m);
    const outPath = path.join(ROOT, m.out);
    const actual = fs.existsSync(outPath) ? norm(fs.readFileSync(outPath, 'utf8')) : null;
    if (actual !== expected) drifts.push(m.out);
  }
  return drifts;
}

function generateAll() {
  for (const m of MIRRORS) {
    const expected = buildExpected(m);
    fs.writeFileSync(path.join(ROOT, m.out), expected, 'utf8');
    console.log('生成 ' + m.out + '（源 ' + m.src + '）');
  }
}

function run(argv) {
  if (argv.indexOf('--check') >= 0) {
    const drifts = checkAll();
    if (drifts.length) {
      console.error('镜像与唯一源不一致，请运行 `npm run gen:mirror` 重建：\n' + drifts.join('\n'));
      process.exit(1);
    }
    console.log('镜像校验通过：' + MIRRORS.map((m) => m.out).join(', ') + ' 与唯一源一致。');
  } else {
    generateAll();
    console.log('完成：' + MIRRORS.length + ' 个镜像已生成。');
  }
}

if (require.main === module) run(process.argv.slice(2));

module.exports = { MIRRORS, bodyOf, buildExpected, checkAll, generateAll, run };
