// @ts-check
// utils/child-form.js —— 宝宝档案表单的纯构造（D4 下沉）
// 为什么单独成模块：mine 页「新增/编辑宝宝」两处入口各自手写一长串 setData 字段，
// 与 tasks.js 的 emptyTaskForm/emptyRewardForm 同型。抽成纯函数后可单测，页面只留编排。
// 无 wx / 无 IO。

/**
 * 新增宝宝：空白表单字段集
 * @returns {object}
 */
function emptyChildForm() {
  return {
    editingChild: false, editChildId: '',
    editName: '', editAvatar: '🧒', editPhoto: '',
    editGender: '', editBirthday: '', editAllergens: '', editErr: ''
  };
}

/**
 * 编辑宝宝：由档案对象投影出表单字段集
 * @param {object} [c] 宝宝档案（children 列表项）
 * @returns {object}
 */
function childFormFrom(c) {
  const x = c || {};
  return {
    editingChild: true, editChildId: x._id || '',
    editName: x.name || '', editAvatar: x.avatar || '🧒', editPhoto: x.photo || '',
    editGender: x.gender || '', editBirthday: x.birthday || '', editAllergens: x.allergens || '',
    editErr: ''
  };
}

module.exports = { emptyChildForm, childFormFrom };
