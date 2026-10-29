// services/local/backup.js —— 本地版数据导出 / 备份（v1.0-local 新增）
//
// 仅本地模式可用（云端模式下数据在云，导出是另一回事）。把 wx.storage 中
// 的全部用户数据打包成 JSON 文件，经微信文件能力（分享 / 保存）交到用户手里，
// 用于换机 / 清缓存前的本地备份。
//
// 设计要点（与项目契约一致）：
//   · 纯逻辑（collectData / buildPayload / validatePayload）与微信 API（exportBackup）分离，
//     前者可单测，后者只在真机 / 工具里跑。
//   · 排除临时会话令牌 xy_parent_token（KEYS.token）；其余数据键全量导出。
//   · 备份文件不依赖云端，是「重置本地演示数据」后唯一的恢复手段。
//   · 注册为本地独占 op（ops.js 标 'local'），页面统一经 utils/api.callApi 调用。
const s = require('../../utils/storage');

// 备份包含的数据键（排除临时会话令牌 token）
const DATA_KEYS = [
  'user', 'children', 'childId', 'tasks', 'rewards',
  'checkIns', 'redemptions', 'pointsLog', 'pets',
  'startInParent', 'seq'
];

// 备份格式版本：未来导入按此校验；如有破坏性改动须递增
const BACKUP_VERSION = 1;

// 必须是数组的数据键（恢复前做轻量形状校验，防损坏文件写坏存储）
const ARRAY_KEYS = ['children', 'tasks', 'rewards', 'checkIns', 'redemptions', 'pointsLog', 'pets'];

// 恢复失败的用户可读提示（code → message）
const RESTORE_ERR = {
  BAD_JSON: '文件不是有效的 JSON',
  NOT_XY_BACKUP: '不是雨宝记的备份文件',
  VERSION_UNSUPPORTED: '备份版本不受支持，请先升级小程序',
  NO_DATA: '备份文件缺少数据',
  BAD_SHAPE: '备份文件数据结构异常'
};

// 错误语义分类（**单一来源**）：把数据层错误码映射为页面可分支的语义类别，
// 页面只认 kind，不再硬编码数据层码，消除「页面枚举错误码」的浅 seam。
//   cancelled —— 用户主动取消，静默返回
//   retryable —— 环境 / 选择器瞬时故障，toast 后可重试
//   blocked   —— 平台配置缺失（如隐私未声明），需引导去后台
//   invalid   —— 备份文件本身问题（非 JSON / 非本应用 / 版本 / 结构）
const ERROR_KIND = {
  CANCELLED: 'cancelled',
  NO_PICK_API: 'retryable',
  READ_FAIL: 'retryable',
  PICK_FAIL: 'retryable',
  PRIVACY_FAIL: 'blocked',
  BAD_JSON: 'invalid',
  NOT_XY_BACKUP: 'invalid',
  VERSION_UNSUPPORTED: 'invalid',
  NO_DATA: 'invalid',
  BAD_SHAPE: 'invalid',
  // 导出链路错误码（与恢复共用分类契约，未来页面可按 kind 分支）
  NO_FS: 'blocked',
  WRITE_FAIL: 'invalid',
  DELIVER_FAIL: 'retryable',
  NO_DELIVER_API: 'blocked'
};

// 构造统一失败结果 { ok:false, code, kind, message }（纯函数，可单测）。
// message 优先级：显式传入 > 校验类诊断（含文件开头预览 / 长度）> RESTORE_ERR 兜底。
function fail(code, extra) {
  extra = extra || {};
  let message = extra.message;
  if (message == null) {
    message = (extra.preview != null || extra.len != null)
      ? restoreErrorMessage({ code, preview: extra.preview, len: extra.len })
      : (RESTORE_ERR[code] || '备份文件无效');
  }
  return { ok: false, code, kind: ERROR_KIND[code] || 'invalid', message };
}

// 收集全部用户数据（纯函数）。返回 { data, counts }
function collectData() {
  const data = {};
  const counts = {};
  for (const key of DATA_KEYS) {
    const val = s.read(s.KEYS[key], null);
    data[key] = val;
    if (Array.isArray(val)) counts[key] = val.length;
    else if (val !== null && val !== undefined) counts[key] = 1;
  }
  return { data, counts };
}

// 组装可序列化的备份对象 + 元数据（纯函数，返回 JSON 字符串）
function buildPayload(opts) {
  opts = opts || {};
  const { data, counts } = collectData();
  const payload = {
    app: '雨宝记',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: opts.appVersion || '',
    counts,
    data
  };
  return JSON.stringify(payload, null, 2);
}

// 校验失败时的用户可读提示，含可选「文件开头预览」（用于判断选错文件还是文件损坏）
function restoreErrorMessage(v) {
  const base = RESTORE_ERR[v.code] || '备份文件无效';
  const extra = [];
  if (v.preview) extra.push('开头「' + v.preview + '」');
  if (v.len != null) extra.push('长度 ' + v.len + ' 字符');
  return extra.length ? `${base}（${extra.join('，')}）` : base;
}

// 校验备份 JSON（导出与恢复共用）
function validatePayload(json) {
  let raw = json;
  if (typeof raw !== 'string') raw = raw == null ? '' : String(raw);
  // 微信「分享 → 回选」链路在部分平台会给文件加 BOM（字节序标记 \uFEFF），
  // JSON.parse 无法容忍开头的 \uFEFF，会抛 “Unexpected token”。先剥离。
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  if (!raw.trim()) return { ok: false, code: 'BAD_JSON', len: raw.length };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e1) {
    // 兜底：跳过开头非 JSON 结构的杂字符（如某些平台在文件头追加的标记），从首个 { 或 [ 起解析，
    // 能救回「文件头被追加了几个字节」这类情况；仍失败则进入诊断分支。
    const i = Math.min(
      raw.indexOf('{') >= 0 ? raw.indexOf('{') : Infinity,
      raw.indexOf('[') >= 0 ? raw.indexOf('[') : Infinity
    );
    if (i > 0 && i !== Infinity) {
      try { obj = JSON.parse(raw.slice(i)); } catch (e2) { obj = null; }
    }
  }
  if (!obj) {
    // 解析失败：截取文件开头用于诊断（最多 60 字符、压缩空白），帮助用户判断选错文件还是文件损坏
    const preview = raw.slice(0, 60).replace(/\s+/g, ' ').trim();
    return { ok: false, code: 'BAD_JSON', preview, len: raw.length };
  }
  if (!obj || obj.app !== '雨宝记') return { ok: false, code: 'NOT_XY_BACKUP' };
  if (obj.backupVersion !== BACKUP_VERSION) return { ok: false, code: 'VERSION_UNSUPPORTED' };
  if (!obj.data) return { ok: false, code: 'NO_DATA' };
  // 轻量形状校验：数组键必须是数组（防损坏文件写坏存储）
  for (const k of ARRAY_KEYS) {
    const v = obj.data[k];
    if (v !== undefined && v !== null && !Array.isArray(v)) return { ok: false, code: 'BAD_SHAPE' };
  }
  return { ok: true, payload: obj };
}

// ============ 恢复（导入） ============

// 第一步：选文件 + 读取 + 校验（**不写入**，供页面弹摘要二次确认）
// 文件来源 = 聊天（导出时发到「文件传输助手」的那份），与导出链路闭环。
function pickBackup() {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || typeof wx.chooseMessageFile !== 'function') {
      resolve(fail('NO_PICK_API', { message: '当前环境不支持选择文件' }));
      return;
    }
    const doPick = () => {
      // 不用 extension 过滤（部分安卓机表现异常），选回什么由 validatePayload 把关
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          if (!f) { resolve(fail('CANCELLED')); return; }
          let json;
          try {
            json = wx.getFileSystemManager().readFileSync(f.path, 'utf8');
          } catch (e) {
            resolve(fail('READ_FAIL', { message: '读取文件失败' }));
            return;
          }
          const v = validatePayload(json);
          if (!v.ok) {
            // 诊断：把读到的原始内容前 200 字符打到控制台，便于在开发者工具 / 真机 vConsole 定位「到底读到了什么」
            console.info('[backup] import parse fail:', v.code, 'len=', json && json.length,
              'head=', String(json).slice(0, 200));
            resolve(fail(v.code, { preview: v.preview, len: v.len }));
            return;
          }
          resolve({
            ok: true,
            json,
            exportedAt: v.payload.exportedAt || '',
            backupVersion: v.payload.backupVersion,
            counts: v.payload.counts || {}
          });
        },
        fail: (err) => {
          // 只把「用户主动取消」当静默；真实失败必须带上 errMsg 浮出水面，否则就是“点了没反应”
          const msg = (err && err.errMsg) || '';
          if (/cancel/i.test(msg)) {
            resolve(fail('CANCELLED'));
          } else {
            console.info('[backup] chooseMessageFile fail:', msg);
            resolve(fail('PICK_FAIL', { message: '打开文件选择器失败：' + (msg || '未知原因') }));
          }
        }
      });
    };
    // chooseMessageFile 自基础库 2.33.0 起为隐私接口：须先经隐私授权（同意《用户隐私保护指引》的
    // 「选中的文件」类型）。复用全局 onNeedPrivacyAuthorization → privacy-sheet 闸门（与 child-photo 同款）。
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({
        success: doPick,
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          if (/cancel/i.test(msg)) { resolve(fail('CANCELLED')); return; }
          console.info('[backup] requirePrivacyAuthorize fail:', msg);
          const notDeclared = /112|not declared|隐私|privacy/i.test(msg);
          resolve(fail('PRIVACY_FAIL', {
            message: notDeclared
              ? '小程序后台《用户隐私保护指引》需补充声明「选中的文件」类型后才能选择备份文件'
              : '隐私授权未通过：' + msg
          }));
        }
      });
      return;
    }
    doPick();   // 旧基础库无隐私机制，直接选
  });
}

// 第二步：校验后把备份写入存储（覆盖式恢复，页面须先二次确认）
// 只写 DATA_KEYS（会话令牌本就不在导出范围内，不会复活旧登录态）。
// ⚠️ 调用约定：callApi 的本地路由是 local[name](params)，页面传 { json: '<字符串>' } 包装对象；
// 而单测直接传 JSON 字符串。此处对两种形状做兼容解包（其余 op 无此问题，因其参数本身就是对象）。
function restoreFromJson(params) {
  const json = (params && typeof params === 'object' && params.json !== undefined) ? params.json : params;
  const v = validatePayload(json);
  if (!v.ok) return fail(v.code, { preview: v.preview, len: v.len });
  const data = v.payload.data;
  for (const key of DATA_KEYS) {
    if (data[key] !== undefined) s.write(s.KEYS[key], data[key]);
  }
  return { ok: true, counts: collectData().counts, exportedAt: v.payload.exportedAt };
}

// 时间戳文件名：YYYYMMDD_HHmmss
function formatStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 微信侧：写文件 + 分享 / 保存（依赖 wx API，单测里 mock）
async function exportBackup(opts) {
  opts = opts || {};
  const json = buildPayload({ appVersion: opts.appVersion });
  const fs = (typeof wx !== 'undefined' && wx.getFileSystemManager) ? wx.getFileSystemManager() : null;
  if (!fs) return fail('NO_FS', { message: '当前环境不支持文件操作' });
  const stamp = formatStamp(new Date());
  const fileName = `雨宝记数据备份_${stamp}.json`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  try {
    fs.writeFileSync(filePath, json, 'utf8');
  } catch (e) {
    return fail('WRITE_FAIL', { message: (e && e.message) || '写入文件失败' });
  }
  return deliverFile(filePath, fileName);
}

// 优先分享到聊天（移动端最稳的出文件方式，可发到「文件传输助手」留存），失败退保存到本地
function deliverFile(filePath, fileName) {
  return new Promise((resolve) => {
    if (typeof wx !== 'undefined' && typeof wx.shareFileMessage === 'function') {
      wx.shareFileMessage({
        filePath,
        fileName,
        success: () => resolve({ ok: true, filePath, fileName }),
        fail: () => fallbackSave(filePath, resolve)
      });
    } else {
      fallbackSave(filePath, resolve);
    }
  });
}

function fallbackSave(filePath, resolve) {
  if (typeof wx !== 'undefined' && typeof wx.saveFileToDisk === 'function') {
    wx.saveFileToDisk({
      filePath,
      success: () => resolve({ ok: true, filePath }),
      fail: () => resolve(fail('DELIVER_FAIL', { message: '无法分享或保存文件' }))
    });
  } else {
    resolve(fail('NO_DELIVER_API', { message: '当前环境不支持导出文件' }));
  }
}

module.exports = {
  DATA_KEYS, BACKUP_VERSION, ARRAY_KEYS, RESTORE_ERR, ERROR_KIND,
  collectData, buildPayload, validatePayload, exportBackup,
  pickBackup, restoreFromJson, fail,
  formatStamp
};
