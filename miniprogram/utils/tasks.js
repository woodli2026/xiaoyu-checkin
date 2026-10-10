// @ts-check
// utils/tasks.js —— 前端纯逻辑：任务可见性 / 优先级旗子 / 分组 / 标签字典
//
// 【D1 单源（2026-10-10）】下方 SLOT 段落由 `npm run gen:mirror` 从 cloudfunctions/lib/visibility.js
// 注入，请勿手改 SLOT 内内容（改源后跑 gen:mirror；`npm run verify:mirror` 会校验）。

// ==MIRROR-SLOT:visibility (AUTO-GENERATED ← cloudfunctions/lib/visibility.js)==
function toDate(str) {
  const p = String(str).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// 某任务在某日是否需要打卡
// 规则（2026-09-17 调整）：
//   ① 未生效（dateStr < 生效日期）→ 不可见
//   ② 未设重复 → 生效后「每天」都可见（原为仅生效当天，会让任务第二天就消失）
//   ③ 每 N 天 / 按周 → 按重复规则出现
function taskVisibleOn(task, dateStr) {
  if (!task || task.deleted) return false;
  const start = task.date;
  const r = task.repeat || {};
  if (start && dateStr < start) return false;
  if (!r.enabled) return true;
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
// ==MIRROR-SLOT-END==

// 优先级：高=红🚩 / 中=黄 / 低=绿 / 无=无旗
const PRIORITY = {
  high: { label: '高优先级', flag: '🚩', color: '#FF6B6B', show: true },
  mid: { label: '中优先级', flag: '🚩', color: '#FFC93C', show: true },
  low: { label: '低优先级', flag: '🚩', color: '#5FD08A', show: true },
  none: { label: '无优先级', flag: '', color: '', show: false }
};
function priorityInfo(p) { return PRIORITY[p] || PRIORITY.none; }

const TYPE_LABEL = { study: '学习', life: '生活', sport: '运动', growth: '成长' };
const TYPE_OPTIONS = [
  { value: 'study', label: '学习' },
  { value: 'life', label: '生活' },
  { value: 'sport', label: '运动' },
  { value: 'growth', label: '成长' }
];
const PRIORITY_OPTIONS = [
  { value: 'high', label: '高优先级', short: '高' },
  { value: 'mid', label: '中优先级', short: '中' },
  { value: 'low', label: '低优先级', short: '低' },
  { value: 'none', label: '无优先级', short: '无' }
];

// 列表副标题里的重复描述（设计稿 .item .ds 的「习惯 · 每日」形态）
function repeatLabel(task) {
  const r = (task && task.repeat) || {};
  if (!r.enabled) return task && task.date ? '仅 ' + task.date : '不限日期';
  if (r.type === 'week') {
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    const wds = (r.weekdays || []).slice().sort((a, b) => a - b);
    if (!wds.length) return '每周';
    return '每周' + wds.map(i => names[i]).join('');
  }
  const iv = Number(r.interval) || 1;
  return iv === 1 ? '每日' : '每 ' + iv + ' 天';
}
const CATEGORY_LABEL = { reward: '奖励', punish: '惩罚' };
const CATEGORY_OPTIONS = [
  { value: 'reward', label: '奖励' },
  { value: 'punish', label: '惩罚' }
];

// 日明细弹层分组：待打卡在前、已完成在后
function splitTasks(list) {
  const todo = [];
  const done = [];
  (list || []).forEach(t => (t.checked ? done : todo).push(t));
  return { todo, done };
}

// 某日是否「所有可见任务都已完成」——日历右上角对号的依据（而非「任意打卡」）。
// 返回 false 的两种情况：① 当天没有任何可见任务（无事可做，不显示对号）；
// ② 存在可见任务但未全部打卡。checkIns 形如 [{taskId, date}]。
function dayAllDone(tasks, checkIns, dateStr) {
  const visible = (tasks || []).filter(t => taskVisibleOn(t, dateStr));
  if (!visible.length) return false;
  const doneIds = new Set((checkIns || []).filter(c => c.date === dateStr).map(c => c.taskId));
  return visible.every(t => doneIds.has(t._id));
}

module.exports = {
  toDate, daysBetween, taskVisibleOn, priorityInfo, splitTasks, repeatLabel, dayAllDone,
  TYPE_LABEL, TYPE_OPTIONS, PRIORITY_OPTIONS, CATEGORY_LABEL, CATEGORY_OPTIONS
};
