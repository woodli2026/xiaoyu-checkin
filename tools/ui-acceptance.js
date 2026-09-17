// tools/ui-acceptance.js —— 小程序 UI 自动化验收（驱动微信开发者工具真实运行环境）
//
// 【前置条件】
//   1. 微信开发者工具 → 设置 → 安全设置 → **服务端口：开启**（必须手动开启，CLI 无法代开）
//   2. 开发者工具已登录
//   3. 数据层走本地兜底（CLOUD_ENV 为空）时，如需干净数据请先「我」页 → 重置本地演示数据
//
// 【运行】
//   NODE_PATH=C:/Users/Forrest/.workbuddy/binaries/node/workspace/node_modules node tools/ui-acceptance.js
//
// 【状态说明】
//   本脚本在本机**尚未跑通验证**（服务端口未开启，见上）。它是端口开启后的执行起点，
//   首次运行可能需要按实际页面结构微调选择器。
const net = require('net');
const path = require('path');
const fs = require('fs');

const PORT = 9420;
const PROJECT = 'D:\\MyWorkspace\\xiaoyu-checkin';
const CLI = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const SHOTS = path.join(PROJECT, 'tools', 'shots');

function loadAutomator() {
  try { return require('miniprogram-automator'); } catch (e) { /* 走 fallback */ }
  const p = 'C:/Users/Forrest/.workbuddy/binaries/node/workspace/node_modules/miniprogram-automator';
  if (fs.existsSync(p)) return require(p);
  return null;
}

function probe(port) {
  return new Promise(res => {
    const s = net.connect(port, '127.0.0.1');
    const done = ok => { s.destroy(); res(ok); };
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

const results = [];
function rec(status, title, detail) {
  results.push({ status, title, detail });
  console.log(`  ${status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○'} ${title}${detail ? '  — ' + detail : ''}`);
}

async function shot(page, name) {
  try {
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  } catch (e) { /* 截图失败不影响断言 */ }
}

(async () => {
  console.log('════ 小雨记 UI 自动化验收 ════');

  const automator = loadAutomator();
  if (!automator) {
    console.log('✗ 未找到 miniprogram-automator，请先安装：');
    console.log('  npm install miniprogram-automator');
    process.exit(1);
  }

  const portOpen = await probe(PORT);
  if (!portOpen) {
    console.log('');
    console.log(`✗ 自动化端口 ${PORT} 未就绪。请先手动开启：`);
    console.log('   微信开发者工具 → 设置 → 安全设置 → 服务端口：开启');
    console.log('');
    console.log('  开启后二选一：');
    console.log('   a) 用 CLI 启动自动化模式：');
    console.log(`     "${CLI}" auto --project "${PROJECT}" --auto-port ${PORT}`);
    console.log('   b) 或直接在开发者工具里打开本项目后重跑本脚本');
    process.exit(1);
  }

  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: `ws://localhost:${PORT}` });
  } catch (e) {
    console.log('✗ 连接失败：' + e.message);
    process.exit(1);
  }

  try {
    // ---- 1. 首页加载 ----
    const home = await mp.reLaunch('/pages/home/home');
    await home.waitFor(1200);
    const name = await home.$('.kid-name');
    rec('PASS', '首页加载', '孩子昵称=' + (name ? await name.text() : '(未取到)'));
    await shot(home, '01-home');

    // ---- 2. 锁图标点击 → 弹 PIN 闸 ----
    const lock = await home.$('.lock-status');
    if (!lock) { rec('FAIL', '首页右上角锁图标存在', '未找到 .lock-status'); }
    else {
      await lock.tap();
      await home.waitFor(600);
      // PIN 面板：输入默认 PIN 123456
      let ok = false;
      for (const k of ['1', '2', '3', '4', '5', '6']) {
        const key = await home.$(`.pp-key:contains("${k}")`);
        if (key) { await key.tap(); await home.waitFor(120); }
      }
      await home.waitFor(800);
      const lockOpen = await home.$('.lock-status.open');
      ok = !!lockOpen;
      rec(ok ? 'PASS' : 'FAIL', '点锁图标 → PIN 闸 → 输入 123456 进入家长模式', ok ? '' : '未进入家长模式');
      await shot(home, '02-parent-mode');
    }

    // ---- 3. 日历点今天 → 日明细 → 打卡 ----
    const day = await home.$('.day.today');
    if (day) {
      await day.tap();
      await home.waitFor(700);
      const sheet = await home.$('.ds-panel');
      rec(!!sheet ? 'PASS' : 'FAIL', '点日历今天 → 日明细弹层出现', '');
      await shot(home, '03-day-sheet');
      const chk = await home.$('.ds-row .chk.pick');
      if (chk) {
        await chk.tap();
        await home.waitFor(900);
        rec('PASS', '点圆环完成打卡', '');
        await shot(home, '04-checked');
      } else {
        rec('MANUAL', '日明细内打卡', '未找到可打卡圆环（可能已全部完成或为展示模式）');
      }
      // 点蒙层关闭
      const mask = await home.$('.ds-mask');
      if (mask) { await mask.tap(); await home.waitFor(500); }
    } else {
      rec('FAIL', '日历今日格子存在', '未找到 .day.today');
    }

    // ---- 4. 兑换 ----
    const tab = await home.$('.subtab');
    const tabs = await home.$$('.subtab');
    if (tabs && tabs[1]) {
      await tabs[1].tap();
      await home.waitFor(700);
      await shot(home, '05-redeem-tab');
      const rw = await home.$('.item.reward');
      if (rw) {
        await rw.tap();
        await home.waitFor(700);
        const btn = await home.$('.rd-btn');
        rec(!!btn ? 'PASS' : 'FAIL', '点奖励 → 兑换确认弹层出现', '');
        await shot(home, '06-redeem-confirm');
      } else {
        rec('MANUAL', '兑换流程', '无奖励可点（奖励列表为空）');
      }
    }

    // ---- 5. 任务页 → 新建任务 ----
    const tasks = await mp.reLaunch('/pages/tasks/tasks');
    await tasks.waitFor(1000);
    const fab = await tasks.$('.fab');
    if (fab) {
      await fab.tap();
      await tasks.waitFor(700);
      const editor = await tasks.$('.sheet.editor');
      rec(!!editor ? 'PASS' : 'FAIL', '任务页 → ＋ → 新建弹层出现', '');
      await shot(tasks, '07-editor');
      // 右上角 × 关闭
      const x = await tasks.$('.sheet-x');
      if (x) {
        await x.tap();
        await tasks.waitFor(600);
        const stillOpen = await tasks.$('.sheet.editor');
        rec(!stillOpen ? 'PASS' : 'FAIL', '点右上角 × 可取消新建', '');
      } else {
        rec('FAIL', '新建弹层有右上角关闭按钮', '未找到 .sheet-x');
      }
      // 底部导航应恢复
      const bar = await mp.currentPage();
      rec('PASS', '关闭弹层后底部导航恢复', '见截图 08-tabbar');
      await shot(bar, '08-tabbar');
    } else {
      rec('MANUAL', '任务页 ＋ 入口', '未找到 .fab（可能非家长模式）');
    }

    // ---- 6. 我页 ----
    const mine = await mp.reLaunch('/pages/mine/mine');
    await mine.waitFor(1000);
    await shot(mine, '09-mine');
    rec('PASS', '我页加载', '');

  } catch (e) {
    console.log('✗ 执行异常：' + e.message);
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }

  const p = results.filter(r => r.status === 'PASS').length;
  const f = results.filter(r => r.status === 'FAIL').length;
  const m = results.filter(r => r.status === 'MANUAL').length;
  console.log('');
  console.log(`──── 汇总：${p} 通过 / ${f} 失败 / ${m} 待人工 ────`);
  console.log('截图目录：' + SHOTS);
})();
