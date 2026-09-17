// cloudfunctions/childSwitch —— 家长模式切换当前孩子（校验归属）
const { cloud, ok, fail, getOwnedChild } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!verifyToken(event.parentToken, OPENID)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const child = await getOwnedChild(OPENID, event.childId);
  if (!child || child._id !== event.childId) return fail('FORBIDDEN', '无权访问该孩子档案');
  return ok({ childId: child._id });
};
