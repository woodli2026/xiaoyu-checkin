// tools/acceptance.js —— MVP 验收标准逐条自动校验
//
// 【它能验证什么 / 不能验证什么】
//   本脚本在本地兜底数据层（miniprogram/services/local.js）上跑完整的业务链路，
//   覆盖 PRD §4 验收标准中**可用断言表达的**部分（数据、规则、权限、隔离）。
//   UI 渲染与手势交互（日历点亮的外观、锁图标点击、弹层开关）不在此脚本范围内，
//   会明确标记为 MANUAL，需人工在开发者工具/真机确认。
//
// 运行：node tools/acceptance.js
const assert = require('node:assert');

// —— mock wx.storage（与 __tests__/local.test.js 同款）——
const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; }
};

const local = require('../miniprogram/services/local');
const s = require('../miniprogram/utils/storage');
const D = require('../miniprogram/utils/domain');

const results = [];
function pass(n, title, detail) { results.push({ n, title, status: 'PASS', detail }); }
function fail(n, title, detail) { results.push({ n, title, status: 'FAIL', detail }); }
function manual(n, title, detail) { results.push({ n, title, status: 'MANUAL', detail }); }

async function check(n, title, fn) {
  try {
    const detail = await fn();
    pass(n, title, detail || '');
  } catch (e) {
    fail(n, title, (e && e.message) || String(e));
  }
}

function todayStr() { return D.ymd(new Date()); }

(async () => {
  await local.resetAll({});

  // ============ 验收 1：静默登录建号 ============
  await check(1, '新用户启动即自动建号并绑定身份', async () => {
    const login = await local.login({});
    assert.strictEqual(login.ok, true, 'login 失败');
    assert.ok(login.user && login.user._id, '未返回 user._id');
    assert.ok(login.childId, '未返回 childId');
    assert.strictEqual(String(login.user.randomCode).length, 16, '邀请码非 16 位');
    assert.strictEqual(login.pinSet, true, '建号未内置默认 PIN');
    // 开箱预置数据
    const dash = await local.getDashboard({ childId: login.childId });
    assert.strictEqual(dash.tasks.length, 3, '预置任务数应为 3，实际 ' + dash.tasks.length);
    assert.strictEqual(dash.rewards.length, 2, '预置奖励数应为 2，实际 ' + dash.rewards.length);
    return `user=${login.user._id} · child=${login.childId} · 邀请码 16 位 · 预置 ${dash.tasks.length} 任务 / ${dash.rewards.length} 奖励 · 默认 PIN 已内置`;
  });

  const first = await local.login({});
  const childId = first.childId;

  // ============ 验收 6 的前半段：未解锁时不可写（先于建任务，保证是只读态）============
  let token = null;
  await check('6a', '展示模式只读：未解锁时写操作被拒', async () => {
    const denied = await local.taskCRUD({
      op: 'create', parentToken: 'bogus',
      payload: { childId, title: '越权任务', score: 1 }
    });
    assert.strictEqual(denied.ok, false, '未持令牌竟然写成功了');
    assert.strictEqual(denied.code, 'TOKEN_INVALID', '错误码应为 TOKEN_INVALID，实际 ' + denied.code);
    return '未持令牌写操作被拒（TOKEN_INVALID）';
  });

  await check('6b', 'PIN 解锁家长模式（默认 123456）', async () => {
    const wrong = await local.unlockParent({ pin: '000000' });
    assert.strictEqual(wrong.code, 'PIN_INVALID', '错误 PIN 竟被接受');
    const un = await local.unlockParent({ pin: '123456' });
    assert.strictEqual(un.ok, true, '默认 PIN 123456 解锁失败');
    assert.ok(un.parentToken, '未签发 parentToken');
    token = un.parentToken;
    return '错误 PIN 被拒 · 默认 PIN 123456 解锁成功并签发令牌';
  });

  // ============ 验收 2：建 3 任务 → 打卡 → 星星累加 + 连续天数 ============
  const taskIds = [];
  await check(2, '建 3 个任务 → 打卡 → 星星按分值累加、连续天数正确', async () => {
    // 建 3 个任务，分值 1 / 2 / 3
    for (const [title, score] of [['验收-任务A', 1], ['验收-任务B', 2], ['验收-任务C', 3]]) {
      const r = await local.taskCRUD({
        op: 'create', parentToken: token,
        payload: { childId, title, score, date: todayStr(), repeat: { enabled: true, type: 'day', interval: 1, weekdays: [] } }
      });
      assert.strictEqual(r.ok, true, '建任务失败：' + title);
      taskIds.push(r.task._id);
    }
    // 打卡 3 次 → 应累计 1+2+3 = 6
    let stars = 0, streak = 0;
    for (const id of taskIds) {
      const ci = await local.checkIn({ childId, taskId: id, parentToken: token });
      assert.strictEqual(ci.ok, true, '打卡失败：' + JSON.stringify(ci));
      stars = ci.totalStars;
      streak = ci.streak;
    }
    assert.strictEqual(stars, 6, '星星应累加为 6，实际 ' + stars);
    assert.strictEqual(streak, 1, '首次打卡连续天数应为 1，实际 ' + streak);
    return `3 任务（分值 1/2/3）→ 打卡后星星=6、连续天数=1`;
  });

  // ============ 验收 3：重复打卡拦截 ============
  await check(3, '同一任务当天重复打卡被拦截', async () => {
    const dup = await local.checkIn({ childId, taskId: taskIds[0], parentToken: token });
    assert.strictEqual(dup.ok, false, '重复打卡竟然成功了');
    assert.strictEqual(dup.code, 'ALREADY_DONE', '错误码应为 ALREADY_DONE，实际 ' + dup.code);
    const dash = await local.getDashboard({ childId });
    assert.strictEqual(dash.totalStars, 6, '重复打卡后星星被错误累加为 ' + dash.totalStars);
    return '重复打卡被拒（ALREADY_DONE），星星仍为 6 未被重复累加';
  });

  // ============ 验收 4：兑换 ============
  await check(4, '建奖励 → 星星足够时兑换成功、星星正确扣减（发放态）', async () => {
    // 可反复兑换的奖励（cost=2）
    const r1 = await local.rewardCRUD({
      op: 'create', parentToken: token,
      payload: { childId, title: '验收-可反复奖励', cost: 2, resetAfterRedeem: true }
    });
    assert.strictEqual(r1.ok, true, '建奖励失败');
    const rd1 = await local.redeem({ childId, rewardId: r1.reward._id, parentToken: token });
    assert.strictEqual(rd1.ok, true, '兑换失败');
    assert.strictEqual(rd1.totalStars, 4, '星星应 6-2=4，实际 ' + rd1.totalStars);

    // 「仅一次」奖励（cost=2）→ 第二次兑换应被拦截
    const r2 = await local.rewardCRUD({
      op: 'create', parentToken: token,
      payload: { childId, title: '验收-仅一次奖励', cost: 2, resetAfterRedeem: false }
    });
    const rd2 = await local.redeem({ childId, rewardId: r2.reward._id, parentToken: token });
    assert.strictEqual(rd2.ok, true, '「仅一次」奖励首次兑换失败');
    assert.strictEqual(rd2.totalStars, 2, '星星应 4-2=2，实际 ' + rd2.totalStars);
    const rd3 = await local.redeem({ childId, rewardId: r2.reward._id, parentToken: token });
    assert.strictEqual(rd3.ok, false, '「仅一次」奖励竟可重复兑换');
    assert.strictEqual(rd3.code, 'ALREADY_REDEEMED', '错误码应为 ALREADY_REDEEMED，实际 ' + rd3.code);

    // 星星不足时兑换应被拒
    const r3 = await local.rewardCRUD({
      op: 'create', parentToken: token,
      payload: { childId, title: '验收-贵奖励', cost: 99, resetAfterRedeem: true }
    });
    const poor = await local.redeem({ childId, rewardId: r3.reward._id, parentToken: token });
    assert.strictEqual(poor.code, 'INSUFFICIENT', '星星不足应被拒，实际 ' + poor.code);

    // 兑换流水为发放态（status=completed）
    const reds = store[s.KEYS.redemptions] || [];
    assert.strictEqual(reds.length, 2, '兑换流水应为 2 条，实际 ' + reds.length);
    reds.forEach(x => assert.strictEqual(x.status, 'completed', '兑换流水非发放态：' + x.status));
    return `兑换 2 次 → 星星 6→4→2 ·「仅一次」二次兑换被拦(ALREADY_REDEEMED) · 星星不足被拦(INSUFFICIENT) · ${reds.length} 条流水均为 completed`;
  });

  // ============ 验收 5：日历点亮 ============
  await check(5, '日历正确点亮当月打卡日（数据层）', async () => {
    const dash = await local.getDashboard({ childId });
    const lit = dash.monthLit || [];
    assert.ok(lit.includes(todayStr()), '当月点亮列表未包含今天：' + JSON.stringify(lit));
    assert.strictEqual(dash.checkIns.filter(c => c.date === todayStr()).length, 3, '今日打卡记录应为 3 条');
    return `monthLit 含今日（${todayStr()}）· 今日打卡记录 3 条 · 本月点亮 ${lit.length} 天`;
  });

  // ============ 验收 6 后半段：令牌失效 ============
  await check('6c', '家长令牌失效机制（过期令牌被拒）', async () => {
    // 伪造一个已过期的令牌
    store[s.KEYS.token] = { token: 'expired-token', expireAt: Date.now() - 1000, openid: 'x' };
    const denied = await local.taskCRUD({
      op: 'create', parentToken: 'expired-token',
      payload: { childId, title: '过期令牌任务', score: 1 }
    });
    assert.strictEqual(denied.ok, false, '过期令牌竟然通过了');
    assert.strictEqual(denied.code, 'TOKEN_INVALID', '错误码应为 TOKEN_INVALID，实际 ' + denied.code);
    return '过期令牌被拒（TOKEN_INVALID）';
  });

  await check('6d', 'PIN 重置恢复默认值', async () => {
    const un = await local.unlockParent({ pin: '123456' });
    token = un.parentToken;
    const changed = await local.setPin({ pin: '654321', parentToken: token });
    assert.strictEqual(changed.ok, true, '改 PIN 失败');
    const un2 = await local.unlockParent({ pin: '654321' });
    assert.strictEqual(un2.ok, true, '新 PIN 无法解锁');
    token = un2.parentToken;
    const rst = await local.resetPin({});
    assert.strictEqual(rst.ok, true, '重置 PIN 失败');
    assert.strictEqual(rst.defaultPin, '123456', '重置后默认 PIN 应为 123456');
    const un3 = await local.unlockParent({ pin: '123456' });
    assert.strictEqual(un3.ok, true, '重置后默认 PIN 无法解锁');
    token = un3.parentToken;
    return '改 PIN → 生效；重置 → 恢复默认 123456 且可解锁';
  });

  // ============ 验收 7：多孩子隔离 ============
  await check(7, '多孩子：切换到第二个档案后，看板与数据按 childId 隔离', async () => {
    // 注：App 内未提供「新建孩子档案」入口（PRD 验收 7 标注内测可选，按 S3 决议只建 1 个档案）。
    // 这里直接注入第二个档案，验证「切换 + 隔离」逻辑本身是否正确。
    const children = store[s.KEYS.children] || [];
    const c2 = {
      _id: 'child-test-2', ownerId: children[0].ownerId, name: '二宝', avatar: '👧',
      totalStars: 0, streak: 0, lastCheckInDate: null, createdAt: Date.now() + 1
    };
    children.push(c2);
    store[s.KEYS.children] = children;

    const sw = await local.childSwitch({ childId: 'child-test-2', parentToken: token });
    assert.strictEqual(sw.ok, true, '切换孩子失败');

    const d1 = await local.getDashboard({ childId });
    const d2 = await local.getDashboard({ childId: 'child-test-2' });

    assert.strictEqual(d1.totalStars, 2, '大宝星星应为 2，实际 ' + d1.totalStars);
    assert.strictEqual(d2.totalStars, 0, '二宝星星应为 0（隔离失败），实际 ' + d2.totalStars);
    assert.ok(d1.checkIns.length >= 3, '大宝应有打卡记录');
    assert.strictEqual(d2.checkIns.length, 0, '二宝不应有打卡记录（隔离失败）');
    assert.notStrictEqual(d1.child._id, d2.child._id, '两个档案 id 相同');

    // 越权访问他人档案应被拒
    const foreign = await local.childSwitch({ childId: 'not-exist-child', parentToken: token });
    assert.strictEqual(foreign.code, 'FORBIDDEN', '越权切换应被拒，实际 ' + foreign.code);
    return `大宝星星=${d1.totalStars}/打卡${d1.checkIns.length} 条 · 二宝星星=${d2.totalStars}/打卡${d2.checkIns.length} 条（完全隔离）· 越权切换被拒`;
  });

  // ============ 验收 8：宠物（第二阶段：宠物 tab）============
  await check(8, '宠物：领养 → 投喂(扣星星+写流水) → 抚摸(免费) → 互动统计', async () => {
    const P = require('../miniprogram/utils/pets');
    assert.strictEqual((await local.petCRUD({ op: 'info', childId })).pet, null, '初始应无宠物');

    const ad = await local.petCRUD({
      op: 'adopt', childId, parentToken: token, payload: { species: 'cat', name: '小灰' }
    });
    assert.strictEqual(ad.ok, true, '领养失败');
    assert.strictEqual(ad.pet.stage, 1, '初始应为幼崽');
    assert.strictEqual(ad.pet.mood, P.MOOD_INIT, '初始心情应为 ' + P.MOOD_INIT);

    // 投喂：扣星星 + 加成长 + 加心情 + 一条 pet_feed 流水
    const starsBefore = 20;
    const childrenArr = store[s.KEYS.children];
    childrenArr.find(c => c._id === childId).totalStars = starsBefore;
    store[s.KEYS.children] = childrenArr;
    const fd = await local.petCRUD({ op: 'feed', childId, parentToken: token });
    assert.strictEqual(fd.ok, true, '投喂失败');
    assert.strictEqual(fd.totalStars, starsBefore - P.PET_FEED_COST, '星星未按投喂成本扣减');
    assert.strictEqual(fd.pet.growthValue, P.PET_GROWTH_PER_FEED, '成长值未按投喂增加');
    const feedLog = (store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed');
    assert.strictEqual(feedLog.length, 1, '投喂应写 1 条 pet_feed 流水');
    assert.strictEqual(feedLog[0].delta, -P.PET_FEED_COST, '流水方向应为支出');

    // 抚摸：免费（不扣星星、不写流水）
    const sk = await local.petCRUD({ op: 'stroke', childId });
    assert.strictEqual(sk.ok, true, '抚摸失败');
    assert.strictEqual(sk.pet.strokeCount, 1, '抚摸次数未累计');
    assert.strictEqual((store[s.KEYS.pointsLog] || []).filter(x => x.refType === 'pet_feed').length, 1,
      '抚摸不应写积分流水');

    // 互动统计：连续 1 天 / 累计 1 投喂 1 抚摸
    const info = await local.petCRUD({ op: 'info', childId });
    assert.strictEqual(info.pet.stats.streakDays, 1, '连续互动天数应为 1');
    assert.strictEqual(info.pet.stats.feedTotal, 1, '累计投喂应为 1');
    assert.strictEqual(info.pet.stats.strokeTotal, 1, '累计抚摸应为 1');
    return `领养「小灰」· 投喂 -${P.PET_FEED_COST}⭐/+${P.PET_GROWTH_PER_FEED} 成长（星星 ${starsBefore}→${fd.totalStars}，1 条 pet_feed 流水）· 抚摸免费 · 连续互动 1 天`;
  });

  // ============ 需人工确认的项 ============
  manual('6-UI', '首页右上角锁图标 与「我」页切换行 两处家长模式切换',
    '需人工：闭锁态点锁图标 → 弹 PIN 闸；开锁态点 → 直接关闭。属 UI 交互，脚本无法断言');
  manual('5-UI', '日历点亮的外观（圆圈高亮 + ✓）',
    '需人工：数据层已确认 monthLit 正确，需肉眼确认渲染效果');
  manual('UI-全量', '三页视觉与弹层交互（新建/编辑/打卡/兑换/图标选择/日明细）',
    '需人工：按 design-雨宝记-UI.html 基线核对；弹层可点蒙层与右上角 × 关闭');
  manual('云', '云端真库链路（云开发 + 13 个云函数）',
    '阻塞：CLOUD_ENV 为空，当前跑本地兜底。需建集合/索引/上传云函数后复测');

  // ============ 输出 ============
  const pad = (str, n) => {
    let len = 0;
    for (const ch of str) len += ch.charCodeAt(0) > 127 ? 2 : 1;
    return str + ' '.repeat(Math.max(0, n - len));
  };
  console.log('');
  console.log('════════ 雨宝记 MVP 验收报告 ════════');
  console.log('范围：本地兜底数据层（可断言部分）；标 MANUAL 的需人工确认');
  console.log('');
  for (const r of results) {
    const tag = r.status === 'PASS' ? '✓ PASS' : (r.status === 'FAIL' ? '✗ FAIL' : '○ MANUAL');
    console.log(`[${String(r.n).padEnd(6)}] ${tag}  ${r.title}`);
    if (r.detail) console.log(`          └─ ${r.detail}`);
  }
  const p = results.filter(r => r.status === 'PASS').length;
  const f = results.filter(r => r.status === 'FAIL').length;
  const m = results.filter(r => r.status === 'MANUAL').length;
  console.log('');
  console.log(`──────── 汇总：${p} 通过 / ${f} 失败 / ${m} 待人工 ────────`);
  process.exit(f > 0 ? 1 : 0);
})();
