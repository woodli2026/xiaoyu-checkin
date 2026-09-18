// utils/feed.js —— 动态列表的纯展示辅助（无 wx 依赖，可单测）
const D = require('./domain');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 时间戳 → '14:30'
function clockText(ts) {
  const d = new Date(ts || 0);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// 时间戳 → '今天 14:30' / '昨天 09:05' / '9月17日 21:00' / '2025年12月3日 08:00'
function timeText(ts, todayYmd) {
  if (!ts) return '';
  const d = new Date(ts);
  const ds = D.ymd(d);
  const hm = clockText(ts);
  if (todayYmd && ds === todayYmd) return '今天 ' + hm;
  if (todayYmd && ds === D.addDays(todayYmd, -1)) return '昨天 ' + hm;
  const y = d.getFullYear();
  const sameYear = !todayYmd || String(todayYmd).slice(0, 4) === String(y);
  return (sameYear ? '' : y + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

// 分组标题：今天 / 昨天 / 9月17日 / 2025年12月3日
function dayLabel(dateStr, todayYmd) {
  if (!dateStr) return '未知日期';
  if (todayYmd && dateStr === todayYmd) return '今天';
  if (todayYmd && dateStr === D.addDays(todayYmd, -1)) return '昨天';
  const p = String(dateStr).split('-').map(Number);
  const sameYear = !todayYmd || String(todayYmd).slice(0, 4) === String(p[0]);
  return (sameYear ? '' : p[0] + '年') + p[1] + '月' + p[2] + '日';
}

// 星星变化文案：+3 / -5
function deltaText(n) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : '') + v;
}

function kindLabel(kind) { return kind === 'redeem' ? '兑换' : '打卡'; }

// 归属日 ≠ 记录日 → 补录（打卡可对历史日期补打）
function isBackfill(item) {
  if (!item || item.kind !== 'checkin' || !item.date) return false;
  return item.date !== D.ymd(new Date(item.createdAt || 0));
}

// 列表分组：按「归属日」（打卡取 date、兑换取记录日）分组，保持传入顺序（列表已按时间倒序）
function groupByDay(items, todayYmd) {
  const groups = [];
  const byKey = {};
  (items || []).forEach((it) => {
    const key = it.date || D.ymd(new Date(it.createdAt || 0));
    if (!byKey[key]) {
      byKey[key] = { key, label: dayLabel(key, todayYmd), items: [] };
      groups.push(byKey[key]);
    }
    byKey[key].items.push(Object.assign({}, it, {
      time: timeText(it.createdAt, todayYmd),
      deltaText: deltaText(it.delta),
      backfill: isBackfill(it)
    }));
  });
  return groups;
}

module.exports = { clockText, timeText, dayLabel, deltaText, kindLabel, isBackfill, groupByDay };
