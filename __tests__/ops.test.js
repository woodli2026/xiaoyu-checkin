// __tests__/ops.test.js —— 后端操作单一来源（候选③）守卫
// 防止「函数数 / op 隐形漂移」：ops.js 必须与云端目录 + 本地导出 + 云函数实际 op 分支三者一致。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { OPS, LOCAL_ONLY, isPublic, needsToken, callFlag } = require('../miniprogram/ops');
const local = require('../miniprogram/services/local');

// 列出云函数目录名（排除 lib/ 与本地独占项）
function cloudDirs() {
  const cf = path.join(ROOT, 'cloudfunctions');
  return fs.readdirSync(cf, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'lib')
    .map((d) => d.name);
}

// 抓取某个云函数 index.js 里实际出现的 op 分支（event.op === 'X' 形式）
function cloudOps(name) {
  const file = path.join(ROOT, 'cloudfunctions', name, 'index.js');
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const set = new Set();
  const re = /\.op\s*===\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) set.add(m[1]);
  return [...set];
}

test('① 每个云函数目录都在 OPS 中登记', () => {
  for (const d of cloudDirs()) {
    assert.ok(OPS[d] !== undefined, `云函数 ${d} 未在 ops.js 登记`);
  }
});

test('② 每个云函数实际处理的 op 都在其 OPS 映射中（防漏登记 op）', () => {
  for (const d of cloudDirs()) {
    const ops = cloudOps(d);
    const entry = OPS[d];
    if (ops.length === 0) {
      // 无 op 分派：OPS[d] 应为字符串标记
      assert.strictEqual(typeof entry, 'string', `云函数 ${d} 无 op 分支，OPS[${d}] 应为字符串标记`);
    } else {
      assert.strictEqual(typeof entry, 'object', `云函数 ${d} 有 op 分支，OPS[${d}] 应为对象`);
      for (const op of ops) {
        assert.ok(entry[op] !== undefined, `云函数 ${d} 的 op '${op}' 未在 ops.js 登记`);
      }
    }
  }
});

test('③ local.js 导出的后端函数都在 OPS 中（resetAll 为本地独占）', () => {
  const exported = Object.keys(local).filter((k) => typeof local[k] === 'function');
  const expected = [
    'login', 'unlockParent', 'setPin', 'resetPin', 'getDashboard',
    'checkIn', 'redeem', 'taskCRUD', 'rewardCRUD', 'childCRUD',
    'childSwitch', 'feedCRUD', 'petCRUD', 'resetAll'
  ];
  assert.deepStrictEqual(exported.sort(), expected.sort(), 'local.js 导出与预期不符，请核对');
  for (const fn of expected) {
    assert.ok(OPS[fn] !== undefined, `local.js 后端函数 ${fn} 未在 ops.js 登记`);
  }
});

test('④ 无幽灵项：OPS 键 ⊆ 云函数目录 ∪ 本地独占', () => {
  const allowed = new Set([...cloudDirs(), ...LOCAL_ONLY]);
  for (const k of Object.keys(OPS)) {
    assert.ok(allowed.has(k), `ops.js 含未实现的幽灵项 '${k}'（既非云函数也非本地独占）`);
  }
});

test('⑤ 行为抽检：公开 / 需令牌判定正确', () => {
  // 公开（免令牌注入）
  for (const c of [
    ['login'], ['unlockParent'], ['getDashboard'], ['resetAll'], ['resetPin'],
    ['childCRUD', 'list'], ['feedCRUD', 'list'],
    ['petCRUD', 'info'], ['petCRUD', 'stroke']
  ]) {
    assert.strictEqual(isPublic(c[0], c[1]), true, `${c.join(':')} 应为公开`);
    assert.strictEqual(needsToken(c[0], c[1]), false, `${c.join(':')} 不应需令牌`);
  }
  // 需令牌
  for (const c of [
    ['checkIn'], ['redeem'], ['setPin'], ['childSwitch'],
    ['childCRUD', 'create'], ['childCRUD', 'update'], ['childCRUD', 'delete'],
    ['taskCRUD', 'create'], ['rewardCRUD', 'delete'],
    ['feedCRUD', 'undoCheckIn'], ['feedCRUD', 'undoRedeem'],
    ['petCRUD', 'adopt'], ['petCRUD', 'feed'], ['petCRUD', 'rename'],
    ['petCRUD', 'reset'], ['petCRUD', 'release']
  ]) {
    assert.strictEqual(isPublic(c[0], c[1]), false, `${c.join(':')} 应需令牌`);
    assert.strictEqual(needsToken(c[0], c[1]), true, `${c.join(':')} 应需令牌`);
  }
});

test('⑥ 未知调用 / 缺 op 的 op 函数返回 null（守卫测试据此捕获遗漏）', () => {
  assert.strictEqual(callFlag('noSuchFn', undefined), null);
  assert.strictEqual(callFlag('childCRUD', undefined), null); // 按 op 分派却没传 op
});
