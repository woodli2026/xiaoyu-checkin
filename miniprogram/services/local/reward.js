// services/local/reward.js —— 本地兜底层：兑换 + 奖励 CRUD（D3 拆分）
const { s, ok, fail, currentUser, allChildren, saveChildren, allRewards, saveRewards, allRedemptions, saveRedemptions, allPoints, savePoints, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');

// 兑换被拒的文案（与 cloudfunctions/redeem 的 BLOCK_MSG 保持一致）
const REDEEM_BLOCK_MSG = {
  REWARD_NOT_FOUND: '奖励不存在或已删除',
  INVALID: '奖励配置不合法',
  ALREADY_REDEEMED: '该奖励每位孩子只能兑换一次',
  INSUFFICIENT: '星星不够啦'
};

// 兑换（即发放）：只扣星星。限次奖励由「是否已兑换过」把关，不再有库存概念。
async function redeem({ childId, rewardId, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const children = allChildren();
  const child = children.find(c => c._id === childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');
  const reward = allRewards().find(r => r._id === rewardId && !r.deleted);
  if (!reward) return fail('REWARD_NOT_FOUND', '奖励不存在或已删除');

  const reds = allRedemptions();
  const alreadyRedeemed = reds.some(r => r.childId === childId && r.rewardId === rewardId);
  const blocked = D.redeemBlockReason(child, reward, alreadyRedeemed);
  if (blocked) return fail(blocked, REDEEM_BLOCK_MSG[blocked] || '兑换失败');

  child.totalStars = D.applyRedeem(child, reward).totalStars;
  saveChildren(children);

  reds.push({ _id: s.nextId('rd'), childId, rewardId, cost: reward.cost, status: 'completed', createdAt: Date.now() });
  saveRedemptions(reds);

  const pts = allPoints();
  pts.push({ _id: s.nextId('p'), childId, delta: -reward.cost, reason: '兑换:' + reward.title, refType: 'redeem', refId: rewardId, createdAt: Date.now() });
  savePoints(pts);

  return ok({ totalStars: child.totalStars });
}

async function rewardCRUD({ op, parentToken, payload }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const rewards = allRewards();
  const p = payload || {};

  if (op === 'create') {
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.cost) >= 1)) return fail('INVALID', '星星数至少为 1');
    const reward = {
      _id: s.nextId('r'), ownerId: user._id, childId: p.childId,
      title: String(p.title).trim(), icon: p.icon || '🎁',
      category: p.category || 'reward',
      resetAfterRedeem: !!p.resetAfterRedeem,   // true=可反复兑换；false=每位孩子仅一次
      praise: p.praise || '',                    // 兑换后宠物说的正面反馈（空则用默认文案）
      cost: Number(p.cost) || 5,
      createdAt: Date.now(), deleted: false
    };
    rewards.push(reward);
    saveRewards(rewards);
    return ok({ reward });
  }

  if (op === 'update') {
    const reward = rewards.find(r => r._id === p.id);
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    if (p.title != null) reward.title = String(p.title).trim();
    if (p.icon != null) reward.icon = p.icon;
    if (p.category != null) reward.category = p.category;
    if (p.resetAfterRedeem != null) reward.resetAfterRedeem = !!p.resetAfterRedeem;
    if (p.praise != null) reward.praise = p.praise;
    if (p.cost != null) reward.cost = Number(p.cost);
    if (!reward.title) return fail('INVALID', '请填写标题');
    if (!(reward.cost >= 1)) return fail('INVALID', '星星数至少为 1');
    saveRewards(rewards);
    return ok({ reward });
  }

  if (op === 'delete') {
    const reward = rewards.find(r => r._id === p.id);
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    reward.deleted = true;
    saveRewards(rewards);
    return ok({ id: reward._id });
  }
  return fail('INVALID', '未知操作');
}

module.exports = { redeem, rewardCRUD, REDEEM_BLOCK_MSG };
