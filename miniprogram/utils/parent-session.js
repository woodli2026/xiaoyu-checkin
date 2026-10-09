// utils/parent-session.js —— 家长会话：令牌生命周期 + 恢复流程（ADR-0001）
//
// 【职责】把散在 5 个页面的家长令牌知识收拢到一个 module：
//   ① inject(name, params)   —— callApi 每次调用前自动注入 parentToken（公开操作豁免，fail-safe 方向）
//   ② adopt(res[, app])      —— 解锁成功的唯一收口（替代 4 处手写 globalData 三行赋值）
//   ③ requestReunlock()      —— TOKEN_INVALID 恢复：通知栈顶页弹 pin-pad（复用隐私授权先例），
//                               用户输入 PIN 后由 submitReauthPin 放行，取消则 resolve(null)
//   ④ isPublic / getToken    —— 豁免表与当前令牌读取
//
// 【为什么不静默恢复】本地层虽有 unlockParent({silent:true}) 免 PIN 解锁（R10，设备即信任根），
// 但它仅限启动时（app.maybeAutoUnlock）。若 TOKEN_INVALID 也静默重试，R10 的 15 分钟空闲
// 保护会被架空——被退出后随手一操作又无感回到家长模式。故恢复一律弹 PIN（本地/云端同路径）。
//
// 【UI 边界】本 module 不碰任何 UI：恢复弹层由栈顶页实现 onReauthNeed 后自己弹 pin-pad
// （与 app.js 隐私授权的 emitPrivacyNeed 先例同构）。未实现该方法的页面（tasks/pet）取不到
// 恢复入口 → requestReunlock 立即 resolve(null)，TOKEN_INVALID 按原样抛给页面 toast。
//
// 【对 api.js 的依赖用惰性 require】submitReauthPin 内部要走数据层调 unlockParent，
// 而 api.js 顶层 require 本 module（注入用）。惰性 require 打断加载环，两端都只在函数体内使用。

// 后端操作（函数名 / op / 是否需令牌）的单一来源见 utils/ops.js，本 module 不再内联豁免表。
const { isPublic: isPublicCall, LOCAL_ONLY } = require('../ops');
const REAUTH_HINT = '家长模式已失效，请重新解锁';

// 免令牌判定转发到 ops.js（公开或本地独占均免令牌注入）。保持原签名 (name, params)。
function isPublic(name, params) {
  return isPublicCall(name, params && params.op);
}

function appRef(explicit) {
  if (explicit) return explicit;
  return (typeof getApp === 'function') ? getApp() : null;
}

// 当前令牌（只读）。令牌本体仍是 app.globalData 的内存态（不落库），本 module 是唯一访问口。
function getToken(app) {
  const a = appRef(app);
  return (a && a.globalData && a.globalData.parentToken) || '';
}

// callApi 注入口：非公开操作一律带上当前令牌（无令牌时带空串 → 服务端返回 TOKEN_INVALID → 走恢复）
function inject(name, params, app) {
  if (isPublic(name, params)) return;
  params.parentToken = getToken(app);
}

// 解锁成功的唯一收口：unlockParent / 静默解锁返回后调用。
// app.js 的 maybeAutoUnlock 传 this（onLaunch 期 getApp() 时序保守起见）；页面调用不传。
function adopt(res, app) {
  const a = appRef(app);
  if (!a || !a.globalData || !res || !res.parentToken) return;
  a.globalData.parentToken = res.parentToken;
  a.globalData.parentTokenExpire = res.expireAt || 0;
  a.globalData.mode = 'parent';
  a.lastActive = Date.now();          // 重置 R10 空闲计时基准
  if (typeof a.syncMode === 'function') a.syncMode();   // 广播 mode 给已渲染页面
}

// ============ 恢复流程（TOKEN_INVALID → 弹 PIN → 重试一次）============

let _reauthResolve = null;   // seam 挂起的恢复延续点（同一时刻最多一个）

// seam 侧：请求恢复。返回 Promise<string|null>，resolve(pin)=继续重试原操作，resolve(null)=放弃。
function requestReunlock() {
  return new Promise((resolve) => {
    if (_reauthResolve) { resolve(null); return; }   // 已有挂起的恢复：并发调用直接放弃，不排队
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    const top = pages[pages.length - 1];
    if (!top || typeof top.onReauthNeed !== 'function') { resolve(null); return; }  // 页面未接入 → 原样抛错
    _reauthResolve = resolve;
    top.onReauthNeed();
  });
}

// 页面侧：是否有挂起的恢复（onPinComplete / onPinClose 据此分流「恢复解锁」与「常规解锁」）
function hasPendingReauth() { return !!_reauthResolve; }

// 页面侧：用户在 pin-pad 输入 PIN（恢复模式）。成功 → adopt + 放行 seam 重试，返回 true；
// PIN 错误 → 返回 false（面板保持打开，页面负责 pinAttempt 复位），不阻断 seam 等待。
async function submitReauthPin(pin) {
  const resolve = _reauthResolve;
  if (!resolve) return false;
  const api = require('./api');   // 惰性 require 打断与 api.js 的加载环
  try {
    const res = await api.callApi('unlockParent', { pin: String(pin == null ? '' : pin) });
    _reauthResolve = null;
    adopt(res);
    resolve(String(pin));
    return true;
  } catch (e) {
    return false;   // PIN_INVALID / 其它错误都留在面板上，由页面提示
  }
}

// 页面侧：用户关闭 pin-pad 放弃恢复。seam 收到 null → 原错误照常抛给业务调用方。
function cancelReauth() {
  if (!_reauthResolve) return;
  const resolve = _reauthResolve;
  _reauthResolve = null;
  resolve(null);
}

module.exports = {
  REAUTH_HINT,
  isPublic, getToken, inject, adopt,
  requestReunlock, hasPendingReauth, submitReauthPin, cancelReauth
};
