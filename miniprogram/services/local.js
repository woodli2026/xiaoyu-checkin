// services/local.js —— 本地兜底数据层
// 未配置云环境时启用；接口契约与 8 个云函数完全一致，页面层无需感知差异。
const s = require('../utils/storage');
const D = require('../utils/domain');
const T = require('../utils/tasks');
const P = require('../utils/pets');
const SEED = require('../utils/seed');
const CFG = require('../config');

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
function allPets() { return s.read(s.KEYS.pets, []); }
function savePets(l) { s.write(s.KEYS.pets, l); }

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
      streak: 0,
      lastCheckInDate: null,
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
  const t = D.issueToken(CFG.PARENT_IDLE_MS || 15 * 60 * 1000);
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
  // 过滤软删宝宝：与云端 getDashboard 同口径
  const children = allChildren().filter(c => !c.deleted);
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

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const streak = D.displayStreak(new Set(checkIns.map(c => c.date)), today);

  return ok({
    totalStars: child.totalStars || 0,
    streak,
    level: D.levelOf(streak),
    monthLit,
    todayTasks,
    tasks,
    rewards,
    checkIns: checkIns.map(c => ({ taskId: c.taskId, date: c.date })),
    child: {
      _id: child._id, name: child.name, avatar: child.avatar, photo: child.photo || '',
      gender: child.gender || '', birthday: child.birthday || '', allergens: child.allergens || ''
    },
    children: children.map(c => ({
      _id: c._id, name: c.name, avatar: c.avatar, photo: c.photo || '',
      gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
    }))
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

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const streak = D.displayStreak(
    new Set(checkIns.filter(c => c.childId === childId).map(c => c.date)),
    D.ymd(new Date())
  );
  return ok({ totalStars: child.totalStars, streak, level: D.levelOf(streak) });
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
      title: String(p.title).trim(), type: p.type || 'habit', icon: p.icon || '✏️',
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

// 孩子档案字段口径：必须与云函数 childCRUD 保持一致
const NAME_MAX_CHILD = 12;
const ALLERGENS_MAX = 50;
const MAX_CHILDREN = 6;
const GENDERS = ['', 'boy', 'girl'];

// 生日口径：空串（未填）或 YYYY-MM-DD 且为真实存在的日期
function normalizeBirthday(v) {
  const str = String(v == null ? '' : v).trim();
  if (!str) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return str;
}

function childView(c) {
  return {
    _id: c._id, name: c.name, avatar: c.avatar, photo: c.photo || '',
    gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
  };
}

// 从 payload 提取并校验可选档案字段；返回 { patch } 或 { error }
function extractChildProfile(p) {
  const patch = {};
  if (p.gender != null) {
    const g = String(p.gender);
    if (GENDERS.indexOf(g) < 0) return { error: fail('INVALID', '性别取值不合法') };
    patch.gender = g;
  }
  if (p.birthday != null) {
    const b = normalizeBirthday(p.birthday);
    if (b === null) return { error: fail('INVALID', '生日格式需为 YYYY-MM-DD') };
    patch.birthday = b;
  }
  if (p.allergens != null) {
    const a = String(p.allergens).trim();
    if (a.length > ALLERGENS_MAX) return { error: fail('INVALID', '过敏原最多 ' + ALLERGENS_MAX + ' 个字') };
    patch.allergens = a;
  }
  return { patch };
}

// 宝宝档案读写（与云函数 childCRUD 契约一致）：
//   op=list 只读；op=create / update / delete 需家长令牌
// 字段：name / avatar / photo / gender(''|boy|girl) / birthday(YYYY-MM-DD|'') / allergens
async function childCRUD({ op, childId, parentToken, payload }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const mine = allChildren().filter(c => c.ownerId === user._id && !c.deleted);

  if (op === 'list') {
    return ok({ children: mine.map(childView) });
  }

  if (op === 'create') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    if (mine.length >= MAX_CHILDREN) return fail('LIMIT', '最多添加 ' + MAX_CHILDREN + ' 个宝宝');
    const p = payload || {};
    const name = String(p.name == null ? '' : p.name).trim();
    if (!name) return fail('INVALID', '昵称不能为空');
    if (name.length > NAME_MAX_CHILD) return fail('INVALID', '昵称最多 ' + NAME_MAX_CHILD + ' 个字');
    const prof = extractChildProfile(p);
    if (prof.error) return prof.error;
    const child = Object.assign({
      _id: s.nextId('c'), ownerId: user._id, name,
      avatar: String(p.avatar || '').trim() || '🧒', photo: p.photo != null ? String(p.photo) : '',
      gender: '', birthday: '', allergens: '',
      totalStars: 0, streak: 0, lastCheckInDate: null, createdAt: Date.now(), deleted: false
    }, prof.patch);
    const all = allChildren();
    all.push(child);
    saveChildren(all);
    return ok({ child: childView(child) });
  }

  if (op === 'update') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const child = mine.find(c => c._id === childId);
    if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
    const p = payload || {};
    const patch = {};
    if (p.name != null) {
      const name = String(p.name).trim();
      if (!name) return fail('INVALID', '昵称不能为空');
      if (name.length > NAME_MAX_CHILD) return fail('INVALID', '昵称最多 ' + NAME_MAX_CHILD + ' 个字');
      patch.name = name;
    }
    if (p.avatar != null) {
      const avatar = String(p.avatar).trim();
      if (!avatar) return fail('INVALID', '头像不能为空');
      patch.avatar = avatar;
    }
    // photo：自定义头像图片（云端 fileID / 本地保存路径）；空串表示清除照片、回退表情头像
    if (p.photo != null) patch.photo = String(p.photo);
    const prof = extractChildProfile(p);
    if (prof.error) return prof.error;
    Object.assign(patch, prof.patch);
    if (!Object.keys(patch).length) return fail('INVALID', '没有需要更新的内容');
    Object.assign(child, patch);
    saveChildren(allChildren().map(c => (c._id === child._id ? child : c)));
    return ok({ child: childView(child) });
  }

  if (op === 'delete') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const child = mine.find(c => c._id === childId);
    if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
    if (mine.length <= 1) return fail('LAST_CHILD', '至少保留一个宝宝');
    // 软删：任务/奖励/打卡等历史数据按 childId 关联，全部保留
    child.deleted = true;
    saveChildren(allChildren().map(c => (c._id === child._id ? child : c)));
    return ok({ id: child._id, remaining: mine.length - 1 });
  }

  return fail('INVALID', '未知操作');
}

async function childSwitch({ childId, parentToken }) {
  if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
  const user = currentUser();
  const child = allChildren().find(c => c._id === childId && c.ownerId === user._id && !c.deleted);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
  s.write(s.KEYS.childId, childId);
  return ok({ childId });
}

// ============ 动态（打卡 + 兑换流水）============

// 与云函数 feedCRUD 契约一致：op=list 只读；undoCheckIn / undoRedeem 需家长令牌。
// 口径要点（与云端逐条对齐）：
//   ① 任务/奖励**故意不过滤 deleted** —— 历史动态要能显示已删条目的名字与图标；
//   ② 反向流水（refType=checkin_undo / redeem_undo）只作审计，不在动态列表展示；
//   ③ 撤销打卡后连续天数/星级由 displayStreak 重算；
//   ④ 取消兑换会删除 redemptions 记录 → 限次奖励自动恢复可兑。
const FEED_DEFAULT_LIMIT = 30;
const FEED_MAX_LIMIT = 100;

async function feedCRUD({ op, limit, skip, id, parentToken }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const children = allChildren().filter(c => c.ownerId === user._id && !c.deleted);

  if (op === 'list') {
    const childMap = {};
    children.forEach(c => { childMap[c._id] = c; });
    const taskMap = {};
    allTasks().forEach(t => { taskMap[t._id] = t; });        // 不过滤 deleted
    const rewardMap = {};
    allRewards().forEach(r => { rewardMap[r._id] = r; });

    const items = [];
    allCheckIns().forEach(ci => {
      const c = childMap[ci.childId];
      if (!c) return;
      const t = taskMap[ci.taskId];
      const stars = Number(ci.score) || (t ? Number(t.score) : 0) || 0;
      items.push({
        id: ci._id, kind: 'checkin',
        childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
        refId: ci.taskId, title: t ? t.title : '（任务已删除）', icon: t ? t.icon : '❔',
        stars, delta: stars,
        date: ci.date || null, createdAt: ci.createdAt || 0, deleted: !!(t && t.deleted),
        taskType: t ? (t.type || '') : '', repeat: t && t.repeat ? t.repeat : null,
        priority: t ? (t.priority || 'none') : 'none'
      });
    });
    allRedemptions().forEach(rd => {
      const c = childMap[rd.childId];
      if (!c) return;
      const r = rewardMap[rd.rewardId];
      const cost = Number(rd.cost) || (r ? Number(r.cost) : 0) || 0;
      items.push({
        id: rd._id, kind: 'redeem',
        childId: c._id, childName: c.name, childAvatar: c.avatar, childPhoto: c.photo || '',
        refId: rd.rewardId, title: r ? r.title : '（奖励已删除）', icon: r ? r.icon : '❔',
        stars: cost, delta: -cost,
        date: null, createdAt: rd.createdAt || 0, deleted: !!(r && r.deleted),
        category: r ? (r.category || 'reward') : 'reward',
        resetAfterRedeem: r ? !!r.resetAfterRedeem : true
      });
    });

    items.sort((a, b) => b.createdAt - a.createdAt);
    const total = items.length;
    const lim = Math.min(Math.max(Number(limit) || FEED_DEFAULT_LIMIT, 1), FEED_MAX_LIMIT);
    const sk = Math.max(Number(skip) || 0, 0);
    const page = items.slice(sk, sk + lim);
    return ok({ items: page, hasMore: sk + page.length < total, total });
  }

  if (op === 'undoCheckIn') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const list = allCheckIns();
    const idx = list.findIndex(c => c._id === id);
    if (idx < 0) return fail('NOT_FOUND', '打卡记录不存在或已撤销');
    const ci = list[idx];
    const child = children.find(c => c._id === ci.childId);
    if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
    const task = allTasks().find(t => t._id === ci.taskId);
    const stars = Number(ci.score) || (task ? Number(task.score) : 0) || 0;

    child.totalStars = Math.max(0, (child.totalStars || 0) - stars);
    saveChildren(allChildren().map(c => (c._id === child._id ? child : c)));
    list.splice(idx, 1);
    saveCheckIns(list);
    const pts = allPoints();
    pts.push({
      _id: s.nextId('p'), childId: child._id, delta: -stars,
      reason: '撤销打卡:' + (task ? task.title : ''), refType: 'checkin_undo', refId: ci.taskId, createdAt: Date.now()
    });
    savePoints(pts);

    const streak = D.displayStreak(
      new Set(list.filter(c => c.childId === child._id).map(c => c.date)), D.ymd(new Date())
    );
    return ok({ totalStars: child.totalStars, streak, level: D.levelOf(streak), id: ci._id });
  }

  if (op === 'undoRedeem') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const list = allRedemptions();
    const idx = list.findIndex(r => r._id === id);
    if (idx < 0) return fail('NOT_FOUND', '兑换记录不存在或已取消');
    const rd = list[idx];
    const child = children.find(c => c._id === rd.childId);
    if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
    const reward = allRewards().find(r => r._id === rd.rewardId);
    const cost = Number(rd.cost) || (reward ? Number(reward.cost) : 0) || 0;

    child.totalStars = (child.totalStars || 0) + cost;
    saveChildren(allChildren().map(c => (c._id === child._id ? child : c)));
    list.splice(idx, 1);
    saveRedemptions(list);
    const pts = allPoints();
    pts.push({
      _id: s.nextId('p'), childId: child._id, delta: cost,
      reason: '取消兑换:' + (reward ? reward.title : ''), refType: 'redeem_undo', refId: rd.rewardId, createdAt: Date.now()
    });
    savePoints(pts);

    return ok({ totalStars: child.totalStars, rewardId: rd.rewardId, id: rd._id });
  }

  return fail('INVALID', '未知操作');
}

// ============ 宠物（第二阶段：宠物 tab）============

// 宠物 per-child：每个宝宝同时最多 1 只（放生后旧档案软删保留，可重新领养）
// 口径要点（与云函数 petCRUD 契约一致）：
//   ① stage 由 growthValue 派生，不入库（防漂移）；
//   ② mood 按真实时间衰减：读取前用 applyMoodDecay 重算，仅在互动（写）时落库；
//   ③ 投喂消耗星星 → 需家长令牌，并写一条 refType='pet_feed' 的积分流水；
//   ④ 抚摸免费 → 免家长令牌（孩子也能玩），不扣星星、不写流水；
//   ⑤ 统计（连续互动/累计投喂·抚摸/近 7 天）由 pet 内的 feedCount/strokeCount/daily 现算。
//   ⑥ 投喂每日上限 PET_FEED_DAILY_LIMIT 次/天（复用 pet.daily[today].feed 计数），达限返回 FEED_LIMIT 不扣星。
function findPet(childId) {
  return (allPets() || []).find(p => p.childId === childId && !p.released) || null;
}

function petView(pet, today) {
  if (!pet) return null;
  // 老 key 兼容：读取时映射为品种 key（不改写历史数据），未入库品种回落物种默认
  const breedKey = P.resolveSpeciesKey(pet.species);
  const info = P.stageInfo(pet.growthValue, breedKey);
  const breed = P.speciesOf(breedKey);
  // 每日投喂上限：今日已喂次数与是否达限（复用 pet.daily[today].feed 口径，与云端 petView 一致）
  const todayFeedCount = ((pet.daily || {})[today] || {}).feed || 0;
  return {
    _id: pet._id, childId: pet.childId, species: breedKey,
    breedName: breed ? breed.name : '', name: pet.name,
    growthValue: info.growthValue, growthPct: info.growthPct,
    // 成长瓶：按「到下一阶段」的阶段内进度填充（每投喂一次液面可见上升）；满级为满瓶
    stageHave: info.stageHave, stageNeed: info.stageNeed, stagePct: info.stagePct,
    stage: info.stage, stageName: info.name,
    emoji: info.emoji, speciesEmoji: info.speciesEmoji, nextStageAt: info.nextStageAt,
    mood: P.applyMoodDecay(pet.mood, pet.lastMoodAt, Date.now()), moodMax: P.MOOD_MAX,
    feedCount: Number(pet.feedCount) || 0, strokeCount: Number(pet.strokeCount) || 0,
    todayFeedCount, feedLimited: todayFeedCount >= P.PET_FEED_DAILY_LIMIT,
    adoptedAt: pet.createdAt || 0,
    stats: P.computePetStats(pet, today)
  };
}

// op: info(只读·免令牌) / adopt / feed / stroke(免令牌) / rename / reset / release
async function petCRUD({ op, childId, parentToken, payload }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const today = D.ymd(new Date());
  const children = allChildren();
  const child = children.find(c => c._id === childId && c.ownerId === user._id && !c.deleted);
  if (!child) return fail('FORBIDDEN', '无权访问该宝宝档案');
  const p = payload || {};

  if (op === 'info') {
    return ok({ pet: petView(findPet(childId), today) });
  }

  if (op === 'adopt') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    if (findPet(childId)) return fail('ALREADY_HAS_PET', '该宝宝已经有一只宠物啦');
    // 品种即花色（2026-09 升级）：入参为物种组（'cat'|'dog'），品种在物种内随机 5 选 1 后入库
    const group = String(p.species || 'cat');
    if (!P.isValidSpeciesGroup(group)) return fail('INVALID', '不支持的宠物种类');
    const species = P.randomBreedKey(group);
    // 名称：不传 → 用品种默认名；传了就必须非空且 ≤8 字
    let name;
    if (p.name == null) {
      name = P.normalizePetName('', species);
    } else {
      const v = String(p.name).trim();
      if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
      name = v;
    }
    const now = Date.now();
    const pet = {
      _id: s.nextId('pt'), ownerId: user._id, childId,
      species, name,
      growthValue: 0, feedCount: 0, strokeCount: 0,
      mood: P.MOOD_INIT, lastMoodAt: now,
      daily: {}, createdAt: now, released: false
    };
    const pets = allPets();
    pets.push(pet);
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'feed') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    // 每日投喂上限：当日有效投喂达 PET_FEED_DAILY_LIMIT 次即拒绝（不扣星、不加成长值）
    const todayFeedCount = ((pet.daily || {})[today] || {}).feed || 0;
    if (todayFeedCount >= P.PET_FEED_DAILY_LIMIT) {
      return fail('FEED_LIMIT', '今天吃饱啦，明天再喂吧');
    }
    if ((child.totalStars || 0) < P.PET_FEED_COST) return fail('INSUFFICIENT', '星星不够啦');
    const now = Date.now();
    child.totalStars = (child.totalStars || 0) - P.PET_FEED_COST;
    saveChildren(children);
    pet.mood = P.moodAfterFeed(pet.mood, pet.lastMoodAt, now);
    pet.growthValue = (Number(pet.growthValue) || 0) + P.PET_GROWTH_PER_FEED;
    pet.feedCount = (Number(pet.feedCount) || 0) + 1;
    pet.daily = P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'feed'), today);
    pet.lastMoodAt = now;
    savePets(pets);
    const pts = allPoints();
    pts.push({
      _id: s.nextId('p'), childId, delta: -P.PET_FEED_COST,
      reason: '投喂:' + pet.name, refType: 'pet_feed', refId: pet._id, createdAt: now
    });
    savePoints(pts);
    return ok({ pet: petView(pet, today), totalStars: child.totalStars });
  }

  if (op === 'stroke') {
    // 免费互动：免家长令牌，孩子也能摸（不扣星星 / 不写流水）
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    pet.mood = P.moodAfterStroke(pet.mood, pet.lastMoodAt, now);
    pet.strokeCount = (Number(pet.strokeCount) || 0) + 1;
    pet.daily = P.pruneDaily(P.bumpDaily(pet.daily || {}, today, 'stroke'), today);
    pet.lastMoodAt = now;
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'rename') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const v = String(p.name == null ? '' : p.name).trim();
    if (!P.isValidPetName(v)) return fail('INVALID', '名字最多 ' + P.PET_NAME_MAX + ' 个字');
    pet.name = v;
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'reset') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    const now = Date.now();
    pet.growthValue = 0;
    pet.feedCount = 0;
    pet.strokeCount = 0;
    pet.mood = P.MOOD_INIT;
    pet.lastMoodAt = now;
    pet.daily = {};
    savePets(pets);
    return ok({ pet: petView(pet, today) });
  }

  if (op === 'release') {
    if (!verifyLocalToken(parentToken)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const pets = allPets();
    const pet = pets.find(x => x.childId === childId && !x.released);
    if (!pet) return fail('PET_NOT_FOUND', '还没有宠物');
    pet.released = true;              // 软删：成长历史保留，可重新领养一只新的
    pet.releasedAt = Date.now();
    savePets(pets);
    return ok({ id: pet._id });
  }

  return fail('INVALID', '未知操作');
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
  taskCRUD, rewardCRUD, childCRUD, childSwitch, feedCRUD, petCRUD, resetAll,
  DEFAULT_PIN, PIN_LENGTH, PIN_SCHEME   // 导出供单测守卫（与 cloudfunctions/lib/pin.js 比对）
};
