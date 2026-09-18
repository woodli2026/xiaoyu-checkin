// cloudfunctions/checkIn —— 打卡：防重复 / 加分 / 连续天数 / 写流水（事务原子）
const { cloud, db, ok, fail, getOwnedChild } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');
const { applyCheckIn } = require('./lib/checkInCore');
const { displayStreak } = require('./lib/streak');
const { levelOf } = require('./lib/level');
const { ymd } = require('./lib/util');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');
  if (!verifyToken(event.parentToken, OPENID)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');

  const child = await getOwnedChild(OPENID, event.childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');

  const date = event.date || ymd(new Date());

  const taskDoc = await db.collection('tasks').doc(event.taskId).get().catch(() => null);
  const task = taskDoc && taskDoc.data;
  if (!task || task.deleted) return fail('TASK_NOT_FOUND', '任务不存在或已删除');
  if (!(Number(task.score) > 0)) return fail('INVALID', '星星数非法');

  // 防重复（硬保障为 checkIns 唯一索引 (ownerId, childId, taskId, date)）
  const dup = await db.collection('checkIns')
    .where({ childId: child._id, taskId: event.taskId, date }).limit(1).get();
  if (dup.data.length) return fail('ALREADY_DONE', '今日已打卡');

  const upd = applyCheckIn(child, task.score, date);
  const now = Date.now();

  await db.runTransaction(async (t) => {
    await t.collection('children').doc(child._id).update({
      data: { totalStars: upd.totalStars, streak: upd.streak, lastCheckInDate: upd.lastCheckInDate }
    });
    await t.collection('checkIns').add({
      data: { ownerId: child.ownerId, childId: child._id, taskId: event.taskId, date, score: task.score, createdAt: now }
    });
    await t.collection('pointsLog').add({
      data: { ownerId: child.ownerId, childId: child._id, delta: task.score, reason: '打卡:' + task.title, refType: 'checkin', refId: event.taskId, createdAt: now }
    });
  });

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const allCi = await db.collection('checkIns').where({ childId: child._id }).limit(1000).get();
  const streak = displayStreak(new Set(allCi.data.map(c => c.date)), ymd(new Date()));
  return ok({ totalStars: upd.totalStars, streak, level: levelOf(streak) });
};
