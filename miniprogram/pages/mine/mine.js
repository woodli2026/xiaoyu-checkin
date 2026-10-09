const { callApi } = require('../../utils/api');
const { attachTabBarSync } = require('../../utils/tabbar');
const s = require('../../utils/storage');
const session = require('../../utils/parent-session');
function modal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (res) => resolve(res),
      fail: () => resolve({ confirm: false })
    }));
  });
}
Page({
  behaviors: [require('../../behaviors/pin-reauth')],
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
  onAppTouch() { getApp().touch(); },
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
    const d = new Date();
    const todayStr = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
  toggleParent() {
    const app = getApp();
    if (this.data.mode === 'parent') {
      app.clearParent();
      this.setData({ mode: 'display' });
      wx.showToast({ title: '已退出家长模式', icon: 'none' });
      return;
    }
    if (!this.data.pinSet) {
      wx.showToast({ title: '请先设置家长 PIN', icon: 'none' });
      return;
    }
    this.setData({ showPin: true, pinError: '' });
  },
  toggleStartInParent(e) {
    const v = !!e.detail.value;
    s.write(s.KEYS.startInParent, v);
    this.setData({ startInParent: v });
  },
  openSetPin() {
    const app = getApp();
    if (app.globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return;
    }
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
  _requireParent() {
    if (getApp().globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return false;
    }
    return true;
  },
  openBabyList() {
    if (!this._requireParent()) return;
    this.setData({ showBabyList: true });
  },
  closeBabyList() { this.setData({ showBabyList: false }); },
  async pickChild(e) {
    const app = getApp();
    const childId = e.currentTarget.dataset.id;
    if (childId === this.data.childId) return;
    if (!this._requireParent()) return;
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
    if (!this._requireParent()) return;
    this.setData({
      showEditChild: true, editingChild: false, editChildId: '',
      editName: '', editAvatar: '🧒', editPhoto: '',
      editGender: '', editBirthday: '', editAllergens: '', editErr: ''
    });
  },
  openChildEditor(e) {
    if (!this._requireParent()) return;
    const id = e.currentTarget.dataset.id;
    const c = (this.data.children || []).find(x => x._id === id);
    if (!c) return;
    this.setData({
      showEditChild: true, editingChild: true, editChildId: id,
      editName: c.name || '', editAvatar: c.avatar || '🧒', editPhoto: c.photo || '',
      editGender: c.gender || '', editBirthday: c.birthday || '', editAllergens: c.allergens || '',
      editErr: ''
    });
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
  chooseChildPhoto() {
    const proceed = () => this.doChooseChildPhoto();
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({
        success: proceed,   // 已同意 / 或刚在卡片里同意后放行
        fail: () => {
          wx.showToast({ title: '需先授权才能选择照片', icon: 'none' });
        }
      });
      return;
    }
    if (typeof wx.getPrivacySetting === 'function') {
      wx.getPrivacySetting({
        success: (res) => {
          if (!res.privacyContractName) {
            wx.showToast({ title: '小程序后台未配置隐私指引，暂无法选照片', icon: 'none', duration: 3000 });
            return;
          }
          if (res.needAuthorization) this.showPrivacySheet(() => this.doChooseChildPhoto());
          else this.doChooseChildPhoto();
        },
        fail: () => this.doChooseChildPhoto()
      });
    } else {
      this.doChooseChildPhoto();   // 旧基础库无隐私接口，直接选图
    }
  },
  showPrivacySheet(onAgreed) {
    this._privacyCb = onAgreed || null;
    this.setData({ showPrivacy: true });
  },
  onPrivacyAgreed() {
    this.setData({ showPrivacy: false });
    const cb = this._privacyCb;
    this._privacyCb = null;
    if (typeof cb === 'function') cb();
  },
  onPrivacyNeed() { this.showPrivacySheet(null); },
  doChooseChildPhoto() {
    const app = getApp();
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
        if (!temp) return;
        try {
          wx.showLoading({ title: '处理中', mask: true });
          let finalPath = '';
          if (app.globalData.useCloud) {
            finalPath = await this.uploadPhotoCloud(temp);
          } else {
            finalPath = await this.savePhotoLocal(temp);
          }
          this.setData({ editPhoto: finalPath });
          wx.showToast({ title: '已选照片', icon: 'success' });
        } catch (e) {
          console.error('[childPhoto] 处理失败:', e && (e.errMsg || e.message) || e);
          const detail = String((e && (e.errMsg || e.message)) || '').slice(0, 40);
          wx.showToast({ title: detail ? '处理失败: ' + detail : '处理失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
        console.error('[childPhoto] chooseMedia fail:', err && err.errMsg);
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('privacy') >= 0 || msg.indexOf('隐私') >= 0 || msg.indexOf('同意') >= 0) {
          wx.showModal({
            title: '仍无法选择照片',
            content: '已授权但相册接口仍被拦截。请到「微信公众平台 → 设置 → 用户隐私保护指引」确认指引中已勾选接口类型「选中的照片或视频信息」并重新提交审核；同时在本机微信「我 → 设置 → 个人信息与权限 → 授权管理」中确认已同意雨宝记的隐私指引。',
            showCancel: false
          });
          return;
        }
        wx.showToast({ title: '选择照片失败: ' + msg.slice(0, 40), icon: 'none', duration: 2500 });
      }
    });
  },
  savePhotoLocal(tempFilePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().saveFile({ tempFilePath, success: (r) => resolve(r.savedFilePath), fail: reject });
    });
  },
  uploadPhotoCloud(tempFilePath) {
    const app = getApp();
    const ext = (tempFilePath.split('.').pop() || 'jpg').split('?')[0] || 'jpg';
    const openid = (app.globalData.user && app.globalData.user.openid) || 'u';
    const cloudPath = 'child-avatars/' + openid + '_' + (this.data.editChildId || 'new') + '_' + Date.now() + '.' + ext;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath, success: (r) => resolve(r.fileID), fail: reject });
    });
  },
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
    if (!this._requireParent()) return;
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
  }
});