// mirror-sync.test.js —— D1 单源试点防漂移守卫
// 校验 miniprogram/utils/seed.js（生成式镜像）与唯一源 cloudfunctions/lib/seed.js 一致。
// 只要有人手改了镜像、或改了源却忘跑 `npm run gen:mirror`，npm test 立即变红。
const test = require('node:test');
const assert = require('node:assert');
// require.main 守卫保证这里 require 不会触发生成动作，仅取导出
const gen = require('../tools/gen-mirror');

test('seed 生成式镜像与唯一源逐字节一致（防手改镜像 / 防漏 gen:mirror）', () => {
  const drifts = gen.checkAll();
  assert.deepStrictEqual(
    drifts, [],
    '镜像与唯一源不一致，请运行 `npm run gen:mirror` 重建：\n' + drifts.join('\n')
  );
});
