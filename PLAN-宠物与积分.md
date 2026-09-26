# 小雨记 · 宠物 + 打卡积分统计 设计文档（第二阶段 / 非 MVP）

> 文档版本：v0.1
> 编写日期：2026-09-18
> 依据：PRD §6（第二阶段）、2026-09-18 grill 收口决策、`PLAN-小雨记-详细计划.md` / `PLAN-小雨记-MVP实施计划.md` 工程约定
> 定位：本模块实现基线。MVP 已完成核心闭环 + 动态 + R10，本模块在其上叠加；不进入 MVP 验收（§4）。
> 落地节奏：**v1.0 仅本地层（wx.storage）跑通**，云函数 `petCRUD` / `pointsStats` 顺延 v1.1（同既有 B1–B5 模式）。

---

## 1. 目标与范围

两项新功能，均面向宝宝视角，与现有功能无缝衔接：

1. **打卡积分统计**：以宝宝视角呈现「星星余额 + 获取/消耗明细 + 日/周/月统计」。基于 MVP 已有的 `pointsLog` 星星账本，主要是重新呈现 + 补聚合与图表。
2. **电子宠物**：宝宝领养一只 emoji 宠物、命名、投喂（消耗星星→成长值）、按成长值分 5 阶段呈现不同外观与互动。

**联动**：打卡产出星星（既有）→ 投喂消耗星星（新增）→ 宠物成长。两项共用一套「星星」货币。

**范围边界（grill 收口）**：
- 不引入第二套货币；投喂只是 `pointsLog` 一条 `refType='pet_feed'` 的支出。
- 宠物事件**不进动态页**（动态保持纯打卡/兑换）。
- 统计从简：**无同比/环比**，无连续天数报表（连续天数已在首页/宠物顶卡）。
- 新增第 5 个 tab「宠物」（置于「我」之前）。

---

## 2. 既有约束（必须继承，不可破坏）

| 项 | 约定 | 出处 |
|---|---|---|
| 数据自动路由 | 页面只调 `utils/api.callApi(name, params)`；`config.CLOUD_ENV` 空 → `services/local.js`，非空 → 云函数。新增操作须成对实现（本地 + 云端）。 | api.js / MEMORY |
| 契约 | 返回 `{ok:true,...}` 或 `{ok:false,code,message}`；`callApi` 对 `ok:false` 抛 `err.code`。 | api.js |
| 星星账本 | `pointsLog` 字段 `{_id, childId, delta, reason, refType, refId, createdAt}`；`child.totalStars` 为余额真源。 | local.js checkIn/redeem |
| 双份一致性 | 本地实现与云函数逐字段一致；由守卫测试防漂移。 | MEMORY 规则 |
| 底部导航 | 自定义 tabBar；新增 tab 须同步 4 处（app.json pages+tabBar.list、custom-tab-bar list、各页 onShow selected）。 | MEMORY 规则 7/12 |
| 弹层 | 全屏弹层须隐藏 tabBar；`.mask bindtap` 关闭、`.sheet catchtap noop`；`input` 显式 `height:88rpx`。 | MEMORY 规则 8/11 |
| 受控刷新 | 动画切换用递增计数触发，不用「值是否变化」observer。 | MEMORY 规则 11 |
| 视觉基线 | `design-小雨记-UI.html` 糖果调色板（天蓝/薄荷/蜜桃/暖阳/星星金/珊瑚/薰衣草），CSS 变量驱动。 | PRD §1.5 决议 5 |
| 模式 | R10：启动即家长模式 + 15 分钟空闲回展示模式；危险操作须家长令牌。 | PRD §5 |

---

## 3. 数据模型

### 3.1 宠物存储（新增）
- 本地键：`xy_pets`（加到 `utils/storage.js` 的 `KEYS`）。
- 云端集合：`pets`（v1.1）。
- 结构（每宝宝至多一条；未领养则该 `childId` 无记录）：
```js
{
  _id: 'pet_...',          // 本地自增 ID
  ownerId: 'u_...',        // 账号 OPENID/本地 ID
  childId: 'c_...',        // 归属宝宝（per-child）
  species: 'cat',          // 候选 key，见 §3.3
  name: '小猫',            // ≤8 字符，必填
  growthValue: 0,          // 成长值（投喂 +10/次），stage 由其派生
  mood: 80,                 // 心情 0–100（MVP 唯一状态），领养初始 80
  lastMoodAt: null,         // 最近一次改变心情的时间戳（用于按真实时间衰减）
  adoptedAt: 1700000000000,
  lastFedAt: null,          // 最近投喂时间戳
  createdAt: 1700000000000
}
```
- **stage 不入库**，由 `growthValue` 派生（防双份漂移）。派生逻辑集中于 `utils/pets.js`。

### 3.2 积分账本扩展（复用现有 `pointsLog`）
投喂在 `pointsLog` 追加一条：
```js
{ _id, childId, delta: -FEED_COST, reason: '投喂:' + name, refType: 'pet_feed', refId: petId, createdAt }
```
- 既有 `refType` 值：`checkin`（打卡+）、`redeem`（兑换−）、`checkin_undo` / `redeem_undo`（反向审计）。新增 `pet_feed`。
- 余额趋势（图表A）由 `pointsLog` 全量流水重建累计余额。

### 3.3 宠物候选与阶段配置（集中在 `utils/pets.js`）
```js
// MVP 候选：猫 / 狗 两种；新增动物（蜥蜴/蛇/蜘蛛/熊猫/老虎/恐龙…）只加一条不改结构
const SPECIES = [
  { key:'cat', emoji:'🐱', defName:'小猫' },
  { key:'dog', emoji:'🐶', defName:'小狗' },
];

const PET_FEED_COST = 5;        // 星星/次（镜像到云端 cloudfunctions/lib 同名常量，由守卫测试比对）
const PET_GROWTH_PER_FEED = 10; // 成长值/次
const PET_MOOD_INIT = 80;       // 领养初始心情
const MOOD_PER_FEED = 8;        // 喂食提升心情
const MOOD_PER_STROKE = 6;      // 抚摸提升心情
const MOOD_MAX = 100;
const MOOD_DECAY_PER_MIN = 0.05; // 久不互动衰减：约每 20 分钟 −1（读取时按真实时间计算）

// 5 阶段（由 growthValue 派生）
const STAGES = [
  { stage:1, name:'蛋蛋',     min:0,   max:29,  emoji:'🥚', props:[] },
  { stage:2, name:'破壳幼崽', min:30,  max:79,  emoji:null /*用物种 emoji 小号*/, props:[] },
  { stage:3, name:'成长体',   min:80,  max:159, emoji:null, props:['halo'] },
  { stage:4, name:'成年体',   min:160, max:299, emoji:null, props:['scarf'] },
  { stage:5, name:'传奇伙伴', min:300, max:Infinity, emoji:null, props:['crown'] },
];

// 派生：返回 { stage, name, emoji, props, feedCount }
function stageInfo(growthValue, speciesKey) {
  const sp = SPECIES.find(s => s.key === speciesKey) || SPECIES[0];
  const st = STAGES.find(s => growthValue >= s.min && growthValue <= s.max) || STAGES[STAGES.length-1];
  return {
    stage: st.stage,
    name: st.name,
    emoji: st.emoji || sp.emoji,      // 蛋阶段用 🥚，其余用物种 emoji
    props: st.props,
    feedCount: growthValue / PET_GROWTH_PER_FEED
  };
}

// 命名校验：≤8 字符、非空、去空格
function isValidPetName(name) {
  const n = String(name == null ? '' : name).trim();
  return n.length > 0 && n.length <= 8;
}
```
- 阶段外观差异（前端）：蛋=🥚；破壳=物种 emoji 小号；成长=物种 emoji + ✨光环；成年=物种 emoji + SVG 围巾；传奇=物种 emoji + 👑皇冠 SVG + 旋转发光 + 点击彩蛋。
- 蛋→破壳（growthValue 跨 29→30）为「孵化」节点，宠物页「成长日记」记一条里程碑（不写 `pointsLog`、不进动态页）。

---

## 4. 接口契约

### 4.1 路由
页面统一调 `api.callApi(name, params)`。新增一个 name：`petCRUD`（积分子页已取消，`pointsStats` 不做）。
- 本地层：`miniprogram/services/local.js` 实现并挂到 `module.exports`。
- 云端层（v1.1 已同步实现）：`cloudfunctions/petCRUD`，复用 `cloudfunctions/lib/pets.js`（与 `miniprogram/utils/pets.js` 双份，由单测守卫一致）。

### 4.2 `petCRUD({ op, childId, parentToken, payload })`
> **实施定稿（2026-09-18）**：权限与返回以代码为准 —— 投喂消耗星星故需家长令牌；抚摸是免费互动、免令牌（孩子也能玩）。

| op | 权限 | 入参(payload) | 行为 | 返回 |
|---|---|---|---|---|
| `info` | 只读（**免令牌**） | — | 返回该 childId 宠物视图（读取前先 `applyMoodDecay`；视图内含派生 `stage/stageName/emoji/mood/stats`）；未领养返回 `{ pet:null }`。 | `{ pet\|null }` |
| `adopt` | **需家长令牌** | `{ species, name }` | 校验物种（MVP 仅 cat/dog）与 name（≤8 非空；不传则用物种默认名）；每 childId 至多一只，已领养返回 `ALREADY_HAS_PET`；建 `xy_pets` 记录（`growthValue:0, mood:MOOD_INIT, lastMoodAt:now, daily:{}, released:false`）。 | `{ pet }` |
| `feed` | **需家长令牌** | — | 校验宠物存在、`child.totalStars ≥ PET_FEED_COST`（不足 `INSUFFICIENT`）；扣星 + `growthValue+=10` + `feedCount++` + 写 `pet_feed` 流水 + `daily[今天].feed++` + 提升心情（先衰减再 `+MOOD_PER_FEED`）。 | `{ pet, totalStars }` |
| `stroke` | **免令牌**（免费互动） | — | 抚摸：不消耗星星、不写流水；`strokeCount++`、`daily[今天].stroke++`、心情先衰减再 `+MOOD_PER_STROKE`（上限 `MOOD_MAX`），更新 `lastMoodAt`。 | `{ pet }` |
| `rename` | **需家长令牌** | `{ name }` | 校验 name（≤8 非空）；更新 `name`。 | `{ pet }` |
| `reset` | **需家长令牌** | — | 保留宠物（名字/物种不变），`growthValue=0`、心情回 `MOOD_INIT`、`feedCount/strokeCount=0`、`daily={}`（回到蛋）。 | `{ pet }` |
| `release` | **需家长令牌** | — | **软删**（`released:true` + `releasedAt`）：成长历史保留，可重新领养一只新的。 | `{ id }` |

错误码：`TOKEN_INVALID` / `FORBIDDEN`（非本人宝宝）/ `INVALID`（物种或名字非法、未知 op）/ `PET_NOT_FOUND` / `ALREADY_HAS_PET` / `INSUFFICIENT`。

**权限分支（本地层实现要点）**：
```js
// 投喂要花星星 → 与 redeem 同口径需家长令牌；抚摸免费 → 免令牌，孩子也能玩
const NEED_TOKEN = new Set(['adopt', 'feed', 'rename', 'reset', 'release']);
if (NEED_TOKEN.has(op) && !verifyLocalToken(parentToken)) {
  return fail('TOKEN_INVALID', '家长模式已失效，请重新解锁');
}
// info / stroke 不调 verifyLocalToken
```

**`feed` 扣星 + 心情（本地同步双写）**：
```js
const child = children.find(c => c._id === childId);
if ((child.totalStars||0) < PET_FEED_COST) return fail('INSUFFICIENT', '星星不够啦');
const before = pet.growthValue||0;
child.totalStars -= PET_FEED_COST;
pet.growthValue = before + PET_GROWTH_PER_FEED;
pet.lastFedAt = Date.now();
pet.mood = clampMood(applyMoodDecay(pet) + MOOD_PER_FEED);  // 先按真实时间衰减，再 +喂食
pet.lastMoodAt = Date.now();
saveChildren(children); savePets(pets);
const pts = allPoints();
pts.push({ _id: s.nextId('p'), childId, delta:-PET_FEED_COST,
  reason:'投喂:'+pet.name, refType:'pet_feed', refId: pet._id, createdAt: Date.now() });
savePoints(pts);
const isHatch = before < 30 && pet.growthValue >= 30;   // 跨入破壳
```
// 心情按真实时间衰减：每次读取/交互前调用，使"久不互动缓慢下降"实时生效
```js
function applyMoodDecay(pet) {
  if (!pet.lastMoodAt) return pet.mood || PET_MOOD_INIT;
  const mins = (Date.now() - pet.lastMoodAt) / 60000;
  return Math.max(0, (pet.mood || PET_MOOD_INIT) - mins * MOOD_DECAY_PER_MIN);
}
function clampMood(v) { return Math.max(0, Math.min(MOOD_MAX, Math.round(v))); }
```
`stroke` 同理：不扣星，仅 `pet.mood = clampMood(applyMoodDecay(pet) + MOOD_PER_STROKE)` 并更新 `lastMoodAt`。`info` / 宠物页渲染前也先 `applyMoodDecay` 再展示。

### 4.3 `pointsStats({ childId, range })`
- `range`：`{ type:'day'|'week'|'month', ref: 'YYYY-MM-DD' }`（`ref` 为锚定日期，派生窗口）。
- 纯计算在 `utils/pointsStats.js`，本地层 `pointsStats()` 封装：拉 `allPoints()` + `allCheckIns()`（投喂次数柱用 `pet_feed` 计数），调用纯函数。
- 返回（从简、无同比环比）：
```js
{
  balance: Number,                 // 当前真实总余额 = 所有 pointsLog delta 之和（含兑换）
  gain: Number,                    // 本期打卡得星（checkin 正向和）
  spendFeed: Number,               // 本期投喂耗星（pet_feed 负向和，正值）
  spendRedeem: Number,             // 本期兑换耗星（redeem 负向和，正值）
  spendTotal: Number,              // = spendFeed + spendRedeem
  balanceSeries: [{ date:'YYYY-MM-DD', balance:Number }],  // 图表A：真实总余额逐日（窗口内）
  feedCountSeries: [{ date:'YYYY-MM-DD', count:Number }],  // 图表B：投喂次数按日
  items: [{ date, kind:'checkin'|'pet_feed'|'redeem', title, delta, createdAt }]  // 明细（窗口内，按日筛选）
}
```
- **口径**：顶部「消耗」= `spendFeed + spendRedeem`；图表A = 真实总余额（`balanceSeries` 由全量 `pointsLog` 累计重建，含兑换影响）；两者自洽、互相咬合。

---

## 5. 积分统计纯函数（utils/pointsStats.js）

无 IO、纯函数，本地层 / 页面 / 测试 / 云端 v1.1 共用，单一真相源。

```js
// 由锚定日期派生窗口 [startMs, endMs)
function rangeWindow(range) {
  const d = new Date(range.ref + 'T00:00:00');
  if (range.type === 'day')  { const s=startOfDay(d); return [s, s+864e5]; }
  if (range.type === 'week') { const s=startOfWeek(d); return [s, s+7*864e5]; } // 周一~周日
  if (range.type === 'month'){ const s=startOfMonth(d); const e=startOfMonth(addMonth(d,1)); return [s,e]; }
}

// 核心：输入全量 pointsLog + range，输出 §4.3 结构
function computeStats(pointsLog, range) {
  const [start, end] = rangeWindow(range);
  const inWin = pointsLog.filter(p => p.createdAt >= start && p.createdAt < end);
  let gain=0, spendFeed=0, spendRedeem=0;
  inWin.forEach(p => {
    if (p.refType === 'checkin') gain += Math.max(0, p.delta||0);
    else if (p.refType === 'pet_feed') spendFeed += Math.max(0, -(p.delta||0));
    else if (p.refType === 'redeem') spendRedeem += Math.max(0, -(p.delta||0));
  });
  // 余额趋势：全量累计，取窗口内每日末值
  const ordered = pointsLog.slice().sort((a,b)=>a.createdAt-b.createdAt);
  let running=0; const byDay={};
  ordered.forEach(p => { running += (p.delta||0); byDay[startOfDay(new Date(p.createdAt))] = running; });
  const balanceSeries = eachDay(start,end).map(date => ({ date, balance: byDay[date] ?? lastKnown(byDay,date) }));
  // 投喂次数按日
  const feedMap={}; inWin.filter(p=>p.refType==='pet_feed').forEach(p=>{ const k=startOfDay(new Date(p.createdAt)); feedMap[k]=(feedMap[k]||0)+1; });
  const feedCountSeries = eachDay(start,end).map(date => ({ date, count: feedMap[date]||0 }));
  // 明细
  const items = inWin.map(p => ({ date: startOfDay(new Date(p.createdAt)), kind: kindOf(p.refType), title: titleOf(p), delta: p.delta, createdAt: p.createdAt }))
                      .sort((a,b)=>b.createdAt-a.createdAt);
  return { balance: running, gain, spendFeed, spendRedeem, spendTotal: spendFeed+spendRedeem,
           balanceSeries, feedCountSeries, items };
}
```
- 单元测试覆盖：空账本、`range` 三型、跨日/跨周/跨月边界、孵化前后 growthValue 不影响统计（统计只看 pointsLog）。

---

## 6. UI 线框（糖果调色板，童趣友好）

> 详细高保真原型由 `frontend-design` 逐页产出并确认（见 §9 工作流）。此处给结构与字段基线。

### 6.1 宠物 tab（pages/pet）
```
┌─────────────────────────────┐
│ [🐱] 小猫              ✏️ │ ← 顶部宠物信息条（参考首页 kidbar）：头像+宠物名称
│      成长体 · Lv.3        │    下一行级别；右侧编辑按钮改名（未领养→领养）
├─────────────────────────────┤
│  ⭐ 28 颗星星                │
│  🔥 6 天连续互动 ›           │ ← 连续互动胶囊（首页同款白底橙字药丸，🔥闪动）；点击→互动统计报表
├─────────────────────────────┤
│     🐱  (CSS 弹跳/摇摆)      │ ← 仅 Emoji 主体 + 阶段配饰（halo/scarf/crown SVG）
├─────────────────────────────┤
│  (🍼投喂) (✋抚摸)           │ ← 技能按钮**置于头像框内底部中间**
├─────────────────────────────┤
└─────────────────────────────┘
```
**底部 HUD（v2.5 定稿，取代血条/魔法条）**：暗黑破坏神式左右对称布局——
`[🍷成长瓶 心型玻璃红液]  (🍼投喂) (✋抚摸)  [💠心情瓶 水晶玻璃蓝液]`

| 瓶 | 形状 | 液体 | 填充口径 | 瓶内数字 |
|---|---|---|---|---|
| 成长瓶 | **玻璃心**（心型玻璃，**无瓶盖**） | 红色 | **`stagePct`（到下一阶段的阶段内进度）**：蛋蛋→破壳需 30、每投喂 +10 ⇒ 每次涨 1/3；破壳→成长体需 50 ⇒ 每次 1/5；成年体→传奇需 140 ⇒ 每次 1/14 | `stageHave/stageNeed`（满级 `MAX`） |
| 心情瓶 | **玻璃钻石**（明亮式切割：台面+冠部+腰线+亭部收尖，**无瓶盖**） | 蓝色 | `mood/100`（每抚摸 +6 ⇒ 液面 +6%；投喂 +8） | `mood` |

- **瓶身常驻**：未领养时两个瓶子也在（空瓶），只有中间的投喂/抚摸按钮隐藏。
- 玻璃质感：瓶身 `clip-path`（心形由参数方程采样 44 点生成，钻石为明亮式切割 7 点）+ 内壁高光 + 斜向反光条 + 液面高光椭圆轻微起伏 + 液体内上浮气泡；**无瓶盖**（就是玻璃心与玻璃钻石本体）。钻石另加切面线层 `.facet`（腰线 + 台面两侧竖线 + 亭部汇聚到底尖的两条棱）。瓶内数字置于**瓶身中下部**（心形与钻石底部都收尖，贴底会被裁）。液面高度 `transition .6s` 缓动上升。
- **为什么要改成阶段内进度**：若按 300 总经验填充，每次投喂仅 +3.3%，液面几乎不动、没有反馈；改成「到下一阶段」后每次投喂液面可见上跳（1/3 → 1/5 → 1/14），升阶瞬间瓶子见底换更大的容量，形成节奏感。
- 字段由 `stageInfo()` 派生（`stageHave` / `stageNeed` / `stagePct`），云地双份镜像 + `__tests__/pet.test.js` 守卫；页面不做运算（`pet.js` 的 `apply()` 里算好 `growthPct` / `moodPct` / `growthTxt` / `moodTxt`，避免 `pet` 为 null 时 `height:%` 非法）。
- 宠物页**不展示孩子条（小雨/我的宠物小伙伴）与锁图标**（R10 本地层默认家长模式；放生/重置经 `openManage` 二次确认）。
- 互动统计报表（点击连续互动胶囊）：连续互动天数 / 累计投喂 / 累计抚摸 / 累计成长值 + 本周投喂 vs 抚摸对比柱。**不设独立「积分记录」「成长日记」按钮**（用户 2026-09-18 决策）。
- 未领养状态：顶部信息条显示「🥚 / 还没有宠物 / 领养后开启成长」，右侧编辑按钮→领养 sheet；舞台区（头像框）只显示「🥚」蛋，框外下方「领养一只小伙伴」按钮 → 弹领养 sheet（猫🐱/狗🐶 二选一 + 命名输入框，≤8 字）。
- **改名（rename）已恢复**：入口＝**顶部信息条右侧 ✏️ 编辑按钮**，弹改名 sheet（≤8 字、非空校验），不设独立改名按钮（用户 2026-09-18 最终决策，覆盖此前「去掉改名」）。领养/改名 sheet 均须登记 `SHEET_KEYS`（MEMORY 规则 7）。
- 连续互动天数来自互动流水（`petInteractions`），非 `getDashboard` 的打卡连续天数。

### 6.2 ~~积分子页（pages/points）~~ —— **v1.0 不做（用户 2026-09-18 最终确认）**

> **决策**：不做独立积分子页。统计入口统一为宠物页顶卡「N 天连续互动」胶囊 → **互动统计报表**弹层。
> 报表内容：连续互动天数 / 累计投喂 / 累计抚摸 / 累计成长值 + 本周投喂 vs 抚摸对比。
> 因此 `utils/pointsStats.js`、`pages/points/*`、Canvas 折线/柱状、日周月切换 **均不实施**；
> 积分（星星）余额展示仍复用顶卡与首页，投喂照旧写 `pointsLog`（`refType:'pet_feed'`）保证账本完整。
> 原设计（存档，若后续要恢复可参照）：三卡（余额/得星/耗=投喂+兑换）+ 真实总余额折线 + 投喂次数柱状 + 明细（兑换标「家长」）+ 日/周/月切换，Canvas 2D 自绘、无第三方依赖。

**互动统计（替代方案）数据源**：宠物文档内 `feedCount` / `strokeCount` 累计计数 + `daily` 按日计数（`{'YYYY-MM-DD':{feed:n,stroke:n}}`，仅保留近 60 天，写入时裁剪）。
- 累计投喂 = `feedCount`；累计抚摸 = `strokeCount`；累计成长值 = `growthValue`。
- 本周 = 近 7 天 `daily` 求和。
- 连续互动天数 = 由 `daily` 的日期集合按「今天已互动则从今天起、否则从昨天起」连续回数（与 `displayStreak` 同口径，抽成纯函数 `utils/pets.js interactionStreak(dates, today)`）。
- 连续互动天数**不等于** `getDashboard` 的打卡连续天数（来源不同，各自独立）。

---

## 7. 页面与文件清单（v1.0 本地层）

| 文件 | 改动 | 说明 |
|---|---|---|
| `miniprogram/utils/storage.js` | 改 | `KEYS` 加 `pets:'xy_pets'` |
| `miniprogram/utils/pets.js` | **新** | `SPECIES` / 阶段 / `stageInfo` / `isValidPetName` / 常量（PET_FEED_COST 等） |
| `miniprogram/utils/pets.js` | **新** | `SPECIES`(猫/狗) / 阶段 / `stageInfo` / `isValidPetName` / 常量 + `applyMoodDecay` / `clampMood` / `interactionStreak` / `computePetStats` |
| `miniprogram/services/local.js` | 改 | 加 `allPets/savePets` 读写；实现 `petCRUD`（adopt/feed/stroke/rename/info/release/reset）；挂 `module.exports` |
| `miniprogram/pages/pet/*` | **新** | 宠物 tab（顶部信息条 / 顶卡 / 头像框含两玻璃瓶+技能按钮 / 互动统计弹层） |
| ~~`miniprogram/pages/points/*`~~ | **不做** | ~~积分子页~~（用户最终确认取消；改为「连续互动胶囊 → 互动统计弹层」） |
| ~~`miniprogram/utils/pointsStats.js`~~ | **不做** | ~~`rangeWindow`/`computeStats`~~（随积分子页一并取消） |
| `miniprogram/custom-tab-bar/index.js` | 改 | `list` 增「宠物」（第 2 项，紧跟首页）；`SHEET_KEYS` 增领养/改名弹层 |
| `miniprogram/app.json` | 改 | `pages` 加 `pages/pet/pet`；`tabBar.list` 在首页后插入宠物 |
| `miniprogram/pages/{home,tasks,feed,mine}.js` | 改 | `onShow` 的 `selected`：首页 0、宠物 1、任务屋 2、动态 3、我 4 |
| `cloudfunctions/petCRUD/index.js` | **新（已实现）** | 复用 `lib/pets.js`；同本地契约（13 个云函数之一，`cloudfunctions/setup.js` 已登记并 sync） |
| `cloudfunctions/lib/pets.js` | **新（已实现）** | 与 `miniprogram/utils/pets.js` 双份镜像（云函数无法跨目录 require）；由 `__tests__/pet.test.js` 守卫一致 |
| `__tests__/pet.test.js` | **新** | 纯函数守卫（stage/mood/interactionStreak/computePetStats）+ 本地层 petCRUD（adopt/feed/stroke/rename/info/release/reset + 权限分支）+ 云地双份一致 + 云函数集一一对应 |
| `__tests__/tabbar.test.js` | 改 | SHEET_KEYS 增宠物页 4 个弹层；新增「5 个 tab 的 4 处定义一致」守卫 |
| `tools/acceptance.js` | 改 | 新增验收 8：宠物领养 → 投喂（扣星+流水）→ 抚摸（免费）→ 互动统计 |

---

## 8. tabBar 同步（规则 7/12）

tab「宠物」紧跟「首页」之后，顺序：**首页 0 / 宠物 1 / 任务屋 2 / 动态 3 / 我 4**（用户 2026-09-18 决策；原 3 个 tab 顺延）。
须同步 4 处：
1. `app.json` 的 `pages` 数组追加 `pages/pet/pet`（不做 `pages/points/points`）。
2. `app.json` 的 `tabBar.list` 在「首页」之后插入 `{ pagePath:'pages/pet/pet', text:'宠物', iconPath, selectedIconPath }`（图标用 Phosphor Fill 双态 SVG，烘焙色，置于 `images/tabbar/pet-off|on.svg`）。
3. `custom-tab-bar/index.js` 的 `list` 同步（与 app.json 一致，宠物置于列表第 2 项）。
4. 各页面 `onShow` 的 `selected` 索引：首页 0、宠物页 `selected=1`、任务屋 `selected=2`、动态 `selected=3`、我页 `selected=4`。

---

## 9. 工作流（与本次实现对齐）

按用户指定顺序执行：
1. **PRD 补录**（已完成）：PRD §6 第二阶段章节。
2. **PLAN 设计文档**（本文）。
3. **frontend-design 逐页原型**（已完成 2026-09-18）：产出宠物 tab 原型 `design-宠物tab-原型.html` 并与用户逐轮确认至 **v2.4 定稿**；**积分子页经用户最终确认取消**（统计改由「连续互动胶囊 → 互动统计弹层」承载）。
4. **TDD 实施**（已完成 2026-09-18）：`__tests__/pet.test.js` 13 条（红→绿）→ 实现 `utils/pets.js` / `services/local.js` 的 `petCRUD` / `pages/pet` + tabBar 4 处同步 → 全量 `npm test`（48 条全过）+ `npm run check`（211 文件 0 错误）+ `npm run acceptance`（11 通过 / 0 失败 / 4 待人工）。
5. **HUD 视觉改版 v2.5**（2026-09-19 用户定稿）：血条/魔法条 → **心型成长瓶 + 水晶心情瓶**（常驻、暗黑式左右对称）；填充口径改「到下一阶段」的阶段内进度（`stagePct`），纯函数云地双份同步 + 新增 `stagePct` 用例与「HUD 结构守卫」用例 → 全量 **50/50 通过**、211 文件 0 错误、acceptance 11/0/4。

**实施结果**：5 个 tab（首页 0 / 宠物 1 / 任务屋 2 / 动态 3 / 我 4）已上线；宠物页 4 个弹层（领养 / 改名 / 互动统计 / 管理）已登记 `SHEET_KEYS`；云函数 `petCRUD` 已同步至 13 个。剩余待人工：真机视觉走查（按 `design-宠物tab-原型.html` v2.4 核对）。

---

## 10. 测试清单（守卫）

**pet.local.test.js**
- adopt：成功建记录；name 超 8 字被拒；空名被拒（不传则用物种默认名）；同 childId 二次 adopt 返回 `ALREADY_HAS_PET`；非法物种 `INVALID`。
- feed：成功扣 5 星 + 成长 +10 + 心情 +8 + 写 `pet_feed` 流水；余额不足返回 `INSUFFICIENT` 且不改数据；第 3 次投喂跨 29→30，阶段由蛋蛋变破壳（前端提示「破壳啦」）。
- stroke：免费（不扣星、不写流水），`strokeCount` 与 `daily` 递增，心情 +6（上限 100）。
- rename：≤8 成功；空名被拒。
- info：未领养返回 `pet:null`；领养后返回正确视图；`lastMoodAt` 回拨 100 分钟后读取到衰减后的心情（75）。
- reset / release：reset 保留名字清零成长；release 软删（`released:true`）后可重新领养。
- 越权：非本人宝宝 `FORBIDDEN`；宠物 per-child 跨宝宝互不影响。
- release/reset：**无令牌返回 `TOKEN_INVALID`**；有令牌 release 删记录、reset 成长清零。
- 权限：adopt/feed/rename/info 在「展示模式（无令牌）」下仍可执行（与 redeem 默认需令牌形成对照）。

**pointsStats.test.js**
- 空 `pointsLog` → 全 0、序列空。
- `range` 三型（day/week/month）窗口与 `balanceSeries` / `feedCountSeries` 长度正确。
- 跨日/跨周/跨月边界计入正确。
- `gain` 只计 checkin 正向；`spendFeed` 只计 pet_feed；`spendRedeem` 只计 redeem；`spendTotal` 为二者和。
- `balanceSeries` 末值 = 全量累计（含兑换影响），与顶卡 `balance` 一致。

**跨端守卫（local.test.js 占位）**
- `PET_FEED_COST` / `PET_GROWTH_PER_FEED` 本地值 == 云 `lib/pets.js` 值（v1.1 落地后启用）。

---

## 11. 风险与注意

- **口径提示**：统计顶卡「消耗」= 投喂 + 兑换（全貌），图表A 余额趋势 = 真实总余额（含兑换下探）。两者自洽；但宠物页若另显「宝宝视角余额（打卡得−投喂耗）」须明确标注，避免与真实总余额混淆（grill 6.2 已选真实总余额口径）。
- **孵化节点不重复计费**：`isHatch` 仅前端标记，不写额外流水。
- **放生即清零**：成长日记随宠物记录删除而丢失（破坏性操作，家长把关）；如需保留历史可改软删标记，本期不做。
- **stage 派生单一源**：务必走 `utils/pets.js` 的 `stageInfo`，禁止页面本地硬算阈值（防 v1.1 双份漂移）。
