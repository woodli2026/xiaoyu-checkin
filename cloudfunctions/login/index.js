// cloudfunctions/login —— 静默登录：按 openid 查重/建号 + 至少 1 个孩子档案 + 开箱预置数据
const { cloud, db, ok, fail, genRandomCode, VEGGIES } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { seedTasks, seedRewards } = require('./lib/seed');
const { PIN_SCHEME, defaultPinHash, isCurrentPinScheme } = require('./lib/pin');

// 预置「3 任务 + 2 奖励」（见 lib/seed.js 的设计说明）：仅在首次创建孩子档案时执行一次。
// 单条失败不阻断登录，只记录日志 —— 家长也能自建，代价可接受。
async function seedChildData(ownerId, childId) {
  const now = Date.now();
  const date = ymd(new Date(now));
  const tasks = seedTasks({ ownerId, childId, date, now });
  const rewards = seedRewards({ ownerId, childId, now });
  let inserted = 0;
  for (const doc of tasks) {
    try { await db.collection('tasks').add({ data: doc }); inserted++; }
    catch (e) { console.error('[login] 预置任务失败', doc.title, e); }
  }
  for (const doc of rewards) {
    try { await db.collection('rewards').add({ data: doc }); inserted++; }
    catch (e) { console.error('[login] 预置奖励失败', doc.title, e); }
  }
  return inserted;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');

  const users = db.collection('users');
  let user = (await users.where({ openid: OPENID }).limit(1).get()).data[0];

  if (!user) {
    const doc = {
      openid: OPENID,
      randomCode: genRandomCode(),
      nickname: VEGGIES[Math.floor(Math.random() * VEGGIES.length)] + '宝宝',
      avatar: '🧒',
      pinHash: defaultPinHash(),   // 内置默认 PIN（见 lib/pin.js DEFAULT_PIN）
      pinSet: true,
      pinScheme: PIN_SCHEME,
      createdAt: Date.now()
    };
    try {
      const add = await users.add({ data: doc });
      user = Object.assign({ _id: add._id }, doc);
    } catch (e) {
      // 并发首登竞态：openid 唯一索引兜底，回查
      user = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
      if (!user) return fail('AUTH_FAIL', '建号失败，请重试');
    }
  }

  // 兼容两类历史账号，统一重置为默认 PIN，避免「怎么输都进不去」的死状态：
  //   ① 更早版本遗留的无 PIN 账号（pinSet = false）
  //   ② PIN 方案变更前的账号（如 8 位口径建的号：pinSet 为真、pinScheme 缺失或不匹配，
  //      其 pinHash 存的是 hash('12345678')，永远匹配不上 6 位输入）
  if (!isCurrentPinScheme(user)) {
    const hash = defaultPinHash();
    try {
      await users.doc(user._id).update({
        data: { pinHash: hash, pinSet: true, pinScheme: PIN_SCHEME }
      });
      user.pinHash = hash;
      user.pinSet = true;
      user.pinScheme = PIN_SCHEME;
      console.info('[login] PIN 方案迁移完成 ->', PIN_SCHEME);
    } catch (e) {
      console.error('[login] PIN 方案迁移失败', e);
    }
  }

  const children = db.collection('children');
  // 内存过滤软删宝宝：老档案没有 deleted 字段，云端 where deleted:false 不匹配缺字段文档
  const mine = (await children.where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get())
    .data.filter(c => !c.deleted);
  let child = mine[0] || null;
  if (!child) {
    const cdoc = {
      ownerId: user._id, name: '宝宝', avatar: '🧒', photo: '',
      gender: '', birthday: '', allergens: '',
      totalStars: 0, createdAt: Date.now(), deleted: false
    };
    const add = await children.add({ data: cdoc });
    child = Object.assign({ _id: add._id }, cdoc);
    await seedChildData(user._id, child._id);
  }

  return ok({
    user: {
      _id: user._id, nickname: user.nickname, avatar: user.avatar,
      pinSet: !!user.pinSet, randomCode: user.randomCode
    },
    childId: child._id,
    child: { _id: child._id, name: child.name, avatar: child.avatar },
    pinSet: !!user.pinSet
  });
};
