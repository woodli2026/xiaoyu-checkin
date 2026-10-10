// @ts-check
// utils/calendar.js —— 日历视图纯函数（无 wx / 无 IO，可单测）
const T = require('./tasks');

/**
 * 两位补零
 * @param {number} n
 * @returns {string}
 */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 'YYYY-MM' 按 delta 增减月份（自动进位 / 退位）
 * @param {string} ym
 * @param {number} delta
 * @returns {string}
 */
function shiftYm(ym, delta) {
  const parts = String(ym).split('-').map(Number);
  let y = parts[0];
  let m = parts[1] + Number(delta || 0);
  if (m > 12) { m = 1; y += 1; }
  else if (m < 1) { m = 12; y -= 1; }
  return y + '-' + pad2(m);
}

/**
 * 生成某月日历格：首行前置空白 + 每日格。
 * lit=当日有打卡记录；today=今日；done=当日「全部可见任务已完成」（T.dayAllDone）。
 * @param {Array<Object>} allTasks 全部任务（含 deleted 过滤后的可见性判定交给 dayAllDone）
 * @param {Array<{ date: string }>} checkIns 打卡流水
 * @param {string} viewYm 目标月份 'YYYY-MM'
 * @param {string} today 今日 'YYYY-MM-DD'
 * @returns {{ cells: Array<Object>, label: string }}
 */
function buildCalendar(allTasks, checkIns, viewYm, today) {
  const parts = String(viewYm).split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const startWd = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const litSet = new Set((checkIns || []).map((c) => c.date));
  const cells = [];
  for (let i = 0; i < startWd; i++) cells.push({ key: 'b' + i, blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = y + '-' + pad2(m) + '-' + pad2(d);
    cells.push({
      key: ds, day: d, date: ds,
      lit: litSet.has(ds),
      today: ds === today,
      done: T.dayAllDone(allTasks, checkIns, ds)
    });
  }
  return { cells, label: y + '年' + m + '月' };
}

module.exports = { shiftYm, buildCalendar };
