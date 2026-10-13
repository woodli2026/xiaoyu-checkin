// cloudfunctions/lib/session.js
//
// 会话策略常量（候选①，2026-10-10）：家长令牌有效期的**云端单一政策源**。
//
// 为什么单独成文件：
//   原先「令牌多久过期」这个政策散成三份且互不一致——
//     config.js                 1 年（R10.1）
//     local/auth.js             读 config ✅
//     unlockParent/index.js     硬编码 5 分钟 ❌（云端从未实跑，故一直没暴露）
//   切云端后会 100% 复现：令牌 5 分钟过期 + 云端不静默解锁（app.js#maybeAutoUnlock）
//   → 进家长模式 5 分钟后每次写操作都弹 PIN，正是 R10.1 要消灭的行为。
//
// 口径：必须与 miniprogram/config.js 的 PARENT_TOKEN_TTL_MS **相等**，
//      由 __tests__/token-ttl-guard.test.js 断言（小程序不能 require 包外文件，
//      故采用「双份常量 + 守卫」，与项目既有镜像策略一致）。
//
// R10.1：家长模式默认开启、空闲自动退出已移除、令牌 1 年长效（仅作会话标识）。
const PARENT_TOKEN_TTL_MS = 365 * 24 * 3600 * 1000;   // 1 年

module.exports = { PARENT_TOKEN_TTL_MS };
