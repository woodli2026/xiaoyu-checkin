const { callApi } = require('../../utils/api');
const D = require('../../utils/domain');
const { attachTabBarSync } = require('../../utils/tabbar');
const s = require('../../utils/storage');
const CF = require('../../utils/child-form');
function modal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (res) => resolve(res),
      fail: () => resolve({ confirm: false })
    }));
  });
}
Page({
  behaviors: [require('../../behaviors/pin-reauth'), require('../../behaviors/parent-gate'), require('../../behaviors/child-photo')],
  data: {
    mode: 'display', pinSet: false, useCloud: false,
    user: { nickname: '', avatar: '🧒', randomCode: '' },
    child: null, childId: '', children: [],
    version: '1.0.0', todayStr: '', beianNo: '',
    showSetPin: false, setPinStage: 'new', pendingPin: '', setPinErr: '',
    showBabyList: false,
    showEditChild: false, editingChild: false, editChildId: '',
    editName: '', editAvatar: '🧒', editPhoto: '',
    editGender: '', editBirthday: '', editAllergens: '', editErr: '',
    showHelp: false, showAbout: false,
    showPrivacy: false,   // 隐私授权弹层（components/privacy-sheet，选图就地授权用）
    startInParent: true   // 设置项：启动即家长模式（R10，默认开）
  },
  noop() {},
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    attachTabBarSync(this);
    this.refresh();
  },
  async refresh() {
    const app = getApp();
    try { await app.whenReady(); } catch (e) { return; }
    const u = app.globalData.user || {};
    const todayStr = D.ymd(new Date());
    this.setData({
      mode: app.globalData.mode,
      pinSet: !!u.pinSet,
      useCloud: app.globalData.useCloud,
      user: { nickname: u.nickname || '', avatar: u.avatar || '🧒', randomCode: u.randomCode || '' },
      childId: app.globalData.childId,
      version: app.globalData.version,
      beianNo: app.globalData.beianNo,
      todayStr,
      startInParent: s.read(s.KEYS.startInParent, true)
    });
    await this.load();
  },
  async load() {
    const app = getApp();
    try {
      const res = await callApi('getDashboard', { childId: app.globalData.childId });
      this.setData({ children: res.children || [], child: res.child || null });
    } catch (e) { /* 忽略 */ }
  },
  // toggleParent 已收拢到 behaviors/parent-gate（「家长模式」行 bindtap="toggleParent"）
  toggleStartInParent(e) {
    const v = !!e.detail.value;
    s.write(s.KEYS.startInParent, v);
    this.setData({ startInParent: v });
  },
  openSetPin() {
    const app = getApp();
    if (!this.requireParent()) return;
    this.setData({ showSetPin: true, setPinStage: 'new', pendingPin: '', setPinErr: '' });
  },
  onSetPinComplete(e) {
    if (this.data.setPinStage === 'new') {
      this.setData({ showSetPin: false, pendingPin: e.detail.pin, setPinErr: '' });
      setTimeout(() => this.setData({ showSetPin: true, setPinStage: 'confirm' }), 60);
      return;
    }
    if (e.detail.pin !== this.data.pendingPin) {
      this.setData({ showSetPin: false, setPinStage: 'new', pendingPin: '' });
      setTimeout(() => this.setData({ showSetPin: true, setPinErr: '两次输入不一致，请重试' }), 60);
      return;
    }
    this.doSetPin(this.data.pendingPin);
  },
  async doSetPin(pin) {
    const app = getApp();
    try {
      await callApi('setPin', { pin });
      if (app.globalData.user) app.globalData.user.pinSet = true;
      this.setData({ showSetPin: false, pinSet: true, pendingPin: '' });
      wx.showToast({ title: 'PIN 已设置', icon: 'success' });
    } catch (err) {
      this.setData({
        setPinErr: (err && err.message) || '设置失败',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onSetPinClose() { this.setData({ showSetPin: false, setPinStage: 'new', pendingPin: '' }); },
  async forgotPin() {
    const r = await modal({
      title: '重置 PIN',
      content: '将把家长 PIN 恢复为默认值 123456，重置后请尽快改成自己的。确定？'
    });
    if (!r.confirm) return;
    try {
      await callApi('resetPin', {});
      const app = getApp();
      if (app.globalData.user) app.globalData.user.pinSet = true;
      app.clearParent();
      this.setData({ pinSet: true, mode: 'display' });
      wx.showToast({ title: '已恢复默认 PIN', icon: 'none' });
    } catch (e) {
      wx.showToast({ title: '重置失败', icon: 'none' });
    }
  },
  // 家长模式闸门已收拢到 behaviors/parent-gate#requireParent（真值统一取 globalData.mode）
  openBabyList() {
    if (!this.requireParent()) return;
    this.setData({ showBabyList: true });
  },
  closeBabyList() { this.setData({ showBabyList: false }); },
  async pickChild(e) {
    const app = getApp();
    const childId = e.currentTarget.dataset.id;
    if (childId === this.data.childId) return;
    if (!this.requireParent()) return;
    try {
      await callApi('childSwitch', { childId });
      app.globalData.childId = childId;
      this.setData({ childId });
      wx.showToast({ title: '已切换', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' });
    }
  },
  openNewChild() {
    if (!this.requireParent()) return;
    this.setData(Object.assign({ showEditChild: true }, CF.emptyChildForm()));
  },
  openChildEditor(e) {
    if (!this.requireParent()) return;
    const id = e.currentTarget.dataset.id;
    const c = (this.data.children || []).find(x => x._id === id);
    if (!c) return;
    this.setData(Object.assign({ showEditChild: true }, CF.childFormFrom(c)));
  },
  closeEditChild() {
    this.setData({ showEditChild: false, editErr: '', editPhoto: '' });
  },
  onEditNameInput(e) { this.setData({ editName: e.detail.value, editErr: '' }); },
  onEditAllergensInput(e) { this.setData({ editAllergens: e.detail.value, editErr: '' }); },
  onEditGender(e) { this.setData({ editGender: e.currentTarget.dataset.gender, editErr: '' }); },
  onEditBirthday(e) { this.setData({ editBirthday: e.detail.value, editErr: '' }); },
  clearEditBirthday() { this.setData({ editBirthday: '', editErr: '' }); },
  clearEditPhoto() { this.setData({ editPhoto: '', editErr: '' }); },
  // 宝宝头像选图（相册选图 + 隐私授权闸门 + 本地/云端保存）已抽到 behaviors/child-photo.js（D4）
  async saveChildProfile() {
    const name = String(this.data.editName || '').trim();
    if (!name) { this.setData({ editErr: '昵称不能为空' }); return; }
    if (name.length > 12) { this.setData({ editErr: '昵称最多 12 个字' }); return; }
    if (String(this.data.editAllergens || '').trim().length > 50) {
      this.setData({ editErr: '过敏原最多 50 个字' }); return;
    }
    try {
      const res = await this._submitChild();
      this._afterSave(res);
    } catch (err) {
      this.setData({ editErr: (err && err.message) || '保存失败' });
    }
  },
  _submitChild() {
    const payload = {
      name: String(this.data.editName || '').trim(),
      avatar: this.data.editAvatar || '🧒',
      photo: this.data.editPhoto || '',
      gender: this.data.editGender || '',
      birthday: this.data.editBirthday || '',
      allergens: String(this.data.editAllergens || '').trim()
    };
    if (this.data.editingChild) {
      return callApi('childCRUD', { op: 'update', childId: this.data.editChildId, payload });
    }
    return callApi('childCRUD', { op: 'create', payload });
  },
  _afterSave(res) {
    const wasEditing = this.data.editingChild;
    this.setData({ showEditChild: false, editErr: '', editPhoto: '' });
    wx.showToast({ title: wasEditing ? '已保存' : '已添加', icon: 'success' });
    this.load();
  },
  async deleteChild() {
    if (!this.requireParent()) return;
    const id = this.data.editChildId;
    const c = (this.data.children || []).find(x => x._id === id);
    if (!c) return;
    if ((this.data.children || []).length <= 1) {
      wx.showToast({ title: '至少保留一个宝宝', icon: 'none' });
      return;
    }
    const r = await modal({
      title: '删除宝宝',
      content: '确定删除「' + (c.name || '宝宝') + '」？其任务、奖励与历史打卡记录会保留，只是不再显示。'
    });
    if (!r.confirm) return;
    try {
      await this._doDeleteChild();
      await this._afterDelete(id);
    } catch (err) {
      this.setData({ editErr: (err && err.message) || '删除失败' });
    }
  },
  _doDeleteChild() {
    return callApi('childCRUD', { op: 'delete', childId: this.data.editChildId });
  },
  async _afterDelete(id) {
    const app = getApp();
    this.setData({ showEditChild: false, editErr: '' });
    if (id === this.data.childId) {
      const rest = (this.data.children || []).filter(x => x._id !== id);
      if (rest.length) {
        try {
          await callApi('childSwitch', { childId: rest[0]._id });
          app.globalData.childId = rest[0]._id;
          this.setData({ childId: rest[0]._id });
        } catch (e) { /* 切换失败不阻断删除结果 */ }
      }
    }
    wx.showToast({ title: '已删除', icon: 'none' });
    await this.load();
  },
  copyInvite() {
    const code = (this.data.user && this.data.user.randomCode) || '';
    if (!code) return;
    wx.setClipboardData({ data: code });   // 系统自带「内容已复制」提示
  },
  openHelp() { this.setData({ showHelp: true }); },
  closeHelp() { this.setData({ showHelp: false }); },
  openAbout() { this.setData({ showAbout: true }); },
  closeAbout() { this.setData({ showAbout: false }); },
  async resetDemo() {
    const r = await modal({ title: '重置本地演示数据', content: '将清空本机所有任务/奖励/打卡记录并重新生成账号。确定？' });
    if (!r.confirm) return;
    const app = getApp();
    try {
      await callApi('resetAll', {});
      app.clearParent();
      await app.login();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已重置', icon: 'success' });
      this.refresh();
    } catch (e) {
      wx.showToast({ title: '重置失败', icon: 'none' });
    }
  },
  // 数据导出 / 备份：仅本地模式可用（云端模式下数据在云，导出是另一回事）。
  // 把本机全部数据打包成 JSON 文件，经微信「分享 / 保存」交到用户手里。
  async exportData() {
    const r = await modal({
      title: '数据导出 / 备份',
      content: '将把本机全部数据（宝宝档案、任务、奖励、打卡记录、星星流水、宠物等）导出为一个 JSON 文件。' +
        '你可以把它发到「文件传输助手」或「保存到手机」留存，用于换机或清缓存前备份。导出不会影响现有数据。'
    });
    if (!r.confirm) return;
    wx.showLoading({ title: '正在生成…', mask: true });
    try {
      const res = await callApi('exportBackup', { appVersion: this.data.version });
      wx.hideLoading();
      if (res && res.ok) {
        wx.showToast({ title: '已生成，请选择保存到手机', icon: 'none' });
      } else {
        wx.showToast({ title: (res && res.message) || '导出失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
    }
  },
  // 恢复备份：从聊天中选取备份文件，校验后覆盖恢复。
  // 破坏性操作：家长闸门 + 两次确认（意图确认 → 摘要确认）。
  async importData() {
    if (!this.requireParent()) return;
    const app = getApp();
    const r = await modal({
      title: '恢复备份',
      content: '将从备份文件恢复本机数据，当前数据会被完全覆盖。建议先「导出」一份当前数据留底。继续？'
    });
    if (!r.confirm) return;
    // 第一步：选文件 + 校验（pickBackup 不写入）
    let pick;
    try {
      pick = await callApi('pickBackup', {});
    } catch (err) {
      if (err && err.code === 'CANCELLED') return;   // 用户取消选文件，静默返回
      // 校验类失败（非 JSON / 非本应用 / 版本不符 / 结构异常）用弹窗展示完整诊断（含文件开头预览与长度），
      // 便于定位是「选错文件」还是「文件在传输中被损坏」；toast 会截断长文本，故用 modal。
      if (err && err.code && err.code !== 'PICK_FAIL' && err.code !== 'NO_PICK_API' && err.code !== 'READ_FAIL') {
        wx.showModal({ title: '导入失败', content: (err && err.message) || '备份文件无效', showCancel: false });
      } else {
        wx.showToast({ title: (err && err.message) || '选择文件失败', icon: 'none' });
      }
      return;
    }
    // 第二步：摘要确认（导出时间 + 数据量）
    const L = { children: '宝宝', tasks: '任务', rewards: '奖励', checkIns: '打卡', redemptions: '兑换', pointsLog: '星星流水', pets: '宠物' };
    const parts = [];
    Object.keys(L).forEach((k) => { if (pick.counts && pick.counts[k]) parts.push(L[k] + ' ' + pick.counts[k]); });
    const when = (pick.exportedAt || '').replace('T', ' ').slice(0, 16) || '未知时间';
    const r2 = await modal({
      title: '确认恢复',
      content: '备份导出于 ' + when + (parts.length ? '（' + parts.join(' · ') + '）' : '') + '。恢复将覆盖当前全部数据，确定？'
    });
    if (!r2.confirm) return;
    wx.showLoading({ title: '正在恢复…', mask: true });
    try {
      await callApi('restoreBackup', { json: pick.json });
      wx.hideLoading();
      // 存储已整体替换：清家长会话 + 重新登录，让 globalData 与新数据对齐
      app.clearParent();
      await app.login();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已恢复', icon: 'success' });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '恢复失败', icon: 'none' });
    }
  }
});