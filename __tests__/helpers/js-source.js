// __tests__/helpers/js-source.js —— 守卫测试用的「源码文本分析」工具（单一来源）
//
// 【为什么需要】守卫要从生产源码里「提取字面量 / 函数体再求值」，此前这套工具在
// child-rules-guard / mirror-guard / view-shape-guard / aggregate-guard 各抄一份，并已
// 悄悄分叉：strip 有「字符串感知」与「朴素正则」两版，functionBlock 有「含签名」与
// 「仅函数体」两版。收敛到本模块，消除这部分漂移面（候选 ⑥）。
//
// 约定：
//   - strip 的规范实现在 tools/lint.js（tools 不可依赖 __tests__，故此处只 re-export）。
//   - functionBlock 统一返回「含签名的完整函数文本」（async 感知 + 括号感知），
//     可同时满足「整体 eval」与「仅在函数体内找锚点」两类调用。
//   - 所有函数均为 AST 级（跳过字符串/模板/注释），禁止用朴素正则替代（会 100% 误报）。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { strip } = require('../../tools/lint');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const keysOf = (o) => Object.keys(o).sort();

// 从 openIdx（指向 '{'）起扫描，跳过字符串/模板/注释，返回匹配的右括号索引
function matchBrace(src, openIdx) {
  let depth = 0, inStr = null, esc = false, lineC = false, blockC = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && src[i + 1] === '/') { blockC = false; i++; } continue; }
    if (esc) { esc = false; continue; }
    if (inStr) { if (ch === '\\') { esc = true; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && src[i + 1] === '/') { lineC = true; i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('未匹配到右括号');
}

// 返回 anchor 之后第一个 '{' 起的完整 "{...}" 文本
function objectLiteralAfter(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const b = src.indexOf('{', a);
  if (b < 0) throw new Error('anchor 后无 {');
  return src.slice(b, matchBrace(src, b) + 1);
}

// 返回 anchor 之后第一个 '{' 起的完整 "{...}" 块（用于提取箭头函数体）
function arrowBlock(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const i = src.indexOf('=>', a);
  const b = src.indexOf('{', i);
  return src.slice(b, matchBrace(src, b) + 1);
}

// 括号感知地提取具名函数（含签名），正确处理 `async function f({ op }) { ... }` 之类的解构参数
function functionBlock(src, fnName) {
  const sig = (src.includes('async function ' + fnName) ? 'async function ' : 'function ') + fnName;
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('找不到函数: ' + fnName);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) break; }
  }
  const b = src.indexOf('{', i);
  return src.slice(start, matchBrace(src, b) + 1);
}

// '(' + span + ')' 后在沙箱中求值（用于把提取出的字面量/函数文本变成真值）
function evalObj(span, sandbox) { return vm.runInNewContext('(' + span + ')', sandbox); }
function evalInContext(code, sandbox) { return vm.runInNewContext(code, sandbox); }

module.exports = {
  ROOT, read, keysOf, strip, matchBrace,
  objectLiteralAfter, arrowBlock, functionBlock, evalObj, evalInContext
};
