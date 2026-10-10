// cloudfunctions/childSwitch —— 家长模式切换当前孩子（校验归属）
const { cloud, ok, fail } = require('./lib/cloud');
const { resolveCaller, assertToken, ownedChild } = require('./lib/runtime');

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID } = r;
  const tf = assertToken(event, OPENID);
  if (tf) return tf;
  const child = await ownedChild(OPENID, event.childId);
  if (!child || child._id !== event.childId || child.deleted) return fail('FORBIDDEN', '无权访问该宝宝档案');
  return ok({ childId: child._id });
};
