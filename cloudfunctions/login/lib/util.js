// cloudfunctions/lib/util.js —— 日期工具（纯函数，可单测）
// 【D1 单源】下方 SECTION 区间的唯一手写点在此；前端 miniprogram/utils/domain.js 的同名 SLOT
// 由 tools/gen-mirror.js（npm run gen:mirror）注入，请勿手改镜像侧（verify:mirror 会校验）。
// ==MIRROR-SECTION:util==
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, n) {
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(p[0], p[1] - 1, p[2]);
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}
// ==MIRROR-SECTION-END==

module.exports = { pad2, ymd, addDays };
