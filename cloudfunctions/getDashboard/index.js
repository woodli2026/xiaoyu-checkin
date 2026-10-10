// cloudfunctions/getDashboard —— 孩子看板聚合（星星/连续天数/星级/当月点亮/今日任务/奖励目录/孩子列表）
const { cloud, db, ok, fail } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { resolveCaller } = require('./lib/runtime');
const { buildDashboard } = require('./lib/dashboard');

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { user } = r;

  const childrenRes = await db.collection('children')
    .where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
  // 内存过滤软删：老档案没有 deleted 字段，云端 where deleted:false 不匹配缺字段文档
  const children = childrenRes.data.filter(c => !c.deleted);
  if (!children.length) return fail('NO_CHILD', '无孩子档案');
  const child = children.find(c => c._id === event.childId) || children[0];

  const today = ymd(new Date());

  const [tasksRes, rewardsRes, checkRes, redRes] = await Promise.all([
    db.collection('tasks').where({ childId: child._id, deleted: false }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('rewards').where({ childId: child._id, deleted: false }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('checkIns').where({ childId: child._id }).limit(1000).get(),
    db.collection('redemptions').where({ childId: child._id }).limit(1000).get()
  ]);

  // 纯视图聚合（与本地 buildDashboard 双份镜像，aggregate-guard 守卫）
  return ok(buildDashboard({
    today,
    children,
    child,
    tasks: tasksRes.data,
    rewards: rewardsRes.data,
    redemptions: redRes.data,
    checkIns: checkRes.data
  }));
};
