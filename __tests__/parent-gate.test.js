// __tests__/parent-gate.test.js
//
// 家长模式「开关 + 闸门」收拢（候选④，2026-10-11）。
//
// 背景：同一个判定在 5 个页面散成 8 处，有 5 种文案、2 种真值来源、2 种失败表现：
//   home:210/240  '请点击右上角锁图标开启家长模式'   ← this.data.mode
//   tasks:69      '请点击首页右上角锁图标开启家长模式' ← this.data.mode（return false）
//   pet:91/144/199 '投喂/领养/（空）需家长模式'        ← this.data.mode
//   feed:106      '请点击右上角锁图标开启家长模式'      ← this.data.mode（setData detailErr）
//   mine:86/138   '请先进入家长模式'                   ← app.globalData.mode / getApp().globalData.mode
// 且 toggleParent 有 3 份拷贝（home 与 feed 逐字相同，mine 只差一句 toast）。
//
// 修法：家长模式「怎么进、怎么拦」收进 utils/parent-gate.js（纯函数）+ behaviors/parent-gate.js（薄壳）。
// 真值统一为 app.globalData.mode（data.mode 是渲染副本，可能滞后）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT, strip } = require('./helpers/js-source');
const gate = require('../miniprogram/utils/parent-gate');

// 记录 toast / setData，便于断言
let TOASTS = [];
global.wx = { showToast: (o) => TOASTS.push(o) };

function makeCtx(state) {
  const app = {
    globalData: { mode: (state && state.appMode) || 'display' },
    clearParent() { this._cleared = true; }
  };
  return {
    data: Object.assign({ mode: 'display', pinSet: true, showPin: false, pinError: '' }, state && state.data),
    setData(o) { Object.assign(this.data, o); },
    getApp() { return app; },
    _app: app
  };
}

test('前置：wx.showToast 桩可用', () => {
  TOASTS = [];
  global.wx.showToast({ title: 'x' });
  assert.strictEqual(TOASTS.length, 1);
});

// ---------- requireParent：闸门 ----------

test('requireParent：已是家长模式 → true，无任何提示', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'parent' });
  assert.strictEqual(gate.requireParent(ctx), true);
  assert.strictEqual(TOASTS.length, 0, '已是家长模式不应提示');
});

test('requireParent：非家长模式 → false + 默认文案 toast', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'display' });
  assert.strictEqual(gate.requireParent(ctx), false);
  assert.strictEqual(TOASTS.length, 1);
  assert.ok(TOASTS[0].title.length > 0, '提示文案不得为空');
});

test('requireParent：可传自定义文案', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'display' });
  gate.requireParent(ctx, { msg: '投喂需家长模式' });
  assert.strictEqual(TOASTS[0].title, '投喂需家长模式');
});

test('requireParent：errField 走 setData 而非 toast（动态页详情内提示）', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'display' });
  const ok = gate.requireParent(ctx, { errField: 'detailErr', msg: '请先开启家长模式' });
  assert.strictEqual(ok, false);
  assert.strictEqual(TOASTS.length, 0, 'errField 场景不应弹 toast');
  assert.strictEqual(ctx.data.detailErr, '请先开启家长模式');
});

test('requireParent：真值取 app.globalData.mode（权威），不受 data.mode 滞后影响', () => {
  const ctx = makeCtx({ appMode: 'parent' });
  ctx.data.mode = 'display';   // data 副本滞后
  assert.strictEqual(gate.requireParent(ctx), true, '应以 globalData.mode 为准');
});

// ---------- toggleParent：开关 ----------

test('toggleParent：已是家长模式 → 退出（clearParent + mode=display + 提示）', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'parent' });
  gate.toggleParent(ctx);
  assert.strictEqual(ctx._app._cleared, true, '应调用 app.clearParent()');
  assert.strictEqual(ctx.data.mode, 'display');
  assert.strictEqual(TOASTS.length, 1);
});

test('toggleParent：未设置 PIN → 提示去设置，不弹 PIN 面板', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'display', data: { pinSet: false } });
  gate.toggleParent(ctx);
  assert.strictEqual(ctx.data.showPin, false, '未设 PIN 不应打开面板');
  assert.strictEqual(TOASTS.length, 1);
});

test('toggleParent：已设 PIN → 打开 PIN 面板并清空错误提示', () => {
  TOASTS = [];
  const ctx = makeCtx({ appMode: 'display', data: { pinSet: true, pinError: '上次错了' } });
  gate.toggleParent(ctx);
  assert.strictEqual(ctx.data.showPin, true);
  assert.strictEqual(ctx.data.pinError, '');
});

// ---------- 静态守卫：不得在各页重写 ----------

const PAGES = ['home/home', 'pet/pet', 'tasks/tasks', 'feed/feed', 'mine/mine'];
const readPage = (p, ext) => fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', p + '.' + ext), 'utf8');

test('静态守卫：五页不得自写 toggleParent（应走 behavior）', () => {
  const bad = PAGES.filter((p) => /toggleParent\s*\(/.test(strip(readPage(p, 'js'))));
  assert.deepStrictEqual(bad, [], '以下页面自写了 toggleParent：' + bad.join(', '));
});

test('静态守卫：五页不得内联家长模式闸门（应走 requireParent）', () => {
  const bad = PAGES.filter((p) => /mode\s*!==\s*'parent'/.test(strip(readPage(p, 'js'))));
  assert.deepStrictEqual(bad, [], '以下页面内联了家长模式判定：' + bad.join(', '));
});

test('静态守卫：onAppTouch 死链路已清除（js 方法 + wxml 绑定 + app.touch）', () => {
  for (const p of PAGES) {
    assert.ok(!/onAppTouch/.test(readPage(p, 'js')), p + '.js 仍有 onAppTouch');
    assert.ok(!/onAppTouch/.test(readPage(p, 'wxml')), p + '.wxml 仍有 onAppTouch 绑定');
  }
  const app = strip(fs.readFileSync(path.join(ROOT, 'miniprogram', 'app.js'), 'utf8'));
  assert.ok(!/\btouch\s*\(/.test(app), 'app.js 仍定义 touch()');
});

test('静态守卫：五页均接入 parent-gate behavior', () => {
  const missing = PAGES.filter((p) => !/parent-gate/.test(readPage(p, 'js')));
  assert.deepStrictEqual(missing, [], '以下页面未接入 behaviors/parent-gate：' + missing.join(', '));
});

// ---------- Behavior 装配守卫（真机失效类 bug 的防线） ----------
//
// 教训（2026-10-11 线上回归）：behaviors/parent-gate.js 曾把 toggleParent/requireParent
// 直接写在 Behavior 顶层。Behavior 只注册固定字段（methods/data/...），**顶层自定义函数
// 不会被注册为方法** → 真机上 `this.requireParent` 为 undefined → 五页所有走到闸门的写操作
// （打卡/投喂/新增删除任务…）全部抛错。纯函数单测测不到（只覆盖 utils），必须断言 Behavior 形状。
// 通用形状检查见 __tests__/behavior-shape.test.js；此处只锁本文件必须提供的方法名。
function loadBehavior(rel) {
  const prev = global.Behavior;
  global.Behavior = (def) => def;   // 捕获定义对象，不做真实注册
  try {
    const abs = require.resolve(rel);
    delete require.cache[abs];
    return require(rel);
  } finally {
    global.Behavior = prev;
  }
}

test('装配守卫：behaviors/parent-gate 必须提供 requireParent / toggleParent 页面方法', () => {
  const def = loadBehavior('../miniprogram/behaviors/parent-gate');
  assert.ok(def.methods, '缺少 methods 块（页面方法必须放进 methods 内）');
  assert.strictEqual(typeof def.methods.requireParent, 'function', 'requireParent 未注册为页面方法');
  assert.strictEqual(typeof def.methods.toggleParent, 'function', 'toggleParent 未注册为页面方法');
});

test('真值来源：页面实例无 .getApp 时回退全局 getApp()（真机行为）', () => {
  const prev = global.getApp;
  global.getApp = () => ({ globalData: { mode: 'parent' } });
  try {
    // 真机页面实例没有 .getApp 方法；data.mode 是可能滞后的副本
    const ctx = { data: { mode: 'display' }, setData() {} };
    assert.strictEqual(gate.isParent(ctx), true, '应回退到全局 getApp() 读 globalData.mode');
    assert.strictEqual(gate.requireParent(ctx), true, '家长模式下闸门应放行');
  } finally {
    if (prev === undefined) delete global.getApp; else global.getApp = prev;
  }
});
