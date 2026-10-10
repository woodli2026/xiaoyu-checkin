// services/local/task.js —— 本地兜底层：任务 CRUD（D3 拆分）
const { s, ok, fail, currentUser, allTasks, saveTasks, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');

async function taskCRUD({ op, parentToken, payload }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const tasks = allTasks();
  const p = payload || {};

  if (op === 'create') {
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.score) >= 1)) return fail('INVALID', '星星数至少为 1');
    const task = {
      _id: s.nextId('t'), ownerId: user._id, childId: p.childId,
      title: String(p.title).trim(), type: p.type || 'study', icon: p.icon || '✏️',
      date: p.date || D.ymd(new Date()),
      repeat: p.repeat || { enabled: false, type: 'day', interval: 1, weekdays: [] },
      score: Number(p.score) || 1, priority: p.priority || 'none',
      praise: p.praise || '',
      createdAt: Date.now(), deleted: false
    };
    tasks.push(task);
    saveTasks(tasks);
    return ok({ task });
  }

  if (op === 'update') {
    const task = tasks.find(t => t._id === p.id);
    if (!task) return fail('NOT_FOUND', '任务不存在');
    if (p.title != null) task.title = String(p.title).trim();
    if (p.score != null) task.score = Number(p.score);
    if (p.type != null) task.type = p.type;
    if (p.icon != null) task.icon = p.icon;
    if (p.date != null) task.date = p.date;
    if (p.repeat != null) task.repeat = p.repeat;
    if (p.priority != null) task.priority = p.priority;
    if (p.praise != null) task.praise = p.praise;
    if (!task.title) return fail('INVALID', '请填写标题');
    if (!(task.score >= 1)) return fail('INVALID', '星星数至少为 1');
    saveTasks(tasks);
    return ok({ task });
  }

  if (op === 'delete') {
    const task = tasks.find(t => t._id === p.id);
    if (!task) return fail('NOT_FOUND', '任务不存在');
    task.deleted = true;
    saveTasks(tasks);
    return ok({ id: task._id });
  }
  return fail('INVALID', '未知操作');
}

module.exports = { taskCRUD };
