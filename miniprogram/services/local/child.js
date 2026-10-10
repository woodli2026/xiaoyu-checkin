// services/local/child.js —— 本地兜底层：多宝宝档案（D3 拆分）
const { s, ok, fail, currentUser, allChildren, saveChildren, verifyLocalToken } = require('./store');

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
      totalStars: 0, createdAt: Date.now(), deleted: false
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

module.exports = {
  childCRUD, childSwitch,
  childView, normalizeBirthday, extractChildProfile,
  NAME_MAX_CHILD, ALLERGENS_MAX, MAX_CHILDREN, GENDERS
};
