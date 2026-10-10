// @ts-check
// utils/confetti.js —— 礼花 / 粒子碎片的纯计算（无 wx / 无 IO；rand 可注入便于单测）

/**
 * 主页礼花筒碎片
 * @typedef {{ id: number, x: number, color: string, shape: string, tx: number, ty: number, rot: number, delay: string }} CannonPiece
 */
/**
 * 宠物页上浮碎片
 * @typedef {{ id: number, left: number, color: string, delay: string }} RisePiece
 */
/**
 * 宠物互动飘浮粒子
 * @typedef {{ id: string, kind: string, left: number, top: number, delay: string }} FxParticle
 */

const CANNON_COLORS = ['#FFC93C', '#FF9AA2', '#7Fd3ff', '#C8F5DD', '#DDD0FF', '#FFB36B', '#A0E7A0', '#FF8FB1'];
const CANNON_X = [8, 26, 44, 62, 80, 92];          // 6 个礼花筒发射点
const CANNON_SHAPES = ['rect', 'circle', 'star', 'ribbon'];
const RISE_COLORS = ['#FFC93C', '#FF9AA2', '#7Fd3ff', '#C8F5DD', '#DDD0FF'];

/**
 * 主页礼花筒：6 炮 × 16–20 片，锥形扩散（-75°~75°）
 * @param {() => number} [rand] 随机源（默认 Math.random，注入便于单测）
 * @returns {CannonPiece[]}
 */
function cannonPieces(rand) {
  const r = rand || Math.random;
  const pieces = [];
  let id = 0;
  CANNON_X.forEach((x) => {
    const n = 16 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const angle = (r() * 150 - 75) * Math.PI / 180;
      const dist = 240 + r() * 360;
      pieces.push({
        id: id++, x,
        color: CANNON_COLORS[Math.floor(r() * CANNON_COLORS.length)],
        shape: CANNON_SHAPES[Math.floor(r() * CANNON_SHAPES.length)],
        tx: Math.round(Math.sin(angle) * dist),
        ty: -Math.round(Math.cos(angle) * dist) - 160,
        rot: Math.round(r() * 540),
        delay: (r() * 0.2).toFixed(2)
      });
    }
  });
  return pieces;
}

/**
 * 宠物页上浮礼花：26 片随机横向散布
 * @param {() => number} [rand]
 * @returns {RisePiece[]}
 */
function risePieces(rand) {
  const r = rand || Math.random;
  const pieces = [];
  for (let i = 0; i < 26; i++) {
    pieces.push({
      id: i, left: Math.round(r() * 100),
      color: RISE_COLORS[i % RISE_COLORS.length], delay: (r() * 0.3).toFixed(2)
    });
  }
  return pieces;
}

/**
 * 宠物互动飘浮粒子（kind: heart / star），自下而上错峰出现
 * @param {string} kind
 * @param {number} attempt
 * @param {number} count
 * @param {() => number} [rand]
 * @returns {FxParticle[]}
 */
function fxParticles(kind, attempt, count, rand) {
  const r = rand || Math.random;
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      id: attempt + '-' + i, kind,
      left: 15 + Math.round(r() * 70),
      top: Math.round(r() * 30) - 25,
      delay: (i * 0.15).toFixed(2)
    });
  }
  return arr;
}

module.exports = { cannonPieces, risePieces, fxParticles, CANNON_X };
