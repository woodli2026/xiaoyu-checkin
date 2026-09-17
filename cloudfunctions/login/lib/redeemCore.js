// cloudfunctions/lib/redeemCore.js —— 兑换核心（纯函数）
// 口径（2026-09-17 调整）：奖励**不再有库存**，限次改由「是否已兑换过」承担。
//   - resetAfterRedeem = true  → 兑换后不记完成，可反复兑换（只受星星余额约束）
//   - resetAfterRedeem = false → 每位孩子只能兑换一次（已兑换过则拒绝）
// 两者都：只从孩子的星星里扣掉 cost，不产生任何库存概念。

// 兑换后的孩子状态（只扣星星）
function applyRedeem(child, reward) {
  const totalStars = (child.totalStars || 0) - (Number(reward && reward.cost) || 0);
  return { totalStars };
}

// 能否兑换：返回 null 表示可以，否则返回失败错误码（供调用方转成文案）
// alreadyRedeemed：该孩子此前是否已兑换过此奖励
function redeemBlockReason(child, reward, alreadyRedeemed) {
  if (!reward) return 'REWARD_NOT_FOUND';
  const cost = Number(reward.cost) || 0;
  if (cost < 1) return 'INVALID';
  if (!reward.resetAfterRedeem && alreadyRedeemed) return 'ALREADY_REDEEMED';
  if (((child && child.totalStars) || 0) < cost) return 'INSUFFICIENT';
  return null;
}

module.exports = { applyRedeem, redeemBlockReason };
