// utils/pin-reauth.js —— 家长 PIN 闸逻辑收拢（Phase B 页面样板收敛，对应 ADR-0001 的 UI 边界下沉）
//
// 【职责】把散在 5 个页面的 onPinClose / onReauthNeed / onPinComplete / onPinForgot
// 与 pinAttempt 复位 hack 收拢为纯函数，由 behaviors/pin-reauth.js 转发给页面实例。
//
// 【为什么是纯函数】不依赖小程序运行时（不引用任何组件/页面 this 之外的环境），
// 可在 node 单测里用 mock ctx 直接验证 reauth / unlock 双分支分流，无需小程序环境。
//
// ctx 约定：页面实例，提供 .data / .setData，可选 .burst()（home 的进入动效，其余页无则跳过）。
// wx 仅用于交互反馈（toast/modal），测试里 mock global.wx 即可。

const session = require('./parent-session');

// 失败时：设置错误文案并 bump attempt（pin-pad 组件 observer 据此清空输入、重新输入）。
// 不能用 error 值触发清空：同一句错误第二次不变 → observer 不触发 → 输入停在满位被 length 拦。
function bumpPin(ctx, msg) {
  ctx.setData({ pinError: msg || 'PIN 不正确', pinAttempt: ctx.data.pinAttempt + 1 });
}

// 关闭面板（恢复或常规）。有挂起恢复则取消 → seam 原错误照常抛给业务方。
function onPinClose(ctx) {
  if (session.hasPendingReauth()) session.cancelReauth();
  ctx.setData({ showPin: false, pinError: '' });
}

// 会话层要求恢复：弹面板 + 提示 + bump（让组件进入可输入态）。
function onReauthNeed(ctx) {
  ctx.setData({
    showPin: true,
    pinError: session.REAUTH_HINT,
    pinAttempt: ctx.data.pinAttempt + 1
  });
}

// 提交 PIN：reauth（令牌过期恢复）与 常规首次解锁 双分支。
async function onPinComplete(ctx, e) {
  const pin = e && e.detail && e.detail.pin;
  if (session.hasPendingReauth()) {
    const ok = await session.submitReauthPin(pin);
    if (ok) {
      ctx.setData({ showPin: false, pinError: '', mode: 'parent' });
    } else {
      bumpPin(ctx, 'PIN 不正确');   // 面板保持打开，等待下一次输入
    }
    return;   // 重试原操作由 seam 自动完成，页面无需感知
  }
  // 常规首次解锁（home / mine / feed 进入家长模式入口）
  const api = require('./api');   // 惰性 require 打断与 api.js 的加载环
  try {
    const res = await api.callApi('unlockParent', { pin: String(pin == null ? '' : pin) });
    session.adopt(res);   // 家长会话唯一收口
    ctx.setData({ showPin: false, pinError: '', mode: 'parent' });
    if (typeof ctx.burst === 'function') ctx.burst();   // home 动效；其余页无 burst 方法则跳过
    wx.showToast({ title: '已进入家长模式', icon: 'success' });
  } catch (err) {
    bumpPin(ctx, (err && err.message) || 'PIN 不正确');
  }
}

// 忘记 PIN：重置为默认并提示（home / mine「忘记」入口）。
async function onPinForgot(ctx) {
  const api = require('./api');
  try {
    const res = await api.callApi('resetPin', {});
    const def = (res && res.defaultPin) || '123456';
    ctx.setData({ pinError: '', pinAttempt: ctx.data.pinAttempt + 1 });
    wx.showModal({
      title: 'PIN 已恢复默认',
      content: '已重置为 ' + def + '，请重新输入。建议进入家长模式后修改成自己的。',
      showCancel: false
    });
  } catch (err) {
    bumpPin(ctx, (err && err.message) || '重置失败，请重试');
  }
}

module.exports = { bumpPin, onPinClose, onReauthNeed, onPinComplete, onPinForgot };
