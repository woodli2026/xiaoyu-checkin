// cloudfunctions/resetPin —— 遗忘 PIN：经微信身份(OPENID)验证后恢复为内置默认 PIN
// 口径（见 README §9）：重置 = 回到默认 PIN，而非把账号置为「无 PIN」死状态
const { cloud, db, ok, fail, getUserByOpenid } = require('./lib/cloud');
const { DEFAULT_PIN, PIN_SCHEME, defaultPinHash } = require('./lib/pin');

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');
  const user = await getUserByOpenid(OPENID);
  if (!user) return fail('AUTH_FAIL', '未登录');
  await db.collection('users').doc(user._id).update({
    data: { pinHash: defaultPinHash(), pinSet: true, pinScheme: PIN_SCHEME }
  });
  return ok({ pinSet: true, defaultPin: DEFAULT_PIN });
};
