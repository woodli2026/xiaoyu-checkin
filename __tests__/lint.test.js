// lint.test.js —— D8 静态检查守卫
// ① 全仓 lint 必须零问题（纳入 npm test，防回归）
// ② 锁住「先剥离注释再匹配」这个关键前提：注释里的示例代码不得误报
// ③ 各规则必须真的能抓到违规（防止规则写废了却一直绿）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const lint = require('../tools/lint');

const ROOT = path.join(__dirname, '..');

test('全仓 lint 通过：require 路径可解析 / 无 debugger / miniprogram 无 console.log', () => {
  // 进程内调用：本机（沙箱）spawn node.exe 稳定报 EBUSY，子进程方式不可靠
  const r = lint.runAll();
  const detail = r.report.map(i => i.file + '\n' + i.hits.map(h => '   第 ' + h.line + ' 行：' + h.msg).join('\n')).join('\n');
  assert.strictEqual(r.problems, 0, 'lint 未通过：\n' + detail);
  assert.ok(r.files > 0, 'lint 未扫描到任何文件，范围配置可能失效');
});

test('关键前提：注释与字符串中的 require 不得误报', () => {
  const stripped = lint.strip("// 前端对应 require('../utils/domain')\nconst a = require('./real');\n/* require('./nope') */\n");
  assert.ok(stripped.indexOf('../utils/domain') < 0, '行注释未被剥离');
  assert.ok(stripped.indexOf("./nope") < 0, '块注释未被剥离');
  assert.ok(stripped.indexOf('./real') >= 0, '真实 require 被误删');
  // 剥离后不应再命中注释里的坏路径
  const hits = lint.ruleRequirePath(path.join(ROOT, 'miniprogram', 'x.js'), stripped);
  assert.deepStrictEqual(hits.filter(h => h.msg.indexOf('../utils/domain') >= 0), []);
});

test('R1 能抓到无法解析的 require 路径', () => {
  const file = path.join(ROOT, 'miniprogram', 'pages', 'home', 'home.js');
  const hits = lint.ruleRequirePath(file, "const ops = require('../../../ops');\n");
  assert.strictEqual(hits.length, 1, '应命中 1 条坏路径');
  assert.ok(/无法解析/.test(hits[0].msg));
  // 反向：正确的相对路径不该命中
  assert.strictEqual(lint.ruleRequirePath(file, "const ops = require('../../ops');\n").length, 0);
});

test('R2 能抓到 debugger 残留，且不把 debuggerXxx 当关键字', () => {
  assert.strictEqual(lint.ruleDebugger('function f(){ debugger; }').length, 1);
  assert.strictEqual(lint.ruleDebugger('const debuggerMode = 1;').length, 0, '标识符含 debugger 不应误报');
});

test('R3 只在 miniprogram 内禁 console.log，且放行 console.info', () => {
  const inApp = path.join(ROOT, 'miniprogram', 'app.js');
  assert.strictEqual(lint.ruleConsole(inApp, "console.log('x')").length, 1);
  assert.strictEqual(lint.ruleConsole(inApp, "console.info('x')").length, 0, 'console.info 属刻意提示，放行');
  const inTools = path.join(ROOT, 'tools', 'acceptance.js');
  assert.strictEqual(lint.ruleConsole(inTools, "console.log('x')").length, 0, 'tools 属命令行输出，不限');
});

test('行内豁免 // lint-ignore 放行「字符串里描述代码」的行（生成器场景）', () => {
  const file = path.join(ROOT, 'miniprogram', 'x.js');
  const raw = "const tpl = \"require('./does-not-exist')\";   // lint-ignore\n";
  assert.deepStrictEqual(lint.lintSource(file, raw), [], '带豁免注释的行不应报错');
  // 反向：去掉豁免注释后同一行必须命中（防豁免机制把规则废掉）
  const raw2 = "const tpl = \"require('./does-not-exist')\";\n";
  assert.strictEqual(lint.lintSource(file, raw2).length, 1, '无豁免注释时必须命中坏 require');
  assert.deepStrictEqual([...lint.ignoreLines(raw)], [1]);
  assert.deepStrictEqual([...lint.ignoreLines(raw2)], []);
});

test('生成副本 cloudfunctions/<fn>/lib/ 不参与 lint（由 verify:lib 负责）', () => {
  assert.strictEqual(lint.isGeneratedCopy('cloudfunctions/login/lib/token.js'), true);
  assert.strictEqual(lint.isGeneratedCopy('cloudfunctions/lib/token.js'), false, 'canonical 源必须被检查');
  assert.strictEqual(lint.isGeneratedCopy('miniprogram/utils/api.js'), false);
  const files = lint.collect();
  assert.ok(files.length > 0);
  assert.strictEqual(files.filter(f => lint.isGeneratedCopy(path.relative(ROOT, f))).length, 0);
});
