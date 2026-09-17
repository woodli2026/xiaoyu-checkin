// services/local.js —— 本地兜底数据层
// 未配置云环境时启用；接口契约与 8 个云函数完全一致，页面层无需感知差异。
const s = require('../utils/storage');
const D = require('../utils/domain');
const T = require('../utils/tasks');
const SEED = require('../utils/seed');

const VEGGIES = ['番茄', '黄瓜', '南瓜', '土豆', '玉米', '胡萝卜', '西兰花', '茄子',
  '菠菜', '豌豆', '蘑菇', '青椒', '白菜', '冬瓜', '莲藕', '山药'];

// —— 工具 ——
function ok(o) { return Object.assign({ ok: true }, o || {}); }
function fail(code, message) { return { ok: false, code, message: message || code }; }

// 兑换被拒的文案（与 cloudfunctions/redeem 的 BLOCK_MSG 保持一致）
const REDEEM_BLOCK_MSG = {
  REWARD_NOT_FOUND: '奖励不存在或已删除',
  INVALID: '奖励配置不合法',
  ALREADY_REDEEMED: '该奖励每位孩子只能兑换一次',
  INSUFFICIENT: '星星不够啦'
};

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

// —— 存取 ——
function currentUser() { return s.read(s.KEYS.user, null); }
function saveUser(u) { s.write(s.KEYS.user, u); }
function allChildren() { return s.read(s.KEYS.children, []); }
function saveChildren(l) { s.write(s.KEYS.children, l); }
function allTasks() { return s.read(s.KEYS.tasks, []); }
function saveTasks(l) { s.write(s.KEYS.tasks, l); }
function allRewards() { return s.read(s.KEYS.rewards, []); }
function saveRewards(l) { s.write(s.KEYS.rewards, l); }
function allCheckIns() { return s.read(s.KEYS.checkIns, []); }
function saveCheckIns(l) { s.write(s.KEYS.checkIns, l); }
function allPoints() { return s.read(s.KEYS.pointsLog, []); }
function savePoints(l) { s.write(s.KEYS.pointsLog, l); }
function allRedemptions() { return s.read(s.KEYS.redemptions, []); }
function saveRedemptions(l) { s.write(s.KEYS.redemptions, l); }

function verifyLocalToken(token) {
  const t = s.read(s.KEYS.token, null);
  return !!(t && token && t.token === token && t.expireAt > Date.now());
}

// 预置「3 任务 + 2 奖励」：仅在首次创建孩子档案时执行一次（与云端 login 行为一致）
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
  let children = allChildren();
  if (!children.length) {
    const child = {
      _id: s.nextId('c'),
      ownerId: user._id,
      name: '宝宝',
      avatar: '🧒',
      totalStars: 0,
      streak: 0,
      lastCheckInDate: null,
      createdAt: Date.now()
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

async function unlockParent({ pin }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  if (!user.pinSet) return fail('PIN_NOT_SET', '请先在「我」页设置 PIN');
  // 兜底：PIN 方案（位数/口径）变更过的老账号，旧哈希永远匹配不上新位数。
  // 若 login 的自动迁移没跑到，这里给出一条可执行的引导，而不是含糊的「PIN 不正确」。
  if (!isCurrentPinScheme(user)) {
    return fail('PIN_SCHEME_STALE', 'PIN 规则已更新，请点下方「忘记 PIN」恢复默认后重试');
  }
  if (hashPin(pin) !== user.pinHash) return fail('PIN_INVALID', 'PIN 不正确');
  const t = D.issueToken(5 * 60 * 1000);
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

// ============ 看板 ============

async function getDashboard({ childId }) {
  const children = allChildren();
  const child = children.find(c => c._id === childId) || children[0];
  if (!child) return fail('NO_CHILD', '无孩子档案');
  const today = D.ymd(new Date());
  const tasks = allTasks().filter(t => t.childId === child._id && !t.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
  // 奖励补「该孩子是否已兑换过」：限次奖励（resetAfterRedeem=false）只有一次机会，
  // 这个标志在界面上取代了原「库存」的角色。
  const redeemedIds = new Set(
    allRedemptions().filter(r => r.childId === child._id).map(r => r.rewardId)
  );
  const rewards = allRewards().filter(r => r.childId === child._id && !r.deleted)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(r => Object.assign({}, r, { redeemed: redeemedIds.has(r._id) }));
  const checkIns = allCheckIns().filter(c => c.childId === child._id);
  const doneToday = new Set(checkIns.filter(c => c.date === today).map(c => c.taskId));

  const todayTasks = tasks
    .filter(t => T.taskVisibleOn(t, today))
    .map(t => ({
      taskId: t._id, title: t.title, icon: t.icon, score: t.score,
      priority: t.priority, type: t.type, checked: doneToday.has(t._id)
    }));

  const ym = today.slice(0, 7);
  const monthLit = Array.from(new Set(
    checkIns.filter(c => c.date.slice(0, 7) === ym).map(c => c.date)
  )).sort();

  return ok({
    totalStars: child.totalStars || 0,
    streak: child.streak || 0,
    level: D.levelOf(child.streak || 0),
    monthLit,
    todayTasks,
    tasks,
    rewards,
    checkIns: checkIns.map(c => ({ taskId: c.taskId, date: c.date })),
    child: { _id: child._id, name: child.name, avatar: child.avatar },
    children: children.map(c => ({ _id: c._id, name: c.name, avatar: c.avatar }))
  });
}

// ============ 写操作 ============

async function checkIn({ childId, taskId, date, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const children = allChildren();
  const child = children.find(c => c._id === childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');
  const d = date || D.ymd(new Date());
  const tasks = allTasks();
  const task = tasks.find(t => t._id === taskId && !t.deleted);
  if (!task) return fail('TASK_NOT_FOUND', '任务不存在或已删除');
  if (!(Number(task.score) > 0)) return fail('INVALID', '星星数非法');

  const checkIns = allCheckIns();
  if (checkIns.some(c => c.childId === childId && c.taskId === taskId && c.date === d)) {
    return fail('ALREADY_DONE', '今日已打卡');
  }

  const upd = D.applyCheckIn(child, task.score, d);
  child.totalStars = upd.totalStars;
  child.streak = upd.streak;
  child.lastCheckInDate = upd.lastCheckInDate;
  saveChildren(children);

  checkIns.push({ _id: s.nextId('ci'), childId, taskId, date: d, score: task.score, createdAt: Date.now() });
  saveCheckIns(checkIns);

  const pts = allPoints();
  pts.push({ _id: s.nextId('p'), childId, delta: task.score, reason: '打卡:' + task.title, refType: 'checkin', refId: taskId, createdAt: Date.now() });
  savePoints(pts);

  return ok({ totalStars: child.totalStars, streak: child.streak, level: upd.level });
}

// 兑换（即发放）：只扣星星。限次奖励由「是否已兑换过」把关，不再有库存概念。
async function redeem({ childId, rewardId, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const children = allChildren();
  const child = children.find(c => c._id === childId);
  if (!child) return fail('CHILD_NOT_FOUND', '孩子档案不存在');
  const reward = allRewards().find(r => r._id === rewardId && !r.deleted);
  if (!reward) return fail('REWARD_NOT_FOUND', '奖励不存在或已删除');

  const reds = allRedemptions();
  const alreadyRedeemed = reds.some(r => r.childId === childId && r.rewardId === rewardId);
  const blocked = D.redeemBlockReason(child, reward, alreadyRedeemed);
  if (blocked) return fail(blocked, REDEEM_BLOCK_MSG[blocked] || '兑换失败');

  child.totalStars = D.applyRedeem(child, reward).totalStars;
  saveChildren(children);

  reds.push({ _id: s.nextId('rd'), childId, rewardId, cost: reward.cost, status: 'completed', createdAt: Date.now() });
  saveRedemptions(reds);

  const pts = allPoints();
  pts.push({ _id: s.nextId('p'), childId, delta: -reward.cost, reason: '兑换:' + reward.title, refType: 'redeem', refId: rewardId, createdAt: Date.now() });
  savePoints(pts);

  return ok({ totalStars: child.totalStars });
}

async function taskCRUD({ op, parentToken, payload }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const tasks = allTasks();
  const p = payload || {};

  if (op === 'create') {
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.score) >= 1)) return fail('INVALID', '星星数至少为 1');
    const task = {
      _id: s.nextId('t'), ownerId: user._id, childId: p.childId,
      title: String(p.title).trim(), type: p.type || 'habit', icon: p.icon || '🌟',
      date: p.date || D.ymd(new Date()),
      repeat: p.repeat || { enabled: false, type: 'day', interval: 1, weekdays: [] },
      score: Number(p.score) || 1, priority: p.priority || 'none',
      createdAt: Date.now(), deleted: false
    };
    tasks.push(task);
    saveTasks(tasks);
    return ok({ task });
  }

  if (op === 'update') {
    const task = tasks.find(t => t._id === p.id);
    if (!task) return fail('NOT_FOUND', '任务不存在');
    if (p.title != null) task.title = String(p.title).trim();
    if (p.score != null) task.score = Number(p.score);
    if (p.type != null) task.type = p.type;
    if (p.icon != null) task.icon = p.icon;
    if (p.date != null) task.date = p.date;
    if (p.repeat != null) task.repeat = p.repeat;
    if (p.priority != null) task.priority = p.priority;
    if (!task.title) return fail('INVALID', '请填写标题');
    if (!(task.score >= 1)) return fail('INVALID', '星星数至少为 1');
    saveTasks(tasks);
    return ok({ task });
  }

  if (op === 'delete') {
    const task = tasks.find(t => t._id === p.id);
    if (!task) return fail('NOT_FOUND', '任务不存在');
    task.deleted = true;
    saveTasks(tasks);
    return ok({ id: task._id });
  }
  return fail('INVALID', '未知操作');
}

async function rewardCRUD({ op, parentToken, payload }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const rewards = allRewards();
  const p = payload || {};

  if (op === 'create') {
    if (!p.title || !String(p.title).trim()) return fail('INVALID', '请填写标题');
    if (!(Number(p.cost) >= 1)) return fail('INVALID', '星星数至少为 1');
    const reward = {
      _id: s.nextId('r'), ownerId: user._id, childId: p.childId,
      title: String(p.title).trim(), icon: p.icon || '🎁',
      category: p.category || 'reward',
      resetAfterRedeem: !!p.resetAfterRedeem,   // true=可反复兑换；false=每位孩子仅一次
      cost: Number(p.cost) || 5,
      createdAt: Date.now(), deleted: false
    };
    rewards.push(reward);
    saveRewards(rewards);
    return ok({ reward });
  }

  if (op === 'update') {
    const reward = rewards.find(r => r._id === p.id);
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    if (p.title != null) reward.title = String(p.title).trim();
    if (p.icon != null) reward.icon = p.icon;
    if (p.category != null) reward.category = p.category;
    if (p.resetAfterRedeem != null) reward.resetAfterRedeem = !!p.resetAfterRedeem;
    if (p.cost != null) reward.cost = Number(p.cost);
    if (!reward.title) return fail('INVALID', '请填写标题');
    if (!(reward.cost >= 1)) return fail('INVALID', '星星数至少为 1');
    saveRewards(rewards);
    return ok({ reward });
  }

  if (op === 'delete') {
    const reward = rewards.find(r => r._id === p.id);
    if (!reward) return fail('NOT_FOUND', '奖励不存在');
    reward.deleted = true;
    saveRewards(rewards);
    return ok({ id: reward._id });
  }
  return fail('INVALID', '未知操作');
}

// ============ 多孩子 ============

// 孩子档案读写（与云函数 childCRUD 契约一致）：op=list 只读 / op=update 需家长令牌
async function childCRUD({ op, childId, parentToken, payload }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const mine = allChildren().filter(c => c.ownerId === user._id);

  if (op === 'list') {
    return ok({ children: mine.map(c => ({ _id: c._id, name: c.name, avatar: c.avatar })) });
  }

  if (op === 'update') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const child = mine.find(c => c._id === childId);
    if (!child) return fail('FORBIDDEN', '无权访问该孩子档案');
    const p = payload || {};
    if (p.name == null && p.avatar == null) return fail('INVALID', '没有需要更新的内容');
    if (p.name != null) {
      const name = String(p.name).trim();
      if (!name) return fail('INVALID', '昵称不能为空');
      if (name.length > 12) return fail('INVALID', '昵称最多 12 个字');
      child.name = name;
    }
    if (p.avatar != null) {
      const avatar = String(p.avatar).trim();
      if (!avatar) return fail('INVALID', '头像不能为空');
      child.avatar = avatar;
    }
    saveChildren(allChildren().map(c => (c._id === child._id ? child : c)));
    return ok({ child: { _id: child._id, name: child.name, avatar: child.avatar } });
  }

  return fail('INVALID', '未知操作');
}

async function childSwitch({ childId, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const child = allChildren().find(c => c._id === childId && c.ownerId === user._id);
  if (!child) return fail('FORBIDDEN', '无权访问该孩子档案');
  s.write(s.KEYS.childId, childId);
  return ok({ childId });
}

// ============ 演示辅助 ============

async function resetAll() {
  Object.keys(s.KEYS).forEach(k => {
    if (k === 'privacy') return;
    s.remove(s.KEYS[k]);
  });
  return ok({});
}

module.exports = {
  login, unlockParent, setPin,
  resetPin: resetPinByOpenid,   // 与云函数 resetPin 对齐
  getDashboard, checkIn, redeem,
  taskCRUD, rewardCRUD, childCRUD, childSwitch, resetAll,
  DEFAULT_PIN, PIN_LENGTH, PIN_SCHEME   // 导出供单测守卫（与 cloudfunctions/lib/pin.js 比对）
};
