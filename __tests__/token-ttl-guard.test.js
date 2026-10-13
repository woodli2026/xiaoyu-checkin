// __tests__/token-ttl-guard.test.js
//
// 家长令牌有效期守卫（候选①，2026-10-10）。
//
// 背景：TTL 这个「一层决定、两端共用」的政策常量散成了三份——
//   miniprogram/config.js:20        PARENT_TOKEN_TTL_MS = 365 天（1 年）
//   miniprogram/services/local/auth.js:120  读 config ✅
//   cloudfunctions/unlockParent/index.js:19  硬编码 5 * 60 * 1000 ❌
//   且 cloudfunctions/lib/token.js#issueToken 还有个 5 分钟的默认值兜底。
//
// 后果（填 CLOUD_ENV 即 100% 复现）：切云端后令牌 5 分钟过期，
// 而 app.js#maybeAutoUnlock 明确「云端层不静默解锁」→ 无任何续期路径，
// 表现为「进家长模式 5 分钟后，每做一次写操作就弹一次 PIN」——
// 正是 R10.1（令牌 1 年长效、无空闲自动退出）要消灭的行为。
//
// 修法：云端常量收进 lib/session.js（单一政策源），issueToken 取消默认值兜底
//      （强制调用方显式给 TTL，把「到底要多久」这个决策逼到调用面），
//      本守卫断言两端策略常量相等。
//
// 说明：这是「双份常量 + 守卫」而非真正单源 —— 小程序不能 require 包外文件，
//      与项目既有的 D1 镜像策略一致（正确性由守卫保证，不由物理共享保证）。
const test = require('node:test');
const assert = require('node:assert');

const { read, strip } = require('./helpers/js-source');

const CFG = require('../miniprogram/config');
const SESSION = require('../cloudfunctions/lib/session');

const YEAR = 365 * 24 * 3600 * 1000;

// ---------- 两端策略常量必须一致 ----------

test('两端策略常量一致：lib/session.js === config.js 的 PARENT_TOKEN_TTL_MS', () => {
  assert.strictEqual(SESSION.PARENT_TOKEN_TTL_MS, CFG.PARENT_TOKEN_TTL_MS,
    '云端与前端的家长令牌有效期必须相等，否则切云端后过期行为会突变');
});

test('策略常量就是 R10.1 要求的 1 年长效（365 天）', () => {
  assert.strictEqual(CFG.PARENT_TOKEN_TTL_MS, YEAR, '前端 TTL 应为 1 年');
  assert.strictEqual(SESSION.PARENT_TOKEN_TTL_MS, YEAR, '云端 TTL 应为 1 年');
});

// ---------- 静态守卫：不得再出现旧的 5 分钟硬编码 ----------

test('静态守卫：unlockParent 不得再硬编码 5 分钟 TTL', () => {
  const src = strip(read('cloudfunctions/unlockParent/index.js'));
  assert.ok(!/5\s*\*\s*60\s*\*\s*1000/.test(src),
    'unlockParent 仍硬编码 5 分钟有效期，应改用 lib/session.js 的策略常量');
});

test('静态守卫：issueToken 不得保留 TTL 默认值兜底（必须显式传）', () => {
  const src = strip(read('cloudfunctions/lib/token.js'));
  assert.ok(!/ttlMs\s*\|\|/.test(src),
    'issueToken 仍有 TTL 默认值兜底——默认 5 分钟会悄悄生效，应删除默认值强制显式传参');
});

test('静态守卫：云端签发令牌必须引用 session 策略常量', () => {
  const src = strip(read('cloudfunctions/unlockParent/index.js'));
  assert.ok(/PARENT_TOKEN_TTL_MS/.test(src),
    'unlockParent 应显式引用 PARENT_TOKEN_TTL_MS（而不是字面量分钟数）');
});

test('静态守卫：本地层签发令牌必须读 config 的策略常量', () => {
  const src = strip(read('miniprogram/services/local/auth.js'));
  assert.ok(/PARENT_TOKEN_TTL_MS/.test(src),
    '本地层应读 CFG.PARENT_TOKEN_TTL_MS，不得写死 TTL');
});
