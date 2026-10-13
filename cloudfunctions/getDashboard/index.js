// cloudfunctions/getDashboard —— 孩子看板聚合（星星/连续天数/星级/当月点亮/今日任务/奖励目录/孩子列表）
const { cloud, db, ok, fail } = require('./lib/cloud');
const { ymd } = require('./lib/util');
const { resolveCaller } = require('./lib/runtime');
const { pickCurrent } = require('./lib/ownership');
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
  // 候选②：默认选中语义（childId 缺失/不匹配 → 第一个宝宝），与本地层 dashboard 同口径
  const child = pickCurrent(children, event.childId);

  const today = ymd(new Date());

  // 软删一律「内存过滤」，不用 deleted:false 谓词 —— 否则缺该字段的文档会静默消失
  const [tasksRes, rewardsRes, checkRes, redRes] = await Promise.all([
    db.collection('tasks').where({ childId: child._id }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('rewards').where({ childId: child._id }).orderBy('createdAt', 'asc').limit(200).get(),
    db.collection('checkIns').where({ childId: child._id }).limit(1000).get(),
    db.collection('redemptions').where({ childId: child._id }).limit(1000).get()
  ]);
  const tasks = tasksRes.data.filter((t) => !t.deleted);
  const rewards = rewardsRes.data.filter((r) => !r.deleted);

  // 纯视图聚合（与本地 buildDashboard 双份镜像，aggregate-guard 守卫）
  return ok(buildDashboard({
    today,
    children,
    child,
    tasks,
    rewards,
    redemptions: redRes.data,
    checkIns: checkRes.data
  }));
};
