// __tests__/mirror-guard.test.js —— 候选② 延伸：闭合 D2 安全网盲区（Phase A，2026-10-09）
// 填补 ②-A（lib 副本逐字节守卫）未覆盖的「前端 services ↔ 云端云函数」双份镜像盲区：
//   ① REDEEM_BLOCK_MSG（services/local.js）↔ BLOCK_MSG（cloudfunctions/redeem/index.js）
//   ② petView 输出键集（services/local.js#petView ↔ cloudfunctions/petCRUD/index.js#petView）
// 用 vm 沙箱对两处字面量求值，断言真实键集（及文案值）一致 + 等于固定预期集合，
// 既防单边漂移，也防双端同漂移；同时顺带验证字面量语法有效。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 从 openIdx（指向 '{'）起扫描，跳过字符串/注释，返回匹配的右括号索引
function matchBrace(src, openIdx) {
  let depth = 0, inStr = null, esc = false, lineC = false, blockC = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (lineC) { if (ch === '\n') lineC = false; continue; }
    if (blockC) { if (ch === '*' && src[i + 1] === '/') { blockC = false; i++; } continue; }
    if (esc) { esc = false; continue; }
    if (inStr) { if (ch === '\\') { esc = true; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '/' && src[i + 1] === '/') { lineC = true; i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { blockC = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('未匹配到右括号');
}

// 返回从 anchor 之后第一个 '{' 起的完整 "{...}" 文本
function objectLiteralAfter(src, anchor) {
  const a = src.indexOf(anchor);
  if (a < 0) throw new Error('找不到 anchor: ' + anchor);
  const b = src.indexOf('{', a);
  if (b < 0) throw new Error('anchor 后无 {');
  return src.slice(b, matchBrace(src, b) + 1);
}

// 返回函数（含签名到匹配的右括号）的完整文本
function functionAfter(src, fnName) {
  const a = src.indexOf('function ' + fnName);
  if (a < 0) throw new Error('找不到函数 ' + fnName);
  const b = src.indexOf('{', a);
  return src.slice(a, matchBrace(src, b) + 1);
}

function evalObj(span, sandbox) {
  return vm.runInNewContext('(' + span + ')', sandbox);
}

test('① REDEEM_BLOCK_MSG(本地兜底) ↔ BLOCK_MSG(云端兑换) 字面量口径一致', () => {
  const localMsg = evalObj(objectLiteralAfter(read('miniprogram/services/local/reward.js'), 'REDEEM_BLOCK_MSG ='), {});
  const cloudMsg = evalObj(objectLiteralAfter(read('cloudfunctions/redeem/index.js'), 'BLOCK_MSG ='), {});
  const expected = ['ALREADY_REDEEMED', 'INSUFFICIENT', 'INVALID', 'REWARD_NOT_FOUND'].sort();
  assert.deepStrictEqual(Object.keys(localMsg).sort(), expected, '本地 REDEEM_BLOCK_MSG 键集漂移');
  assert.deepStrictEqual(Object.keys(cloudMsg).sort(), expected, '云端 BLOCK_MSG 键集漂移');
  // 注：两对象分属不同 vm 上下文，deepStrictEqual 会因原型跨 realm 误判；文案是基元串，逐个比较即可
  for (const k of expected) {
    assert.strictEqual(localMsg[k], cloudMsg[k], `兑换被拒文案 ${k} 双端不一致`);
  }
});

test('② petView 输出键集 本地 ↔ 云端 一致（视图模型契约）', () => {
  const sandbox = {
    pet: {
      _id: 'p1', childId: 'c1', species: 'cat_lihua', name: '咪咪',
      growthValue: 50, mood: 60, lastMoodAt: Date.now(),
      feedCount: 2, strokeCount: 1, daily: {}, createdAt: 123
    },
    today: '2026-10-09',
    P: {
      resolveSpeciesKey: (s) => s,
      stageInfo: () => ({ growthValue: 50, growthPct: 10, stageHave: 50, stageNeed: 100, stagePct: 0.5, stage: 0, name: '幼崽', emoji: '🐱', speciesEmoji: '🐱', nextStageAt: 300 }),
      speciesOf: () => ({ name: '狸花' }),
      applyMoodDecay: (m) => m,
      MOOD_MAX: 100,
      PET_FEED_DAILY_LIMIT: 3,
      feedCountToday: () => 0,
      canFeed: () => true,
      computePetStats: () => ({ a: 1 })
    },
    Number, Date
  };
  // 求值整段 petView 函数并调用，才能拿到真实输出对象（return 字面量引用了函数内局部变量）
  const localView = evalObj('(' + functionAfter(read('miniprogram/services/local/pet.js'), 'petView') + ')', sandbox)(sandbox.pet, sandbox.today);
  const cloudView = evalObj('(' + functionAfter(read('cloudfunctions/petCRUD/index.js'), 'petView') + ')', sandbox)(sandbox.pet, sandbox.today);
  const expected = [
    '_id', 'adoptedAt', 'breedName', 'childId', 'emoji', 'feedCount', 'feedLimited',
    'growthPct', 'growthValue', 'mood', 'moodMax', 'name', 'nextStageAt', 'species',
    'speciesEmoji', 'stage', 'stageHave', 'stageName', 'stageNeed', 'stagePct',
    'stats', 'strokeCount', 'todayFeedCount'
  ].sort();
  assert.deepStrictEqual(Object.keys(localView).sort(), expected, '本地 petView 视图字段漂移');
  assert.deepStrictEqual(Object.keys(cloudView).sort(), expected, '云端 petView 视图字段漂移');
  assert.deepStrictEqual(Object.keys(localView).sort(), Object.keys(cloudView).sort(), '双端 petView 输出键集不一致');
});
