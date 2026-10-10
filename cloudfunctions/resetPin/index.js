// cloudfunctions/resetPin —— 遗忘 PIN：经微信身份(OPENID)验证后恢复为内置默认 PIN
// 口径（见 README §9）：重置 = 回到默认 PIN，而非把账号置为「无 PIN」死状态
const { cloud, db, ok, fail } = require('./lib/cloud');
const { DEFAULT_PIN, PIN_SCHEME, defaultPinHash } = require('./lib/pin');
const { resolveCaller } = require('./lib/runtime');

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { user } = r;
  await db.collection('users').doc(user._id).update({
    data: { pinHash: defaultPinHash(), pinSet: true, pinScheme: PIN_SCHEME }
  });
  return ok({ pinSet: true, defaultPin: DEFAULT_PIN });
};
