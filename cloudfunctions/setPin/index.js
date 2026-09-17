// cloudfunctions/setPin —— 设置/修改家长 PIN（首次免 token；修改需家长模式）
const { cloud, db, ok, fail, getUserByOpenid } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');
const { PIN_SCHEME, hashPin, isValidPin } = require('./lib/pin');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');
  const user = await getUserByOpenid(OPENID);
  if (!user) return fail('AUTH_FAIL', '未登录');
  if (!isValidPin(event.pin)) return fail('INVALID', 'PIN 必须为 6 位数字');
  if (user.pinSet && !verifyToken(event.parentToken, OPENID)) {
    return fail('TOKEN_INVALID', '请先进入家长模式');
  }
  await db.collection('users').doc(user._id).update({
    data: { pinHash: hashPin(event.pin), pinSet: true, pinScheme: PIN_SCHEME }
  });
  return ok({ pinSet: true });
};
