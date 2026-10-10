// cloudfunctions/unlockParent —— 校验 PIN → 签发家长令牌（5 分钟）
const { cloud, ok, fail } = require('./lib/cloud');
const { verifyPin, isCurrentPinScheme } = require('./lib/pin');
const { issueToken } = require('./lib/token');
const { resolveCaller } = require('./lib/runtime');

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID, user } = r;
  if (!user.pinSet) return fail('PIN_NOT_SET', '请先在「我」页设置 PIN');
  // 兜底：PIN 方案（位数/口径）变更过的老账号，旧哈希永远匹配不上新位数。
  // 若 login 的自动迁移没跑到（例如云函数未重新上传），给出可执行的引导而非含糊的「PIN 不正确」。
  if (!isCurrentPinScheme(user)) {
    return fail('PIN_SCHEME_STALE', 'PIN 规则已更新，请点下方「忘记 PIN」恢复默认后重试');
  }
  if (!verifyPin(event.pin, user.pinHash)) return fail('PIN_INVALID', 'PIN 不正确');

  const t = issueToken(OPENID, 5 * 60 * 1000);
  return ok({ parentToken: t.token, expireAt: t.expireAt });
};
