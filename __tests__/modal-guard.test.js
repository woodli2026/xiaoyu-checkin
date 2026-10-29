const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const ALLOWED = path.resolve(ROOT, 'utils', 'modal.js');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p, out); continue; }
    if (/\.js$/.test(name)) out.push(p);
  }
  return out;
}

// 匹配「定义」而非「调用」：函数声明 function modal( 或赋值 modal = ( 的 Promise 包装。
// 调用点 await modal({ 不含 =，const { modal } = require 不含 =(，均不命中。
const DEF_RE = /(function\s+modal\s*\(|[^.\w]modal\s*=\s*\()/;

test('modal 定义仅存在于 utils/modal.js（无页面级重复定义）', () => {
  const files = walk(ROOT, []);
  for (const f of files) {
    if (path.resolve(f) === ALLOWED) continue;
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(
      !DEF_RE.test(src),
      '发现重复的 modal 定义：' + f + '\n请改用 const { modal } = require(\'../../utils/modal\')'
    );
  }
});

test('modal 契约：success 透传 res、fail 退化为 { confirm:false }', async () => {
  let mode = 'ok';
  global.wx = {
    showModal: (o) => {
      if (mode === 'fail') o.fail({ errMsg: 'fail' });
      else o.success({ confirm: true, cancel: false });
    }
  };
  const { modal } = require('../miniprogram/utils/modal');
  const okRes = await modal({ title: 't' });
  assert.strictEqual(okRes.confirm, true);
  mode = 'fail';
  const failRes = await modal({ title: 't' });
  assert.strictEqual(failRes.confirm, false);
});
