// services/local/checkin.js —— 本地兜底层：打卡（D3 拆分）
const { s, ok, fail, allChildren, saveChildren, allTasks, allCheckIns, saveCheckIns, allPoints, savePoints, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');

// ============ 写操作 ============

async function checkIn({ childId, taskId, date, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const children = allChildren();
  const child = children.find(c => c._id === childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');
  const d = date || D.ymd(new Date());
  const tasks = allTasks();
  const task = tasks.find(t => t._id === taskId && !t.deleted);
  if (!task) return fail('TASK_NOT_FOUND', '任务不存在或已删除');
  if (!(Number(task.score) > 0)) return fail('INVALID', '星星数非法');

  const checkIns = allCheckIns();
  if (checkIns.some(c => c.childId === childId && c.taskId === taskId && c.date === d)) {
    return fail('ALREADY_DONE', '今日已打卡');
  }

  const upd = D.applyCheckIn(child, task.score, d);
  child.totalStars = upd.totalStars;
  child.lastCheckInDate = upd.lastCheckInDate;
  saveChildren(children);

  checkIns.push({ _id: s.nextId('ci'), childId, taskId, date: d, score: task.score, createdAt: Date.now() });
  saveCheckIns(checkIns);

  const pts = allPoints();
  pts.push({ _id: s.nextId('p'), childId, delta: task.score, reason: '打卡:' + task.title, refType: 'checkin', refId: taskId, createdAt: Date.now() });
  savePoints(pts);

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const streak = D.displayStreak(
    new Set(checkIns.filter(c => c.childId === childId).map(c => c.date)),
    D.ymd(new Date())
  );
  return ok({ totalStars: child.totalStars, streak, level: D.levelOf(streak) });
}

module.exports = { checkIn };
