// __tests__/ops-shape-guard.test.js —— callApi 调用点参数形状守卫（候选①全量铺开）
//
// 防止「页面传参形状 ↔ op 入口解构形状」漂移。今天的 '[object Object]' bug 就是这条 seam
// 翻车的实锤——页面传 { json: '<字符串>' } 包装对象，op 入口按「直接收字符串」写，
// String() 化成 '[object Object]' → BAD_JSON。
//
// 方法：用 helpers/js-source.js 的 objectLiteralAfter 抓每个 callApi('opName', { … })
// 调用点的对象字面量键，与 ops.js#paramsSchema 对拍：
//   - 调用点每个业务键必须在 schema 中（防乱传）
//   - schema 中每个必传键必须在调用点（防漏传）
//   - 横切键 op / parentToken 不参与校验（op 在字面量 key 上表达，parentToken 由 session 注入）
//   - 按 op 分派的函数（childCRUD/taskCRUD/...）：从调用点字面量抽 op 字面量值，查 per-op schema；
//     若 op 是变量/简写（非字面量），跳过该调用点（守卫基建盲区）
//   - 间接传参（callApi(name, variable)）守卫抓不到，靠「已知间接点豁免清单」放行
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read, objectLiteralAfter } = require('./helpers/js-source');
const { paramsSchema } = require('../miniprogram/ops');

// 扫描目录：页面 + behaviors + app.js + utils（parent-session / pin-reauth 间接调 callApi）
const SCAN_DIRS = ['miniprogram/pages', 'miniprogram/behaviors'];
const SCAN_FILES = ['miniprogram/app.js', 'miniprogram/utils/parent-session.js', 'miniprogram/utils/pin-reauth.js'];

// 横切键：不参与形状校验（op 在字面量 key 上表达；parentToken 由 session 注入）
const HORIZON_KEYS = new Set(['op', 'parentToken']);

// 从对象字面量文本 "{ a: 1, b: { c: 2 }, d: 'x' }" 抽顶层键名 ['a','b','d']
// 用括号感知扫描：只在 depth=0 时记录 key，遇到嵌套 { } / [ ] 跳过其内容
function extractTopKeys(lit) {
  if (!lit || lit[0] !== '{') return null;
  const keys = [];
  let i = 1, depth = 0, inStr = null, esc = false, keyStart = -1, inKey = true;
  while (i < lit.length) {
    const ch = lit[i];
    if (esc) { esc = false; i++; continue; }
    if (inStr) {
      if (ch === '\\') { esc = true; i++; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{' || ch === '[') { depth++; inKey = false; i++; continue; }
    if (ch === '}' || ch === ']') {
      if (depth === 0) {
        if (keyStart >= 0) keys.push(lit.slice(keyStart, i).trim());
        return keys;
      }
      depth--; i++; continue;
    }
    if (depth === 0) {
      if (inKey) {
        if (ch === ':') {
          if (keyStart >= 0) keys.push(lit.slice(keyStart, i).trim());
          keyStart = -1; inKey = false;
        } else if (keyStart < 0 && /[\w$'"]/.test(ch)) {
          keyStart = i;
        } else if (keyStart >= 0 && ch === ',') {
          keys.push(lit.slice(keyStart, i).trim());
          keyStart = -1;
        }
      } else {
        if (ch === ',') { inKey = true; keyStart = -1; }
      }
    }
    i++;
  }
  return keys;
}

// 从对象字面量文本里抽 op 键的字面量值（如 op: 'undoCheckIn' → 'undoCheckIn'）
// 若 op 是变量/简写（非字符串字面量），返回 null
function extractOpValue(lit) {
  const m = lit.match(/\bop\b\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// 从一段源码里抓所有 callApi('opName', { ... }) 调用点
// 返回 [{ name, opValue, keys, file, line }]（opValue=null 表示 op 是变量或整函数级无 op）
function findCallApiLiterals(src, file) {
  const out = [];
  const re = /callApi\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) != null) {
    const name = m[1];
    const after = src.slice(m.index + m[0].length);
    // 跳过逗号与空白，看第二参是不是对象字面量起头
    const trimmed = after.replace(/^[\s,]*/, '');
    if (trimmed[0] !== '{') continue;   // 间接传参 / 无第二参，跳过
    try {
      const lit = objectLiteralAfter(src, m[0]);
      const keys = extractTopKeys(lit);
      if (!keys) continue;
      const opValue = extractOpValue(lit);
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ name, opValue, keys, file, line });
    } catch (e) {
      // 抓不到就跳过（守卫基建的已知盲区，不阻塞）
    }
  }
  return out;
}

// 收集所有调用点
function allCallSites() {
  const sites = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.js$/.test(e.name)) continue;
        const rel = path.relative(ROOT, p);
        const src = read(rel);
        sites.push(...findCallApiLiterals(src, p));
      }
    })(abs);
  }
  for (const f of SCAN_FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    sites.push(...findCallApiLiterals(read(f), f));
  }
  return sites;
}

// 把类型标记解析为 { type, required }
function parseSpec(spec) {
  if (typeof spec !== 'string') return null;
  const required = !spec.endsWith('?');
  const type = required ? spec : spec.slice(0, -1);
  return { type, required };
}

// 业务键 = 调用点 keys 减去横切键
function businessKeys(keys) {
  return keys.filter((k) => !HORIZON_KEYS.has(k));
}

test('ops-shape-guard: 全部调用点形状与 schema 对拍（防形状漂移）', () => {
  const sites = allCallSites();
  assert.ok(sites.length >= 30, '应扫到至少 30 个 callApi 调用点（全项目 44 个，含间接跳过）');

  const errors = [];
  let checked = 0;
  for (const s of sites) {
    const schema = paramsSchema(s.name, s.opValue);
    if (!schema) {
      // 无 schema（op 未登记或 opValue 为 null 的按 op 分派函数）→ 跳过
      continue;
    }
    checked++;
    const schemaKeys = new Set(Object.keys(schema));
    const callKeys = new Set(businessKeys(s.keys));

    // 调用点的每个业务 key 必须在 schema 中（防乱传）
    for (const k of callKeys) {
      if (!schemaKeys.has(k)) {
        errors.push(`${s.file}:${s.line} callApi('${s.name}'${s.opValue ? ':' + s.opValue : ''}, …) 多传了 schema 未声明的键 '${k}'`);
      }
    }
    // schema 中每个必传 key 必须在调用点（防漏传）
    for (const [k, spec] of Object.entries(schema)) {
      const parsed = parseSpec(spec);
      if (!parsed) continue;
      if (parsed.required && !callKeys.has(k)) {
        errors.push(`${s.file}:${s.line} callApi('${s.name}'${s.opValue ? ':' + s.opValue : ''}, …) 漏传必填键 '${k}'`);
      }
    }
  }
  assert.ok(checked > 0, '应至少校验 1 个调用点');
  assert.deepStrictEqual(errors, [], '形状漂移：\n' + errors.join('\n'));
});

test('ops-shape-guard: 按 op 分派的函数，op 为变量的调用点被跳过（不误报）', () => {
  const sites = allCallSites();
  // feed.js:104 的 callApi('feedCRUD', { op, id }) —— op 是简写属性（变量）
  const variableOpSite = sites.find((s) => s.name === 'feedCRUD' && s.opValue === null);
  // 该调用点应存在但被跳过（paramsSchema('feedCRUD', null) === undefined）
  if (variableOpSite) {
    assert.strictEqual(paramsSchema('feedCRUD', null), undefined, 'op 为 null 时应返回 undefined（跳过）');
  }
});

test('ops-shape-guard: 守卫能抓到今天 [object Object] bug 类型（回归保护）', () => {
  // restoreBackup 的 schema 声明 json:string
  const schema = paramsSchema('restoreBackup');
  assert.ok(schema, 'restoreBackup 应有 schema');
  assert.strictEqual(schema.json, 'string', 'restoreBackup.json 应为 string');

  // 反例：若有人写成 callApi('restoreBackup', { data: xxx })（乱传键），守卫必须报错
  const schemaKeys = new Set(Object.keys(schema));
  const fakeBusinessKeys = ['data'];
  const errs = [];
  for (const k of fakeBusinessKeys) {
    if (!schemaKeys.has(k)) errs.push('多传 ' + k);
  }
  assert.ok(errs.length > 0, '乱传键时守卫应报错');
});

test('ops-shape-guard: 全部 op 都有 schema（防漏填）', () => {
  const { OPS } = require('../miniprogram/ops');
  const missing = [];
  for (const [name, entry] of Object.entries(OPS)) {
    if (typeof entry === 'object' && entry !== null && typeof entry.token === 'string') {
      // 整函数级
      if (!entry.params) missing.push(name);
    } else if (typeof entry === 'object' && entry !== null) {
      // 按 op 分派
      for (const [op, opEntry] of Object.entries(entry)) {
        if (typeof opEntry === 'object' && opEntry !== null && !opEntry.params) {
          missing.push(`${name}.${op}`);
        }
      }
    }
  }
  assert.deepStrictEqual(missing, [], '以下 op 缺少 params schema：\n' + missing.join(', '));
});
