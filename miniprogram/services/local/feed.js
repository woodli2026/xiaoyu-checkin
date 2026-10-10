// services/local/feed.js —— 本地兜底层：动态流水（D3 拆分）
const { s, ok, fail, currentUser, allChildren, saveChildren, allTasks, allRewards, allCheckIns, saveCheckIns, allRedemptions, saveRedemptions, allPoints, savePoints, verifyLocalToken } = require('./store');
const D = require('../../utils/domain');
const F = require('../../utils/feed');

// ============ 动态（打卡 + 兑换流水）============

// 与云函数 feedCRUD 契约一致：op=list 只读；undoCheckIn / undoRedeem 需家长令牌。
// 口径要点（与云端逐条对齐）：
//   ① 任务/奖励**故意不过滤 deleted** —— 历史动态要能显示已删条目的名字与图标；
//   ② 反向流水（refType=checkin_undo / redeem_undo）只作审计，不在动态列表展示；
//   ③ 撤销打卡后连续天数/星级由 displayStreak 重算；
//   ④ 取消兑换会删除 redemptions 记录 → 限次奖励自动恢复可兑。
async function feedCRUD({ op, limit, skip, id, parentToken }) {
  const user = currentUser();
  if (!user) return fail('AUTH_FAIL', '未登录');
  const children = allChildren().filter(c => c.ownerId === user._id && !c.deleted);

  if (op === 'list') {
    // 纯数据聚合（与云端 buildFeed 双份镜像，aggregate-guard 守卫）
    // 任务/奖励故意不过滤 deleted：历史动态要能显示已删条目的名字与图标
    return ok(F.buildFeed({
      children,
      tasks: allTasks(),
      rewards: allRewards(),
      checkIns: allCheckIns(),
      redemptions: allRedemptions(),
      limit, skip
    }));
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

module.exports = { feedCRUD };
