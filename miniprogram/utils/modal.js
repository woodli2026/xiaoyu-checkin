// 统一 wx.showModal 的 Promise 包装（单一来源）。
// 抽自 pages/feed/feed.js 与 pages/mine/mine.js 中逐字重复的本地 modal() 实现。
// 契约：success 解析为 res（含 res.confirm）；fail 解析为 { confirm:false }，避免「点了没反应」也走 reject 链。
function modal(options) {
  return new Promise((resolve) => {
    wx.showModal(Object.assign({}, options, {
      success: (res) => resolve(res),
      fail: () => resolve({ confirm: false })
    }));
  });
}

module.exports = { modal };
