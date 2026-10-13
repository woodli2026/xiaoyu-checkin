// cloudfunctions/childSwitch —— 家长模式切换当前孩子（校验归属）
const { cloud, ok, fail } = require('./lib/cloud');
const { resolveCaller, assertToken, ownedChild } = require('./lib/runtime');

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID } = r;
  const tf = assertToken(event, OPENID);
  if (tf) return tf;
  // 候选②：ownedChild 已是严格归属（不属于自己 → null），无需再手工比对 _id
  const child = await ownedChild(OPENID, event.childId);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
  return ok({ childId: child._id });
};
