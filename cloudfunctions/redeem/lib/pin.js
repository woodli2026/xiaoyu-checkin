// cloudfunctions/lib/pin.js —— 家长 PIN 哈希（sha256 + 盐）
const crypto = require('crypto');

const SALT = process.env.XY_PIN_SALT || 'xiaoyu-pin-salt';

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
  return crypto.createHash('sha256').update((salt || SALT) + '::' + String(pin)).digest('hex');
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
  SALT, DEFAULT_PIN, PIN_LENGTH, PIN_SCHEME,
  hashPin, verifyPin, isValidPin, defaultPinHash, isCurrentPinScheme
};
