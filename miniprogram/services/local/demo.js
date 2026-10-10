// services/local/demo.js —— 本地兜底层：演示辅助（D3 拆分）
const { s, ok } = require('./store');

// ============ 演示辅助 ============

async function resetAll() {
  Object.keys(s.KEYS).forEach(k => {
    if (k === 'privacy') return;
    s.remove(s.KEYS[k]);
  });
  return ok({});
}

module.exports = { resetAll };
