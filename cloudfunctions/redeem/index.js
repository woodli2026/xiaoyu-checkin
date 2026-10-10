// cloudfunctions/redeem —— 兑换（即发放）：星星足够 → 扣星星 + 写流水（事务原子）
// 口径（2026-09-17 调整）：**不再有库存**。限次改由「是否已兑换过」承担：
//   resetAfterRedeem=true  → 可反复兑换；false → 每位孩子仅一次
const { cloud, db, ok, fail } = require('./lib/cloud');
const { applyRedeem, redeemBlockReason } = require('./lib/redeemCore');
const { resolveCaller, assertToken, ownedChild } = require('./lib/runtime');

const BLOCK_MSG = {
  REWARD_NOT_FOUND: '奖励不存在或已删除',
  INVALID: '奖励配置不合法',
  ALREADY_REDEEMED: '该奖励每位孩子只能兑换一次',
  INSUFFICIENT: '星星不够啦'
};

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID } = r;
  const tf = assertToken(event, OPENID);
  if (tf) return tf;

  const child = await ownedChild(OPENID, event.childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');

  const rDoc = await db.collection('rewards').doc(event.rewardId).get().catch(() => null);
  const reward = rDoc && rDoc.data;
  if (!reward || reward.deleted) return fail('REWARD_NOT_FOUND', '奖励不存在或已删除');

  // 限次奖励：查该孩子此前是否已兑换过（替代原「库存」的角色）
  let alreadyRedeemed = false;
  if (!reward.resetAfterRedeem) {
    const prior = await db.collection('redemptions')
      .where({ childId: child._id, rewardId: reward._id }).limit(1).get();
    alreadyRedeemed = !!(prior && prior.data && prior.data.length);
  }

  const blocked = redeemBlockReason(child, reward, alreadyRedeemed);
  if (blocked) return fail(blocked, BLOCK_MSG[blocked] || '兑换失败');

  const upd = applyRedeem(child, reward);
  const now = Date.now();

  await db.runTransaction(async (t) => {
    await t.collection('children').doc(child._id).update({ data: { totalStars: upd.totalStars } });
    await t.collection('redemptions').add({
      data: {
        ownerId: child.ownerId, childId: child._id, rewardId: reward._id,
        cost: reward.cost, status: 'completed', createdAt: now
      }
    });
    await t.collection('pointsLog').add({
      data: {
        ownerId: child.ownerId, childId: child._id, delta: -reward.cost,
        reason: '兑换:' + reward.title, refType: 'redeem', refId: reward._id, createdAt: now
      }
    });
  });

  return ok({ totalStars: upd.totalStars });
};
