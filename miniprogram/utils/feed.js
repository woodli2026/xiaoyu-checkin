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

// 动态列表数据聚合（纯函数）—— buildFeed 正文由 gen-mirror 从 cloudfunctions/lib/feed.js 注入（勿手改）。
// 仅做「原始记录 → 列表项」的 join/投影 + 排序 + 分页；分组/时间文案见上方 groupByDay。
//
// 注入正文使用裸常量名 DEFAULT_LIMIT / MAX_LIMIT（与云端源一致），故在此定义；
// 对外导出仍保留 FEED_ 前缀（避免与页面其他常量撞名）。
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const FEED_DEFAULT_LIMIT = DEFAULT_LIMIT;
const FEED_MAX_LIMIT = MAX_LIMIT;

// ==MIRROR-SLOT:buildFeed (AUTO-GENERATED ← cloudfunctions/lib/feed.js)==
// 以下段由 tools/gen-mirror.js 注入 miniprogram/utils/feed.js 的同名 SLOT（勿在此处写云端专属代码）。
function buildFeed(raw) {
  const { children, tasks, rewards, checkIns, redemptions, limit, skip } = raw;
  const childMap = {};
  (children || []).forEach(c => { childMap[c._id] = c; });
  const taskMap = {};
  (tasks || []).forEach(t => { taskMap[t._id] = t; });
  const rewardMap = {};
  (rewards || []).forEach(r => { rewardMap[r._id] = r; });

  const items = [];
  (checkIns || []).forEach(ci => {
    const c = childMap[ci.childId];
    if (!c) return;
    const t = taskMap[ci.taskId];
    const stars = Number(ci.score) || (t ? Number(t.score) : 0) || 0;
    items.push({
      id: ci._id, kind: 'checkin',
      childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
      refId: ci.taskId, title: t ? t.title : '（任务已删除）', icon: t ? t.icon : '❔',
      stars, delta: stars,
      date: ci.date || null, createdAt: ci.createdAt || 0, deleted: !!(t && t.deleted),
      // 详情用
      taskType: t ? (t.type || '') : '', repeat: t && t.repeat ? t.repeat : null,
      priority: t ? (t.priority || 'none') : 'none'
    });
  });
  (redemptions || []).forEach(rd => {
    const c = childMap[rd.childId];
    if (!c) return;
    const r = rewardMap[rd.rewardId];
    const cost = Number(rd.cost) || (r ? Number(r.cost) : 0) || 0;
    items.push({
      id: rd._id, kind: 'redeem',
      childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
      refId: rd.rewardId, title: r ? r.title : '（奖励已删除）', icon: r ? r.icon : '❔',
      stars: cost, delta: -cost,
      date: null, createdAt: rd.createdAt || 0, deleted: !!(r && r.deleted),
      // 详情用
      category: r ? (r.category || 'reward') : 'reward',
      resetAfterRedeem: r ? !!r.resetAfterRedeem : true
    });
  });

  items.sort((a, b) => b.createdAt - a.createdAt);
  const total = items.length;
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sk = Math.max(Number(skip) || 0, 0);
  const page = items.slice(sk, sk + lim);
  return { items: page, hasMore: sk + page.length < total, total };
}
// ==MIRROR-SLOT-END==

module.exports = { clockText, timeText, dayLabel, deltaText, kindLabel, isBackfill, groupByDay, buildFeed, FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT };
