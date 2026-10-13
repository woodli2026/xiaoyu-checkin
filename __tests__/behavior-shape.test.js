// __tests__/behavior-shape.test.js —— 通用 Behavior 装配守卫
//
// 【为什么需要】2026-10-11 线上回归：behaviors/parent-gate.js 把 toggleParent/requireParent
// 写在了 Behavior 的**顶层**。Behavior 只注册固定字段（data/properties/methods/lifetimes…），
// 顶层自定义函数**不会**被注册为页面方法 → 真机上 `this.requireParent` 为 undefined →
// 五页所有走到闸门的写操作（打卡 / 投喂 / 新增·删除任务 …）全部抛错。
//
// 纯函数单测（utils/*）测不到这类问题——它们验证的是行为逻辑，不是「方法有没有被挂上」。
// 本守卫直接加载每个 behavior 定义，断言其形状：只允许固定字段，页面方法必须放进 methods。
//
// 加载方式：把全局 Behavior 换成「捕获定义对象」的桩（不真正注册），再 require 文件。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'miniprogram', 'behaviors');

// Behavior 定义允许的顶层字段（见官方 behaviors 文档）
const ALLOWED_FIELDS = new Set([
  'data', 'properties', 'methods', 'behaviors', 'lifetimes', 'observers', 'created',
  'attached', 'ready', 'moved', 'detached', 'relations', 'externalClasses', 'options',
  'pageLifetimes', 'definitionFilter'
]);

function loadBehavior(abs) {
  const prev = global.Behavior;
  global.Behavior = (def) => def;   // 捕获定义，不注册
  try {
    delete require.cache[abs];
    return require(abs);
  } finally {
    global.Behavior = prev;
  }
}

test('通用装配守卫：每个 behaviors/*.js 只使用固定顶层字段（页面方法须在 methods 内）', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0, 'miniprogram/behaviors 下没有 behavior 文件（路径或结构变了？）');

  const problems = [];
  for (const f of files) {
    const abs = path.join(DIR, f);
    let def;
    try {
      def = loadBehavior(abs);
    } catch (e) {
      problems.push(f + ' 加载失败: ' + (e && e.message));
      continue;
    }
    if (!def || typeof def !== 'object') {
      problems.push(f + ' 未导出 Behavior 定义对象');
      continue;
    }
    const stray = Object.keys(def).filter((k) => !ALLOWED_FIELDS.has(k));
    if (stray.length) {
      problems.push(f + ' 顶层出现非固定字段（页面方法必须放进 methods）: ' + stray.join(', '));
    }
  }
  assert.deepStrictEqual(problems, [], 'Behavior 形状违规：\n' + problems.join('\n'));
});
