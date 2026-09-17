// tools/check-syntax.js —— 递归校验所有 .js 的语法（仅解析，不执行）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const roots = ['miniprogram', 'cloudfunctions', '__tests__', 'tools'];
const skipDirs = new Set(['node_modules', '.git']);
let errors = 0, count = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (skipDirs.has(name)) continue;
      walk(full);
    } else if (name.endsWith('.js')) {
      count++;
      const code = fs.readFileSync(full, 'utf8');
      try {
        new vm.Script(code, { filename: full });
      } catch (e) {
        errors++;
        console.error('✗ 语法错误', path.relative(process.cwd(), full));
        console.error('  ' + e.message.split('\n')[0]);
      }
    }
  }
}

roots.forEach((r) => { if (fs.existsSync(r)) walk(r); });
console.log(`\n检查完成：${count} 个文件，${errors} 个语法错误。`);
process.exit(errors ? 1 : 0);
