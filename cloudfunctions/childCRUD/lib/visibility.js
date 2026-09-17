// cloudfunctions/lib/visibility.js —— 任务在某日是否需要打卡（纯函数）
function toDate(str) {
  const p = String(str).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// 任务在某日是否需要打卡
// 规则（2026-09-17 调整）：
//   ① 未生效（dateStr < 生效日期）→ 不显示
//   ② 未设重复 → 生效后「每天」都显示（原为「仅生效当天」，与打卡场景不符：
//      任务只在创建当天能打卡，第二天就消失）
//   ③ 每 N 天 / 按周 → 仍按重复规则出现
function taskVisibleOn(task, dateStr) {
  if (!task || task.deleted) return false;
  const start = task.date;
  const r = task.repeat || {};
  if (start && dateStr < start) return false;   // 还没到生效日期
  if (!r.enabled) return true;                  // 生效后每天都可见
  if (r.type === 'day') {
    if (!start) return true;
    const diff = daysBetween(start, dateStr);
    const iv = r.interval || 1;
    return diff >= 0 && diff % iv === 0;
  }
  if (r.type === 'week') {
    const wds = r.weekdays || [];
    return wds.indexOf(toDate(dateStr).getDay()) >= 0;
  }
  return false;
}

module.exports = { toDate, daysBetween, taskVisibleOn };
