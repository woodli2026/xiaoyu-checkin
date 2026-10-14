// __tests__/backup.test.js —— 本地版数据导出 / 备份（v1.0-local 新增）
// 验证：① 收集排除会话令牌 ② 打包 JSON 结构 ③ 校验函数 ④ 微信侧写文件 + 分享调用
const test = require('node:test');
const assert = require('node:assert');

const { store } = require('./helpers/wx-storage').installWxStorageMock();
const backup = require('../miniprogram/services/local/backup');
const local = require('../miniprogram/services/local');
const s = require('../miniprogram/utils/storage');

test('备份收集：全量数据键（排除会话令牌 token），数量统计正确', async () => {
  await local.resetAll();
  const login = await local.login({});   // 登录即 seed 8 任务 + 8 奖励
  const childId = login.childId;
  const unlock = await local.unlockParent({ pin: local.DEFAULT_PIN });
  const token = unlock.parentToken;
  const dash = await local.getDashboard({ childId });
  await local.checkIn({ childId, taskId: dash.todayTasks[0].taskId, parentToken: token });  // 制造 1 条打卡

  const { data, counts } = backup.collectData();
  assert.ok(data.user && data.user._id, '应包含 user');
  assert.ok(Array.isArray(data.children) && data.children.length >= 1, '应包含 children');
  assert.ok(Array.isArray(data.tasks) && data.tasks.length >= 1, '应包含 tasks（seed 8 个）');
  assert.ok(Array.isArray(data.checkIns) && data.checkIns.length === 1, '应包含 checkIns（刚打 1 卡）');
  // 关键：会话令牌被排除
  assert.strictEqual(Object.prototype.hasOwnProperty.call(data, 'token'), false, '不得导出会话令牌');
  assert.strictEqual(data.token, undefined);
  // 数量统计
  assert.strictEqual(counts.checkIns, 1);
  assert.strictEqual(typeof counts.user, 'number');
});

test('备份打包：JSON 结构合法，含元数据与版本号', async () => {
  await local.resetAll();
  await local.login({});
  const json = backup.buildPayload({ appVersion: '1.0.0' });
  const obj = JSON.parse(json);
  assert.strictEqual(obj.app, '雨宝记');
  assert.strictEqual(obj.backupVersion, 1);
  assert.ok(obj.exportedAt, '应含导出时间');
  assert.strictEqual(obj.appVersion, '1.0.0');
  assert.ok(obj.data && obj.data.user, '应含 data.user');
  // 默认 opts 也能工作
  assert.strictEqual(JSON.parse(backup.buildPayload()).backupVersion, 1);
});

test('备份校验：坏 JSON / 非本应用 / 缺数据 均判失败，合法包判成功', () => {
  assert.strictEqual(backup.validatePayload('not json').ok, false);
  assert.strictEqual(backup.validatePayload(JSON.stringify({ app: '别的' })).code, 'NOT_XY_BACKUP');
  assert.strictEqual(backup.validatePayload(JSON.stringify({ app: '雨宝记', backupVersion: 1 })).code, 'NO_DATA');
  assert.strictEqual(backup.validatePayload(JSON.stringify({ app: '雨宝记', backupVersion: 2 })).code, 'VERSION_UNSUPPORTED');
  const ok = backup.validatePayload(backup.buildPayload());
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.payload.app, '雨宝记');
  // BOM 容错：微信「分享 → 回选」链路可能在文件头加 BOM（\uFEFF），应仍能解析
  assert.strictEqual(backup.validatePayload('﻿' + backup.buildPayload()).ok, true, '带 BOM 的合法备份应能解析');
  // 兜底：文件头被平台追加了杂字符（如某些机型在 JSON 前塞了几个字节），应从首个 { 起解析
  const junk = 'xxxx' + backup.buildPayload();
  const recovered = backup.validatePayload(junk);
  assert.strictEqual(recovered.ok, true, '开头有杂字符的合法备份应能被兜底解析');
  assert.strictEqual(recovered.payload.app, '雨宝记');
  // 纯非 JSON（如网页）：判失败且带诊断字段（preview / len）
  const html = backup.validatePayload('<html><body>404</body></html>');
  assert.strictEqual(html.ok, false);
  assert.strictEqual(html.code, 'BAD_JSON');
  assert.ok(html.preview && html.len > 0, '应回传 preview 与 len 用于诊断');
});

test('导出文件：写出 JSON 并调用分享（wx 侧 mock）', async () => {
  await local.resetAll();
  await local.login({});   // 登录即 seed 8 任务 + 8 奖励，足以验证全量导出

  // —— mock 微信文件系统 + 分享 ——
  let written = null;
  global.wx.getFileSystemManager = () => ({
    writeFileSync: (p, c) => { written = { p, c }; }
  });
  global.wx.env = { USER_DATA_PATH: '/tmp/xy' };
  let shared = null;
  global.wx.shareFileMessage = (o) => { shared = o; if (o.success) o.success(); };

  const res = await backup.exportBackup({ appVersion: '1.0.0' });
  assert.strictEqual(res.ok, true, '应成功');
  assert.ok(written && written.p.endsWith('.json'), '应写出 .json 文件');
  assert.strictEqual(shared.filePath, written.p);
  assert.ok(shared.fileName.startsWith('雨宝记数据备份_'), '文件名前缀正确');
  // 写出的内容本身可被校验（结构闭环）
  assert.strictEqual(backup.validatePayload(written.c).ok, true);
});

test('导出降级：分享不可用 → 退而保存到本地', async () => {
  await local.resetAll();
  await local.login({});
  let saved = null;
  global.wx.getFileSystemManager = () => ({ writeFileSync: () => {} });
  global.wx.env = { USER_DATA_PATH: '/tmp/xy' };
  // 故意让 shareFileMessage 失败
  global.wx.shareFileMessage = (o) => { if (o.fail) o.fail({ errMsg: 'share fail' }); };
  global.wx.saveFileToDisk = (o) => { saved = o; if (o.success) o.success(); };

  const res = await backup.exportBackup({});
  assert.strictEqual(res.ok, true, '保存降级也应成功');
  assert.ok(saved, '应调用 saveFileToDisk');
});

test('导出失败：无文件系统环境 → 明确报错（不抛异常）', async () => {
  await local.resetAll();
  await local.login({});
  delete global.wx.getFileSystemManager;
  const res = await backup.exportBackup({});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'NO_FS');
});

test('恢复往返：导出 → 清空 → 恢复，状态完全还原', async () => {
  await local.resetAll();
  const login = await local.login({});
  const childId = login.childId;
  const token = (await local.unlockParent({ pin: local.DEFAULT_PIN })).parentToken;
  await local.checkIn({ childId, taskId: (await local.getDashboard({ childId })).todayTasks[0].taskId, parentToken: token });
  const dashBefore = await local.getDashboard({ childId });
  const json = backup.buildPayload({ appVersion: '1.0.0' });

  await local.resetAll();   // 模拟数据被清空 / 换机
  const restored = backup.restoreFromJson(json);
  assert.strictEqual(restored.ok, true);

  const childIdB = JSON.parse(json).data.childId;
  const dashAfter = await local.getDashboard({ childId: childIdB });
  assert.strictEqual(dashAfter.ok, true);
  assert.strictEqual(dashAfter.totalStars, dashBefore.totalStars, '星星总数还原');
  assert.strictEqual(dashAfter.checkIns.length, dashBefore.checkIns.length, '打卡记录还原');
  assert.strictEqual(dashAfter.children[0].name, dashBefore.children[0].name, '宝宝资料还原');
  // 会话令牌不复活（导出时已排除）
  assert.strictEqual(store[s.KEYS.token], undefined);
  // 恢复摘要与导出一致
  assert.strictEqual(restored.counts.checkIns, 1);
});

test('恢复拒绝：坏结构 / 非本应用 / 错版本 / 坏 JSON', () => {
  const badShape = JSON.parse(backup.buildPayload({}));
  badShape.data.tasks = 'not-an-array';
  assert.strictEqual(backup.restoreFromJson(JSON.stringify(badShape)).code, 'BAD_SHAPE');
  assert.strictEqual(backup.restoreFromJson('{}').code, 'NOT_XY_BACKUP');
  const v99 = JSON.parse(backup.buildPayload({}));
  v99.backupVersion = 99;
  assert.strictEqual(backup.restoreFromJson(JSON.stringify(v99)).code, 'VERSION_UNSUPPORTED');
  assert.strictEqual(backup.restoreFromJson('not json').code, 'BAD_JSON');
});

test('恢复调用约定：页面经 callApi 传 { json } 包装对象 / 单测直接传字符串，双形状等价', async () => {
  await local.resetAll();
  const json = backup.buildPayload({});
  // 形状 A（页面真实路径）：local[name](params) → restoreFromJson({ json })
  const viaWrapper = backup.restoreFromJson({ json });
  assert.strictEqual(viaWrapper.ok, true, '包装对象形状应恢复成功');
  // 形状 B（单测直连）：restoreFromJson('<json 字符串>')
  const viaString = backup.restoreFromJson(json);
  assert.strictEqual(viaString.ok, true, '裸字符串形状应恢复成功');
  // 回归守卫：包装对象绝不能再被 String() 化成 '[object Object]' 报 BAD_JSON
  assert.notStrictEqual(backup.restoreFromJson({ json }).code, 'BAD_JSON');
});

test('选文件（pickBackup）：选择+读取+校验，不写入', async () => {
  await local.resetAll();
  const json = backup.buildPayload({});   // 空库也能打出合法备份
  global.wx.env = { USER_DATA_PATH: '/tmp/xy' };
  global.wx.getFileSystemManager = () => ({
    readFileSync: () => json,
    writeFileSync: () => {}
  });
  // ① 正常选择
  global.wx.chooseMessageFile = (o) => o.success({ tempFiles: [{ path: '/tmp/b.json', name: 'backup.json', size: 100 }] });
  const p = await backup.pickBackup();
  assert.strictEqual(p.ok, true);
  assert.ok(p.counts, '应带数量摘要');
  assert.strictEqual(p.json, json);
  // ② 校验通过但未写入（pick 不落盘，库仍为空）
  assert.strictEqual(store[s.KEYS.tasks], undefined);
  // ③ 用户取消
  global.wx.chooseMessageFile = (o) => o.fail({ errMsg: 'chooseMessageFile:fail cancel' });
  assert.strictEqual((await backup.pickBackup()).code, 'CANCELLED');
  // ④ 内容非法
  global.wx.chooseMessageFile = (o) => o.success({ tempFiles: [{ path: '/tmp/b.json' }] });
  global.wx.getFileSystemManager = () => ({ readFileSync: () => 'not json' });
  const bad = await backup.pickBackup();
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'BAD_JSON');
  // ⑤ 用户可读提示
  assert.ok(bad.message && bad.message.length > 0);
  // ⑥ 选中的是网页而非备份 → 解析失败并回显文件开头用于诊断
  global.wx.chooseMessageFile = (o) => o.success({ tempFiles: [{ path: '/tmp/x.json' }] });
  global.wx.getFileSystemManager = () => ({ readFileSync: () => '<html><body>404 Not Found</body></html>' });
  const html = await backup.pickBackup();
  assert.strictEqual(html.ok, false);
  assert.strictEqual(html.code, 'BAD_JSON');
  assert.ok(html.message.indexOf('开头「') >= 0, '应回显文件开头用于诊断');
});

test('隐私闸门：requirePrivacyAuthorize 失败（指引未声明）→ 明确提示；成功 → 正常选文件', async () => {
  await local.resetAll();
  const json = backup.buildPayload({});
  global.wx.env = { USER_DATA_PATH: '/tmp/xy' };
  global.wx.getFileSystemManager = () => ({ readFileSync: () => json });

  // ① 后台未声明「选中的文件」→ errno 112 → 提示去后台补声明
  global.wx.requirePrivacyAuthorize = (o) => o.fail({ errMsg: 'requirePrivacyAuthorize:fail:112 api scope is not declared in the privacy agreement' });
  const denied = await backup.pickBackup();
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.code, 'PRIVACY_FAIL');
  assert.ok(denied.message.indexOf('选中的文件') >= 0, '应提示补声明「选中的文件」');

  // ② 用户拒绝隐私弹层 → 视为取消
  global.wx.requirePrivacyAuthorize = (o) => o.fail({ errMsg: 'requirePrivacyAuthorize:fail cancel' });
  assert.strictEqual((await backup.pickBackup()).code, 'CANCELLED');

  // ③ 授权通过 → 继续选文件
  global.wx.requirePrivacyAuthorize = (o) => o.success({});
  global.wx.chooseMessageFile = (o) => o.success({ tempFiles: [{ path: '/tmp/b.json', name: 'backup.json', size: 100 }] });
  const ok = await backup.pickBackup();
  assert.strictEqual(ok.ok, true);
});
