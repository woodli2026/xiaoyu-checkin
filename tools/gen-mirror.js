// tools/gen-mirror.js —— D1 单源：从唯一源生成前端镜像
//
// 两种模式：
//   whole   —— 整文件镜像：产物 = banner + [head] +（源中 `// ==MIRROR-BODY-START==` 之后的正文）
//   section —— 区间镜像：把源中 `// ==MIRROR-SECTION:<name>==` … `// ==MIRROR-SECTION-END==`
//              之间的内容，注入目标文件同名的 SLOT 区间（目标其余内容原样保留）
//
// 用法：
//   node tools/gen-mirror.js            # 生成/覆盖镜像（= npm run gen:mirror）
//   node tools/gen-mirror.js --check    # 只校验镜像与源一致（漂移则非零退出 = npm run verify:mirror）
//
// 为何生成而非共用：小程序不能 require 仓库外路径（cloudfunctions/），故前端只能持有副本；
// 生成式镜像把「两份手写」降为「一份手写 + 一份机生成」，从根上消除漂移。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BODY_MARKER = '// ==MIRROR-BODY-START==';
const SEC_END = '// ==MIRROR-SECTION-END==';
const SLOT_END = '// ==MIRROR-SLOT-END==';
const norm = (s) => s.replace(/\r\n/g, '\n');
const secStart = (name) => '// ==MIRROR-SECTION:' + name + '==';
const slotHeader = (name, src) => '// ==MIRROR-SLOT:' + name + ' (AUTO-GENERATED ← ' + src + ')==';
const slotRe = (name) => new RegExp('// ==MIRROR-SLOT:' + name + ' \\(AUTO-GENERATED[^\\n]*==\\n[\\s\\S]*?// ==MIRROR-SLOT-END==');

// ———————————————— whole：整文件镜像 ————————————————
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
  },
  {
    name: 'pets',
    src: 'cloudfunctions/lib/pets.js',
    out: 'miniprogram/utils/pets.js',
    banner: [
      '// utils/pets.js —— 宠物模块纯逻辑（无 wx / 无 IO）· 自动生成的镜像，请勿手改！',
      '//',
      '// 唯一源：cloudfunctions/lib/pets.js',
      '// 生成：npm run gen:mirror      校验：npm run verify:mirror（已接入 npm test）',
      '// 覆盖：物种 / 五阶段 / 命名校验 / 心情衰减 / 互动连续天数 / 互动统计',
      '// 行为一致性另由 __tests__/pet.test.js 的「双份实现一致」用例守卫。'
    ],
    // 前端特有前置（云端 pets.js 为 require('./util')+require('./streak') 合并，前端用 utils/domain 统一提供）
    head: ["const D = require('./domain');"]   // lint-ignore（此串是「被生成的代码文本」，非本文件的真 require）
  }
];

// ———————————————— section：区间镜像（源段 → 目标 SLOT）————————————————
const SECTIONS = [
  { name: 'util',        src: 'cloudfunctions/lib/util.js',        out: 'miniprogram/utils/domain.js' },
  { name: 'streak',      src: 'cloudfunctions/lib/streak.js',      out: 'miniprogram/utils/domain.js' },
  { name: 'level',       src: 'cloudfunctions/lib/level.js',       out: 'miniprogram/utils/domain.js' },
  { name: 'checkInCore', src: 'cloudfunctions/lib/checkInCore.js', out: 'miniprogram/utils/domain.js' },
  { name: 'redeemCore',  src: 'cloudfunctions/lib/redeemCore.js',  out: 'miniprogram/utils/domain.js' },
  { name: 'visibility',  src: 'cloudfunctions/lib/visibility.js',  out: 'miniprogram/utils/tasks.js' }
];

// 取唯一源中标记行之后的正文（去掉标记行与随后的空行）
function bodyOf(src) {
  const idx = src.indexOf(BODY_MARKER);
  if (idx < 0) throw new Error('唯一源缺少镜像标记 ' + BODY_MARKER);
  const afterMarkerLine = src.slice(src.indexOf('\n', idx) + 1);
  return afterMarkerLine.replace(/^\n+/, '');
}

// 依据唯一源计算 whole 镜像应有的完整文本
function buildExpected(m) {
  const src = norm(fs.readFileSync(path.join(ROOT, m.src), 'utf8'));
  const head = m.head ? m.head.join('\n') + '\n\n' : '';
  return m.banner.join('\n') + '\n\n' + head + bodyOf(src);
}

// 取源文件中 SECTION 区间的内容（去掉首尾空行，末尾补单换行；空段返回空串）
function sectionBody(srcText, name) {
  const startTok = secStart(name);
  const i = srcText.indexOf(startTok);
  if (i < 0) throw new Error('源缺少 ' + startTok + '（' + name + '）');
  const j = srcText.indexOf(SEC_END, i);
  if (j < 0) throw new Error('源缺少 ' + SEC_END + '（' + name + '）');
  const body = srcText.slice(srcText.indexOf('\n', i) + 1, j).replace(/^\n+/, '').replace(/\n+$/, '');
  return body.length ? body + '\n' : '';
}

// 把一条 section 注入目标文本（返回新文本，不落盘）
function renderSlot(outText, s) {
  const srcText = norm(fs.readFileSync(path.join(ROOT, s.src), 'utf8'));
  const block = slotHeader(s.name, s.src) + '\n' + sectionBody(srcText, s.name) + SLOT_END;
  const re = slotRe(s.name);
  if (!re.test(outText)) throw new Error('目标缺少 SLOT: ' + s.name + '（' + s.out + '）');
  // 用函数形式替换：正文含 `$`（模板字符串）时字符串形式会误解析
  return outText.replace(re, () => block);
}

// 计算某个目标文件在全部 section 注入后的文本
function buildSectionOut(outRel) {
  let text = norm(fs.readFileSync(path.join(ROOT, outRel), 'utf8'));
  for (const s of SECTIONS.filter((x) => x.out === outRel)) text = renderSlot(text, s);
  return text;
}

const sectionOuts = () => [...new Set(SECTIONS.map((s) => s.out))];

// 返回漂移的镜像列表（空 = 全部一致）
function checkAll() {
  const drifts = [];
  for (const m of MIRRORS) {
    const expected = buildExpected(m);
    const outPath = path.join(ROOT, m.out);
    const actual = fs.existsSync(outPath) ? norm(fs.readFileSync(outPath, 'utf8')) : null;
    if (actual !== expected) drifts.push(m.out + '（whole:' + m.name + '）');
  }
  for (const out of sectionOuts()) {
    if (norm(fs.readFileSync(path.join(ROOT, out), 'utf8')) !== buildSectionOut(out)) drifts.push(out + '（section）');
  }
  return drifts;
}

function generateAll() {
  for (const m of MIRRORS) {
    fs.writeFileSync(path.join(ROOT, m.out), buildExpected(m), 'utf8');
    console.log('生成 ' + m.out + '（whole ← ' + m.src + '）');
  }
  for (const out of sectionOuts()) {
    fs.writeFileSync(path.join(ROOT, out), buildSectionOut(out), 'utf8');
    console.log('生成 ' + out + '（section 注入）');
  }
}

function run(argv) {
  if (argv.indexOf('--check') >= 0) {
    const drifts = checkAll();
    if (drifts.length) {
      console.error('镜像与唯一源不一致，请运行 `npm run gen:mirror` 重建：\n' + drifts.join('\n'));
      process.exit(1);
    }
    console.log('镜像校验通过：' + [...MIRRORS.map((m) => m.out), ...sectionOuts()].join(', ') + ' 与唯一源一致。');
  } else {
    generateAll();
    console.log('完成：' + (MIRRORS.length + sectionOuts().length) + ' 个镜像已生成。');
  }
}

if (require.main === module) run(process.argv.slice(2));

module.exports = { MIRRORS, SECTIONS, bodyOf, buildExpected, sectionBody, renderSlot, buildSectionOut, checkAll, generateAll, run };
