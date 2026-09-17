# 小雨记 MVP 逐任务详细计划（TDD 实施规格）

> 关联：PRD-小雨学习打卡笔记.md（v0.5）、PLAN-小雨记-MVP实施计划.md、design-小雨记-UI.html（视觉基线）
> 目标：把 20 个 MVP 任务逐一展开为**接口签名 + 集合 Schema + 边界/异常 + TDD 失败用例清单 + 依赖**，供独立会话窗口按 Superpowers 流程（先写失败测试→红→绿）实现。
> 约定：**本文件只描述规格，不含实现代码。**

---

## 0. 工程结构与测试策略

### 0.1 目录（建议）
```
/xiaoyu-mini
 ├─ miniprogram/                 # 小程序前端
 │   ├─ app.js  app.json app.wxss
 │   ├─ pages/
 │   │   ├─ home/                # Tab1：打卡+兑换子页签
 │   │   ├─ tasks/               # Tab2：任务+奖励子页签（含 FAB 与编辑/新建弹层）
 │   │   └─ mine/                # Tab3：家长模式切换/PIN/多孩子/帮助/关于/邀请码
 │   ├─ components/              # lock-icon / pin-pad / emoji-picker / day-sheet / confetti
 │   └─ utils/                   # 前端纯逻辑（排序、旗子映射、图标回写）
 ├─ cloudfunctions/
 │   ├─ login/  unlockParent/  getDashboard/
 │   ├─ checkIn/  redeem/  taskCRUD/  rewardCRUD/  childSwitch/
 │   └─ lib/                    # 共享纯逻辑（被云函数引用，可 jest 单测）
 │       ├─ auth.js  token.js  streak.js  level.js
 │       └─ redeemCore.js  checkInCore.js
 └─ __tests__/                   # jest 用例（与 lib 一一对应）
```

### 0.2 TDD 策略（关键）
- **可测逻辑全部下沉到 `cloudfunctions/lib/` 纯函数**：无 `wx-server-sdk` 依赖、无 IO，参数进/结果出，便于 `jest` 红绿。
- **云函数 `index.js` 为薄壳**：解析入参 → 调用 lib → 读写集合 → 返回。薄壳可用开发者工具手动验证，不强制单测。
- **前端纯逻辑**（任务创建时间排序、旗子映射、图标回写、打卡后列表下移）抽进 `miniprogram/utils/`，`jest` 或小程序测试库覆盖。
- **红绿纪律**：每个 lib 函数先写失败测试（断言输入→期望输出），跑红，再写实现跑绿；不允许先写实现。
- **token 后台失效 vs 切后台**：服务端只校验 `expireAt`（5min 空闲）；客户端在 `App.onHide` 主动清掉内存 `parentToken`，实现"切后台即失效"。两端共同满足 PRD-ACC-03。

### 0.3 集合 Schema（终版，统一 `ownerId` 便于 V1.1 多账号解耦）
| 集合 | 字段 | 索引/约束 |
|------|------|-----------|
| `users` | `_id, openid(uni), randomCode(16位), nickname, avatar('🧒'), pinHash, pinSet(bool), createdAt` | openid 唯一 |
| `children` | `_id, ownerId, name, avatar, totalStars(int,默认0), streak(int,默认0), lastCheckInDate('YYYY-MM-DD'\|null), createdAt` | (ownerId) |
| `tasks` | `_id, ownerId, childId, title, type('habit'\|'chore'), icon(emoji), date('YYYY-MM-DD' 生效日), repeat{enabled(bool),type('day'\|'week'),interval(int),weekdays(int[0-6])}, score(int≥1), priority('high'\|'mid'\|'low'\|'none'), createdAt, deleted(bool)` | (ownerId, childId, deleted=false) |
| `rewards` | `_id, ownerId, childId, title, icon(emoji), category('reward'\|'punish'), resetAfterRedeem(bool 不限次), cost(int≥1), stock(int), baseStock(int 原值,不限次时重置依据), createdAt, deleted(bool)` | (ownerId, childId, deleted=false) |
| `checkIns` | `_id, ownerId, childId, taskId, date('YYYY-MM-DD'), score(int), createdAt` | **唯一 (ownerId, childId, taskId, date)** |
| `redemptions` | `_id, ownerId, childId, rewardId, cost(int), status('completed'), createdAt` | (ownerId, childId) |
| `pointsLog` | `_id, ownerId, childId, delta(int 可负), reason(string), refType('checkin'\|'redeem'), refId, createdAt` | (ownerId, childId) |

> `children.totalStars` 为缓存值，所有加减均由 checkInCore / redeemCore 原子维护，删除任务/奖励**不回退**（流水保留对账）。

---

## 阶段 A：基座与鉴权

### T1 `login` 云函数 + 单测
- **目标**：静默登录，按 openid 查重/建号，返回 user + `pinSet`。
- **接口**：`exports.main = async ({ OPENID }) => ({ user:{_id,nickname,avatar,pinSet}, pinSet })`
- **行为**：
  - 查 `users` 无 `openid` → 建号：`randomCode`=16位 `[A-Za-z0-9]`，`nickname`=随机蔬菜名+"宝宝"（如"番茄宝宝"），`avatar='🧒'`，`pinHash=''`，`pinSet=false`。
  - 有 → 返回现有 user。
- **边界**：openid 缺失 → 抛 `AUTH_FAIL`；并发首登竞态 → 用 openid 唯一索引兜底，捕获 duplicate 后回查。
- **TDD 失败用例**：
  1. 新 openid → 返回 `pinSet:false` 且 `randomCode` 长度 16、含字母数字。
  2. 同 openid 第二次 → 返回同一 `_id`（不重复建号）。
  3. 首登后自动建 1 个 `children` 档案（ownerId=用户，`name` 默认"宝宝"，`totalStars:0`）→ 返回 `childId`。
  4. openid 为空 → 抛错码 `AUTH_FAIL`。

### T2 `users` 集合权限 + `app.globalData` 登录流
- **目标**：集合权限设「仅创建者可读写」；`app.js onLaunch` 调 `login` 写入全局态。
- **接口（前端）**：`app.globalData = { user, childId, mode:'display', parentToken:null, parentTokenExpire:0 }`
- **行为**：`onLaunch` → `wx.cloud.callFunction({name:'login'})` → 存 `user/childId`；`onHide` 清 `parentToken`（切后台失效）；`onShow` 若 `parentTokenExpire<now` 退回 display。
- **边界**：登录失败 → `wx.showToast` 并停留展示模式；云环境未初始化 → 提示重试。
- **TDD 失败用例**：
  1. 启动后 `globalData.user` 非空且 `childId` 存在。
  2. `onHide` 后 `parentToken` 置 null。
  3. 启动 `wx.cloud.init` 在 `onLaunch` 首行完成（早于 login 调用）。

### T3 `unlockParent` + `parentToken` 校验中间件 + 单测
- **目标**：PIN 校验 → 签发 `parentToken`（5min）；所有写云函数前置校验。
- **接口**：`unlockParent(pin) -> { parentToken, expireAt }`；中间件 `verifyParentToken(token) -> bool`。
- **lib/token.js 纯函数**：
  - `issueToken(secret, ttlMs=300000) -> {token, expireAt}`（`token`=32位 hex，`expireAt=Date.now()+ttlMs`）。
  - `verifyToken(token, store) -> bool`（`store.has(token) && store.get(token).expireAt > Date.now()`）。
  - 服务端用 `Map<token,{openid,expireAt}>` 作 store（内存，重启失效即可）。
- **行为**：`unlockParent` 用 `pinHash` 比对（bcrypt/加盐 sha256）；成功入 store 返回 token；失败返回 `{ok:false}`。
- **边界**：未设 PIN（`pinSet=false`）→ 拒绝并提示去设置；token 过期 → 写函数返回 `TOKEN_EXPIRED`；token 伪造/缺失 → `TOKEN_INVALID`。
- **TDD 失败用例**：
  1. `issueToken` 输出 32 位 hex 且 `expireAt≈now+300000`。
  2. 有效期内 `verifyToken` 真；`expireAt` 改过去 → 假。
  3. 篡改 token 串 → `verifyToken` 假。
  4. 正确 PIN → 返回 token；错误 PIN → `ok:false`；`pinSet=false` → `PIN_NOT_SET`。

### T4 家长模式闸 UI（PIN 遮罩）+ 双入口
- **目标**：6 位圆点 + 数字键盘遮罩；首页锁图标 / 「我」页切换行两处均调 `toggleParent()`。
- **接口（前端）**：`toggleParent()`：display→`openPin()`；parent→`setMode('display')`；`pinSet=false`→toast 去「我」页设置。
- **行为**：`pinInput(n)` 累计 6 位 → 调 `unlockParent` → 成功 `setMode('parent')` 并 confetti；失败 `pinErr` 抖动清空。
- **边界**：非数字忽略；超过 6 位截断；切后台遮罩关闭（防 PIN 残留屏）；连续 5 次错 → 锁定 30s（可选，MVP 可仅 toast）。
- **TDD 失败用例**（前端纯逻辑 `pinReducer`）：
  1. 输入 "123456" → 长度 6 触发提交。
  2. 输入 "12a3" → 过滤非数字剩 "123"。
  3. 已 6 位再输入忽略。
  4. `toggleParent` 在 `pinSet=false` 时不弹 PIN 而 toast。

---

## 阶段 B：孩子看板（展示模式）

### T5 `getDashboard` 聚合
- **目标**：返回某 `childId` 看板数据：星星、连续天数、星级、当月点亮日、今日任务（含是否已打卡）。
- **接口**：`getDashboard(childId) -> { totalStars, streak, level, monthLit:[YYYY-MM-DD...], todayTasks:[{taskId,title,icon,score,priority,checked}], rewards:[...] }`
- **lib 纯函数**：
  - `streakOf(checkInDates:Set<string>, asOf:string) -> int`：从 asOf 向前数连续含打卡的日期。
  - `levelOf(streak:int) -> 1..5`：≥25→5, ≥18→4, ≥10→3, ≥4→2, 否则 1。
- **边界**：`childId` 非本账号 → 拒绝；无打卡 → `streak:0,level:1,monthLit:[]`；跨月 asOf 正确处理。
- **TDD 失败用例**：
  1. `streakOf`：连续 [09-15,16,17]、asOf=09-17 → 3；asOf=09-18（无打卡）→ 0；中间断一天 → 1。
  2. `levelOf`：25→5, 18→4, 10→3, 4→2, 3→1, 0→1。
  3. `getDashboard` 月跨边界：asOf 月初，上月打卡不计当月点亮。

### T6 首页打卡页签 UI（含可点击锁图标）
- **目标**：孩子信息 / 统计(星星+星级同行右对齐连续天数) / 日历点亮 / 任务清单；右上角锁图标可点击切换（≥40px 命中区，aria-label + 键盘）。
- **接口（前端）**：`renderLockStatus()`（统一渲染两页锁图标 + 「我」页切换行，含 `aria-label`/`title`/keydown）、`homeSub(btn)`。
- **行为**：锁图标 `onclick=toggleParent()`；闭锁灰 `#a9a2ba`、开锁珊瑚 `var(--coral)`；选中子页签带天蓝→薄荷底色、未选中白底（轨道 `#efeaf6`）。
- **边界**：家长模式关 → 首页打卡/兑换只读；点击锁图标开锁后才可写。
- **TDD 失败用例**（前端）：
  1. `renderLockStatus`：display → 两锁图标 class `locked` 且 aria-label="点击开启家长模式"；parent → `open` + "点击关闭家长模式"。
  2. 点击闭锁锁图标（pinSet=true）→ 调 `openPin`；开锁 → `setMode('display')`。
  3. 子页签切换：homeSub('redeem') → 兑换屏 `active`、打卡屏非 active。

### T7 首页兑换页签 UI
- **目标**：奖励列表（图标/名/分类/库存/cost，创建时间序）；展示模式无兑换按钮。
- **接口（前端）**：`renderRewards('#rewardList')`（不传 mode；点击 → `openRedeem`）。
- **行为**：库存 `stock>90` 显示 ∞（不限次）；星星不足时兑换确认按钮禁用（`openRedeem` 内校验）。
- **边界**：展示模式点奖励 → `openRedeem` 直接 toast「请点击右上角锁图标开启家长模式」返回（不弹确认）。
- **TDD 失败用例**：`renderRewards` 输出按 `createdAt` 升序；`stock>90` 渲染 ∞。

### T8 日历组件（当月网格 + 点亮）
- **目标**：当月日期网格，已打卡日点亮（pop 动效）；点击日期 → 弹日明细。
- **接口（前端）**：`renderCalendar(litDays:Set)`；`openDay(d)`。
- **行为**：今日圆环高亮；点亮日填充主色+✓；点击非本月灰显。
- **边界**：月底前/后补白格；litDays 来自 `getDashboard.monthLit`。
- **TDD 失败用例**：
  1. 给定 `litDays={09-17}` → 该格 class `lit` 且非今日格无 `today` 类。
  2. 今日（asOf）格带 `today` 类。
  3. `openDay(17)` → 弹层标题含 "9月17日"。

---

## 阶段 C：写操作（家长模式）

### T9 `checkIn` 云函数 + 单测
- **目标**：唯一校验 → 加分/连续天数/写 pointsLog；原子。
- **接口**：`checkIn({childId, taskId, date, parentToken}) -> {ok, totalStars, streak, level}`
- **lib/checkInCore.js 纯函数**（事务内调用）：
  - 校验 (childId,taskId,date) 唯一（查/插捕获 duplicate）。
  - `totalStars += score`；`streak` 更新：`date == lastCheckInDate+1天` → +1；`date == today 且 lastCheckInDate==today` → 不变；否则重置 1（并更新 lastCheckInDate）。
  - 写 `checkIns` + `pointsLog{delta:score, reason:'打卡:'+title, refType:'checkin'}`。
- **边界**：重复 → `{ok:false, code:'ALREADY_DONE'}`；`parentToken` 无效 → `TOKEN_INVALID`；`taskId` 不存在/已删 → `TASK_NOT_FOUND`；score 非正 → 拒。
- **TDD 失败用例**：
  1. 首打卡 → totalStars=score, streak=1。
  2. 昨日已打卡、今日再打 → streak+1。
  3. 隔日打卡 → streak 重置 1。
  4. 同日同任务二次 → `ALREADY_DONE`，星星不累加。
  5. 无 token → `TOKEN_INVALID`。

### T10 打卡交互（日明细弹层）
- **目标**：待打卡在上、已完成在下、淡分隔线无文字；家长模式点圆环即打卡（即时下移、弹层不关、滚动位保留）；展示模式点圆环 toast 去锁图标。
- **接口（前端）**：`openDay(d)` → `pickCheck(ev,id,d)` → `doCheck(id)`（调云函数，乐观更新）+ 重渲 `openDay(d)` 并恢复 `scrollTop`。
- **行为**：圆环空心蓝 `.chk.pick` 可点；已完成 `.chk.ok` 绿✓；打卡成功 confetti + toast `+score⭐`。
- **边界**：展示模式圆环 onclick → toast「请点击右上角锁图标开启家长模式」；弹层不关。
- **TDD 失败用例**（前端 `splitTasks`）：
  1. 给定 tasks（done 标记）→ `todo` 在前、`done` 在后、中间有 `day-sep`。
  2. 展示模式 `pickCheck` 调用 → 不触发 `doCheck` 而 toast。
  3. 打卡后 `openDay` 重渲且 `scrollTop` 保持。

### T11 `redeem` 云函数 + 单测
- **目标**：库存>0 且 totalStars≥cost → 原子扣星星/库存-1/写 redemptions(completed)/pointsLog。
- **接口**：`redeem({childId, rewardId, parentToken}) -> {ok, totalStars, stock}`
- **lib/redeemCore.js 纯函数**：
  - 前置：库存>0（`resetAfterRedeem` 不限次时 stock 视为 ∞，跳过库存校验）且 `totalStars>=cost`，否则 `INSUFFICIENT`。
  - 原子：`totalStars -= cost`；`resetAfterRedeem` 真 → 库存不变（重置为 baseStock 已实现）；假 → `stock-=1`，`stock==0` 标记下架（deleted 或隐藏）。
  - 写 `redemptions{status:'completed'}` + `pointsLog{delta:-cost, reason:'兑换:'+name, refType:'redeem'}`。
- **边界**：不限次奖励重复兑换库存恒为 baseStock；限次耗尽后不可再兑；并发兑换用事务防超兑。
- **TDD 失败用例**：
  1. 限次：stock=1,cost≤stars → 兑换后 stock=0,totalStars-cost。
  2. 不限次：resetAfterRedeem 真 → 多次兑换 stock 恒 baseStock。
  3. stars<cost → `INSUFFICIENT`，不扣。
  4. stock=0（限次）→ `OUT_OF_STOCK`。
  5. 无 token → `TOKEN_INVALID`。

### T12 兑换确认弹窗（家长模式）
- **目标**：点奖励 → 弹确认（需 ⭐N + 当前持有）；确认 → `redeem` → confetti。
- **接口（前端）**：`openRedeem(id)` → `confirmRedeem(id)`。
- **行为**：星星不足 → 确认按钮禁用 + toast；成功 → confetti + 列表刷新。
- **边界**：兑换页签仅家长模式可进确认；展示模式点奖励直接 toast（见 T7 边界）。
- **TDD 失败用例**：`openRedeem` 在 `stars<cost` 时不弹确认而 toast「星星不够」；`confirmRedeem` 成功后 `state.stars` 减 cost 且 `renderRewards` 两列表刷新。

### T13 `taskCRUD` + 任务列表/编辑/新建（弹出式图标）
- **目标**：建/改/删任务（软删）；列表纯维护、创建时间序、优先级旗子；弹出式图标选择器。
- **接口（云函数）**：`taskCRUD({op:'create'|'update'|'delete', parentToken, payload})`
  - create payload：`{childId,title,type,icon,date,repeat,score,priority}`
  - update：`{id, ...patch}`；delete：`{id}`（置 `deleted=true`）。
- **前端**：`renderTasksTab()`（创建时间序，`flagHtml(priority)` 高红🚩/中黄/低绿/无）、`editTask(id)`、`openCreate()`(task)、`iconField()`/`openIconPick()`。
- **边界**：标题/score 空拦截；删除二次确认；软删不回退星星；`childId` 非本账号拒绝。
- **TDD 失败用例**：
  1. `taskCRUD.create` 缺 title → `INVALID`；score<1 → `INVALID`。
  2. `flagHtml('high')` → 红🚩；`'none'` → 空。
  3. 列表渲染按 `createdAt` 升序（非 done 序）。
  4. delete → 集合 `deleted=true`，`pointsLog` 仍含历史（不删）。
  5. `iconField` 默认只渲染当前图标、`openIconPick` 弹出 64 格且高亮当前值。

### T14 `rewardCRUD` + 奖励列表/编辑/新建（tab 改名「奖励」）
- **目标**：建/改/删奖励（软删）；`renderRewards(listSel, mode)` 区分：任务与奖励页 `mode='manage'` 点进 `editReward`、首页兑换页签不传点进 `openRedeem`。
- **接口（云函数）**：`rewardCRUD({op, parentToken, payload})`；create 含 `category, resetAfterRedeem, cost, stock, baseStock`。
- **前端**：`editReward(id)`（分类 奖励/惩罚、兑换后重置 不限次/限次、cost）、`openCreate()`(reward)。
- **边界**：分类保留奖励/惩罚；不限次 `resetAfterRedeem=true` 且 `baseStock=cost?` 实为库存原值（Reward 无 cost 概念于库存，baseStock=初始 stock）；兑换后重置语义见 T11。
- **TDD 失败用例**：
  1. `renderRewards('#rewardManageList','manage')` 点击 → `editReward`；`renderRewards('#rewardList')` 点击 → `openRedeem`。
  2. create 缺 title/cost → `INVALID`。
  3. 删除奖励 → 已扣星星不回退（`pointsLog` 保留）。

### T15 删除二次确认 + 软删关联规则
- **目标**：任务/奖励删除统一二次确认弹窗；软删关联展示隐藏、流水保留。
- **接口（前端）**：`confirmDelete(kind,id)` → 调 `taskCRUD/rewardCRUD` delete。
- **边界**：确认前不执行；取消关闭；删除后列表立即移除该项。
- **TDD 失败用例**：`confirmDelete` 在未确认前不触发云函数；确认后列表不含该 id 且 `deleted=true`。

---

## 阶段 D：多孩子 / 我 / 收尾

### T16 `children` + `childSwitch` + childId 选择器
- **目标**：多孩子支持；家长模式切 `childId`，数据与看板隔离。
- **接口（云函数）**：`childSwitch({childId, parentToken})`（校验 ownerId）；前端「我」页 `childId` 选择器。
- **边界**：内测仅 1 档案，切换 UI 不报错；切后首页/任务/奖励全部按新 childId 重渲；非本账号 childId 拒绝。
- **TDD 失败用例**：`childSwitch` 后 `getDashboard(newId).totalStars` 与旧隔离；非 owner childId → `FORBIDDEN`。

### T17 PIN 设置/重置（PRD-ACC-03）
- **目标**：首次设 6 位 PIN（`pinHash`+`pinSet=true`）；修改需家长模式；遗忘经 OPENID 重置。
- **接口（云函数）**：`setPin({pin, parentToken?})`（首设无 token；改设需 token）；`resetPinByOpenid()`（验证 OPENID 后清空 pinHash，回 `pinSet=false`）。
- **边界**：PIN 非 6 位数字 → `INVALID`；首设后 `pinSet=true` 才允许 `unlockParent`；重置后须重设。
- **TDD 失败用例**：setPin('12345')→`INVALID`；setPin('123456')→`pinSet=true`；resetPin 后 `unlockParent` 返回 `PIN_NOT_SET`。

### T18 我页（帮助/关于/邀请码展示）
- **目标**：进入/关闭家长模式切换行（与锁图标同 `toggleParent`）、PIN 设置/修改入口、多孩子切换、帮助中心、关于（版本号）、邀请码展示。
- **接口（前端）**：`openPinSetting()`（需家长模式）、`goHelp()`、`goAbout()`、`renderInviteCode()`（展示 `users.randomCode` 或生成 inviteCode）。
- **边界**：设置 PIN 需先开家长模式（否则 toast）；邀请码仅展示不绑定。
- **TDD 失败用例**：`openPinSetting` 在 display 模式 → toast 不开弹层；邀请码渲染为 16 位 `randomCode`。

### T19 合规（隐私弹窗 + 青少年模式轻提示）
- **目标**：首次启动隐私协议弹窗；《隐私保护指引》配置；连续使用提醒轻提示。
- **接口（前端）**：`onLaunch` 检查本地 `privacyAgreed` → 未同意弹《隐私保护指引》+ 同意按钮；每日首次启动轻提示「注意休息哦～」。
- **边界**：未同意不进入主流程；备案/指引为上线配置项（代码侧仅留入口）。
- **TDD 失败用例**：首次启动 `privacyAgreed=false` → 弹窗；同意后写本地标记，二次启动不弹。

### T20 验收回归 + 体验版提包
- **目标**：逐条回归 PRD §4 验收 1–7；导出体验版。
- **回归清单**：
  1. 启动自动建号绑微信（T1/T2）。
  2. 建 3 任务→打卡→星星累加、连续天数正确（T9/T10/T13）。
  3. 重复打卡当天拦截（T9）。
  4. 建奖励→兑换成功、扣减正确（T11/T12/T14）。
  5. 日历点亮当月打卡日（T6/T8）。
  6. 双模式：默认只读；PIN 解锁可写；孩子无写；锁图标与「我」页两处可切换（T3/T4/T6/T10/T12）。
  7. 多孩子 childId 切换隔离（T16）。
- **TDD/手动**：上述 1–7 各写一条端到端手测脚本（开发者工具）+ 关键 lib 单测全绿。
- **提包**：`project.config.json` 体验版上传；记录版本号到「关于」页。

---

## 依赖与执行顺序（关键路径）
```
T1 ─┐
T2 ─┴─> T3 ─> T4                         (基座/鉴权)
T5 ─> T6 ─> T7 ─> T8                     (展示看板)
T9 ─> T10                                (打卡写)
T11─> T12                                (兑换写)
T13─> T14 ─> T15                         (任务/奖励 CRUD)
T16 (依赖 T1/T13 数据模型)
T17 (依赖 T3)
T18 (依赖 T4/T16/T17)
T19 (独立，可并行 T18)
T20 (全量回归)
```
- **红绿纪律**：每个 T 先写其 lib 纯函数失败测试 + 对应云函数/页面契约，跑红后再实现；薄壳与 UI 手动验证。
- **隔离工作区**：新会话窗口建议 clone 本计划到独立分支/目录，按 T 顺序提交，每 T 一红一绿两次 commit。
