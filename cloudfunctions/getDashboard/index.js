// cloudfunctions/getDashboard —— 孩子看板聚合（星星/连续天数/星级/当月点亮/今日任务/奖励目录/孩子列表）
const { cloud, db, ok, fail, getUserByOpenid } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { levelOf } = require('./lib/level');
const { displayStreak } = require('./lib/streak');
const { taskVisibleOn } = require('./lib/visibility');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');
  const user = await getUserByOpenid(OPENID);
  if (!user) return fail('AUTH_FAIL', '未登录');

  const childrenRes = await db.collection('children')
    .where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
  // 内存过滤软删：老档案没有 deleted 字段，云端 where deleted:false 不匹配缺字段文档
  const children = childrenRes.data.filter(c => !c.deleted);
  if (!children.length) return fail('NO_CHILD', '无孩子档案');
  const child = children.find(c => c._id === event.childId) || children[0];

  const today = ymd(new Date());
  const ym = today.slice(0, 7);

  const [tasksRes, rewardsRes, checkRes, redRes] = await Promise.all([
    db.collection('tasks').where({ childId: child._id, deleted: false }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('rewards').where({ childId: child._id, deleted: false }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('checkIns').where({ childId: child._id }).limit(1000).get(),
    db.collection('redemptions').where({ childId: child._id }).limit(1000).get()
  ]);

  const tasks = tasksRes.data;
  const checkIns = checkRes.data;
  // 奖励补「该孩子是否已兑换过」：限次奖励（resetAfterRedeem=false）只有一次机会，
  // 这个标志在界面上取代了原「库存」的角色。
  const redeemedIds = new Set((redRes.data || []).map(r => r.rewardId));
  const redMap = {};
  (redRes.data || []).forEach(r => { redMap[r.rewardId] = r._id; });
  const rewards = rewardsRes.data.map(r => Object.assign({}, r, { redeemed: redeemedIds.has(r._id), redeemId: redMap[r.rewardId] || null }));

  const doneToday = new Set(checkIns.filter(c => c.date === today).map(c => c.taskId));
  const todayTasks = tasks
    .filter(t => taskVisibleOn(t, today))
    .map(t => ({
      taskId: t._id, title: t.title, icon: t.icon, score: t.score,
      priority: t.priority, type: t.type, checked: doneToday.has(t._id)
    }));

  const monthLit = Array.from(new Set(
    checkIns.filter(c => String(c.date).slice(0, 7) === ym).map(c => c.date)
  )).sort();

  // 连续天数由打卡流水推导（增量计数器在补打卡场景会算错，2026-09-18 修复）
  const streak = displayStreak(new Set(checkIns.map(c => c.date)), today);
  return ok({
    totalStars: child.totalStars || 0,
    streak,
    level: levelOf(streak),
    monthLit,
    todayTasks,
    tasks,
    rewards,
    checkIns: checkRes.data.map(c => ({ id: c._id, taskId: c.taskId, date: c.date })),
    child: {
      _id: child._id, name: child.name, avatar: child.avatar, photo: child.photo || '',
      gender: child.gender || '', birthday: child.birthday || '', allergens: child.allergens || ''
    },
    children: children.map(c => ({
      _id: c._id, name: c.name, avatar: c.avatar, photo: c.photo || '',
      gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
    }))
  });
};
