// behaviors/child-photo.js —— 宝宝头像选图（相册选图 + 隐私授权闸门 + 本地/云端保存）
// 自 mine.js 抽出（D4）：页面只留编排，长流程集中于此，方法名与 wxml 绑定保持一致。
// 依赖页面 data：editChildId（云端路径命名用）；依赖页面 data.setData 的 editPhoto 字段。
module.exports = Behavior({
  methods: {
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
    }
  }
});
