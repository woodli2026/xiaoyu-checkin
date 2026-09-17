// cloudfunctions/childCRUD —— 孩子档案读写（家长模式可改昵称/头像）
//
// 【设计说明 / 对 PRD 的偏离 #6】
// PRD 的 MVP 清单里没有「编辑孩子昵称/头像」入口（PRD-MINE-01 只含多孩子切换）。
// 经确认新增本能力，故独立成 childCRUD 云函数（与 taskCRUD / rewardCRUD 命名对齐），
// 而不是塞进语义为「切换」的 childSwitch。
//   op=list   —— 只读，返回当前用户名下全部孩子档案（供选择器/编辑面板）
//   op=update —— 写，须持有效 parentToken；仅允许改 name / avatar
const { cloud, db, ok, fail, getOwnedChild, getUserByOpenid } = require('./lib/cloud');
const { verifyToken } = require('./lib/token');

const NAME_MAX = 12;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('AUTH_FAIL', '缺少 openid');

  const user = await getUserByOpenid(OPENID);
  if (!user) return fail('AUTH_FAIL', '未登录');

  const children = db.collection('children');

  if (event.op === 'list') {
    const r = await children.where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
    return ok({ children: r.data.map(c => ({ _id: c._id, name: c.name, avatar: c.avatar })) });
  }

  if (event.op === 'update') {
    if (!verifyToken(event.parentToken, OPENID)) return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
    const child = await getOwnedChild(OPENID, event.childId);
    if (!child || child._id !== event.childId) return fail('FORBIDDEN', '无权访问该孩子档案');

    const p = event.payload || {};
    const patch = {};
    if (p.name != null) {
      const name = String(p.name).trim();
      if (!name) return fail('INVALID', '昵称不能为空');
      if (name.length > NAME_MAX) return fail('INVALID', '昵称最多 ' + NAME_MAX + ' 个字');
      patch.name = name;
    }
    if (p.avatar != null) {
      const avatar = String(p.avatar).trim();
      if (!avatar) return fail('INVALID', '头像不能为空');
      patch.avatar = avatar;
    }
    if (!Object.keys(patch).length) return fail('INVALID', '没有需要更新的内容');

    await children.doc(child._id).update({ data: patch });
    return ok({
      child: { _id: child._id, name: patch.name != null ? patch.name : child.name, avatar: patch.avatar != null ? patch.avatar : child.avatar }
    });
  }

  return fail('INVALID', '未知操作');
};
