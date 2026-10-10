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

test('生成器覆盖范围：whole 2 条 + section 6 条 / 4 个产物', () => {
  assert.deepStrictEqual(gen.MIRRORS.map((m) => m.name), ['seed', 'pets']);
  assert.deepStrictEqual(
    gen.SECTIONS.map((s) => s.name),
    ['util', 'streak', 'level', 'checkInCore', 'redeemCore', 'visibility']
  );
  const outs = [...new Set(gen.SECTIONS.map((s) => s.out))];
  assert.deepStrictEqual(outs, ['miniprogram/utils/domain.js', 'miniprogram/utils/tasks.js']);
});
