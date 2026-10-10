// __tests__/privacy.test.js —— 隐私授权机制守卫（PET-PRIVACY-ENG-10）
// 口径：官方 onNeedPrivacyAuthorization 机制 + 公共弹层组件 + 「就地授权」体验
//   ① components/privacy-sheet 四件套齐备，wxml 含 agreePrivacyAuthorization 按钮；
//   ② app.js 注册 wx.onNeedPrivacyAuthorization（竞态兜底）+ resolvePrivacy 放行封装；
//   ③ home 原首启弹层已迁移为组件引用（旧结构零残留）；
//   ④ mine 选图前 getPrivacySetting 预检，需授权则当场弹组件、同意后原地继续。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('privacy: 公共组件 privacy-sheet 四件套齐备，wxml 含官方授权按钮与指引链接', () => {
  ['privacy-sheet.js', 'privacy-sheet.json', 'privacy-sheet.wxml', 'privacy-sheet.wxss'].forEach(f => {
    assert.ok(exists('miniprogram/components/privacy-sheet/' + f), '缺少组件文件: ' + f);
  });
  const compJson = JSON.parse(read('miniprogram/components/privacy-sheet/privacy-sheet.json'));
  assert.strictEqual(compJson.component, true, 'privacy-sheet.json 应声明 component:true');

  const wxml = read('miniprogram/components/privacy-sheet/privacy-sheet.wxml');
  // 官方授权按钮：open-type=agreePrivacyAuthorization + 回调 + 按钮有 id（resolve 校验用）
  assert.ok(/open-type="agreePrivacyAuthorization"/.test(wxml), '缺少官方授权按钮 open-type');
  assert.ok(/bindagreeprivacyauthorization="agreePrivacy"/.test(wxml), '授权按钮缺 agreePrivacy 回调');
  assert.ok(/id="privacy-agree-btn"/.test(wxml), '授权按钮缺 id（resolve({event:agree}) 微信校验用）');
  assert.ok(/bindtap="openPrivacyContract"/.test(wxml) && /用户隐私保护指引/.test(wxml), '缺指引链接');
  // 蒙层不绑关闭：隐私弹层必须显式同意（与迁移前 home 行为一致）
  assert.ok(!/class="mask" bindtap/.test(wxml), '隐私弹层蒙层不应绑点击关闭');
  // 内容吞冒泡
  assert.ok(/catchtap="noop"/.test(wxml), '弹层内容未吞冒泡');

  const js = read('miniprogram/components/privacy-sheet/privacy-sheet.js');
  assert.ok(/getApp\(\)\.resolvePrivacy\(AGREE_BTN_ID\)/.test(js), '同意后未调 resolvePrivacy 放行挂起调用');
  assert.ok(/triggerEvent\('agreed'\)/.test(js), '同意后未通知页面（agreed 事件）');
  assert.ok(/PRIVACY_KEY/.test(js), '同意后未写本地 PRIVACY_KEY 标记（旧基础库回退口径）');
  // show 属性驱动（与 pin-pad 组件约定一致）
  assert.ok(/show:\s*\{\s*type:\s*Boolean/.test(js), '组件应使用 show 属性驱动');
});

test('privacy: app.js 注册 onNeedPrivacyAuthorization 竞态兜底 + resolvePrivacy 放行封装', () => {
  const appJs = read('miniprogram/app.js');
  assert.ok(/wx\.onNeedPrivacyAuthorization\(/.test(appJs), 'app.js 未注册 onNeedPrivacyAuthorization');
  assert.ok(/typeof wx\.onNeedPrivacyAuthorization [!=]== 'function'/.test(appJs), '注册处应做基础库能力判断');
  assert.ok(/privacyResolve/.test(appJs), 'app.js 未保存挂起的 resolve');
  assert.ok(/emitPrivacyNeed/.test(appJs) && /onPrivacyNeed/.test(appJs), '缺少「通知栈顶页面弹层」的广播机制');
  assert.ok(/resolvePrivacy\(buttonId\)/.test(appJs), '缺少 resolvePrivacy 放行封装');
  assert.ok(/event:\s*'agree'/.test(appJs), 'resolve 应携带 event:agree');
  // 启动即注册（onLaunch 内调用）
  const launch = /onLaunch\(\)[\s\S]*?\n  \},/.exec(appJs);
  assert.ok(launch && /registerPrivacy\(\)/.test(launch[0]), 'onLaunch 未调用 registerPrivacy');
});

test('privacy: home 首启弹层已迁移为公共组件（旧结构零残留，预检保留）', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const js = read('miniprogram/pages/home/home.js');
  const wxss = read('miniprogram/pages/home/home.wxss');
  const json = JSON.parse(read('miniprogram/pages/home/home.json'));

  // 组件引用 + show 数据绑定 + agreed 回调
  assert.ok(/<privacy-sheet show="\{\{showPrivacy\}\}" bindagreed="agreePrivacy" \/>/.test(wxml),
    'home 未引用 privacy-sheet 组件');
  assert.strictEqual(json.usingComponents['privacy-sheet'], '/components/privacy-sheet/privacy-sheet',
    'home.json 未登记 privacy-sheet');

  // 旧弹层结构零残留（pv-* 样式与 sheet 结构已随组件迁出）
  assert.ok(!/class="sheet privacy"/.test(wxml), '旧隐私弹层 sheet 结构残留');
  assert.ok(!/pv-title|pv-body|pv-link|pv-btn/.test(wxml), '旧隐私弹层节点残留');
  assert.ok(!/pv-title|pv-body|pv-link|pv-btn/.test(wxss), '旧隐私弹层样式残留（应迁入组件 wxss）');
  assert.ok(!/openPrivacyContract/.test(js), 'openPrivacyContract 应已迁入组件');
  assert.ok(!/open-type="agreePrivacyAuthorization"/.test(wxml), '授权按钮应只存在于组件内');

  // onShow 的 getPrivacySetting 预检保留（needAuthorization → setData showPrivacy）
  assert.ok(/wx\.getPrivacySetting\(\{/.test(js), 'home 预检 getPrivacySetting 丢失');
  assert.ok(/needAuthorization/.test(js), 'home 预检 needAuthorization 判断丢失');
  assert.ok(/showPrivacy: \!\!res\.needAuthorization|showPrivacy: !res\.needAuthorization|showPrivacy: !!res\.needAuthorization/.test(js),
    'home 预检未写 showPrivacy');
  // 本地回退口径保留（旧基础库）
  assert.ok(/checkPrivacyLocal/.test(js) && /PRIVACY_KEY/.test(js), '旧基础库本地回退口径丢失');
  // 同意后 restTip 保留（每日首次使用提醒）
  assert.ok(/restTip\(\)/.test(js), '同意后 restTip 调用丢失');
  // 竞态兜底接入
  assert.ok(/onPrivacyNeed\(\)/.test(js), 'home 未实现 onPrivacyNeed（app.js 广播接入点）');
});

test('privacy: mine 选图就地授权（getPrivacySetting 预检 → 弹组件 → 同意后原地继续）', () => {
  const wxml = read('miniprogram/pages/mine/mine.wxml');
  // 选图流程已抽 behaviors/child-photo.js（D4）：合并两文件做隐私闸门口径校验
  const js = read('miniprogram/pages/mine/mine.js') + read('miniprogram/behaviors/child-photo.js');
  const json = JSON.parse(read('miniprogram/pages/mine/mine.json'));

  assert.strictEqual(json.usingComponents['privacy-sheet'], '/components/privacy-sheet/privacy-sheet',
    'mine.json 未登记 privacy-sheet');
  assert.ok(/<privacy-sheet show="\{\{showPrivacy\}\}" bindagreed="onPrivacyAgreed" \/>/.test(wxml),
    'mine 未引用 privacy-sheet 组件');

  // 预检：chooseChildPhoto 内 getPrivacySetting → needAuthorization 则弹组件并挂「同意后继续」回调
  assert.ok(/chooseChildPhoto\(\)[\s\S]*?wx\.getPrivacySetting\(\{[\s\S]*?needAuthorization[\s\S]*?showPrivacySheet\(\(\) => this\.doChooseChildPhoto\(\)\)/.test(js),
    'chooseChildPhoto 缺少 getPrivacySetting 预检 + 就地弹窗 + 同意后继续');
  // fail / 旧基础库回退：直接选图（不阻塞）
  assert.ok(/fail: \(\) => this\.doChooseChildPhoto\(\)/.test(js), '预检 fail 未回退直接选图');
  // 原选图业务整体保留在 doChooseChildPhoto
  assert.ok(/doChooseChildPhoto\(\)[\s\S]*?wx\.chooseMedia\(\{/.test(js), '原选图逻辑未迁入 doChooseChildPhoto');
  assert.ok(/sourceType: \['album', 'camera'\]/.test(js), '选图参数回退（album/camera）');
  // 同意回调：关弹层 + 继续挂起业务
  assert.ok(/onPrivacyAgreed\(\)[\s\S]*?showPrivacy: false[\s\S]*?_privacyCb/.test(js),
    'onPrivacyAgreed 未关弹层并继续挂起回调');
  // 竞态兜底接入
  assert.ok(/onPrivacyNeed\(\)/.test(js), 'mine 未实现 onPrivacyNeed（app.js 广播接入点）');
  // 旧「请先在首页同意」口径废弃（体验改造点）
  assert.ok(!/请先在首页同意/.test(js), '旧「去首页授权」文案残留（应就地授权）');
  // data 透出 showPrivacy（SHEET_KEYS 派生 tabBar 显隐依赖页面 data）
  assert.ok(/showPrivacy: false/.test(js), 'mine data 缺 showPrivacy 开关');
});
