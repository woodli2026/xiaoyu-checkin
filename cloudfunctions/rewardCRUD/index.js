// cloudfunctions/rewardCRUD —— 奖励 建/改/删（软删；软删不回退星星）
const { cloud, db, ok, fail, getOwnedChild } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');
  if (!verifyToken(event.parentToken, OPENID)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');

  const p = event.payload || {};
  const coll = db.collection('rewards');

  if (event.op === 'create') {
    const child = await getOwnedChild(OPENID, p.childId);
    if (!child) return fail('FORBIDDEN', '无权访问该孩子档案');
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.cost) >= 1)) return fail('INVALID', '星星数至少为 1');
    const doc = {
      ownerId: child.ownerId, childId: child._id,
      title: String(p.title).trim(), icon: p.icon || '🎁',
      category: p.category || 'reward',
      resetAfterRedeem: !!p.resetAfterRedeem,   // true=可反复兑换；false=每位孩子仅一次
      cost: Number(p.cost) || 5,
      createdAt: Date.now(), deleted: false
    };
    const add = await coll.add({ data: doc });
    return ok({ reward: Object.assign({ _id: add._id }, doc) });
  }

  if (event.op === 'update') {
    const doc = await coll.doc(p.id).get().catch(() => null);
    const reward = doc && doc.data;
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    const child = await getOwnedChild(OPENID, reward.childId);
    if (!child) return fail('FORBIDDEN', '无权操作');
    const patch = {};
    if (p.title != null) {
      if (!String(p.title).trim()) return fail('INVALID', '请填写标题');
      patch.title = String(p.title).trim();
    }
    if (p.icon != null) patch.icon = p.icon;
    if (p.category != null) patch.category = p.category;
    if (p.resetAfterRedeem != null) patch.resetAfterRedeem = !!p.resetAfterRedeem;
    if (p.cost != null) {
      if (!(Number(p.cost) >= 1)) return fail('INVALID', '星星数至少为 1');
      patch.cost = Number(p.cost);
    }
    await coll.doc(p.id).update({ data: patch });
    return ok({ reward: Object.assign({}, reward, patch) });
  }

  if (event.op === 'delete') {
    const doc = await coll.doc(p.id).get().catch(() => null);
    const reward = doc && doc.data;
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    const child = await getOwnedChild(OPENID, reward.childId);
    if (!child) return fail('FORBIDDEN', '无权操作');
    await coll.doc(p.id).update({ data: { deleted: true } });
    return ok({ id: p.id });
  }

  return fail('INVALID', '未知操作');
};
