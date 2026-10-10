// cloudfunctions/taskCRUD —— 任务 建/改/删（软删；软删不回退星星）
const { cloud, db, ok, fail, getOwnedChild } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { resolveCaller, assertToken, ownedChild } = require('./lib/runtime');

const PATCH_KEYS = ['title', 'type', 'icon', 'date', 'repeat', 'priority', 'praise'];

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID } = r;
  const tf = assertToken(event, OPENID);
  if (tf) return tf;

  const p = event.payload || {};
  const coll = db.collection('tasks');

  if (event.op === 'create') {
    const child = await ownedChild(OPENID, p.childId);
    if (!child) return fail('FORBIDDEN', '无权访问该孩子档案');
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.score) >= 1)) return fail('INVALID', '星星数至少为 1');
    const doc = {
      ownerId: child.ownerId, childId: child._id,
      title: String(p.title).trim(), type: p.type || 'study', icon: p.icon || '✏️',
      date: p.date || ymd(new Date()),
      repeat: p.repeat || { enabled: false, type: 'day', interval: 1, weekdays: [] },
      score: Number(p.score) || 1, priority: p.priority || 'none',
      praise: p.praise || '',
      createdAt: Date.now(), deleted: false
    };
    const add = await coll.add({ data: doc });
    return ok({ task: Object.assign({ _id: add._id }, doc) });
  }

  if (event.op === 'update') {
    const doc = await coll.doc(p.id).get().catch(() => null);
    const task = doc && doc.data;
    if (!task) return fail('NOT_FOUND', '任务不存在');
    const child = await ownedChild(OPENID, task.childId);
    if (!child) return fail('FORBIDDEN', '无权操作');
    const patch = {};
    PATCH_KEYS.forEach(k => { if (p[k] != null) patch[k] = p[k]; });
    if (p.score != null) patch.score = Number(p.score);
    if (patch.title != null) {
      if (!String(patch.title).trim()) return fail('INVALID', '请填写标题');
      patch.title = String(patch.title).trim();
    }
    if (patch.score != null && !(patch.score >= 1)) return fail('INVALID', '星星数至少为 1');
    await coll.doc(p.id).update({ data: patch });
    return ok({ task: Object.assign({}, task, patch) });
  }

  if (event.op === 'delete') {
    const doc = await coll.doc(p.id).get().catch(() => null);
    const task = doc && doc.data;
    if (!task) return fail('NOT_FOUND', '任务不存在');
    const child = await ownedChild(OPENID, task.childId);
    if (!child) return fail('FORBIDDEN', '无权操作');
    await coll.doc(p.id).update({ data: { deleted: true } });
    return ok({ id: p.id });
  }

  return fail('INVALID', '未知操作');
};
