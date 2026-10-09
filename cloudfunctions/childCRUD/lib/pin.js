// cloudfunctions/lib/pin.js —— 家长 PIN 哈希（sha256 + 盐）
//
// 【D6 安全修复 / 2026-10-09】
// 旧实现为 `const SALT = process.env.XY_PIN_SALT || 'xiaoyu-pin-salt'`，环境变量缺失时
// 回退到硬编码的公开盐 —— 任何人拿到源码即可离线彩虹表爆破 6 位 PIN（仅 100 万种）。
// 现改为：环境变量缺失即在**使用点抛错**（fail-fast，惰性，不打挂 tests/）。
// 由 __tests__/secret-guard.test.js 守卫，防止回退。
//
// 注：前端本地兜底层 services/local.js 用的是独立的轻量哈希（'xiaoyu$local' 前缀），
// 与云端盐无关；两者数据不互通，故云端换盐不影响本地单机模式。
const crypto = require('crypto');

function getSalt(salt) {
  const s = salt || process.env.XY_PIN_SALT;
  if (!s) {
    throw new Error('XY_PIN_SALT 未配置：必须在云函数环境变量中设置 PIN 哈希盐，否则无法校验/写入 PIN');
  }
  return s;
}

// 默认 PIN：建号即内置，便于家庭内测直接进入家长模式（6 位）
// 口径：「忘记 PIN 重置」= 恢复为该默认值，而非清空（见 README §9）
const DEFAULT_PIN = '123456';
const PIN_LENGTH = 6;

// PIN 方案版本：位数 / 哈希口径发生变化时必须递增。
// users.pinScheme 与此不一致的历史账号（例如早期 8 位口径建的号，其 hash 存的是
// 「12345678」），会在 login 时被自动重置为默认 PIN —— 否则旧哈希永远匹配不上
// 6 位输入，账号会陷入「怎么输都进不去」的死状态且不报错。
const PIN_SCHEME = 'len6-v1';

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(getSalt(salt) + '::' + String(pin)).digest('hex');
}

function verifyPin(pin, hash, salt) {
  return !!hash && hashPin(pin, salt) === hash;
}

// 6 位纯数字校验
function isValidPin(pin) {
  return new RegExp('^\\d{' + PIN_LENGTH + '}$').test(String(pin || ''));
}

// 默认 PIN 的哈希（建号 / 重置 / 方案迁移时复用，避免各处重复算）
function defaultPinHash(salt) {
  return hashPin(DEFAULT_PIN, salt);
}

// 该账号的 PIN 是否已是当前方案（pinSet 为真且方案一致）
function isCurrentPinScheme(user) {
  return !!(user && user.pinSet && user.pinScheme === PIN_SCHEME);
}

module.exports = {
  getSalt, DEFAULT_PIN, PIN_LENGTH, PIN_SCHEME,
  hashPin, verifyPin, isValidPin, defaultPinHash, isCurrentPinScheme
};
