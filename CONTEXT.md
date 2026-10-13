# CONTEXT.md —— 雨宝记 项目术语与上下文

> 目标读者：后续接手/改进本项目代码架构的人（含 AI Agent）。
> 作用：以「术语表 + 架构不变量 + 约束清单 + 已知债务」的形态，把**代码里没写清楚、但决定了怎么改才对**的信息集中在一处。
> 权威来源优先级：**代码 > 本文件 > docs/ 下的历史文档**。若本文件与代码冲突，以代码为准并顺手修正本文件。
>
> 最后校对：2026-10-13（对照 commit 工作区实况；架构复盘候选②①⑤④⑥ + D17/D19/D20 销债 + 上线回归修复 后）。

---

## 0. 快速定位

| 问题 | 看哪里 |
|---|---|
| 某个操作的数据从哪来 | `miniprogram/utils/api.js` → 云端 `cloudfunctions/<name>/index.js` 或本地 `miniprogram/services/local.js` |
| 业务规则（连续天数/星级/可见性/兑换） | `miniprogram/utils/domain.js`、`tasks.js`、`pets.js`、`dashboard.js`、`feed.js#buildFeed`（**均为生成式镜像**）→ 唯一源在 `cloudfunctions/lib/*`（改源后跑 `npm run gen:mirror`） |
| 数据字段口径 | 本文件 §5 数据模型 |
| 页面 UI 约束（为什么元素看得见却点不到） | `miniprogram/app.wxss` 顶部注释 + §7 隐式前提 |
| 改完怎么验 | `npm test`（含 lint 守卫）/ `npm run check` / `npm run lint` / §9 命令 |

---

## 1. 项目速览

- **是什么**：微信原生小程序 + 微信云开发，面向家庭的儿童习惯养成工具（打卡 → 星星 → 兑换奖励 + 虚拟宠物陪伴）。
- **命名**：「雨宝记」为对外名（2026-09 由「小雨记」更名）。代码里历史标识符 `xiaoyu` / `xy_` 前缀**保持不变**，属刻意保留，不要批量改名。
- **版本**：`1.0.0`（`miniprogram/config.js` 的 `APP_VERSION`，显示在「关于」页）。
- **当前运行档位**：**双分支并行**（2026-10-13 起，见下方「双分支工作流」）。
  `v1.0-local` = `CLOUD_ENV = ''` → 本地兜底层（wx.storage），即线上 v1.0 形态；
  `v1.1-cloud` = `CLOUD_ENV = 'cloud1-d1gom5pau1e9cf09d'` → 云函数层（环境已开通，集合/密钥待配）。
- **技术约束**：无构建工具、无 TypeScript、无 ESLint、无第三方依赖。`npm run check` 做**语法解析级**校验；`npm run lint`（`tools/lint.js`，零依赖自研）做**跨文件可解析性 + 发布卫生**检查。类型安全靠约定 + 测试；**D8（2026-10-10）**：纯逻辑模块（`domain/tasks/calendar/bubble/confetti/pet-page/icons/storage`）已加 `// @ts-check` + JSDoc；含 `wx` 全局的模块由 `miniprogram/types/globals.d.ts`（最小 ambient 声明）+ 仓库根 `jsconfig.json` 兜底，**仅供 IDE 提示，不装 tsc、不进 CI**。
- **规模**（2026-10-13 守卫基建去重后）：前端 js 45 个（含 `utils/` 18 + `services/local/` 10 + `behaviors/` 3）；云函数 13 个，每个自带 17 份 lib 副本（`cloudfunctions/lib/` 源 17 文件 → 221 副本 → cloudfunctions 下共 252 个 js）；`__tests__/` 28 个测试文件（+ `helpers/` 3 个共享模块）；全仓 333 个 js（`npm run check` 范围）。

### 双分支工作流（2026-10-13 建立，⚠️ 切分支必读）

**本地版与云端版从此分叉，各自独立演进、各自独立提审。**

| 分支 | 定位 | `CLOUD_ENV` | 日常改动 |
|---|---|---|---|
| `v1.0-local` | **本地版主线**（当前默认分支所在） | `''` 空 → 本地兜底 | bug 修复、体验优化；不发版则线上无感 |
| `v1.1-cloud` | **云端版分支** | `'cloud1-d1gom5pau1e9cf09d'` | V1.1 云同步/后台/离线队列 |
| `main` | `v1.0-local` 的同源起点（`684a7a4`），暂未推送 v1.0-local | — | 冻结 |

- `v1.1-cloud` 首提交 `1ca08a9` = V1.1a-0（opId 幂等基建 + F5 埋点，226 测试）。
  `v1.0-local` 停在 `684a7a4`（215 测试）——**两条线测试数不同是正常的**（幂等守卫只在云端分支）。
- ⚠️⚠️ **`config.js` 不随切分支变化**（`.gitignore` 排除 + `assume-unchanged`）：
  切分支后它保留上一次编辑的值，**必须手工核对**。已踩过的坑：切到 `v1.0-local` 后
  `CLOUD_ENV` 仍是环境 ID → 编译出来意外连云端。`config.js` 头部有对照表。
  反向同理：切到 `v1.1-cloud` 后若忘填，会**静默降级**回本地兜底（`app.js` 的 fail-fast 设计）。
- 两分支都能独立跑全绿：`v1.0-local` = test 215 / lint 110 / check 333；`v1.1-cloud` = test 226 / lint 113 / check 349。
- 云环境：免费体验版，**约 2026-10-26 到期**（v1.0 已 2026-10-11 上线，按「上线后第 15 天」规则）。
  V1.1 提审前必须转付费 19.9 元/月，详见 `docs/v1.1-design-spec.md` §6.1。

---

## 2. 目录职责地图

```
miniprogram/            小程序前端
  app.js                全局基座：云初始化 / 静默登录 / 双模式态 / 家长令牌生命周期 / 隐私授权兜底
  config.js             唯一部署开关（CLOUD_ENV）+ 版本号 + 空闲阈值
  app.json              页面注册、自定义 tabBar、__usePrivacyCheck__
  app.wxss              全局样式 + 糖果调色板 CSS 变量（视觉唯一口径）
  services/local.js     本地兜底数据层「聚合出口」（D3 拆分，2026-10-10）：只做 re-export，导出集与签名不变
  services/local/       本地兜底层各域模块（D3，2026-10-10）：
    store.js            通用 ok/fail + 存储访问（allTasks/savePets 等）+ verifyLocalToken（低层，供各域 require）
    auth.js             账号 / PIN（hashPin·默认 123456）/ 家长令牌（login·unlockParent·setPin·resetPin）
    dashboard.js        看板 getDashboard（纯组装走 utils/dashboard#buildDashboard）
    checkin.js          打卡 checkIn
    task.js / reward.js 任务 CRUD / 兑换 + 奖励 CRUD（REDEEM_BLOCK_MSG 在此）
    child.js            多宝宝档案（constants + normalizeBirthday/childView/extractChildProfile + childCRUD/childSwitch）
    feed.js             动态流水 feedCRUD（list / undoCheckIn / undoRedeem）
    pet.js              宠物 petCRUD（含 petView / findPet）
    demo.js             演示辅助 resetAll（仅本地独占）
  utils/
    api.js              统一数据入口 callApi(name, params) —— 云端/本地自动路由 + 错误抛出
    domain.js           纯逻辑：日期/连续天数/星级/令牌/打卡核/兑换核/空闲判定 —— ⚠️ SLOT 段**机生成**（源见 §4.2）
    tasks.js            纯逻辑：任务可见性/优先级/分组/标签字典 —— ⚠️ visibility 段**机生成**
    pets.js             纯逻辑：宠物物种/阶段/命名/心情衰减/互动统计 + 投喂上限（feedCountToday/canFeed，C 单源）—— ⚠️ **整文件机生成**，唯一源 `lib/pets.js`
    calendar.js         纯函数：日历格 buildCalendar + 月份增减 shiftYm（D4 自 home.js 下沉）
    bubble.js           纯函数：气泡配色 bubbleStyleFor + BUBBLE_THEME（D4 自 home.js 下沉）
    confetti.js         纯函数：礼花粒子 cannonPieces/risePieces/fxParticles（D4 自 home·pet 下沉）
    pet-page.js         纯函数：宠物页 data 映射 pagePetData/petClsOf（D4 自 pet.js 下沉）
    child-form.js       纯函数：宝宝档案表单构造 emptyChildForm/childFormFrom（D4 自 mine.js 下沉）
    feed.js             纯展示：动态列表时间/分组文案 + buildFeed（动态数据聚合，E 下沉单源）
    dashboard.js        纯函数：buildDashboard 看板聚合（E 下沉单源，与 lib/dashboard.js 双份守卫）
    seed.js             开箱预置数据（8 任务 + 8 奖励）—— ⚠️ **整文件机生成**，唯一源 `lib/seed.js`；`npm run gen:mirror` 重建
    storage.js          本地存储键名表 KEYS + read/write/remove/nextId
    tabbar.js           自定义 tabBar 显隐「派生」控制器
    icons.js            emoji 图标候选集（任务/奖励各 6 类 × 24）
    ops.js              **后端操作单一来源**（候选③，2026-10-09）：函数名/op/是否需令牌的唯一清单；豁免表与守卫测试均引用它，改它须同步云函数与 local.js 导出
    pin-reauth.js       家长 PIN 闸逻辑收拢（Phase B，2026-10-09）：onPinClose/onReauthNeed/onPinComplete/onPinForgot 的可测纯函数，由 behaviors/pin-reauth.js 转发给页面
    parent-gate.js      家长模式「开关 + 闸门」纯逻辑（候选④，2026-10-11）：isParent/requireParent/toggleParent 收拢；真值口径统一取 `app.globalData.mode`，由 behaviors/parent-gate.js 转发给页面
  components/           公共组件：day-sheet / emoji-picker / pin-pad / privacy-sheet
  behaviors/            小程序原生 Behavior：pin-reauth.js（PIN 面板关/提交/忘记，五页接入）、parent-gate.js（家长模式开关 + 闸门，五页接入）、child-photo.js（宝宝头像选图 + 隐私授权闸门，D4 自 mine.js 抽出）
  custom-tab-bar/       自定义底部导航（原生 tabBar 字号不可调，故自定义）
  types/globals.d.ts    小程序全局（wx/getApp/Page/Component/Behavior）的最小 ambient 声明，仅供 `// @ts-check` 模块的 IDE 提示（D8）
（仓库根）jsconfig.json  编辑器 JS 工程配置：include miniprogram/**，`checkJs:false` + 逐文件 `// @ts-check`（仅 IDE，不参与打包/CI）

cloudfunctions/         云函数（部署单元）
  lib/                  共享纯逻辑（唯一手写来源）：cloud.js（含 wx-server-sdk 助手）+ runtime.js（授权/上下文深模块）+ **ownership.js（归属判定纯函数：pickOwned 严格 / pickCurrent 回退 / isOwnedResource）** + **session.js（会话策略常量：PARENT_TOKEN_TTL_MS，云端单一政策源）** + dashboard.js / feed.js（看板与动态聚合纯函数）+ seed.js（开箱预置数据的**唯一手写来源**，前端 utils/seed.js 由 gen:mirror 生成），均由 setup.js sync 分发（现 17 文件 × 13 函数 = 221 副本）
  setup.js              生成各函数 package.json 并把 lib 复制进每个函数目录
  <name>/index.js       各云函数入口（自包含：自带 lib/ 副本）
  <name>/lib/           ⚠️ 构建产物，由 setup.js 生成，勿手改

__tests__/              28 个测试文件（node:test，无第三方依赖）
  helpers/              守卫基建**单一来源**（非 *.test.js，不被 runner 收集，但被 lint/check 扫描）
    js-source.js        源码文本工具：read/keysOf/strip（re-export 自 tools/lint）/matchBrace/objectLiteralAfter/arrowBlock/functionBlock/evalObj/evalInContext
    wx-storage.js       wx.storage mock（installWxStorageMock → 各文件独立 store）
    cloud-db.js         忠实版内存云数据库 + wx-server-sdk 拦截器（**真的会写**；供写路径双端对拍守卫用）
tools/                  acceptance.js（接口验收）/ ui-acceptance.js（WXML 结构验收）/ check-syntax.js（语法解析）/ lint.js（D8 静态检查，含行内 `// lint-ignore` 豁免）/ gen-mirror.js（D1 单源镜像生成：whole + section 两种模式，见 §9）
docs/                   需求·设计·方案·计划·隐私·发布（PRD / PLAN / ACCEPTANCE / release-checklist 等）
```

---

## 3. 术语表

### 3.1 领域术语

| 术语 | 定义 | 代码位置 |
|---|---|---|
| **宝宝 / child** | 被管理的孩子档案，数据以 `childId` 隔离。多宝宝上限 **6**，软删（`deleted:true`），至少保留 1 个 | `children` 集合 / `xy_children` |
| **星星 / star** | **统一货币**（积分与星星同一概念，不设第二种货币）。打卡加分、兑换扣分、投喂扣分 | `child.totalStars`、`pointsLog` |
| **打卡 / checkIn** | 某孩子在某日完成某任务，产生一条流水并加星。同一 `(childId, taskId, date)` 唯一 | `checkIns` |
| **补打卡 / backfill** | 对**历史日期**打卡（日历点过去日期）。会破坏增量计数器 → 连续天数一律由流水重推 | `feed.js#isBackfill`、`domain.js#displayStreak` |
| **连续天数 / streak** | 展示口径：今天有打卡则从今天往前数，今天没打则从昨天往前数（**不因今天没打而归零**） | `domain.js#displayStreak` ↔ `lib/streak.js` |
| **星级 / level** | 由 streak 派生的 1–5 星：≥25→5，≥18→4，≥10→3，≥4→2，否则 1 | `domain.js#levelOf` ↔ `lib/level.js` |
| **可见性 / visible** | 某任务在某日是否需要打卡。未设重复 → 生效后**每天**可见（不是仅生效当天） | `tasks.js#taskVisibleOn` ↔ `lib/visibility.js` |
| **对号 / dayAllDone** | 日历某日右上角勾：「当日**所有可见任务**都已完成」才为真；无可见任务 → false | `tasks.js#dayAllDone` |
| **奖励 / reward** | 用星星兑换的条目。`category` 有 `reward`/`punish`（惩罚）两种文案口径 | `rewards` |
| **限次 / resetAfterRedeem** | `true`=可反复兑换（只受余额约束）；`false`=每位孩子**仅一次**（靠「是否已兑换过」把关）。**奖励无库存概念** | `domain.js#redeemBlockReason` ↔ `lib/redeemCore.js` |
| **任务类型 / type** | 枚举 `study`(学习)/`life`(生活)/`sport`(运动)/`growth`(成长)；旧 `habit`/`chore` 已弃用（v1.0.8）。**正面反馈 / praise** 任务新增字符串字段（打卡后宠物气泡展示，空则默认文案） | `utils/tasks.js#TYPE_OPTIONS`、本地/云端 `taskCRUD`、`seed.js` |
| **撤销契约（v1.0.8）** | `getDashboard` 现透出：`checkIns[].id`（撤销打卡用）、限次已兑换奖励 `rewards[].redeemId`（取消兑换用）。首页据此复用 `feedCRUD.undoCheckIn`/`undoRedeem`（均 `'token'`） | `services/local.js#getDashboard` ↔ `getDashboard/index.js` |
| **动态 / feed** | 打卡 + 兑换的聚合流水列表（跨全部宝宝）。**故意不过滤 `deleted`**，历史记录要能显示已删条目名 | `feedCRUD op=list` |
| **撤销 / undo** | 撤销打卡（扣回星星、重算连续、删记录）或取消兑换（返还星星、恢复限次）。反向流水 `*_undo` 只作审计，**不在动态展示** | `feedCRUD op=undoCheckIn/undoRedeem` |
| **宠物 / pet** | 每宝宝**同时最多 1 只**，`per-child` 隔离。放生 = 软删 `released:true`，可重新领养 | `pets` 集合 |
| **品种 / breed** | 10 个品种 key（5 猫 5 狗）：`cat_lihua` … `dog_beagle`。**领养时选「物种组」`cat`/`dog`，品种在组内随机 5 选 1 后入库** | `pets.js#SPECIES/randomBreedKey` |
| **物种组 / speciesGroup** | 仅 `cat`/`dog` 两个值，用于领养二选一 UI | `pets.js#SPECIES_GROUPS` |
| **阶段 / stage** | 两档：幼崽(0–299) → 成年(≥300)。**由 `growthValue` 派生，不入库** | `pets.js#stageInfo` |
| **成长瓶 / 心情瓶** | HUD 两个玻璃瓶：左红液按 `stagePct`（阶段内进度，每次投喂液面可见上升）；右蓝液按 `mood`。暗黑破坏神式视觉 | `pages/pet/pet.wxml` |
| **心情 / mood** | 0–100，投喂 +8、抚摸 +6，久不互动**每小时 -1**（不足 1 小时不扣）。读取时重算，仅在写操作时落库 | `pets.js#applyMoodDecay` |
| **投喂 / feed** | 花 5 星星 → +10 成长 +8 心情，写 `pet_feed` 流水。**需家长令牌**，每日上限 3 次（`FEED_LIMIT`） | `petCRUD op=feed` |
| **抚摸 / stroke** | **免费·免家长令牌**（孩子也能玩）→ +6 心情，不扣星星、不写流水 | `petCRUD op=stroke` |
| **家长模式 / parent mode** | 可写状态。`mode: 'parent'｜'display'`，靠 `parentToken` 支撑 | `app.js` |
| **展示模式 / display** | 只读状态（默认）。孩子视角 | `app.js` |
| **R10 / R10.1** | R10=启动即家长模式（本地层已实现，云端层顺延）；R10.1（2026-10-10）=取消 15 分钟空闲自动回退，家长模式默认开启、仅手动关闭（锁图标），令牌 1 年长效（`config.PARENT_TOKEN_TTL_MS`） | `app.js#maybeAutoUnlock` |

### 3.2 工程术语

| 术语 | 含义 |
|---|---|
| **数据层自动路由** | `config.CLOUD_ENV` 非空 → `wx.cloud.callFunction`；为空 → `services/local.js`。页面层只调 `api.callApi()`，不感知差异 |
| **家长会话 / parent session** | 收拢家长令牌生命周期的 module（`utils/parent-session.js`，位于 `api.js#callApi` seam）：token 自动注入、失效检测、恢复流程统一在此，页面不感知令牌存在。见 ADR-0001 |
| **统一契约** | 每个数据操作返回 `{ok:true, ...}` 或 `{ok:false, code, message}`。`callApi` 遇 `ok:false` 抛 `err.code`，页面用 `code` 分支 |
| **双份镜像 / mirror** | 同一份纯逻辑在前端（`miniprogram/utils/*`）与云端（`cloudfunctions/lib/*`）各存一份，靠**守卫测试**做 `deepStrictEqual` 比对防漂移 |
| **守卫测试 / guard test** | 断言两处实现口径一致的测试。改任一份不一致 → `npm test` 变红 |
| **同步 / sync** | `npm run sync` = 跑 `cloudfunctions/setup.js`：把 `lib/*.js` 复制进 13 个云函数目录 |
| **派生 / derived** | 状态不落库、不人工配对，而由其他状态**计算得出**（stage 由 growthValue 派生；tabBar 显隐由弹层开关派生） |
| **弹层 / sheet** | 全屏/半屏遮罩弹层。开关字段统一登记在 `tabbar.js#SHEET_KEYS` |
| **隐私授权闸门** | 相册等隐私 API 需先获《用户隐私保护指引》同意；两条路径：页面预检 与 微信异步兜底 |

---

## 4. 架构要点（改代码前必须知道）

### 4.1 数据层：一份契约，两套实现

```
页面 → utils/api.js#callApi(name, params)
         ├─ useCloud() === true  → wx.cloud.callFunction({name, data:params})  → cloudfunctions/<name>/index.js
         └─ useCloud() === false → services/local.js[name](params)
                                        ↓ 双方都返回 {ok, ...}
         ok:false → throw err(code) ；ok:true → 返回 result
```

- `useCloud()` 以 `app.onLaunch` 显式写入的 `_cloudFlag` 为准（避免启动早期 `getApp()` 时序不确定）。
- **新增一个数据操作 = 同时改 3 处**：`services/local.js`（本地实现）+ `cloudfunctions/<新函数>/index.js`（云端实现）+ `cloudfunctions/setup.js` 的 `FUNCTIONS` 数组。漏一处即路由不到。

### 4.2 镜像清单（纯逻辑组为「唯一源 → 机生成」；其余仍双份手写）

> domain/tasks/pets/seed 已改为**生成式镜像**：唯一手写点在 `cloudfunctions/lib/*`，前端副本由
> `npm run gen:mirror` 注入（源侧 `// ==MIRROR-SECTION:<name>==` ↔ 前端 `// ==MIRROR-SLOT:<name>==`；
> seed/pets 为整文件 `// ==MIRROR-BODY-START==`）。**只改云端源 → gen:mirror → sync**，不再两份手写。

| 前端（机生成） | 云端唯一源 | 守卫测试 |
|---|---|---|
| `utils/domain.js`（SLOT：util/streak/level/checkInCore/redeemCore） | `lib/util.js` + `lib/streak.js` + `lib/level.js` + `lib/checkInCore.js` + `lib/redeemCore.js` | `mirror-sync.test.js` + `core.test.js`（行为级） |
| `utils/tasks.js`（SLOT：visibility） | `lib/visibility.js` | `mirror-sync.test.js` + `core.test.js`（行为级） |
| `utils/pets.js`（整文件） | `lib/pets.js` | `mirror-sync.test.js` + `pet.test.js`（双份一致） |
| `utils/seed.js`（整文件） | `lib/seed.js` | `mirror-sync.test.js` + `seed.test.js` |
| `utils/dashboard.js`（整文件，候选⑤ 2026-10-11） | `lib/dashboard.js` | `mirror-sync.test.js` + `aggregate-guard.test.js`（端到端） |
| `utils/feed.js`（SLOT：buildFeed，候选⑤） | `lib/feed.js` | `mirror-sync.test.js` + `aggregate-guard.test.js`（端到端） |

> 候选⑤ 之前 `dashboard` / `buildFeed` 是**双份手写**，只靠 `aggregate-guard` 的「单样本输出对称」兜底
> （覆盖 1 个分支组合，单边改 `childMap` 缺失、`limit/skip` 边界这类分支仍会全绿漂移）。
> 现升级为机生成镜像：逐字节守卫，覆盖全部分支的源码文本。
> 前端 `dashboard.js` 的 require 前缀差异由生成器 `head` 注入命名空间映射解决
> （源用裸 `displayStreak`/`taskVisibleOn`，前端映射自 `D`/`T`）；
> `feed.js` 注入正文用裸 `DEFAULT_LIMIT`/`MAX_LIMIT`，前端另导出 `FEED_*` 别名避免与页面常量撞名。

> ⚠️ 以下仍为**双份手写**（改一份必须改另一份）：

| 前端 | 云端 | 守卫测试 |
|---|---|---|
| `services/local.js` 的 PIN 常量 | `lib/pin.js` | `local.test.js`（默认 PIN 口径） |
| `services/local.js` 的 `REDEEM_BLOCK_MSG` | `redeem/index.js` 的 `BLOCK_MSG` | `__tests__/mirror-guard.test.js`（键集 + 文案值一致） |
| `services/local.js#petView` | `cloudfunctions/petCRUD/index.js#petView` | `__tests__/mirror-guard.test.js`（输出键集一致） |
| `custom-tab-bar` 的 list | `app.json` tabBar.list | `tabbar.test.js`（五 tab 四处定义一致） |

### 4.3 云函数自包含

微信开发者工具「上传并部署」**只打包所选函数目录**，跨目录 `require` 不会被上传。因此：

- 每个 `cloudfunctions/<name>/` 自带一份 `lib/`（同内容，13 份副本）。
- **改 `lib/` 后必须 `npm run sync`**，否则线上跑的还是旧逻辑。
- `lib/index.js` 是不含 `wx-server-sdk` 的纯逻辑汇总出口（供测试直接 require）；`lib/cloud.js` 才依赖 `wx-server-sdk`，**故意不纳入 index.js**。

### 4.4 鉴权三件套

1. **PIN**：6 位数字，默认 `123456`（建号即内置）。哈希 sha256+盐（云端）/ 轻量 djb2（本地兜底，非安全实现）。
   - `PIN_SCHEME = 'len6-v1'`：**改位数或哈希口径必须递增此版本号**。老账号 `pinScheme` 不匹配 → login 自动重置为默认 PIN；若迁移未跑到，`unlockParent` 返回 `PIN_SCHEME_STALE` 引导走「忘记 PIN」。
   - 「忘记 PIN 重置」= **恢复默认 PIN**，不是置为「无 PIN」（否则账号死锁且不报错）。
2. **家长令牌**：云端为**无状态 HMAC-SHA256**（`base64url({openid,expireAt}) + '.' + sig`），密钥 `XY_TOKEN_SECRET`。因 13 个云函数内存不共享，**不可用服务端 Map**。
3. **模式态**：`mode` 与 `parentToken` 存内存（`globalData`），不落库。
   - `onHide` **不清令牌**（`wx.chooseMedia` 等原生能力同样触发 onHide，清了会导致选图回来令牌失效），只记 `_hiddenAt`。
   - `onShow` 检查 `parentTokenExpire`（R10.1 起令牌 1 年长效，正常使用不触发）；**空闲自动退出已移除**（R10.1，2026-10-10），退出仅靠手动锁图标。
   - **seam 收拢（2026-10-08 实施落地，ADR-0001）**：token 注入与恢复统一在 `utils/parent-session.js`。页面**不传 `parentToken`**（`pages/` 下出现该字符串即为回归，`__tests__/session.test.js` 守卫断言）；`callApi` 按 `utils/ops.js` 单一来源中的豁免标记自动注入（fail-safe 方向：公开/本地独占免令牌，其余一律注入）；`TOKEN_INVALID` 统一走「弹 PIN 重解锁 → 重试原操作一次」，本地云端同路径，**不得改为静默恢复**（避免无感自愈掩盖会话异常）。恢复 UI 复用隐私授权先例（seam 存延续点 → 栈顶页实现 `onReauthNeed` 弹 PIN）。覆盖：**五个 tab 页全覆盖**（2026-10-08 补齐 tasks/pet——二页无主动解锁入口，pin-pad 仅服务恢复；无忘记 PIN 入口，自救走首页/我页；结构守卫见 session.test.js）。解锁签发唯一收口 = `session.adopt(res)`。

- **家长 PIN 闸 UI 方法收拢（2026-10-09 Phase B）**：五页的 `onPinClose` / `onReauthNeed` / `onPinComplete`（home/mine 外加 `onPinForgot`）与 `pinAttempt` 复位 hack 已抽离到 `behaviors/pin-reauth.js`（薄壳）+ `utils/pin-reauth.js`（可测纯函数），五页通过 `behaviors:[require('../../behaviors/pin-reauth')]` 接入；wxml 的 `pin-pad` 绑定（`onPinComplete`/`onPinClose`/`onPinForgot`）无需改动。守卫见 `__tests__/pin-behavior.test.js`（页面不得本地定义这些方法）+ `__tests__/pin-reauth.test.js`（纯函数逻辑）。

- **家长模式「开关 + 闸门」收拢（2026-10-11 候选④）**：`toggleParent`（锁图标）与 `requireParent`（操作前闸门）此前散在五页共 8 处，**5 种文案 + 2 种真值来源（`this.data.mode` vs `app.globalData.mode`）+ 2 种失败表现（toast / setData 错误字段）**，且 `toggleParent` 有 3 份拷贝。现收进 `utils/parent-gate.js`（纯函数）+ `behaviors/parent-gate.js`（薄壳），五页接入。**真值口径统一取 `app.globalData.mode`**（`data.mode` 只是渲染副本、可能滞后）。同时清除 `onAppTouch → app.touch()` 死链路（R10.1 后为空操作，5 页根 view 的 `bindtap` 与 `app.touch` 一并删除）。守卫见 `__tests__/parent-gate.test.js`（纯函数 9 条 + 静态守卫：五页不得自写 `toggleParent`/内联 `mode !== 'parent'`/残留 `onAppTouch`/未接入 behavior）；顺带移除五页已死的 `parent-session` import（Phase B 后零调用）。

> ⚠️ **上线回归与修复（2026-10-11）**：`behaviors/parent-gate.js` 首版把 `toggleParent`/`requireParent` 写在 **Behavior 顶层**——Behavior 只注册固定字段（`methods`/`data`/…），**顶层自定义函数不会被挂为页面方法**，真机上 `this.requireParent` 为 `undefined` → 五页所有走闸门的写操作（打卡/投喂/新增·删除任务…）全部抛错。修复：方法移入 `methods: {}`。**教训**：纯函数单测（`utils/`）只验逻辑、验不到「方法有没有被挂上」，故新增守卫 `__tests__/behavior-shape.test.js`（加载每个 behavior 定义，断言只用固定顶层字段）。同时修 `isParent` 真值来源：页面实例**没有** `.getApp` 方法（`getApp` 是全局函数），原实现据此静默退化成 `data.mode`，现改为 `appOf()` 优先 `ctx.getApp`、回退全局 `getApp()`。

### 4.4b 归属语义：严格 vs 默认选中（候选②，2026-10-10 修复越权）

> 这一节是**安全不变量**，改任何涉及 `childId` / `taskId` / `rewardId` 的云端代码前必读。

同一行代码曾同时承担两重语义，导致越权：

```js
return r.data.find(c => c._id === childId) || r.data[0];   // ← 旧实现，已删除
```

| 语义 | 用途 | 回退是否正确 | 现在的正确写法 |
|---|---|---|---|
| **A · 归属校验** | 所有写操作（checkIn / redeem / CRUD / childSwitch / petCRUD / feedCRUD） | ❌ 错，必须拒绝 | `runtime.ownedChild(OPENID, childId)` → `ownership.pickOwned`，不属于自己返回 `null` |
| **B · 默认选中** | 看板「当前宝宝」（没指定就给我第一个） | ✅ 对，是设计意图 | `runtime.currentChild(OPENID, childId)` 或 `ownership.pickCurrent(children, childId)` |

**三条硬规则：**

1. **写操作一律用 `ownedChild`**，绝不能用 `currentChild` —— 否则「传别人的 childId」会静默落到自己的第一个宝宝上。
2. **task / reward 是子资源，必须单独校验**：`runtime.ownedTask(OPENID, taskId)` / `ownedReward(OPENID, rewardId)` 内含「属于该用户的某个孩子」+ 软删校验。
   历史 bug：`checkIn` 只校验 child 归属就直接用 `event.taskId` 取任务 → 可用他人 taskId 打卡计分。
3. **失败码**：写操作统一 `CHILD_NOT_FOUND` / `NOT_FOUND`（不区分「不存在」与「是别人的」，避免资源存在性探测）；`childSwitch` / `petCRUD` 的 `FORBIDDEN` 保留（语义明确且前端依赖）。

**软删一律内存过滤，不用 `deleted:false` 谓词**（老档案缺该字段会被静默过滤掉）—— 见 §6 与守卫 `__tests__/ownership-guard.test.js`。

守卫：`__tests__/ownership-guard.test.js`（纯函数行为 + 三条静态守卫：cloud.js 不得回退 / 云函数不得自写 ownedChild / checkIn·redeem 不得绕过原语直取文档 + 禁用 `deleted:false` 谓词）。
⚠️ 教训：`runtime-guard.test.js` 旧桩把 `getOwnedChild` 写成**严格语义**，与真实实现（回退）相反 —— 桩替换了被测行为，导致这类回归永远不可能变红。**桩只替 db 取数，判定逻辑必须用真实的 `lib/ownership.js`**。

### 4.5 自定义 tabBar 必须「派生」而非「配对」

- 页面内 `z-index` **无法越过**自定义 tabBar（实测即使弹层 z-index 300 也被 tabBar 的 90 盖住）。
- 故：页面 `onShow` 调 `attachTabBarSync(this)`，之后**每次 `setData` 自动**按 `SHEET_KEYS` 重算显隐。**禁止**手写 `setTabBarHidden`（历史遗留 42 处已于 2026-10-09 全部剥离，页面层零显式调用；新增更不要写）。
- ⚠️ **新增任何全屏弹层，必须把开关字段加进 `SHEET_KEYS`**，否则打开时底栏不隐藏。

### 4.6 隐私授权闸门

`app.json` 有 `__usePrivacyCheck__: true`。两条路径：

1. **页面预检**（常规）：`home.onShow` / `mine` 选图前调 `wx.getPrivacySetting` → 主动弹 `privacy-sheet`。
2. **异步兜底**（竞态）：`app.registerPrivacy()` 注册 `wx.onNeedPrivacyAuthorization`，存下 `resolve` 并通知栈顶页 `onPrivacyNeed()`；用户同意 → `resolvePrivacy(buttonId)` 放行被挂起的 API，**全程不离开当前页**。

声明中必须包含「选中的照片或视频信息」scope。`privacy-sheet` 组件有幂等守卫，勿重复弹。

---

## 5. 数据模型

本地键名（`utils/storage.js#KEYS`）与云端集合名并列：

| 实体 | 本地 key | 云端集合 | 关键字段 |
|---|---|---|---|
| 用户 | `xy_user` | `users` | `_id, openid, randomCode(16), nickname, avatar, pinHash, pinSet, pinScheme, createdAt` |
| 宝宝 | `xy_children` | `children` | `_id, ownerId, name(≤12), avatar, photo, gender(''｜boy｜girl), birthday(YYYY-MM-DD｜''), allergens(≤50), totalStars, createdAt, deleted`（`streak` / `lastCheckInDate` 死字段均已于 2026-10-10 移除） |
| 任务 | `xy_tasks` | `tasks` | `_id, ownerId, childId, title, type('habit'｜'chore'), icon, date, repeat{enabled,type('day'｜'week'),interval,weekdays[]}, score(≥1), priority('high'｜'mid'｜'low'｜'none'), createdAt, deleted` |
| 奖励 | `xy_rewards` | `rewards` | `_id, ownerId, childId, title, icon, category('reward'｜'punish'), resetAfterRedeem(bool), cost(≥1), createdAt, deleted` |
| 打卡流水 | `xy_checkIns` | `checkIns` | `_id, childId, taskId, date, score, createdAt`（唯一键 `childId+taskId+date`） |
| 兑换流水 | `xy_redemptions` | `redemptions` | `_id, childId, rewardId, cost, status:'completed', createdAt` |
| 积分流水 | `xy_pointsLog` | `pointsLog` | `_id, childId, delta(±), reason, refType('checkin'｜'redeem'｜'checkin_undo'｜'redeem_undo'｜'pet_feed'), refId, createdAt` |
| 宠物 | `xy_pets` | `pets` | `_id, ownerId, childId, species(品种 key), name(≤8), growthValue, feedCount, strokeCount, mood(0–100), lastMoodAt, daily{date:{feed,stroke}}(保留 60 天), createdAt, released, releasedAt` |
| 当前宝宝 | `xy_childId` | —（`globalData.childId`） | |
| 家长令牌 | `xy_parent_token` | —（内存） | 仅本地层用；云端为无状态签名 |
| 启动即家长模式 | `xy_start_in_parent` | — | 默认 `true` |
| 自增序号 | `xy_seq` | — | 本地 `nextId(prefix)` 用 |

**软删规则**：`children` / `tasks` / `rewards` 用 `deleted:true`，**读列表必须内存过滤 `deleted`**；`pets` 用 `released:true`（同理，因老文档可能缺该字段，`where released:false` 会漏匹配）。

### 错误码目录

| 类别 | 码 |
|---|---|
| 通用 | `INVALID`、`NOT_FOUND`、`FORBIDDEN`、`AUTH_FAIL`、`TOKEN_INVALID`、`NOT_IMPLEMENTED`（api 层） |
| PIN | `PIN_INVALID`、`PIN_NOT_SET`、`PIN_SCHEME_STALE` |
| 看板/打卡 | `NO_CHILD`、`CHILD_NOT_FOUND`、`TASK_NOT_FOUND`、`ALREADY_DONE` |
| 兑换 | `REWARD_NOT_FOUND`、`ALREADY_REDEEMED`、`INSUFFICIENT` |
| 宝宝 | `LIMIT`（>6）、`LAST_CHILD` |
| 宠物 | `ALREADY_HAS_PET`、`PET_NOT_FOUND`、`FEED_LIMIT`、`INSUFFICIENT` |

---

## 6. 关键不变量（改了就会出事）

1. **连续天数只用流水重推**。历史 `child.streak` 增量计数器在**补打卡场景会算错**（2026-09-18 修复展示口径）；该字段属「写而不读」的死字段，**已于 2026-10-10 彻底移除**。展示一律走 `displayStreak`（由打卡流水推导）。`applyCheckIn` 现**只返回 `{ totalStars }`**（不再返回/写回任何派生字段）；同样写而不读的 `lastCheckInDate` 亦于同日移除。
2. **stage 不入库**，由 `growthValue` 派生。
3. **奖励无库存**。限次只由「是否已兑换过」承担（`resetAfterRedeem`）。
4. **任务未设重复 → 生效后每天可见**（不是仅生效当天）。
5. **PIN 镜像 4 处**：`lib/pin.js`（源）+ 13 份 lib 副本（`npm run sync`）+ `services/local.js` 常量 + 测试断言。改位数/哈希必递增 `PIN_SCHEME`。
6. **本地包内图片禁用 webp**（`<image>` 不解析本地 webp，仅网络资源有效）→ 一律 PNG-8（256 色量化 + 透明）。
7. **设计稿换算比 1px ≈ 1.923rpx**（750rpx = 屏宽）。配色只认 `app.wxss` 的 CSS 变量，**不得自行改配色**（视觉基线 `docs/design-雨宝记-UI.html`）。
8. **弹层交互约定**：`.mask` 绑 `bindtap="关闭"`、`.sheet` 绑 `catchtap="noop"`。**绝不要在 `.mask` 上写 `catchtap`**（会吞掉蒙层点击 → 「点哪儿都关不掉」，已踩过）。
9. **表单弹层必须带 `.sheet-x` 关闭按钮**（只有底部「保存」时用户会以为无法取消）。
10. **`<input>` 必须显式 `height` + `line-height`，`padding` 只留左右**（小程序 input 自带固定高度，上下 padding 会压扁内容区 → 文字只露一半）。

---

## 7. 隐式前提 / 排查清单

### 「元素在但看不见」优先级顺序
**先怀疑高度与层级，再怀疑数据。**

| 症状 | 首查 |
|---|---|
| 弹层底部按钮点不到 | 是否漏登记 `SHEET_KEYS` → tabBar 未隐藏 |
| 内容区空白 | 容器高度归零 / 误用 `scroll-view`（本项目**禁用 scroll-view**，改容器 `overflow:auto`） |
| input 文字被裁 | 是否只写了上下 padding（见 §6.10） |
| 弹层关不掉 | `.mask` 是否误写 `catchtap` |
| 数据「没更新」 | 受控刷新是否用递增计数触发 |

### 其他
- **弹层最大高 78vh**（`.sheet{max-height:78vh}`）。
- 层级约定：`fab 95 < 页面弹层 200 < day-sheet 300 < emoji-picker 400 < pin-pad 500`；自定义 tabBar = 90。
- **本机环境坑**：删除文件只能用 `node -e "fs.rmSync(...)"`；Git Bash 的 `rm` / PowerShell `Remove-Item` 在本机**静默失效**。git 在坏 Git Bash 下用 `node -e "require('child_process').execFileSync('git',[...])"`。
- 开发者工具「预览」走系统代理：Clash `127.0.0.1:7897` 未运行会 `ECONNREFUSED` → 切「不使用任何代理」。

---

## 8. 已知架构债（改进方向候选）

按「对架构演进的影响」排序，每条都附现状证据：

| # | 债务 | 现状 | 改进方向 |
|---|---|---|---|
| D1 | ~~双份镜像无单一来源~~ | ~~`domain/tasks/pets` 3 组逻辑各存两份，靠守卫测试兜底~~ | **已销债（2026-10-10 第四批）**：`gen-mirror.js` 扩出 **section 模式**（源侧 `// ==MIRROR-SECTION:<name>==` → 前端 `// ==MIRROR-SLOT:<name>==` 注入，其余内容原地保留）；seed/pets 走 whole 整文件模式，domain（util/streak/level/checkInCore/redeemCore 五段）/tasks（visibility 一段）走 section。前端 6 文件全部**机生成**，现 **whole 3（seed/pets/dashboard）+ section 7（util/streak/level/checkInCore/redeemCore/visibility/buildFeed）**，`mirror-sync.test.js` 守卫（覆盖范围**从配置派生**，不再写死名字数组）。**仍双份手写**的只剩 `REDEEM_BLOCK_MSG` / `petView` / PIN 常量（见 §4.2 第二张表） |
| D2 | **lib 副本膨胀** | `setup.js` 把 15 个 lib 文件复制进 13 个函数目录 = 195 个副本（占 cloudfunctions 下 210 个 js 的 93%），改 lib 后必须记得 `npm run sync` | **已立安全网（2026-10-09 候选②-A）**：`setup.js --check` + `npm run verify:lib` + `__tests__/lib-sync.test.js` 守卫，改 lib 忘跑 sync → 测试/校验立即变红；**盲区补盲（2026-10-09 Phase A）**：此前安全网只校 lib↔副本、不校「前端 services ↔ 云端云函数」的 D1 级镜像，`petView` / `REDEEM_BLOCK_MSG` 已加 `__tests__/mirror-guard.test.js` 守卫；体积问题仍待 V1.1 公共依赖方案 |
| D3 | ~~`services/local.js` 单体~~ | ~~842 行→E 后 774 行，一个文件承担 14 个操作 + 校验 + 哈希 + 视图映射~~ | **已销债（2026-10-10）**：按域拆为 `services/local/{store,auth,dashboard,checkin,task,reward,child,feed,pet,demo}.js`，`local.js` 只做聚合导出（导出集/签名不变，`ops.test.js`/`pet.test.js` 守卫）；行为语义零变更（`npm test` 全绿） |
| D4 | **页面 JS 偏大** | 实测（2026-10-11 候选④后）：`home.js 298` / `pet.js 267` / `mine.js 258` / `tasks.js 212` / `feed.js 112`（第四批前为 383/387/333/222） | **已缓解（2026-10-10 第三·四·五批 + 2026-10-11 候选④）**：纯展示计算下沉 5 个纯函数模块——`utils/calendar.js`（日历格/月份增减）、`bubble.js`（气泡配色）、`confetti.js`（礼花粒子）、`pet-page.js`（宠物页 data 映射）、`child-form.js`（宝宝表单构造），共减 **~230 行**，行为级单测 `page-utils.test.js`；mine 的选图长流程（~96 行）抽为 `behaviors/child-photo.js`；**候选④** 再把家长模式开关/闸门收进 `behaviors/parent-gate.js`（8 处内联判定 + 3 份 `toggleParent` 拷贝），五页再减 **~69 行**。**弹层开关 `openX/closeX` 样板经评估判为负收益、不再抽**：可归约的纯样板仅约 4 个弹层（help/about/stats/icon，其余 opener 带守卫或表单初始化），收敛需改约 20 处 wxml 并撞 `pet.test.js` 对 `closeName` 的断言，净行数≈0、风险>收益 |
| D5 | **注释口径漂移** | `miniprogram/services/local.js:2` 仍写「接口契约与 **8 个云函数**完全一致」，实际 **13 个**；`lib/token.js` 内的「8 个云函数」属历史设计说明（`docs/README-小程序.md` 已记录 8→13 的修正）。功能无影响，但会误导读代码的人 | **已销债（2026-10-10）**：`local.js`（现为聚合出口）顶部注释已改「13 个云函数」（原写 8）；D3 拆分后该注释保留于 `services/local.js`。`ops.test.js` 的「云函数目录 ↔ ops.js ↔ local.js 导出」三者一致守卫不变；`lib/token.js` 的「8 个云函数」为历史设计说明，保留不动 |
| D6 | **密钥治理 —— 已修复（2026-10-09）** | 原为「env 缺失即回退硬编码弱密钥」（`xiaoyu-dev-secret-change-me` / `xiaoyu-pin-salt`），属静默失败：忘配环境变量也能正常跑，而家长令牌可被任何人伪造。**现已改为惰性 fail-fast**：`lib/token.js` 的 `getSecret()` 与 `lib/pin.js` 的 `getSalt()` 在使用点抛错（不在模块加载时抛，否则打挂 tests）。同日**轮换密钥**：旧值曾随 `README-小程序.md` 进入 git 历史（commit `3e65934`/`7ce1e9f8`），按泄露处理 | 剩余仅平台操作：V1.1 上云前把新值配进 13 个云函数的环境变量（全函数一致）。守卫 `__tests__/secret-guard.test.js` 防回退 |
| D7 | **本地层静默解锁绕过 PIN** | `unlockParent({silent:true})` 本地可免 PIN 签发令牌（设备信任模型），云端未接入 | 云端接入设备信任后再放开；当前若误开云端会退回「不静默」，属安全设计而非 bug |
| D8 | **无静态类型 / lint 刚起步** | **已立 `tools/lint.js`（2026-10-09 Phase C）**：零依赖，3 条规则（require 相对路径可解析 / 禁 `debugger` / `miniprogram` 内禁 `console.log`），基线 0 问题并已接入 `npm test`。范围刻意排除 `cloudfunctions/*/lib/` 生成副本（漂移归 `verify:lib`）。**类型标注（2026-10-10 第四·五批）**：纯逻辑模块 `domain / tasks / calendar / bubble / confetti / pet-page / icons / storage` 已加 `// @ts-check` + JSDoc；**D8 收口（第五批）**：新增 `miniprogram/types/globals.d.ts`（wx/getApp/Page… 最小 ambient 声明）+ 仓库根 `jsconfig.json`，含 `wx` 全局的模块此后可逐文件 opt-in（本次以 `storage.js` 示范）；仍**仅 IDE 提示**，零依赖、不装 tsc、不进 CI | **未做 `eslint`**（与零依赖风格冲突、需为 195 个副本配 ignore）；镜像纯模块（`dashboard/feed/pets/seed`）故意**不加** `@ts-check`（避免破坏双份镜像对称，其正确性由 aggregate/mirror 守卫保证）。类型安全其余仍靠约定 + 测试。lint 含行内 `// lint-ignore` 豁免（用于生成器里「描述代码」的字符串） |
| D9 | **命名不一致** | 本地 `xy_checkIns` vs 云端集合 `checkIns`；历史 `xiaoyu` 前缀 | 属刻意保留，不建议改；如需统一，走一次性迁移脚本 + 幂等守卫 |
| D10 | **`resetAll` 只在本地** | `services/local.js` 导出演示用 `resetAll`，无云端对应 | 保持现状即可（否则云上会「一键删数据」）；如需云端重置请加二次确认 + 令牌 |
| D11 | ~~令牌传递散布 5 页~~ | ~~4 处手写 globalData 三行赋值 + ~21 处 parentToken 传参~~ | **已销债**（2026-10-08，ADR-0001 + `utils/parent-session.js`）：页面零令牌感知，守卫测试防回归 |
| D12 | **云端 13 函数授权/上下文重复** | 13 个 index.js 各自内联手写 OPENID 解析/用户解析/令牌校验/归属校验，字面同源无单源（候选 A 之前「人工对齐」漂移高发区） | **已缓解（2026-10-10 候选 A）**：收敛到 `cloudfunctions/lib/runtime.js` 三原语（resolveCaller/assertToken/ownedChild，单源 + `npm run sync` 分发 + `__tests__/runtime-guard.test.js` 守卫）；特例 setPin 条件令牌 / login 自建号 / unlockParent 签发令牌 / feedCRUD 子函数令牌保留手写。本地 `services/local.js` 未动（D3 仍待 V1.1 拆分） |
| D13 | ~~看板/动态业务聚合双份手写~~ | ~~「原始记录→视图模型」组装在云端与本地各手写一遍，无守卫~~ | **已销债（2026-10-10 抽纯函数 → 2026-10-11 候选⑤ 升级为机生成镜像）**：`lib/dashboard.js`(buildDashboard) 与 `lib/feed.js`(buildFeed) 为唯一源，前端 `utils/dashboard.js` 走 whole 镜像、`utils/feed.js#buildFeed` 走 section 镜像，**逐字节守卫**取代原来的单样本行为对比。端到端另有 `__tests__/aggregate-guard.test.js`（双端 getDashboard / feedCRUD list 输出一致 + runtime 原语漏 require 静态扫描；该守卫曾当场抓到 `feedCRUD/index.js` 漏 `require('./lib/runtime')` 的真实 bug） |
| D14 | **投喂上限判定双份内联** | `cloudfunctions/petCRUD/index.js` 与本地兜底层各自内联「今日投喂次数 / 达限」判定（`((pet.daily||{})[today]||{}).feed >= PET_FEED_DAILY_LIMIT`），无共享纯函数（D13 同类盲区，`mirror-guard` 只校 petView 键集不校值） | **已销债（2026-10-10 候选 C）**：收敛到 `pets.js` 单源 `feedCountToday`/`canFeed`（云端 lib 与前端 utils 双镜像 + `pet.test.js` 值级守卫），两处调用点只调本函数；`pet.test.js` 静态断言改为「必须走 `P.canFeed`、禁止内联」 |
| D16 | **云端归属回退导致越权（已修复）** | `cloud.js#getOwnedChild` 末尾 `\|\| r.data[0]` 把「归属校验」与「默认选中」两重语义塞进一个函数：① checkIn/redeem 传他人 childId 会静默落到自己第一个宝宝；② `taskCRUD`/`rewardCRUD` 传 `task.childId` 时回退必然命中 → `FORBIDDEN` 分支成为**死代码**（可改删他人任务/奖励）；③ checkIn 取任务**不校验 task 归属**（可用他人 taskId 打卡计分）。本地层是严格 `find` 无回退，故本地表现正常、掩盖了云端缺陷（云端从未实跑） | **已销债（2026-10-10 候选②）**：新增 `lib/ownership.js` 纯函数（`pickOwned` 严格 / `pickCurrent` 回退 / `isOwnedResource`）；`cloud.js` 改为 `ownedChildren`（内存过滤软删）+ `getOwnedChild`/`getCurrentChild`/`childIdsOf`；`runtime.js` 导出 `ownedChild`/`currentChild`/`ownedTask`/`ownedReward`；7 个云函数统一走原语（childSwitch 删手工补刀、petCRUD/feedCRUD 删自写实现）。顺带修 getDashboard 的 `deleted:false` 谓词（候选③）。守卫 `__tests__/ownership-guard.test.js`（16 用例，含 3 条静态防回归） |
| D17 | ~~`npm test` 是手工文件清单~~ | ~~`package.json` 硬编码 23 个测试文件路径；新增守卫漏登记即**静默失效**（已踩：ownership-guard 首轮未被纳入，160 全绿却没跑到）~~ | **已销债（2026-10-10）**：改为 `node --test "__tests__/*.test.js"`（**Node 22 自己展开 glob**，故 cmd.exe 下也成立；注意 `node --test __tests__/` 在本机不可用——会被当成模块路径报 MODULE_NOT_FOUND）。新增测试文件**自动纳入、无需登记** |
| D18 | **家长令牌 TTL 三份真值（已修复）** | 「令牌多久过期」散成三份：`config.js`=1 年（R10.1）、`local/auth.js` 读 config ✅、`unlockParent/index.js` **硬编码 5 分钟** ❌，且 `lib/token.js#issueToken` 还有 5 分钟默认值兜底。云端从未实跑故一直未暴露；填 `CLOUD_ENV` 后 100% 复现（5 分钟过期 + 云端不静默解锁 = 每次写操作弹 PIN） | **已销债（2026-10-10 候选①）**：新增 `lib/session.js#PARENT_TOKEN_TTL_MS`（云端单一政策源）；`unlockParent` 改为引用它；`issueToken` **删除 TTL 默认值**（强制显式传参，把决策逼到调用面）。守卫 `__tests__/token-ttl-guard.test.js`（6 用例：两端常量相等 + 均为 1 年 + 4 条静态守卫）。改 `lib/token.js` 后须跑 `npm run gen:mirror`（它是 `utils/domain.js` 的镜像源） |
| D19 | **云端写路径零守卫** | 所有 guard 里的 db 桩 `doc().update()/remove()` 都是 `Promise.resolve({})` **空操作**（`aggregate-guard:68`、`view-shape-guard:118`）→ 云端写操作（建/改/删任务奖励、打卡、兑换、投喂、动态撤销…）的**落库结果从未被验证**；而 `CLOUD_ENV` 一开这些就是生产路径（云端从未实跑）。唯一有真实存储的只有 `child-rules-guard` 的 children 集合 | **已销债（2026-10-13）**：新增 `__tests__/helpers/cloud-db.js`（**真会写**的内存 db：add/update/remove 真改库 + `runTransaction` + `command.in`）与 `__tests__/cloud-write-guard.test.js`（**双端对拍**：本地层=oracle，同初态同操作 → 断言「返回体 + 全部集合末态」逐字段一致，规范化 `_id`/`ownerId`/`*At`）。首轮覆盖 taskCRUD / rewardCRUD / checkIn / redeem / petCRUD(adopt·feed·stroke·rename·reset·release) / feedCRUD(undoCheckIn·undoRedeem)。拦截实测：把云端打卡流水写错集合名 → 守卫立即变红 |
| D20 | **守卫基建复制 3–8 份（已销债）** | 测试公共基建在多文件各抄一份**且已分叉**：`matchBrace` 3 份（逐字相同）；注释/字符串剥离 4 份——`aggregate-guard` 用朴素正则 `stripComments`，**非字符串感知**（注释里的示例代码会被误判）；`functionBlock` 2 份**已分叉**（含签名 vs 仅函数体）；`objectLiteralAfter`/`arrowBlock`/`evalObj` 各 2 份；wx.storage mock **8 份**；`Module._load` 拦截 2 份；内存云 `dbMock` 2 份（`update/remove` 是 **no-op** 的劣质版，而 `helpers/cloud-db.js` 已是忠实版）；`read` 7 份 / `keysOf` 3 份 | **已销债（2026-10-13 候选⑥）**：收敛到 `__tests__/helpers/` 三个单一来源——`js-source.js`（文本工具；`strip` **re-export 自 `tools/lint.js`**，规范实现留在 tools，因 tools 不可依赖 `__tests__/`）+ `wx-storage.js` + `cloud-db.js`；9 个消费文件改为 import，两份劣质 `dbMock` 换成 `createHarness()`（行为等价，因它们只走读路径）。`functionBlock` 统一为「含签名」（4 个调用点均兼容）。守卫 `__tests__/test-infra-guard.test.js`（防再复制 + 断言 helpers 接口与命名） |
| D15 | ~~`child.streak` / `lastCheckInDate` 死字段~~ | ~~历史增量计数器与最后打卡日，写而不读（展示走 `displayStreak` 由流水重推）~~ | **已销债（2026-10-10 第三·五批）**：`applyCheckIn` 现只返回 `{ totalStars }`（签名由 `(child,score,date)` 收敛为 `(child,score)`），不再返回/写回 `streak` 与 `lastCheckInDate`；cloud `checkIn`/`login`/`childCRUD` 与本地 `local/{auth,child,checkin}.js` 建号/打卡写入同步移除；`core.test.js` 断言两者均已消失。**无遗留** |

---

## 9. 常用命令与工作流

```bash
npm test          # 28 个测试文件（node:test，无依赖，glob 自动发现）—— 215 个用例（含 mirror-guard/view-shape-guard/child-rules-guard/runtime-guard/aggregate-guard/**cloud-write-guard**/mirror-sync/page-utils/lint/secret-guard/ownership-guard/token-ttl-guard/parent-gate/behavior-shape/**test-infra-guard** 等守卫）
npm run check     # 全量语法解析（miniprogram/cloudfunctions/__tests__/tools，333 文件；.d.ts 不在扫描范围）
npm run lint      # 静态检查 110 个手写文件：require 路径可解析 / 禁 debugger / miniprogram 内禁 console.log（已接入 npm test；支持行内 `// lint-ignore` 豁免）
npm run sync      # ⚠️ 改过 cloudfunctions/lib/ 后必跑：重建 package.json + 复制 lib 到 13 个函数（现 15 文件/函数）
npm run verify:lib # 校验 lib 源与 13 目录副本逐字节一致（防忘 sync 漂移；已接入 npm test 守卫）
npm run gen:mirror    # ⚠️ 改过任一唯一源（lib/ 下 seed·pets·util·streak·level·checkInCore·redeemCore·visibility）后必跑：重建前端镜像
npm run verify:mirror # 校验全部生成式镜像与唯一源一致（whole 3 + section 7 / 6 个产物；已接入 npm test 守卫 __tests__/mirror-sync.test.js）
npm run acceptance      # tools/acceptance.js —— 数据层接口验收
npm run ui-acceptance   # tools/ui-acceptance.js —— WXML 结构验收
```

### 标准改动流程

```
改纯逻辑（domain/tasks/pets/seed）
  → 只改 cloudfunctions/lib/* 的**唯一源**（前端 utils/{domain,tasks,pets,seed}.js 是机生成镜像，勿手改）
      · pets / seed = 整文件镜像（改 `// ==MIRROR-BODY-START==` 之后的正文）
      · domain      = 改 lib/{util,streak,level,checkInCore,redeemCore}.js 的 `// ==MIRROR-SECTION:*==` 段
      · tasks       = 改 lib/visibility.js 的 SECTION 段
  → npm run gen:mirror（重建镜像）→ npm run sync（分发到 13 函数）
  → npm test（mirror-sync.test.js + 行为级守卫必须绿）

改数据操作（新增/修改 op）
  → services/local/<域>.js（D3 后按域拆分；新增导出须同步 services/local.js 聚合）
    + cloudfunctions/<name>/index.js + setup.js FUNCTIONS
  → npm test（pet.test.js 有「本地函数集与云函数集一一对应」守卫）
  → npm run acceptance

改 UI（wxml/wxss）
  → 开全屏弹层？→ 登记 SHEET_KEYS
  → 新增图标？→ 只用单码位 emoji（core.test.js 有守卫）
  → npm run ui-acceptance + npm run check
```

### 每次交付自检
`APP_VERSION` 是否递增（否则「关于」页仍显示旧版本，说明开发者工具没编译到最新代码）。

---

## 10. 发布状态与待办（架构相关）

- **已完成**：v1.0 本地层全功能、**215/215 测试**、全量语法 0 错误（333 文件）、lint 0 问题、宠物模块定稿、隐私授权闸门修复；**候选⑥「守卫基建复制 3–8 份」已销债**（2026-10-13：收敛到 `__tests__/helpers/{js-source,wx-storage,cloud-db}.js` 三个单一来源，消除 2 处真分叉——`strip` 的朴素正则版与 `functionBlock` 的双语义；两份劣质 `dbMock` 换成 `createHarness()`；新增 `test-infra-guard` 防再复制，见 §8 D20）；**架构复盘候选②「云端归属回退导致越权」已修复**（2026-10-10：`lib/ownership.js` 纯函数 + runtime 双原语 + 7 个云函数统一 + 16 用例守卫，详见 §4.4b 与 §8 D16）；**候选①「家长令牌 TTL 三份真值」已修复**（`lib/session.js` 单一政策源 + `issueToken` 取消默认值兜底 + 6 用例守卫，§8 D18）；**候选⑤「看板/动态聚合双份手写」已接 gen-mirror 单源**（`utils/dashboard.js` whole + `utils/feed.js#buildFeed` section，由「单样本输出对称」升级为**逐字节守卫**，2026-10-11）；**候选④「前端家长模式开关/闸门 8 处散写」已收拢**（`utils/parent-gate.js` + `behaviors/parent-gate.js`，五页接入 + 清除 `onAppTouch` 死链路 + 移除五页死 import，13 用例守卫，2026-10-11）；**候选④ 上线回归已修复**（2026-10-11：`behaviors/parent-gate` 方法移入 `methods:{}` + `isParent` 回退全局 `getApp()` + 新增 `behavior-shape` 装配守卫，见 §4.4）；**D19「云端写路径零守卫」已销债**（2026-10-13：`__tests__/helpers/cloud-db.js`（真会写的内存 db）+ `__tests__/cloud-write-guard.test.js`（**双端对拍**，本地=oracle），覆盖 taskCRUD / rewardCRUD / checkIn / redeem / petCRUD / feedCRUD(undo)，见 §8 D19）；**D17「npm test 手工清单」已销债**（改 glob 自动发现，新增测试无需再登记）；架构阶段 ①令牌会话 / ④删旁路 / ③ops表 / ②-A(sync安全网) / **Phase A(petView·REDEEM_BLOCK_MSG 镜像守卫)** / **Phase B(家长 PIN 闸页面样板收敛)** / **Phase C(D8 静态检查 tools/lint.js)** 均已落地；**D6 密钥治理已修复**（兜底移除 + 密钥轮换 + 守卫）；**架构深化轨道（按提交粒度分五批）**——第一批（B′ 视图形状守卫 / B 宝宝档案校验守卫 / A `lib/runtime.js` 授权深模块 D12）、第二批（E 看板·动态聚合抽纯函数 D13）、第三批（D1 seed 单源试点 / D3 `local.js` 按域拆分 / C canFeed 单源 D14 / D `child.streak` 死字段 D15 / D5 注释口径修正）、第四批（D1 生成式单源扩至 pets/domain/tasks 的 **section 模式** / D4 页面纯函数下沉 + child-photo behavior / D8 `// @ts-check` 试点）、**第五批（2026-10-10）：D15 尾部 `lastCheckInDate` 移除 / D4 尾部 宝宝表单构造下沉（`utils/child-form.js`）/ D8 收口 类型声明基础设施（`types/globals.d.ts` + `jsconfig.json`）** 全部落地。
- **D6 剩余（平台操作，非代码）**：V1.1 上云前把新的 `XY_TOKEN_SECRET` / `XY_PIN_SALT` 配进 13 个云函数环境变量（值见 `docs/README-小程序.md` §3.4，该文件 gitignore）。**v1.0 本地单机模式不依赖这两项，不影响上线**。
- **顺延 V1.1（云侧）**：云端部署 → `CLOUD_ENV` 填写 → R10 云端静默解锁 → `petCRUD` 云上线 → 密钥轮换。
- **v1.0 发布状态（2026-10-11 00:2x 更新）**：**🎉 已正式上线**（用户已在 MP 后台完成「提交发布」）。全流程：2026-10-09 提交审核 → 2026-10-10 审核通过 → 2026-10-11 手动发布上线。门 A 真机走查 / 门 B 代码三关 / 门 C 平台侧全部通过。
  - ⚠️ **线上运行的是本地单机版**（`CLOUD_ENV=''`），线上代码 = 提交审核时的版本（HEAD 附近）。**v1.0 上线后本地的架构改动（D16/D17/D18/D13）尚未上传**，会在下次发版（V1.1 或 v1.0.x 补丁）时随包发布。
  - ⚠️ 此后改动 `miniprogram/` 会影响线上包 —— 每个改动都需重新上传 + 提审才能生效。
  - ⚠️ 发布前**不要**在开发者工具上传新代码——会覆盖「审核通过待发布」的版本。五批架构改动（`718f897` → `99114b4` → `dc15323` → `ba41387` → `5934ba9`）仅落**本地 git**，与线上运行无关，**待 V1.1 云化或下次发版时再上传**。
- **AppID**：`wxb80f4e43f9c99714`（本人账号）；备案主体 个人。服务类目：原定「工具-效率」**已于 2026-10-09 核实下线**，改选「工具-备忘录」（可加「工具-日历」），见 `docs/v1.0-release-checklist.md` §3.0。
- **平台侧进度**：隐私指引 ✅ 已审批通过；个人备案 ✅ 已完成、备案号已回填 `config.js`（assume-unchanged，不入库）；平台注册名 ✅ 已改「雨宝记」；门 A 真机走查 ✅ 已通过；服务类目 ✅ 已改选「工具-备忘录」；提交审核 ✅ 已完成并通过（2026-10-10）。

---

*本文件由代码实况反推生成，用于降低后续架构改进的认知成本。修改架构后请同步更新 §2 / §4 / §5 / §8。*
