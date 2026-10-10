// cloudfunctions/childCRUD —— 宝宝档案读写（家长模式可增删改）
//
// 【设计说明 / 对 PRD 的偏离 #6】
// PRD 的 MVP 清单里没有「编辑孩子昵称/头像」入口（PRD-MINE-01 只含多孩子切换）。
// 经确认新增本能力，故独立成 childCRUD 云函数（与 taskCRUD / rewardCRUD 命名对齐），
// 而不是塞进语义为「切换」的 childSwitch。
// 2026-09-18 扩展为「宝宝管理」：支持新增/编辑/删除宝宝，档案字段扩展为
//   gender（''|boy|girl）/ birthday（YYYY-MM-DD 或空串）/ allergens（过敏原文本）。
//   原数字年龄字段 age 被生日取代（不再读写）。
//   op=list   —— 只读，返回当前用户名下全部未删除宝宝（供列表/切换）
//   op=create —— 写，须持有效 parentToken；每账号上限 6 个宝宝
//   op=update —— 写，须持有效 parentToken
//   op=delete —— 写，软删（deleted:true，保留任务/打卡等历史数据）；至少保留一个宝宝
const { cloud, db, ok, fail } = require('./lib/cloud');
const { resolveCaller, assertToken } = require('./lib/runtime');

const NAME_MAX = 12;
const ALLERGENS_MAX = 50;
const MAX_CHILDREN = 6;
const GENDERS = ['', 'boy', 'girl'];

// 生日口径：空串（未填）或 YYYY-MM-DD 且为真实存在的日期
function normalizeBirthday(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (dt.getFullYear() !== Number(m[1]) || dt.getMonth() !== Number(m[2]) - 1 || dt.getDate() !== Number(m[3])) return null;
  return s;
}

// 从 payload 提取并校验可选档案字段；返回 { patch } 或 { error }
function extractProfileFields(p) {
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

function childView(c) {
  return {
    _id: c._id, name: c.name, avatar: c.avatar,
    photo: c.photo || '',
    gender: c.gender || '', birthday: c.birthday || '', allergens: c.allergens || ''
  };
}

exports.main = async (event) => {
  const r = await resolveCaller(event);
  if (r.fail) return r.fail;
  const { OPENID, user } = r;

  const children = db.collection('children');

  if (event.op === 'list') {
    // 内存过滤软删：老档案没有 deleted 字段，云端 where deleted:false 不匹配缺字段文档
    const r = await children.where({ ownerId: user._id }).orderBy('createdAt', 'asc').limit(50).get();
    return ok({ children: r.data.filter(c => !c.deleted).map(childView) });
  }

  if (event.op === 'create') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const mine = (await children.where({ ownerId: user._id }).limit(50).get()).data.filter(c => !c.deleted);
    if (mine.length >= MAX_CHILDREN) return fail('LIMIT', '最多添加 ' + MAX_CHILDREN + ' 个宝宝');

    const p = event.payload || {};
    const name = String(p.name == null ? '' : p.name).trim();
    if (!name) return fail('INVALID', '昵称不能为空');
    if (name.length > NAME_MAX) return fail('INVALID', '昵称最多 ' + NAME_MAX + ' 个字');
    const avatar = String(p.avatar || '').trim() || '🧒';
    const prof = extractProfileFields(p);
    if (prof.error) return prof.error;

    const cdoc = Object.assign({
      ownerId: user._id, name, avatar, photo: '',
      gender: '', birthday: '', allergens: '',
      totalStars: 0, lastCheckInDate: null, createdAt: Date.now(), deleted: false
    }, prof.patch);
    if (p.photo != null) cdoc.photo = String(p.photo);
    const add = await children.add({ data: cdoc });
    return ok({ child: childView(Object.assign({ _id: add._id }, cdoc)) });
  }

  if (event.op === 'update') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const child = (await children.doc(event.childId).get().catch(() => null));
    if (!child || !child.data || child.data.ownerId !== user._id) return fail('FORBIDDEN', '无权访问该宝宝档案');
    if (child.data.deleted) return fail('NOT_FOUND', '该宝宝已删除');
    const c = child.data;

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
    // photo：自定义头像图片（云端 fileID / 本地保存路径）。允许为空串以「清除照片、回退表情头像」。
    if (p.photo != null) patch.photo = String(p.photo);
    const prof = extractProfileFields(p);
    if (prof.error) return prof.error;
    Object.assign(patch, prof.patch);

    if (!Object.keys(patch).length) return fail('INVALID', '没有需要更新的内容');

    await children.doc(c._id).update({ data: patch });
    const merged = Object.assign({}, c, patch);
    return ok({ child: childView(merged) });
  }

  if (event.op === 'delete') {
    const tf = assertToken(event, OPENID);
    if (tf) return tf;
    const child = (await children.doc(event.childId).get().catch(() => null));
    if (!child || !child.data || child.data.ownerId !== user._id) return fail('FORBIDDEN', '无权访问该宝宝档案');
    if (child.data.deleted) return fail('NOT_FOUND', '该宝宝已删除');
    const mine = (await children.where({ ownerId: user._id }).limit(50).get()).data.filter(c => !c.deleted);
    if (mine.length <= 1) return fail('LAST_CHILD', '至少保留一个宝宝');
    // 软删：任务/奖励/打卡等历史数据按 childId 关联，全部保留
    await children.doc(child.data._id).update({ data: { deleted: true } });
    return ok({ id: child.data._id, remaining: mine.length - 1 });
  }

  return fail('INVALID', '未知操作');
};
