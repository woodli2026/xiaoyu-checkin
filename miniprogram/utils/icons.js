// utils/icons.js —— 图标选择面板候选集（2026-09-18 改版：按用途分两套，各 72 个、分 4 类）
//
// 任务 = 活动 18 + 自然 18 + 旅行 18 + 物品 18
// 奖励 = 食物与饮品 18 + 活动 18 + 旅行 18 + 物品 18（活动/旅行两组与任务共享）
// 选型原则（__tests__/core.test.js 有守卫，改这里必须过测）：
//   ① 只用单码位 emoji，不用 ZWJ 组合与肤色变体（低版本安卓会渲染成方块）；
//   ② 每类取最高频、语义直观的 18 个（App 内 6 列 × 3 行）；
//   ③ 同一套内不允许重复；已含开箱种子数据的 ✏️ 📚 🏃 与奖励 🎈。

const ACTIVITY = [
  '⚽', '🏀', '🎾', '🏓', '🏸', '🥋', '🏊', '🚴', '🏃',
  '🎨', '🎵', '🎹', '🎸', '🎤', '🎬', '📚', '✏️', '🎯'
];
const NATURE = [
  '🌞', '🌈', '⭐', '🌙', '☁️', '🌸', '🌻', '🌹', '🌷',
  '🍀', '🌲', '🌴', '🌵', '🍁', '🐶', '🐱', '🐰', '🐟'
];
const TRAVEL = [
  '🚗', '🚌', '🚲', '🚂', '✈️', '🚀', '🚁', '⛵', '🏖️',
  '🏔️', '🗺️', '🎡', '🎢', '🏰', '⛺', '🌍', '🏕️', '🚕'
];
const TASK_OBJECTS = [
  '🎒', '📕', '📖', '🖍️', '📝', '📌', '✂️', '📏', '💡',
  '🔍', '🔑', '🕐', '🎁', '🏆', '🥇', '🎪', '🧩', '🎲'
];
const FOOD = [
  '🍦', '🍭', '🍫', '🍬', '🧁', '🍰', '🎂', '🍩', '🍪',
  '🍕', '🍔', '🍟', '🍿', '🍎', '🍓', '🍉', '🥤', '🍹'
];
const REWARD_OBJECTS = [
  '🎁', '🧸', '🎈', '🎀', '👑', '💎', '🎧', '📱', '💻',
  '⌚', '🧢', '👟', '🏆', '🎫', '🧴', '🎗️', '🎪', '🧩'
];

const ICON_SETS = {
  task: [
    { name: '活动', icons: ACTIVITY },
    { name: '自然', icons: NATURE },
    { name: '旅行', icons: TRAVEL },
    { name: '物品', icons: TASK_OBJECTS }
  ],
  reward: [
    { name: '食物与饮品', icons: FOOD },
    { name: '活动', icons: ACTIVITY },
    { name: '旅行', icons: TRAVEL },
    { name: '物品', icons: REWARD_OBJECTS }
  ]
};

const DEFAULT_SET = 'task';

// 供组件安全取组：未知 kind 一律回退任务集
function groupsOf(kind) {
  return ICON_SETS[kind] || ICON_SETS[DEFAULT_SET];
}

module.exports = { ICON_SETS, DEFAULT_SET, groupsOf };
