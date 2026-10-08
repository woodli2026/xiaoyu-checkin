// pages/mine —— Tab3：家长模式切换 / PIN 设置重置 / 多孩子 / 帮助 / 关于 / 邀请码
const { callApi } = require('../../utils/api');
const { setTabBarHidden, attachTabBarSync } = require('../../utils/tabbar');
const s = require('../../utils/storage');

function modal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (res) => resolve(res),
      fail: () => resolve({ confirm: false })
    }));
  });
}

Page({
  data: {
    mode: 'display', pinSet: false, useCloud: false,
    user: { nickname: '', avatar: '🧒', randomCode: '' },
    child: null, childId: '', children: [],
    version: '1.0.0', todayStr: '', beianNo: '',
    showPin: false, pinError: '', pinAttempt: 0,
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

  // 任意点击重置家长模式空闲计时（R10）
  onAppTouch() { getApp().touch(); },

  onShow() {
    // 自定义 tabBar 需由页面主动同步选中态。
    // tabBar 的显隐不再靠人工配对：attachTabBarSync 会在每次 setData 后
    // 按弹层开关自动重算，因此不存在「忘了恢复」的可能（详见 utils/tabbar.js）
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

  // —— 家长模式开关（与首页锁图标同逻辑）——
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
    setTabBarHidden(this, true);
  },

  // R10：设置项「启动即家长模式」开关。默认开；关闭后下次启动不再静默解锁，需手动 PIN 进入。
  toggleStartInParent(e) {
    const v = !!e.detail.value;
    s.write(s.KEYS.startInParent, v);
    this.setData({ startInParent: v });
  },

  async onPinComplete(e) {
    const app = getApp();
    try {
      const res = await callApi('unlockParent', { pin: e.detail.pin });
      app.globalData.parentToken = res.parentToken;
      app.globalData.parentTokenExpire = res.expireAt;
      app.globalData.mode = 'parent';
      // 若是在「保存时令牌失效」流程里触发的重新解锁，把新令牌回传给等待方
      if (this._reunlockResolve) {
        const r = this._reunlockResolve;
        this._reunlockResolve = null;
        this.setData({ showPin: false, pinError: '', mode: 'parent' });
        setTabBarHidden(this, true);   // 编辑弹层仍开着，保持 tabBar 隐藏
        r(res.parentToken);
        return;
      }
      this.setData({ showPin: false, pinError: '', mode: 'parent' });
      setTabBarHidden(this, false);
      wx.showToast({ title: '已进入家长模式', icon: 'success' });
    } catch (err) {
      // attempt 必须递增：同一句错误文案第二次不变化，仅靠 error 无法让输入复位
      this.setData({
        pinError: (err && err.message) || 'PIN 不正确',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onPinClose() {
    // 重新解锁流程中关闭 PIN 面板 → 视为放弃，回传 null 让保存流程给出提示
    if (this._reunlockResolve) {
      const r = this._reunlockResolve;
      this._reunlockResolve = null;
      this.setData({ showPin: false, pinError: '' });
      setTabBarHidden(this, true);   // 编辑弹层仍开着，保持 tabBar 隐藏
      r(null);
      return;
    }
    this.setData({ showPin: false, pinError: '' }); setTabBarHidden(this, false);
  },

  // PIN 面板上的自救入口：不需要家长模式即可把 PIN 恢复为默认值
  async onPinForgot() {
    try {
      const res = await callApi('resetPin', {});
      const def = (res && res.defaultPin) || '123456';
      this.setData({ pinError: '', pinAttempt: this.data.pinAttempt + 1 });
      wx.showModal({
        title: 'PIN 已恢复默认',
        content: '已重置为 ' + def + '，请重新输入。建议进入家长模式后到本页改成自己的。',
        showCancel: false
      });
    } catch (err) {
      this.setData({
        pinError: (err && err.message) || '重置失败，请重试',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },

  // —— 设置 / 修改 PIN（需家长模式）——
  openSetPin() {
    const app = getApp();
    if (app.globalData.mode !== 'parent') {
      wx.showToast({ title: '请先进入家长模式', icon: 'none' });
      return;
    }
    this.setData({ showSetPin: true, setPinStage: 'new', pendingPin: '', setPinErr: '' });
    setTabBarHidden(this, true);
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
      await callApi('setPin', { pin, parentToken: app.globalData.parentToken });
      if (app.globalData.user) app.globalData.user.pinSet = true;
      this.setData({ showSetPin: false, pinSet: true, pendingPin: '' });
      setTabBarHidden(this, false);
      wx.showToast({ title: 'PIN 已设置', icon: 'success' });
    } catch (err) {
      // 设置失败时弹层仍开着，必须复位输入，否则键盘同样会被锁死
      this.setData({
        setPinErr: (err && err.message) || '设置失败',
        pinAttempt: this.data.pinAttempt + 1
      });
    }
  },
  onSetPinClose() { this.setData({ showSetPin: false, setPinStage: 'new', pendingPin: '' }); setTabBarHidden(this, false); },

  // 重置口径（与云函数 resetPin 一致）：恢复为内置默认 PIN，而非把账号置为「无 PIN」
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

  // —— 宝宝管理：列表 / 新增 / 编辑 / 删除 / 切换当前（均需家长模式）——
  // 注：PRD 的 MVP 清单未含「宝宝档案管理」，属确认新增（见 README §8 偏差 #6）
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
    setTabBarHidden(this, true);
  },
  closeBabyList() { this.setData({ showBabyList: false }); setTabBarHidden(this, false); },

  // 切换「当前宝宝」（原横排头像卡点击切换的功能，移入宝宝列表）
  async pickChild(e) {
    const app = getApp();
    const childId = e.currentTarget.dataset.id;
    if (childId === this.data.childId) return;
    if (!this._requireParent()) return;
    try {
      await callApi('childSwitch', { childId, parentToken: app.globalData.parentToken });
      app.globalData.childId = childId;
      this.setData({ childId });
      wx.showToast({ title: '已切换', icon: 'success' });
      await this.load();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '切换失败', icon: 'none' });
    }
  },

  // 新增宝宝（空表单，保存走 childCRUD op=create）
  openNewChild() {
    if (!this._requireParent()) return;
    this.setData({
      showEditChild: true, editingChild: false, editChildId: '',
      editName: '', editAvatar: '🧒', editPhoto: '',
      editGender: '', editBirthday: '', editAllergens: '', editErr: ''
    });
    setTabBarHidden(this, true);
  },

  // 编辑已有宝宝（点列表项，保存走 childCRUD op=update）
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
    setTabBarHidden(this, true);
  },

  closeEditChild() {
    this.setData({ showEditChild: false, editErr: '', editPhoto: '' });
    setTabBarHidden(this, false);
  },
  onEditNameInput(e) { this.setData({ editName: e.detail.value, editErr: '' }); },
  onEditAllergensInput(e) { this.setData({ editAllergens: e.detail.value, editErr: '' }); },
  onEditGender(e) { this.setData({ editGender: e.currentTarget.dataset.gender, editErr: '' }); },
  onEditBirthday(e) { this.setData({ editBirthday: e.detail.value, editErr: '' }); },
  // picker 无法清空已选日期，给一个显式「清除」入口
  clearEditBirthday() { this.setData({ editBirthday: '', editErr: '' }); },

  // 移除已选头像照片（仅保留表情头像）。选表情功能已移除，头像仅支持相册上传。
  clearEditPhoto() { this.setData({ editPhoto: '', editErr: '' }); },

  // 从手机相册/相机选择自定义头像照片。
  // 本地模式：saveFile 持久化到用户文件目录（temp 路径重启即失效）；云端模式：上传到云存储拿 fileID。
  //
  // 隐私授权就地完成（2026-09，重写）：
  //   主路径用官方 wx.requirePrivacyAuthorize 作为「授权闸门」。它会在用户尚未同意时触发
  //   app.js 的 onNeedPrivacyAuthorization → 弹 privacy-sheet；用户点「同意并继续」后，
  //   微信在「同意真正落库」之后才回调 success，此时再继续打开相册——彻底规避
  //   「刚点同意→立即 chooseMedia 却被微信判定未同意」的同意落库竞态（此前反复失败的根因）。
  //   已同意过（needAuthorization=false）则 success 立即触发，不再弹卡片（仅首次弹）。
  //   回退路径：旧基础库无 requirePrivacyAuthorize 时，用 getPrivacySetting 预检 + 就地弹卡片。
  chooseChildPhoto() {
    const proceed = () => this.doChooseChildPhoto();
    // 主路径：官方授权闸门（基础库 2.32.3+），消除同意落库竞态
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({
        success: proceed,   // 已同意 / 或刚在卡片里同意后放行
        fail: () => {
          // 用户在卡片里点了「拒绝」：不打开相册，给出提示即可
          wx.showToast({ title: '需先授权才能选择照片', icon: 'none' });
        }
      });
      return;
    }
    // 回退路径：getPrivacySetting 预检，需授权则当场弹组件、同意后原地继续
    if (typeof wx.getPrivacySetting === 'function') {
      wx.getPrivacySetting({
        success: (res) => {
          // 指引未配置：MP 后台没填《用户隐私保护指引》时 privacyContractName 为空，
          // 显式提示后台配置缺失，避免误导用户「去同意」
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

  // 弹隐私授权弹层（可选挂一个「同意后继续」的回调，如继续打开相册）
  showPrivacySheet(onAgreed) {
    this._privacyCb = onAgreed || null;
    this.setData({ showPrivacy: true });
  },
  // 组件 agreed 回调：关弹层并继续被暂停的业务（无挂起回调则仅关闭）
  onPrivacyAgreed() {
    this.setData({ showPrivacy: false });
    const cb = this._privacyCb;
    this._privacyCb = null;
    if (typeof cb === 'function') cb();
  },
  // app.js onNeedPrivacyAuthorization 竞态兜底：微信异步要求授权时由栈顶页弹组件
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
        // 已授权却仍被拦截：绝大多数是 MP 后台《隐私保护指引》未勾选「选中的照片或视频信息」
        // 这一接口类型——指引审批通过 ≠ 该接口被授权。给出可操作的排查指引。
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
    // 过敏原：选填，仅做长度兜底（中间态允许任意输入，保存时才校验）
    if (String(this.data.editAllergens || '').trim().length > 50) {
      this.setData({ editErr: '过敏原最多 50 个字' }); return;
    }
    const app = getApp();
    try {
      const res = await this._submitChild(app.globalData.parentToken);
      this._afterSave(res);
    } catch (err) {
      if (err && err.code === 'TOKEN_INVALID') {
        // 令牌在「选照片 / 切后台」等场景下可能已失效：自动弹出 PIN 重新解锁，成功后再试一次
        const token = await this._reunlock();
        if (!token) { this.setData({ editErr: '家长模式已失效，请重新解锁' }); return; }
        try {
          const res = await this._submitChild(token);
          this._afterSave(res);
        } catch (e2) {
          this.setData({ editErr: (e2 && e2.message) || '保存失败' });
        }
      } else {
        this.setData({ editErr: (err && err.message) || '保存失败' });
      }
    }
  },

  // 保存失败时的自动重新解锁：弹出 PIN 面板，resolve 出新令牌（取消则 resolve(null)）
  _reunlock() {
    return new Promise((resolve) => {
      this._reunlockResolve = resolve;
      this.setData({ showPin: true, pinError: '家长模式已失效，请重新解锁', pinAttempt: this.data.pinAttempt + 1 });
      setTabBarHidden(this, true);
    });
  },

  // 新增或更新宝宝：editingChild 决定 op（create / update）
  _submitChild(parentToken) {
    const payload = {
      name: String(this.data.editName || '').trim(),
      avatar: this.data.editAvatar || '🧒',
      photo: this.data.editPhoto || '',
      gender: this.data.editGender || '',
      birthday: this.data.editBirthday || '',
      allergens: String(this.data.editAllergens || '').trim()
    };
    if (this.data.editingChild) {
      return callApi('childCRUD', { op: 'update', childId: this.data.editChildId, parentToken, payload });
    }
    return callApi('childCRUD', { op: 'create', parentToken, payload });
  },

  _afterSave(res) {
    const wasEditing = this.data.editingChild;
    this.setData({ showEditChild: false, editErr: '', editPhoto: '' });
    setTabBarHidden(this, this.data.showBabyList);   // 宝宝列表仍开着则保持隐藏
    wx.showToast({ title: wasEditing ? '已保存' : '已添加', icon: 'success' });
    this.load();
  },

  // —— 删除宝宝（二次确认 → 软删 → 当前宝宝被删则自动切换）——
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
    const app = getApp();
    try {
      await this._doDeleteChild(app.globalData.parentToken);
      await this._afterDelete(id);
    } catch (err) {
      if (err && err.code === 'TOKEN_INVALID') {
        const token = await this._reunlock();
        if (!token) { this.setData({ editErr: '家长模式已失效，请重新解锁' }); return; }
        try {
          await this._doDeleteChild(token);
          await this._afterDelete(id);
        } catch (e2) {
          this.setData({ editErr: (e2 && e2.message) || '删除失败' });
        }
      } else {
        this.setData({ editErr: (err && err.message) || '删除失败' });
      }
    }
  },
  _doDeleteChild(parentToken) {
    return callApi('childCRUD', { op: 'delete', childId: this.data.editChildId, parentToken });
  },
  async _afterDelete(id) {
    const app = getApp();
    this.setData({ showEditChild: false, editErr: '' });
    // 删的是「当前宝宝」→ 自动切到剩余的第一个，避免主页仍指向已删档案
    if (id === this.data.childId) {
      const rest = (this.data.children || []).filter(x => x._id !== id);
      if (rest.length) {
        try {
          await callApi('childSwitch', { childId: rest[0]._id, parentToken: app.globalData.parentToken });
          app.globalData.childId = rest[0]._id;
          this.setData({ childId: rest[0]._id });
        } catch (e) { /* 切换失败不阻断删除结果 */ }
      }
    }
    wx.showToast({ title: '已删除', icon: 'none' });
    await this.load();
    setTabBarHidden(this, this.data.showBabyList);
  },

  // —— 邀请码（内测阶段仅展示，点击复制）——
  copyInvite() {
    const code = (this.data.user && this.data.user.randomCode) || '';
    if (!code) return;
    wx.setClipboardData({ data: code });   // 系统自带「内容已复制」提示
  },

  // —— 帮助 / 关于 ——
  openHelp() { this.setData({ showHelp: true }); setTabBarHidden(this, true); },
  closeHelp() { this.setData({ showHelp: false }); setTabBarHidden(this, false); },
  openAbout() { this.setData({ showAbout: true }); setTabBarHidden(this, true); },
  closeAbout() { this.setData({ showAbout: false }); setTabBarHidden(this, false); },

  // —— 本地演示数据重置（仅本地模式）——
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
