// @ts-check
// utils/bubble.js —— 宠物对话气泡配色（无 wx / 无 IO，可单测）
const pets = require('./pets');

/**
 * 气泡主题四色（背景渐变 a→b / 文字色 ink / 阴影 shadow）
 * @typedef {{ a: string, b: string, ink: string, shadow: string }} BubbleTheme
 */

/**
 * 每个品种一套糖果色；不同宠物 → 不同气泡配色
 * @type {Record<string, BubbleTheme>}
 */
const BUBBLE_THEME = {
  cat_lihua:    { a: '#FFD9A0', b: '#FFB05A', ink: '#7a4a12', shadow: 'rgba(255,150,60,.45)' },
  cat_orange:   { a: '#FFE3A3', b: '#FFB23E', ink: '#804d00', shadow: 'rgba(255,160,40,.45)' },
  cat_british:  { a: '#CFE3FB', b: '#9CC1F2', ink: '#2b4f86', shadow: 'rgba(120,170,240,.50)' },
  cat_american: { a: '#E6ECF4', b: '#B9C4D6', ink: '#445268', shadow: 'rgba(150,165,190,.45)' },
  cat_ragdoll:  { a: '#EFE0FB', b: '#CBA8EE', ink: '#5a3a86', shadow: 'rgba(190,150,235,.50)' },
  dog_yellow:   { a: '#D6F0AE', b: '#9FD96E', ink: '#3c5a18', shadow: 'rgba(150,205,100,.50)' },
  dog_labrador: { a: '#F0D6B8', b: '#D8A877', ink: '#6b4324', shadow: 'rgba(210,160,110,.50)' },
  dog_shepherd: { a: '#F0D2A6', b: '#CFA067', ink: '#5e3c14', shadow: 'rgba(200,150,90,.48)' },
  dog_poodle:   { a: '#FFD6EC', b: '#FFA6D2', ink: '#9a2e63', shadow: 'rgba(255,150,200,.50)' },
  dog_beagle:   { a: '#FFE9A6', b: '#FFC24D', ink: '#7a4e00', shadow: 'rgba(255,185,70,.45)' }
};

/** 无宠物（fallback）用默认黄 @type {BubbleTheme} */
const BUBBLE_DEFAULT = { a: '#FFE873', b: '#FFD226', ink: '#6b4a12', shadow: 'rgba(255,190,60,.45)' };

/**
 * 由品种 key 生成气泡 CSS 变量串（未知品种 → 默认黄）
 * @param {string|null|undefined} speciesKey
 * @returns {string}
 */
function bubbleStyleFor(speciesKey) {
  const t = (speciesKey && BUBBLE_THEME[pets.resolveSpeciesKey(speciesKey)]) || BUBBLE_DEFAULT;
  return `--bub-a:${t.a};--bub-b:${t.b};--bub-ink:${t.ink};--bub-shadow:${t.shadow}`;
}

module.exports = { BUBBLE_THEME, BUBBLE_DEFAULT, bubbleStyleFor };
