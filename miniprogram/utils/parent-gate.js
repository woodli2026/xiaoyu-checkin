// miniprogram/utils/parent-gate.js —— 家长模式「开关 + 闸门」纯逻辑（可测，无 wx 硬依赖）
//
// 候选④（2026-10-11）：同一个判定此前散在 5 个页面共 8 处，有 5 种文案、2 种真值来源
// （this.data.mode vs app.globalData.mode）、2 种失败表现（toast / setData 错误字段），
// 且 toggleParent 有 3 份拷贝。改一次口径要碰 5 个文件，是典型的 locality 缺失。
//
// 本模块把「怎么进家长模式」与「怎么拦”收在一处，由 behaviors/parent-gate.js 转发给页面。
//
// 真值口径（重要）：**以 app.globalData.mode 为权威**。
//   data.mode 只是渲染副本，由 onShow/refresh 同步而来，可能滞后；
//   mine 页此前两处直接读 globalData、两处读 data，正是这个不一致的体现。
//
// ctx 形状（便于测试注入）：{ data, setData, getApp }
const GATE_MSG = '请先开启家长模式';
const PIN_MISSING_MSG = '请先设置家长 PIN';
const EXIT_MSG = '已退出家长模式';

function toast(title) {
  if (typeof wx !== 'undefined' && wx && wx.showToast) wx.showToast({ title, icon: 'none' });
}

// 取 app 实例：优先 ctx.getApp（测试注入的桩），其次小程序运行时全局 getApp()。
// ⚠️ 页面实例**没有** .getApp 方法（getApp 是全局函数），故必须回退到全局；
//    否则真机上永远拿不到 globalData，会静默退化成 data.mode（滞后副本）——
//    这正是本次「真值口径统一取 globalData」在真机上未生效的原因。
function appOf(ctx) {
  if (ctx && typeof ctx.getApp === 'function') return ctx.getApp();
  if (typeof getApp === 'function') return getApp();
  return null;
}

// 当前是否家长模式：以 globalData 为准，data.mode 仅作兜底（无 app 时）
function isParent(ctx) {
  const app = appOf(ctx);
  const g = app && app.globalData;
  if (g && g.mode) return g.mode === 'parent';
  return !!(ctx && ctx.data && ctx.data.mode === 'parent');
}

/**
 * 家长模式闸门：不是家长模式 → 提示并返回 false；是 → true。
 * @param {object} ctx 页面上下文
 * @param {{msg?: string, errField?: string}} [opts]
 *   msg      自定义提示文案（默认「请先开启家长模式」）
 *   errField 传入则写入该 data 字段而非弹 toast（动态页详情内提示用）
 * @returns {boolean}
 */
function requireParent(ctx, opts) {
  if (isParent(ctx)) return true;
  const o = opts || {};
  const msg = o.msg || GATE_MSG;
  if (o.errField) {
    const patch = {};
    patch[o.errField] = msg;
    ctx.setData(patch);
  } else {
    toast(msg);
  }
  return false;
}

/**
 * 家长模式开关：已是家长 → 退出；未设 PIN → 引导去设置；否则 → 打开 PIN 面板。
 * @param {object} ctx 页面上下文
 * @param {{pinMsg?: string}} [opts]
 */
function toggleParent(ctx, opts) {
  const o = opts || {};
  const app = appOf(ctx);

  if (isParent(ctx)) {
    if (app && app.clearParent) app.clearParent();
    ctx.setData({ mode: 'display' });
    toast(EXIT_MSG);
    return;
  }
  if (!(ctx.data && ctx.data.pinSet)) {
    toast(o.pinMsg || PIN_MISSING_MSG);
    return;
  }
  ctx.setData({ showPin: true, pinError: '' });
}

module.exports = { GATE_MSG, PIN_MISSING_MSG, EXIT_MSG, isParent, requireParent, toggleParent };
