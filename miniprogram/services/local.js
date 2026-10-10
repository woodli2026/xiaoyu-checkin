// services/local.js —— 本地兜底数据层（聚合出口）
// 未配置云环境时启用；接口契约与 13 个云函数完全一致，页面层无需感知差异。
//
// 2026-10-10（架构优化 D3）：原 774 行单体按域拆为 ./local/*.js，本文件只做聚合导出。
// 导出函数集与签名保持不变（由 __tests__/ops.test.js 与 pet.test.js 守卫）。
//   ./local/store.js     通用返回件 + 存储访问 + 令牌校验（低层）
//   ./local/auth.js      账号 / PIN / 家长令牌
//   ./local/dashboard.js 看板
//   ./local/checkin.js   打卡
//   ./local/task.js      任务 CRUD
//   ./local/reward.js    兑换 + 奖励 CRUD
//   ./local/child.js     多宝宝档案
//   ./local/feed.js      动态流水
//   ./local/pet.js       宠物
//   ./local/demo.js      演示辅助（resetAll）
const auth = require('./local/auth');
const dashboard = require('./local/dashboard');
const checkin = require('./local/checkin');
const task = require('./local/task');
const reward = require('./local/reward');
const child = require('./local/child');
const feed = require('./local/feed');
const pet = require('./local/pet');
const demo = require('./local/demo');

module.exports = {
  login: auth.login,
  unlockParent: auth.unlockParent,
  setPin: auth.setPin,
  resetPin: auth.resetPin,               // 与云函数 resetPin 对齐
  getDashboard: dashboard.getDashboard,
  checkIn: checkin.checkIn,
  redeem: reward.redeem,
  taskCRUD: task.taskCRUD,
  rewardCRUD: reward.rewardCRUD,
  childCRUD: child.childCRUD,
  childSwitch: child.childSwitch,
  feedCRUD: feed.feedCRUD,
  petCRUD: pet.petCRUD,
  resetAll: demo.resetAll,
  DEFAULT_PIN: auth.DEFAULT_PIN,
  PIN_LENGTH: auth.PIN_LENGTH,
  PIN_SCHEME: auth.PIN_SCHEME   // 导出供单测守卫（与 cloudfunctions/lib/pin.js 比对）
};
