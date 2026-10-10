// cloudfunctions/lib/redeemCore.js —— 兑换核心（纯函数）
// 【D1 单源】下方 SECTION 镜像到 miniprogram/utils/domain.js 的 SLOT:redeemCore（gen:mirror 注入）。
// ==MIRROR-SECTION:redeemCore==
// 兑换核心（2026-09-17 调整）：奖励**不再有库存**，限次改由「是否已兑换过」承担。
//   resetAfterRedeem = true  → 兑换后不记完成，可反复兑换（只受星星余额约束）
//   resetAfterRedeem = false → 每位孩子只能兑换一次
function applyRedeem(child, reward) {
  const totalStars = (child.totalStars || 0) - (Number(reward && reward.cost) || 0);
  return { totalStars };
}

// 能否兑换：返回 null 表示可以，否则返回错误码
function redeemBlockReason(child, reward, alreadyRedeemed) {
  if (!reward) return 'REWARD_NOT_FOUND';
  const cost = Number(reward.cost) || 0;
  if (cost < 1) return 'INVALID';
  if (!reward.resetAfterRedeem && alreadyRedeemed) return 'ALREADY_REDEEMED';
  if (((child && child.totalStars) || 0) < cost) return 'INSUFFICIENT';
  return null;
}
// ==MIRROR-SECTION-END==

module.exports = { applyRedeem, redeemBlockReason };
