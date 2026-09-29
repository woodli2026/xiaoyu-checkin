# 雨宝记 MVP 实施计划（v0.3 配套）

> 计划日期：2026-09-17
> 关联 PRD：PRD-雨宝学习打卡笔记.md（v0.3，需求已确认）
> 目标：单家庭内测 MVP——任务→打卡→星星→兑换 闭环 + 家长运营/孩子查看双模式
> 技术栈：微信原生小程序（WXML/WXSS/JS）+ 微信云开发（云数据库 + 云函数）

---

## 1. 技术架构

- **前端**：原生小程序，底部 3 Tab（首页 / 任务与奖励 / 我）。全局态 `app.globalData = { user, mode: 'display'|'parent', parentToken, parentTokenExpire, childId }`。
- **后端**：微信云开发。集合权限统一设「仅创建者可读写」；所有写逻辑走云函数（防前端越权）。
- **双模式实现**：默认 `display`（只读）；家长从「我」页点「进入家长模式」输 PIN → 调 `unlockParent` 校验 → 数据层签发 `parentToken`（有效期 15 分钟、存内存不落库）；本地层开启「启动即家长模式」时启动静默进入、无需 PIN；无论哪种进入方式，连续空闲 15 分钟无操作自动回到 `display`（任意交互重置计时）→ 后续写云函数校验 `parentToken` 有效且未过期。
  - 安全含义：即便单 `OPENID`，写云函数**必须持有效 parentToken**，直接裸调写函数将被拒。共居儿童若观察到 PIN 仍可解锁（已知接受风险，V1.1 真实双账号根治）。

## 2. 数据集合（云数据库）

| 集合 | 关键字段 | 说明 |
|------|----------|------|
| `users` | `_id, openid, randomCode(16位), nickname(随机蔬菜名+宝宝), avatar(🧒), pinHash, pinSet(bool), createdAt` | 单账号；`pinHash` 为 6 位 PIN 哈希（加盐），未设置则家长模式不可用 |
| `children` | `_id, ownerId(=user._id), name, avatar, createdAt` | 支持多孩子；`childId` 取其中一项 |
| `tasks` | `_id, childId, title, type(家务/习惯), icon(emoji), date(生效日), repeat{enabled,type:day/week,interval,weekdays[]}, score, priority, createdAt, deleted(bool)` | 软删（隐藏关联展示，不回退星星） |
| `rewards` | `_id, childId, title, icon, category(奖励/惩罚), resetAfterRedeem(bool 不限次/限次), cost, stock, createdAt, deleted` | `resetAfterRedeem=true` 兑换后库存重置为原值 |
| `checkIns` | `_id, childId, taskId, date(YYYY-MM-DD), score, createdAt` | 唯一索引 `(childId, taskId, date)` 防重复 |
| `redemptions` | `_id, childId, rewardId, cost, status(completed), createdAt` | MVP 即发放，status 恒 `completed` |
| `pointsLog` | `_id, childId, delta, reason, refType, refId, createdAt` | 星星变动流水（成长记录/对账） |

> 孩子总星星 `totalStars` 存于 `children` 文档（打卡累加、兑换扣减），避免每次聚合查询。

## 3. 云函数清单

| 函数 | 职责 | 鉴权 |
|------|------|------|
| `login` | 静默登录，按 openid 查重/建号，返回 user + `pinSet` | 公开 |
| `unlockParent` | 校验 PIN → 签发 `parentToken`（5min） | 公开（需正确 PIN） |
| `getDashboard` | 取孩子看板（星星/连续天数/星级/当月日历/任务清单/奖励目录） | 公开（展示模式可读） |
| `checkIn` | 校验 `(childId,taskId,date)` 唯一 → 加分/连续天数/写 pointsLog | 需 parentToken |
| `redeem` | 校验 `stock>0 & totalStars>=cost` → 原子扣星星/库存-1/写 redemptions(completed)/pointsLog | 需 parentToken |
| `taskCRUD` | 建/改/删任务（软删） | 需 parentToken |
| `rewardCRUD` | 建/改/删奖惩（软删） | 需 parentToken |
| `childSwitch` | 家长模式切换 `childId`（多孩子） | 需 parentToken |

## 4. 页面清单（3 Tab）

- **Tab1 首页**：打卡页签（`PRD-CHK-01/02/03`）+ 兑换页签（`PRD-CHK-04` + `PRD-RWD-03`）。展示模式只读预览；家长模式可打卡/兑换。打卡入口=首页日历点日期→日明细弹层，家长模式点待打卡项圆环打卡（非任务列表打卡）。
- **Tab2 任务与奖励**：「任务」子页签=任务纯维护（`PRD-TSK-01/02/03`，无打卡角标，点击行进编辑、右下 `＋` 新建）；「奖励」子页签（原"奖惩"改名）=奖励纯维护（`PRD-RWD-01/02/04`，点击条目进维护弹层、右下 `＋` 新建）。两子页签均仅家长模式可写，展示模式隐藏 `＋` 且行不可编辑；兑换闭环保留在 Tab1 兑换页签（点击奖励项进 `openRedeem`）。
- **Tab3 我**：`PRD-MINE-01`（帮助/关于/设置/邀请码）+ PIN 设置/修改（`PRD-ACC-03`）+ 进入/关闭家长模式切换 + 多孩子 `childId` 选择器。

## 5. 任务拆分（TDD，2–5 分钟粒度）

**阶段 A：基座与鉴权**
- T1 `login` 云函数 + 单测（新用户建号 / 老用户查重 / randomCode 生成）
- T2 `users` 集合权限配置 + `app.globalData` 登录流（启动 onLaunch 调 login）
- T3 `unlockParent` + `parentToken` 校验中间件 + 单测（正确/错误 PIN、过期）
- T4 家长模式闸 UI（PIN 输入遮罩，6 位圆点 + 数字键盘）+ 双入口触发（首页右上角锁图标 / 「我」页切换行，均调 `toggleParent()`）

**阶段 B：孩子看板（展示模式）**
- T5 `getDashboard` 聚合（星星/连续天数/streak/星级阈值）
- T6 首页打卡页签 UI（孩子信息/统计/日历点亮/任务清单 + 右上角锁图标可点击切换家长模式，`renderLockStatus()` 统一渲染图标/`aria-label`/键盘事件）
- T7 首页兑换页签 UI（奖励列表，展示模式无兑换按钮）
- T8 日历组件（当月网格，已打卡日高亮）

**阶段 C：写操作（家长模式）**
- T9 `checkIn` 云函数 + 单测（防重复/加分/连续天数/streak 重置边界）
- T10 打卡交互（首页日历点日期→日明细弹层：待打卡在上、已完成在下、中间淡分隔线无文字；家长模式点待打卡项圆环→打卡，该项即时下移、弹层不关、滚动位保留；展示模式点圆环→提示「请点击右上角锁图标开启家长模式」）
- T11 `redeem` 云函数 + 单测（库存/星星原子扣减）
- T12 兑换确认弹窗（家长模式）
- T13 `taskCRUD` + 任务列表（纯维护、创建时间序、优先级旗子 红/黄/绿/无）+ 新建编辑页 + 弹出式图标选择器（`iconField`/`openIconPick`，默认只显当前图标、点击弹 64 格面板高亮当前值）+ 日期/重复控件
- T14 `rewardCRUD` + 奖励列表（tab 改名「奖励」；`renderRewards(listSel, mode)` 参数区分：任务与奖励页 `mode='manage'` 点进 `editReward` 维护 / 首页兑换页签不传点进 `openRedeem` 兑换）+ 新建编辑页（弹出式图标选择器 + 分类 奖励/惩罚 标签 + 兑换后重置 不限次/限次 语义）+ 软删
- T15 删除二次确认 + 软删关联规则

**阶段 D：多孩子 / 我 / 收尾**
- T16 `children` + `childSwitch` + 家长模式 childId 选择器
- T17 PIN 设置/重置（`PRD-ACC-03`）
- T18 我的页（帮助/关于/设置主题色/邀请码展示）
- T19 合规（隐私弹窗 + 青少年模式轻提示）
- T20 验收回归 + 体验版提包

## 阶段 E：家长模式默认打开（R10，T21–T22）

### T21 本地层静默解锁（启动即家长模式）
- **目标**：`CLOUD_ENV` 未配置且「启动即家长模式」开关开启、且已设 PIN 时，启动时自动签发 `parentToken` 进入家长模式，无需输 PIN。
- **接口（数据层）**：`unlockParent({ silent: true })` → 跳过 PIN 校验直接签发令牌（仍要求 `pinSet=true`）；`pinSet=false` 仍返回 `PIN_NOT_SET`。
- **前端**：`app.js onLaunch` 登录完成后调用；成功置 `globalData.mode='parent'` 并广播给当前页面；失败则维持 `display`。
- **边界**：云端模式（`useCloud`）下不调用静默解锁（设备信任待接入），维持原 PIN 解锁流程；开关关闭时本地层亦走原流程。
- **TDD 失败用例**：
  1. `unlockParent({silent:true})` 在 `pinSet=true` 时返回有效 `parentToken` 且 `expireAt≈now+15min`。
  2. `unlockParent({silent:true})` 在 `pinSet=false` 时返回 `PIN_NOT_SET`。
  3. 正常 PIN 解锁路径（非 silent）行为不变，令牌有效期同样为 15 分钟。

### T22 空闲 15 分钟自动关闭 + 设置项
- **目标**：进入家长模式后，全局空闲计时器监测最近一次交互；连续 15 分钟无操作 → 自动 `clearParent()` 回到 `display` 并 toast；任意点击重置计时。
- **实现**：`app.js` 增加 `lastActive` 与 `tickIdle()`（`setInterval` 每 10s 巡检），页面根 `<view>` 绑定 `bindtap="onAppTouch"` 调 `app.touch()` 重置；空闲到期广播 `display` 给各页。
- **设置项**：「我」页新增「启动即家长模式」开关（默认开），读写 `xy_start_in_parent`（本地兜底存储）。
- **边界**：仅家长模式下计时；`display` 态不计时；返回前台（onShow）重置计时，不立即关闭；删除/改 PIN 等危险操作保留二次确认，不另加 PIN 重认证。
- **TDD 失败用例**：
  1. 纯函数 `isIdleExpired(lastActive, now, idleMs)`：`now-lastActive>idleMs` 为真、无 `lastActive`/为 `null` 时为假。
  2. 切到云端模式时设置项仍显示但静默解锁不触发（单测或手动验收）。

## 6. 验收映射

| 验收标准 | 覆盖任务 |
|----------|----------|
| 1 启动自动建号绑微信 | T1/T2 |
| 2 建3任务→打卡→星星累加/连续天数 | T9/T10/T13 |
| 3 重复打卡当天拦截 | T9 |
| 4 建奖励→兑换成功/扣减正确 | T11/T12/T14 |
| 5 日历点亮当月打卡日 | T6/T8 |
| 6 双模式（默认只读/PIN解锁可写/孩子无写/首页锁图标与「我」页两处均可切换） | T3/T4/T6/T10/T12 |
| 7 多孩子 childId 切换 | T16 |
| 8 启动即家长模式（默认开）：本地层启动免 PIN 进家长模式；关闭开关则启动为展示模式需 PIN | T21 |
| 9 空闲 15 分钟无操作自动回到展示模式，任意交互重置计时 | T22 |
| 10 云端模式静默解锁暂缓、仍需 PIN，但 15 分钟空闲关闭仍生效 | T21/T22 |

## 7. 视觉方向（已与锁定 UI 原型对齐）

> UI 设计稿（高保真可交互原型）为唯一视觉基线：`design-雨宝记-UI.html`（英文副本 `design-xiaoyu-UI.html`）。实现须逐项还原以下 token，不得自行改配色。

- **清新糖果调色板（CSS 变量驱动）**：
  - 天蓝 `--sky:#BFeaff` / 天蓝深 `--sky-deep:#7Fd3ff` / 薄荷 `--mint:#C8F5DD` / 蜜桃 `--peach:#FFD9C7` / 暖阳 `--sun:#FFE6A0` / 星星金 `--star:#FFC93C` / 珊瑚 `--coral:#FF9AA2` / 薰衣草 `--lav:#DDD0FF`。
  - 文字 `--ink:#5A5470`（柔和墨）/ `--ink-soft:#8C86A3`；卡片 `--card:#FFFFFF`；分隔线 `--line:#FFEAF0`；完成绿 `--ok:#5FD08A`；圆角 `--r:26px`；阴影 `--shadow`。
  - 背景：天蓝+蜜桃+薄荷三处径向光晕 + 160° 浅渐变（`#f3fbff→#fdf3ff→#f3fff7`），漂浮云/星装饰。
- **字体**：标题「站酷快乐体 ZCOOL KuaiLe」（儿童圆润体）+ 数字「Baloo 2」；离线降级系统圆体。
- **童趣动效**：漂浮云、闪烁星星、星星弹跳、连续天数火焰脉冲、卡片入场 stagger、打卡/兑换**撒花 confetti**、日历点亮 pop、图标选中 pop。
- **底部 3 Tab**：首页 / 任务与奖励 / 我；首页内 `⭐打卡 / 🎁兑换` 子页签——**选中带底色（天蓝→薄荷渐变）、未选中白底**（轨道 `#efeaf6`）。
- **家长模式锁状态**：仅图标、无文字；默认 🔒 灰 `#a9a2ba`（闭锁），开锁后 🔓 珊瑚色，无背景高保真 SVG（Lucide 风格）。锁图标位于首页打卡页/兑换页右上角，同时提供「我」页切换行，**两处均为可点击开关**（命中区 ≥40px，点击即 `toggleParent()`：闭锁→弹 PIN 闸解锁；开锁→直接关闭）；图标含 `aria-label`/`title` 提示「点击开启/关闭家长模式」，键盘 Enter/Space 等效。
- **首页 hero 卡**：两行（大星数+「5 星等级(左) / 🔥连续天数胶囊(右)」），打卡卡与兑换卡高度对齐（≈119px）。
- **任务与奖励页**：优先级=旗子图标（高 红🚩/中 黄/低 绿/无 无）；右下 `＋` 悬浮（仅家长模式+本 Tab 显示，按子页签决定新增任务/奖励）。
- **图标选择**：默认只显当前图标（`42px` 圆角图标块+「点击更换图标」+▾），点击弹二级居中面板（64 格、`🎨 选择图标`、高亮当前值、选中 pop 回写）。
- **日历日明细弹层**：待打卡在上、已完成在下、中间 2px 淡分隔线（无文字标签）；打卡控件=统一圆形勾选（待打卡空心蓝环 `.chk.pick` 可点 / 已完成绿底白 ✓ `.chk.ok`）；右上角唯一关闭 ×。
- **家长模式闸**：全屏半透明遮罩 + 标题「进入家长模式」+ 6 位 PIN 圆点 + 自定义数字键盘；`unlockParent` 失败/超时退展示模式。

> 注：主题色设置（多套预设换肤）在 MVP 锁定的 UI 中**未出现**，是否纳入 MVP 待本轮确认（见 §8 范围待确认）。

---

> 本计划已与锁定 UI 对齐；确认后进入逐任务详细计划 + TDD 实现（开隔离工作区、先写失败测试）。

## 8. 范围待确认（本轮需拍板）

| # | 项 | 现状 | 建议 |
|---|----|------|------|
| S1 | 主题色换肤（多套预设切换） | 锁定 UI 未含此功能；PRD §2.x 曾提及 | **MVP 不纳入**，CSS 变量已就位，V1.1 一行配置即可开 |
| S2 | `parentToken` 超时策略 | §1 原定「空闲 5 分钟 或 切后台失效，取较短」 | **已决议（R10）**：改为「空闲 15 分钟计时」（任意交互重置），并新增「启动即家长模式」开关（默认开，本地层静默解锁）；云端层静默解锁暂缓（设备信任待接入）。原「切后台即失效」行为移除，返回前台重置计时、不立即关闭 |
| S3 | 多孩子 `childId` 切换 | 验收 #7 要求，T16 已规划；内测单家庭单孩子 | 保留能力（建 `children`+`childSwitch`），内测仅建 1 个孩子档案，验证切换 UI 不报错即可 |
| S4 | 邀请码 | PRD 定为「仅展示」，家庭绑定留 V1.1 | 维持展示态，不实现绑定 |

> 上述 S1–S4 若无异议，默认按「建议」执行。
