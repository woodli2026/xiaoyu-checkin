// utils/tabbar.js —— 自定义 tabBar 的显隐控制
//
// 【为什么需要】
// 自定义 tabBar 是独立组件节点，渲染在页面内容之上。实测（2026-09-17）：页面内
// 即使把弹层 z-index 提到 300，仍会被 z-index 仅 90 的自定义 tabBar 盖住 ——
// 也就是说，**页面内的 z-index 无法越过自定义 tabBar**。
// 因此凡是打开全屏弹层（日明细 / 编辑 / PIN / 图标选择 / 各类确认框）时，
// 必须主动隐藏 tabBar，否则弹层底部的按钮与文字会被底部导航遮挡。
//
// 【为什么是「派生」而不是「人工配对」】
// 最初的做法是在每个打开/关闭弹层的地方各写一句 setTabBarHidden(...)，全项目 31 处。
// 结果必然漏：`tasks.save()` 保存成功后只 setData({showEditor:false})、忘了恢复，
// 表现为「新增/编辑任务保存后底部导航消失」。
// 现改为：页面只需在 onShow 里 attachTabBarSync(this)，之后**每次 setData 都会
// 自动根据弹层开关重算 tabBar 显隐**，无法再漏。
// 好处之一是原有的「特例」也自动正确了：从编辑弹层里打开图标选择器，关掉选择器时
// showEditor 仍为 true → tabBar 保持隐藏，不需要任何条件判断。

// ⚠️ 新增任何「全屏弹层」的开关字段，必须加进这张表，否则打开时 tabBar 不会被隐藏。
const SHEET_KEYS = [
  // pages/tasks
  'showEditor', 'showConfirm', 'showIcon',
  // pages/home
  'showDay', 'showPin', 'showRedeem', 'showPrivacy',
  // pages/feed
  'showDetail',
  // pages/mine
  'showSetPin', 'showHelp', 'showAbout', 'showEditChild', 'showBabyList',
  // pages/pet（showAdopt 已下线：领养改为主区选择卡 + showName 起名弹层两步）
  'showName', 'showRename', 'showStats', 'showManage'
];

function getTabBar(page) {
  if (!page || typeof page.getTabBar !== 'function') return null;
  try { return page.getTabBar(); } catch (e) { return null; }
}

// hidden = true 隐藏，false 显示
//
// 【关于页面里残留的显式调用】
// 三个页面中还留有约 20 处 `setTabBarHidden(this, ...)`，那是改造成派生机制之前的写法。
// 它们如今是**冗余的**：方向与 syncTabBar 的计算结果一致，且紧随其后的 setData 回调
// 会再校正一次，因此不会产生冲突，留作兜底（万一某时机 getTabBar() 取不到实例）。
// ⚠️ 但**新增代码不要再写它们** —— 只改弹层开关（setData）即可，显隐会自动跟随。
function setTabBarHidden(page, hidden) {
  const bar = getTabBar(page);
  if (!bar || typeof bar.setData !== 'function') return;
  // 值未变化则跳过：避免每次 setData 都触发一次无谓的组件渲染
  if (!!bar.data.hidden === !!hidden) return;
  bar.setData({ hidden: !!hidden });
}

// 当前是否有任一全屏弹层处于打开状态
function anySheetOpen(page) {
  const d = page && page.data;
  if (!d) return false;
  for (let i = 0; i < SHEET_KEYS.length; i++) {
    if (d[SHEET_KEYS[i]]) return true;
  }
  return false;
}

// 按页面当前的弹层开关，派生 tabBar 应否隐藏
function syncTabBar(page) {
  setTabBarHidden(page, anySheetOpen(page));
}

// 让页面每次 setData 后自动同步 tabBar 显隐（幂等，可在每次 onShow 调用）
function attachTabBarSync(page) {
  if (!page) return;
  if (!page.__tabBarSyncAttached) {
    page.__tabBarSyncAttached = true;
    const orig = page.setData.bind(page);
    page.setData = function (data, cb) {
      orig(data, function () {
        syncTabBar(page);
        if (typeof cb === 'function') cb.call(page);
      });
    };
  }
  // 每次 attach（即每次 onShow）都校正一次，清掉可能残留的「已隐藏」状态
  syncTabBar(page);
}

module.exports = { setTabBarHidden, getTabBar, syncTabBar, attachTabBarSync, SHEET_KEYS };
