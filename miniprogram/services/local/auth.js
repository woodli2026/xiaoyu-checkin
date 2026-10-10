// services/local/auth.js —— 本地兜底层：账号 / PIN / 家长令牌（D3 拆分）
const { s, ok, fail, currentUser, saveUser, allChildren, saveChildren, allTasks, saveTasks, allRewards, saveRewards, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');
const SEED = require('../../utils/seed');
const CFG = require('../../config');

const VEGGIES = ['番茄', '黄瓜', '南瓜', '土豆', '玉米', '胡萝卜', '西兰花', '茄子',
  '菠菜', '豌豆', '蘑菇', '青椒', '白菜', '冬瓜', '莲藕', '山药'];

// 默认 PIN / 长度 / 方案版本：必须与 cloudfunctions/lib/pin.js 的同名常量一致。
// 前端不能 require cloudfunctions/，故这里是镜像；由 __tests__/local.test.js
// 的「默认 PIN 口径」用例守卫，任一侧漂移都会让 npm test 变红。
const DEFAULT_PIN = '123456';
const PIN_LENGTH = 6;
const PIN_SCHEME = 'len6-v1';

function hashPin(pin) {
  // 本地兜底轻量哈希（占位，非安全实现；云端使用 sha256+盐）
  const str = 'xiaoyu$local' + pin + '$local';
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'l' + h.toString(16);
}

function defaultPinHash() { return hashPin(DEFAULT_PIN); }

// 该账号的 PIN 是否已是当前方案 —— 登录时用它识别需要迁移的历史账号
function isCurrentPinScheme(u) {
  return !!(u && u.pinSet && u.pinScheme === PIN_SCHEME);
}

function genRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// 预置「8 任务 + 8 奖励」：仅在首次创建孩子档案时执行一次（与云端 login 行为一致）
function seedChildData(ownerId, childId) {
  const now = Date.now();
  const date = D.ymd(new Date(now));
  const tasks = allTasks();
  SEED.seedTasks({ ownerId, childId, date, now })
    .forEach(doc => tasks.push(Object.assign({ _id: s.nextId('t') }, doc)));
  saveTasks(tasks);
  const rewards = allRewards();
  SEED.seedRewards({ ownerId, childId, now })
    .forEach(doc => rewards.push(Object.assign({ _id: s.nextId('r') }, doc)));
  saveRewards(rewards);
}

// ============ 账号与鉴权 ============

async function login(params) {
  let user = currentUser();
  if (!user) {
    user = {
      _id: s.nextId('u'),
      openid: (params && params.OPENID) || ('local_' + D.randHex(16)),
      randomCode: genRandomCode(),
      nickname: VEGGIES[Math.floor(Math.random() * VEGGIES.length)] + '宝宝',
      avatar: '🧒',
      pinHash: defaultPinHash(),   // 内置默认 PIN
      pinSet: true,
      pinScheme: PIN_SCHEME,
      createdAt: Date.now()
    };
    saveUser(user);
  } else if (!isCurrentPinScheme(user)) {
    // 兼容两类历史账号（与云函数 login 同口径）：
    //   ① 更早版本遗留的无 PIN 账号（pinSet = false）
    //   ② PIN 方案变更前的账号（如 8 位口径建的号，旧 hash 永远匹配不上 6 位输入）
    user.pinHash = defaultPinHash();
    user.pinSet = true;
    user.pinScheme = PIN_SCHEME;
    saveUser(user);
  }
  let children = allChildren().filter(c => !c.deleted);
  if (!children.length) {
    const child = {
      _id: s.nextId('c'),
      ownerId: user._id,
      name: '宝宝',
      avatar: '🧒',
      photo: '',
      gender: '',
      birthday: '',
      allergens: '',
      totalStars: 0,
      createdAt: Date.now(),
      deleted: false
    };
    children = [child];
    saveChildren(children);
    seedChildData(user._id, child._id);
  }
  let childId = s.read(s.KEYS.childId, null);
  if (!childId || !children.some(c => c._id === childId)) {
    childId = children[0]._id;
    s.write(s.KEYS.childId, childId);
  }
  return ok({ user, childId, pinSet: user.pinSet });
}

async function unlockParent({ pin, silent }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  if (!user.pinSet) return fail('PIN_NOT_SET', '请先在「我」页设置 PIN');
  // 兜底：PIN 方案（位数/口径）变更过的老账号，旧哈希永远匹配不上新位数。
  // 若 login 的自动迁移没跑到，这里给出一条可执行的引导，而不是含糊的「PIN 不正确」。
  if (!isCurrentPinScheme(user)) {
    return fail('PIN_SCHEME_STALE', 'PIN 规则已更新，请点下方「忘记 PIN」恢复默认后重试');
  }
  // 本地层「启动即家长模式」：静默解锁（免 PIN），仅家庭内测阶段、手机即信任根时使用。
  // 云端层不接入此分支（设备信任待接入），故 silent 仅本地兜底生效。
  if (!silent) {
    if (hashPin(pin) !== user.pinHash) return fail('PIN_INVALID', 'PIN 不正确');
  }
  const t = D.issueToken(CFG.PARENT_TOKEN_TTL_MS || 365 * 24 * 3600 * 1000);
  s.write(s.KEYS.token, { token: t.token, expireAt: t.expireAt, openid: user.openid });
  return ok({ parentToken: t.token, expireAt: t.expireAt });
}

async function setPin({ pin, parentToken }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  if (!new RegExp('^\\d{' + PIN_LENGTH + '}$').test(String(pin || ''))) {
    return fail('INVALID', 'PIN 必须为 ' + PIN_LENGTH + ' 位数字');
  }
  if (user.pinSet && !verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '请先进入家长模式');
  user.pinHash = hashPin(String(pin));
  user.pinSet = true;
  user.pinScheme = PIN_SCHEME;
  saveUser(user);
  return ok({ pinSet: true });
}

// 与云函数 resetPin 口径一致：恢复为内置默认 PIN，而非置为「无 PIN」
async function resetPinByOpenid() {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  user.pinHash = defaultPinHash();
  user.pinSet = true;
  user.pinScheme = PIN_SCHEME;
  saveUser(user);
  s.remove(s.KEYS.token);
  return ok({ pinSet: true, defaultPin: DEFAULT_PIN });
}

module.exports = {
  login, unlockParent, setPin,
  resetPin: resetPinByOpenid,   // 与云函数 resetPin 对齐
  DEFAULT_PIN, PIN_LENGTH, PIN_SCHEME   // 导出供单测守卫（与 cloudfunctions/lib/pin.js 比对）
};
