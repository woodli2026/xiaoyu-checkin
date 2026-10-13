// mirror-sync.test.js —— D1 单源防漂移守卫
// 校验全部生成式镜像（tools/gen-mirror.js 的 MIRRORS + SECTIONS）与各自唯一源一致：
//   · whole   整文件镜像：seed、pets
//   · section 区间镜像：domain.js（util/streak/level/checkInCore/redeemCore）、tasks.js（visibility）
// 只要有人手改了镜像、或改了源却忘跑 `npm run gen:mirror`，npm test 立即变红。
const test = require('node:test');
const assert = require('node:assert');
// require.main 守卫保证这里 require 不会触发生成动作，仅取导出
const gen = require('../tools/gen-mirror');

test('全部生成式镜像与唯一源一致（防手改镜像 / 防漏 gen:mirror）', () => {
  const drifts = gen.checkAll();
  assert.deepStrictEqual(
    drifts, [],
    '镜像与唯一源不一致，请运行 `npm run gen:mirror` 重建：\n' + drifts.join('\n')
  );
});

// 覆盖范围从生成器配置**派生**，不写死名字数组 ——
// 否则每加一个镜像都要连带改本用例（守卫不该制造摩擦，checkAll() 已自动覆盖全部条目）。
test('生成器覆盖范围：whole 镜像覆盖纯逻辑组，section 注入不重名', () => {
  const whole = gen.MIRRORS.map((m) => m.name);
  const sections = gen.SECTIONS.map((s) => s.name);

  // 核心纯逻辑必须在列（这些是「唯一源」的实质内容，删了就是退化）
  for (const required of ['seed', 'pets', 'dashboard']) {
    assert.ok(whole.indexOf(required) >= 0, '缺少 whole 镜像：' + required);
  }
  for (const required of ['util', 'streak', 'level', 'checkInCore', 'redeemCore', 'visibility', 'buildFeed']) {
    assert.ok(sections.indexOf(required) >= 0, '缺少 section 镜像：' + required);
  }

  // 名字不得重复（whole 与 section 是两套命名空间，但各自内部必须唯一）
  assert.strictEqual(new Set(whole).size, whole.length, 'whole 镜像名重复：' + whole.join(', '));
  assert.strictEqual(new Set(sections).size, sections.length, 'section 镜像名重复：' + sections.join(', '));

  // 每条配置都必须指向真实存在的文件（防止配了个不存在的路径却一直绿）
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..');
  for (const m of gen.MIRRORS) {
    assert.ok(fs.existsSync(path.join(ROOT, m.src)), 'whole 镜像源不存在：' + m.src);
  }
  for (const s of gen.SECTIONS) {
    assert.ok(fs.existsSync(path.join(ROOT, s.src)), 'section 源不存在：' + s.src);
    assert.ok(fs.existsSync(path.join(ROOT, s.out)), 'section 产物不存在：' + s.out);
  }
});
