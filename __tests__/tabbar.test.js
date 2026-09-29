// tabBar 显隐派生逻辑的回归守卫
//
// 背景：自定义 tabBar 是独立组件节点，页面内 z-index 压不住它，必须在弹层打开时
// 主动隐藏。最初靠「31 处人工配对」实现，必然漏 —— 真实事故：tasks.save() 保存成功后
// 只 setData({showEditor:false})、忘了恢复 tabBar，表现为「新增/编辑任务保存后底部导航消失」。
// 现改为由弹层开关自动派生。本文件守住这个派生逻辑，防止回归。
const { test } = require('node:test');
const assert = require('node:assert');
const { attachTabBarSync, syncTabBar, SHEET_KEYS } = require('../miniprogram/utils/tabbar');

// 模拟一个页面实例 + 它的自定义 tabBar 组件
function makePage(initial) {
  const bar = {
    data: { hidden: false, selected: 0 },
    calls: 0,
    setData(obj) { this.calls++; Object.assign(this.data, obj); }
  };
  const page = {
    __name: 'mock',
    data: Object.assign({}, initial),
    getTabBar() { return bar; },
    setData(obj, cb) {
      Object.assign(this.data, obj);
      if (typeof cb === 'function') cb();
    }
  };
  return { page, bar };
}

test('tabbar: 无弹层时显示；打开任一全屏弹层即隐藏', () => {
  const { page, bar } = makePage({ showEditor: false, showConfirm: false, showIcon: false });
  attachTabBarSync(page);
  assert.strictEqual(bar.data.hidden, false, '初始无弹层 → 应显示');

  page.setData({ showEditor: true });
  assert.strictEqual(bar.data.hidden, true, '打开编辑弹层 → 应隐藏');

  page.setData({ showEditor: false });
  assert.strictEqual(bar.data.hidden, false, '关闭编辑弹层 → 应恢复显示');
});

test('tabbar: 保存任务后必须恢复底部导航（真实事故的回归守卫）', () => {
  // 复现事故路径：openCreateTask → setData(showEditor:true) → save → setData(showEditor:false)
  const { page, bar } = makePage({ showEditor: false });
  attachTabBarSync(page);

  page.setData({ showEditor: true, editorKind: 'task', editing: false });
  assert.strictEqual(bar.data.hidden, true);

  // 保存成功：只关弹层，不做任何手工的 tabBar 恢复调用
  page.setData({ showEditor: false });
  assert.strictEqual(bar.data.hidden, false,
    '保存后底部导航必须回来（此前此处漏恢复，导致导航整块消失）');
});

test('tabbar: 内层弹层关闭时不得误恢复（特例自动正确）', () => {
  // 场景：编辑弹层 → 打开图标选择器 → 关掉选择器。此时编辑弹层仍在，tabBar 必须保持隐藏。
  const { page, bar } = makePage({ showEditor: false, showIcon: false });
  attachTabBarSync(page);

  page.setData({ showEditor: true });
  page.setData({ showIcon: true });
  assert.strictEqual(bar.data.hidden, true);

  page.setData({ showIcon: false });
  assert.strictEqual(bar.data.hidden, true, '编辑弹层仍在 → 图标选择器关闭后仍应隐藏');

  page.setData({ showEditor: false });
  assert.strictEqual(bar.data.hidden, false);
});

test('tabbar: 删除二次确认从编辑弹层内触发的两级关闭', () => {
  const { page, bar } = makePage({ showEditor: false, showConfirm: false });
  attachTabBarSync(page);

  page.setData({ showEditor: true });
  page.setData({ showConfirm: true });

  // 「取消」删除：编辑弹层还在 → 保持隐藏
  page.setData({ showConfirm: false });
  assert.strictEqual(bar.data.hidden, true);

  // 关闭编辑弹层 → 恢复
  page.setData({ showEditor: false });
  assert.strictEqual(bar.data.hidden, false);
});

test('tabbar: 多个弹层并存时，全部关闭才恢复', () => {
  const { page, bar } = makePage({ showDay: false, showRedeem: false, showPrivacy: false });
  attachTabBarSync(page);

  page.setData({ showDay: true });
  page.setData({ showRedeem: true });
  assert.strictEqual(bar.data.hidden, true);

  page.setData({ showDay: false });
  assert.strictEqual(bar.data.hidden, true, '还有弹层开着 → 继续隐藏');

  page.setData({ showRedeem: false });
  assert.strictEqual(bar.data.hidden, false);
});

test('tabbar: 三个页面用到的弹层字段都被 SHEET_KEYS 覆盖', () => {
  // 若将来新增弹层字段却忘了登记进 SHEET_KEYS，这里会红
  const need = [
    'showEditor', 'showConfirm', 'showIcon',           // tasks
    'showDay', 'showPin', 'showRedeem', 'showPrivacy',  // home
    'showDetail',                                       // feed
    'showSetPin', 'showHelp', 'showAbout', 'showEditChild', 'showBabyList', // mine
    'showName', 'showRename', 'showStats', 'showManage' // pet
  ];
  need.forEach(k => assert.ok(SHEET_KEYS.includes(k), 'SHEET_KEYS 缺少 ' + k));
  // 领养弹层已下线（未领养态改为主区选择卡 + showName 起名弹层两步）：showAdopt 不应再登记
  assert.strictEqual(SHEET_KEYS.includes('showAdopt'), false, 'showAdopt 弹层已下线，不应留在 SHEET_KEYS');
});

test('tabbar: 值未变化时不触发组件渲染（避免每次 setData 都白刷一次）', () => {
  const { page, bar } = makePage({ showEditor: false });
  attachTabBarSync(page);
  const afterAttach = bar.calls;

  // 与 tabBar 显隐无关的 setData 不应引起 tabBar 渲染
  page.setData({ tasks: [1, 2, 3] });
  page.setData({ mode: 'parent' });
  assert.strictEqual(bar.calls, afterAttach, '无弹层状态变化 → 不应有额外的 tabBar setData');
});

test('tabbar: 五个 tab 的 4 处定义必须一致（app.json / custom-tab-bar / 各页 selected）', () => {
  // 新增或调整 tab 顺序时，必须同步 4 处：app.json 的 pages、app.json 的 tabBar.list、
  // custom-tab-bar 的 list、以及每个页面 onShow 里的 selected 索引。漏一处就会表现成
  // 「点了 tab 但高亮没跟过去」。此用例把 4 处钉死。
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', 'miniprogram');
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const tabList = appJson.tabBar.list.map(x => String(x.pagePath).replace(/^\//, ''));

  assert.deepStrictEqual(
    appJson.pages.slice(0, tabList.length), tabList,
    'app.json 的 pages 前 ' + tabList.length + ' 项应与 tabBar.list 顺序一致'
  );

  const barSrc = fs.readFileSync(path.join(root, 'custom-tab-bar', 'index.js'), 'utf8');
  const barPaths = [];
  const re = /pagePath:\s*'\/([^']+)'/g;
  let m;
  while ((m = re.exec(barSrc))) barPaths.push(m[1]);
  assert.deepStrictEqual(barPaths, tabList, 'custom-tab-bar 的 list 与 app.json tabBar.list 不一致');

  tabList.forEach((p, i) => {
    const src = fs.readFileSync(path.join(root, p + '.js'), 'utf8');
    const sm = /getTabBar\(\)\.setData\(\{\s*selected:\s*(\d+)\s*\}\)/.exec(src);
    assert.ok(sm, p + ' 未设置 tabBar selected');
    assert.strictEqual(Number(sm[1]), i, p + ' 的 tabBar selected 应为 ' + i + '，实际 ' + sm[1]);
  });
});

test('tabbar: syncTabBar 可脱离 setData 单独调用（onShow 兜底重置）', () => {
  const { page, bar } = makePage({ showEditor: false });
  // 模拟残留状态：tabBar 处于隐藏，但页面并无弹层打开
  bar.data.hidden = true;
  syncTabBar(page);
  assert.strictEqual(bar.data.hidden, false, 'onShow 校正应清掉残留的隐藏状态');
});
