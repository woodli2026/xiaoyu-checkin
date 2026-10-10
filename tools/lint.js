// tools/lint.js —— 零依赖静态检查（D8）
// 与 check-syntax.js 互补：check 只做语法解析，lint 做「跨文件可解析性 + 发布卫生」。
//
// 关键前提：必须先剥离注释与字符串再匹配，否则注释里的示例代码会造成大量误报
// （实测：未剥离时报 17 条坏 require，其中 100% 是注释中的 require('../utils/domain') 之类示例）。
// 剥离时保留换行，使行号仍可对应原文件（字符串内容刻意保留——require 的路径本身就在字符串里）。
// 对「字符串里描述代码」的误报（生成器等），用行内 `// lint-ignore` 豁免该行。
//
// 范围：跳过 cloudfunctions/<fn>/lib/ 的 156 个生成副本（漂移由 npm run verify:lib 负责），
// 只检查手写文件（当前 68 个）。

const fs = require('fs');
const path = require('path');

const ROOTS = ['miniprogram', 'cloudfunctions', '__tests__', 'tools'];
const SKIP_DIRS = new Set(['node_modules', '.git']);
// cloudfunctions/<函数名>/lib/ 是 setup.js 复制出来的副本；canonical 的 cloudfunctions/lib/ 要检查，
// 故只排除「两层」形式：cloudfunctions/xxx/lib/
const isGeneratedCopy = (rel) => /^cloudfunctions[\\/][^\\/]+[\\/]lib[\\/]/.test(rel);
// 自举豁免：lint 工具与其测试自身含大量「故意写坏」的样例（坏 require 路径、debugger 字符串），
// 若参与检查必然自报。规则的正确性由 __tests__/lint.test.js 单测保证。
const SELF_EXEMPT = new Set(['tools/lint.js', 'tools\\lint.js', '__tests__/lint.test.js', '__tests__\\lint.test.js']);

/** 剥离行注释/块注释/字符串内容，保留换行与其余字符，便于按行号定位 */
function strip(src) {
  let out = '';
  let inStr = null;
  let lineComment = false;
  let blockComment = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (lineComment) {
      if (c === '\n') { lineComment = false; out += '\n'; }
      i++; continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i += 2; continue; }
      if (c === '\n') out += '\n';
      i++; continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === inStr) inStr = null;
      i++; continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i += 2; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

function collect() {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full);
      } else if (name.endsWith('.js')) {
        const rel = path.relative(process.cwd(), full);
        if (isGeneratedCopy(rel) || SELF_EXEMPT.has(rel)) continue;
        files.push(full);
      }
    }
  }
  ROOTS.forEach((r) => { if (fs.existsSync(r)) walk(r); });
  return files;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

/** R1：require 相对路径必须可解析（拦 './ops' 写成 '../ops' 这类已踩过的坑） */
function ruleRequirePath(file, src) {
  const bad = [];
  const re = /(?:^|[^\w.])require\s*\(\s*(['"])(\.[^'"]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[2];
    const base = path.resolve(path.dirname(file), target);
    const ok = fs.existsSync(base) ||
      fs.existsSync(base + '.js') ||
      fs.existsSync(base + '.json') ||
      fs.existsSync(path.join(base, 'index.js'));
    if (!ok) bad.push({ line: lineOf(src, m.index), msg: 'require 路径无法解析: ' + target });
  }
  return bad;
}

/** R2：不得残留 debugger（排除 'debugger' 这类字符串字面量，故引号紧邻不算） */
function ruleDebugger(src) {
  const bad = [];
  let idx = src.indexOf('debugger');
  while (idx >= 0) {
    const before = src[idx - 1] || '';
    const after = src[idx + 'debugger'.length] || '';
    const isQuoted = /['"`]/.test(before) || /['"`]/.test(after);
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after) && !isQuoted) {
      bad.push({ line: lineOf(src, idx), msg: '残留 debugger 语句' });
    }
    idx = src.indexOf('debugger', idx + 1);
  }
  return bad;
}

/** R3：miniprogram/ 内禁止 console.log / console.debug（console.info 属刻意提示，放行） */
function ruleConsole(file, src) {
  const rel = path.relative(process.cwd(), file);
  if (!rel.startsWith('miniprogram' + path.sep) && rel !== 'miniprogram') return [];
  const bad = [];
  const re = /console\.(log|debug)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    bad.push({ line: lineOf(src, m.index), msg: '小程序代码内禁止 console.' + m[1] + '（调试残留；刻意提示请用 console.info）' });
  }
  return bad;
}

/** 行内豁免：行内含 `// lint-ignore` 则该行不参与任何规则。
 *  用原始文本（未剥离注释）判定，故豁免注释本身不会被 strip 掉。
 *  场景：生成器里「被生成的代码文本」字符串（如 gen-mirror 的 head）会伪装成真 require 被误报。 */
function ignoreLines(raw) {
  const set = new Set();
  raw.split('\n').forEach((l, i) => { if (l.indexOf('// lint-ignore') >= 0) set.add(i + 1); });
  return set;
}

/** 对单个源文件跑全部规则，返回命中列表（供 lint 主流程与单测共用） */
function lintSource(file, raw) {
  const src = strip(raw);
  const ignore = ignoreLines(raw);
  const keep = (hits) => hits.filter((h) => !ignore.has(h.line));
  return []
    .concat(keep(ruleRequirePath(file, src)))
    .concat(keep(ruleDebugger(src)))
    .concat(keep(ruleConsole(file, src)));
}

/** 扫描全仓并返回结果（供 CLI 与单测共用；单测走进程内调用，不用 spawn） */
function runAll() {
  const files = collect();
  const report = [];
  let problems = 0;
  for (const file of files) {
    const hits = lintSource(file, fs.readFileSync(file, 'utf8'));
    if (hits.length) {
      problems += hits.length;
      report.push({ file: path.relative(process.cwd(), file), hits });
    }
  }
  return { files: files.length, problems, report };
}

function main() {
  const r = runAll();
  for (const item of r.report) {
    console.error('✗ ' + item.file);
    for (const h of item.hits) console.error('   第 ' + h.line + ' 行：' + h.msg);
  }
  console.log('\nlint 完成：检查 ' + r.files + ' 个手写文件（已跳过 cloudfunctions/*/lib 生成副本），' + r.problems + ' 个问题。');
  process.exit(r.problems ? 1 : 0);
}

module.exports = { strip, ignoreLines, lintSource, collect, isGeneratedCopy, ruleRequirePath, ruleDebugger, ruleConsole, runAll };

if (require.main === module) main();
