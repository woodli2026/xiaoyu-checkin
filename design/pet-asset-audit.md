# 宠物模块资产审计报告（Phase 6 打磨）

- 审计人：林绘澄（art-director）· 评审强度：solo
- 范围：`miniprogram/pages/pet/pet.wxml` / `pet.wxss`、`miniprogram/images/tabbar/pet-off|on.svg`，关联基线 `app.wxss`（糖果调色板变量）、`README-小程序.md` §11.17/§12、`utils/pets.js`
- 视觉基线：`design-雨宝记-UI.html` 糖果调色板（CSS 变量驱动，配色禁止擅改）+ `design-宠物tab-原型.html` v2.4
- 结论口径：✔ 符合 / ⚠ 偏差 / ✘ 缺失。只列问题与建议，不改代码。

## 一、规格符合度核对

| 规格项 | 状态 | 依据（文件:选择器/行） |
|---|---|---|
| 心形成长瓶 clip-path 44 点参数方程 | ✔ | pet.wxss:54-57，两侧 -webkit-clip-path + clip-path 双写 |
| 钻石心情瓶 7 点明亮式切割 | ✔ | pet.wxss:59-62（30/70/100/84/50/16/0 七点） |
| 钻石 facet 切面线（腰线+台面竖线+亭部棱） | ✔ | pet.wxss:64-77（3 层渐变 + ::before/::after 棱线） |
| 玻璃质感：内壁高光圈+底部暗角 | ✔ | pet.wxss:79-83（inset 双阴影，被 clip-path 裁形） |
| 斜向反光条 .shine | ✔ | pet.wxss:106-111 |
| 液面高光椭圆 + wave 起伏 | ✔ | pet.wxss:97-105 |
| 上浮气泡（仅液面>0 渲染） | ✔ | pet.wxml:62-65/93-96 条件 block |
| 无瓶盖 | ✔ | pet.wxss:47 注释明确用户 2026-09-19 定稿 |
| 瓶内数字置于瓶身中下部 | ✔ 位置 / ⚠ 可读性 | pet.wxss:124-128（bottom:36rpx），见 P1-1 |
| 液面 transition .6s | ✔ | pet.wxss:86（cubic-bezier 弹性曲线） |
| 技能按钮：投喂/抚摸圆形居中 | ✔ | pet.wxml:74-86；ring 142rpx ≥ 88rpx 触达达标 |
| 顶卡：星星余额 + 连续互动胶囊 | ✔ 同源 | 胶囊复用 app.wxss:117-124 全局 `.streak`（白底 #e8762f 橙字），与首页同款 |
| tab 图标颜色烘焙 + 选中只换 src | ✔ | pet-off #8C86A3 = --ink-soft、pet-on #FF9AA2 = --coral，与 §11.17 口径一致 |
| 弹层 4 个（领养/改名/统计/管理） | ✔ | pet.wxml:120-208；.sheet max-height:78vh（app.wxss:367）、.inp 88rpx（app.wxss:405）均达标 |
| mask/sheet 交互约定（bindtap/catchtap） | ✔ | 四个弹层全部遵守 app.wxss:356-360 注释口径 |
| 5 阶段 emoji+CSS+SVG 配饰 | ✔ 结构 / ⚠ 细节 | 见第四节 |

## 二、问题清单（按严重度）

### P1（必须修）

**P1-1 瓶内数字在低液位/空瓶时几乎不可见，且字号过小**
- 位置：pet.wxss `.flask .fnum`（124-128 行）
- 问题：数字为白字 21rpx（≈10.5px）+ 深色 text-shadow，靠「压在液面上」保证对比。但成长瓶/心情瓶液位由数据驱动：液面低于 bottom:36rpx 一线时（成长瓶 <~32%、心情瓶 <~30%），白字直接落在 `rgba(255,255,255,.75)` 玻璃底上——白对白，仅剩极弱的阴影；目标用户是小学生，21rpx 也低于本项目最小正文口径（tab 文字已放宽到 24rpx）。
- 建议：① 字号提至 24rpx；② text-shadow 改为「白底描边」方案（`-webkit-text-stroke` 或 4 向 1rpx 白色 shadow + 深色主体字 `var(--ink)`），使数字在玻璃与液体两种底上都可读；或 ③ 把数字从瓶内移出，与 `.flab` 合并为「成长 12/50」置于瓶下方，瓶内只留液面动画。

**P1-2 🪽（翅膀）为 Unicode 15.0 emoji，低版本系统渲染为方框**
- 位置：pet.wxml:44-45（`.pet-wing l/r`）
- 问题：🪽 2022 年才进 Unicode 15，微信安卓端大量机型（Android 9-11 旧表情字体）会显示 □ 豆腐块，传奇阶段直接破相。虽是单码位、符合 §11.18「无 ZWJ」铁律，但违反其精神——该铁律的目的是兼容性，版本太新同样翻车。🥚🐣🧣👑🌟✨🍼✋ 均为 Unicode ≤12，安全。
- 建议：翅膀改用纯 CSS（两个渐变椭圆 + flutter 动画，颜色可用 var(--sky)），或降级为 🌸×2；保留 flutter 关键帧不动，只换节点内容。

### P2（建议修）

**P2-1 约 20 处硬编码色值未走 CSS 变量（偏离 token 基线）**
- 位置：pet.wxss 全文件。清单：`#fff6d8/#ffe9ef`（topcard 渐变 8 行）、`#c79a2e`（19）、`#eafff4/#e9f3ff`（arena 29）、`#ffa3b0/#ff5d6c/#e33e58`（成长液 89）、`#95e2ff/#46b6ff/#2f7fe0`（心情液 93）、`#4b5a72`（flab 129）、`#e8762f`（tip/cost 159/180）、`#b08a9a`（manage-btn 190）、`#f6f4fb`（pg 200）、`#dde6f4`（ring 174）、`#f0eef7`（btrack 218）、`#36d1ff/#5b6bff/#ff9f43`（条形图 220-221）。
- 判断：经与原型 v2.4 口径核对，红/蓝液体渐变、arena 薄荷→天蓝等属于**锁定原型的有意豁免**（调色板变量中没有对应的「液红/液蓝」token），不算擅改配色；但无任何声明，后续改版容易漂移。
- 建议：不强行换变量，而是在 pet.wxss 头部注释加一段「硬编码豁免清单：以上色值来自 design-宠物tab-原型.html v2.4，改动需走设计确认」；若后续做暗色/主题化，再抽成页面级 `page` 变量。

**P2-2 README §12 未覆盖 pet 图标（文档滞后）**
- 位置：README-小程序.md §12（530-539 行）：仍写「底部导航 **4 个图标**（house/clipboard-text/clock-counter-clockwise/user-circle）」；§11.17 表格也只列 4 tab。实际已有第 5 个 pet 图标（paw-fill，10 个 SVG）。
- 建议：§12 表格「用途」改为「底部导航 5 个图标」，涉及图标列表补 `paw-fill`；§11.17 补一行 pet=paw-fill 的映射（MIT 许可声明本身已覆盖整个 Phosphor 集，合规无缺口，仅记录不全）。

**P2-3 `.skill .cost` 19rpx 过小**
- 位置：pet.wxss:180。"-2⭐" 约 9.5px，且是扣费信息，孩子看不清容易误触投喂。
- 建议：提至 23rpx，与 `.flab` 一致；disabled 态文案可同步在 `.nm` 旁补「星星不足」而非仅降透明度。

**P2-4 成年→传奇辨识度依赖小配饰，主体无差异**
- 位置：pet.wxss:139-140、pet.wxml:39-47。s4=🌟肩章+🧣围巾，s5=🪽翅膀+👑皇冠+横幅+spinGlow，但主体 emoji 尺寸/颜色完全相同，配饰 emoji 在 185rpx 主体旁视觉占比小；且 s5 的翅膀正是 P1-2 的破相点。
- 建议：s5 给 `.pet.s5` 叠加金色光环底衬（position:absolute 径向渐变圆，`var(--star)` 40%→透明），并 scale(1.06)；横幅 `.pet-banner` 已是强差异，保留。

**P2-5 破壳→成长区分中等，且 s2 头顶壳与「未领养蛋」符号冲突**
- 位置：pet.wxml:33-38。s2=物种 emoji + 头顶🥚壳；s3=✨光环+腮红。头顶一整颗🥚与 kidbar/领养页的「蛋=未拥有」符号同形，孩子可能误读。
- 建议：s2 的壳改为放在宠物**下半部**（`.pet-shell` 由 top:-38rpx 改 bottom 定位，模拟「下半壳还套着」），或将壳换成 🐣 破壳壳；腮红建议 s2 就出现，做渐进。

**P2-6 clip-path 退化表现为直角方块**
- 位置：pet.wxss:48-52。`.flask .body` 无 border-radius，若 clip-path 失效（极老旧 WebView），玻璃瓶退化成 104×112rpx 直角矩形，液体仍是直角条——功能在但塑料感。
- 建议：`.flask .body` 补 `border-radius: 20rpx` 作兜底（clip-path 生效时被裁掉、无副作用）；心形瓶另需注意 `-webkit-clip-path` 前缀已写，覆盖 iOS WKWebView 与新版 Chromium，风险本身低。

**P2-7 `.pet-edit` 触达区域 65rpx < 88rpx**
- 位置：pet.wxss:225-233。改名/领养入口仅 65rpx 圆，儿童手指达标线建议 ≥88rpx。
- 建议：视觉保持 65rpx，用透明 padding 或伪元素把热区扩到 88rpx。

### P3（可忽略/记录）

- **P3-1** `.pet-tip`/`.streak .go` 23rpx 偏小但为辅助文案，可接受。
- **P3-2** 技能按钮、弹层关闭钮无 aria-label（仅 `.pet-edit` 有）。小程序 aria 支持有限，读屏覆盖率本就低，记录即可。
- **P3-3** 撒花层颜色为 JS 内联 style（pet.wxml:213），色值来源未审计；建议后续统一到豁免清单。
- **P3-4** 液面 `::before` 高光椭圆 left/right:-8% 会被 clip-path 裁掉两侧，实际呈现为瓶内宽度，符合预期，无需改。

## 三、可访问性小结

| 维度 | 结论 |
|---|---|
| 触达区域 | 技能 ring 142rpx ✔；pet-edit 65rpx ✗（P2-7）；sheet-x 56rpx 为全局既有规范，不在本模块整改 |
| 色盲友好 | 红/蓝液面除颜色外有**形状双通道**（心形瓶 vs 钻石瓶）+ 底部文字标签「成长/心情」双通道，色盲可辨 ✔——这是本模块做得最好的可访问性设计，保持 |
| 数字可读性 | P1-1，唯一硬伤 |
| 动效安全 | wob/hop/sway 均为小幅 transform，无大面积闪烁；confetti 一次性事件动画，癫痫风险低 |
| 字号 | P1-1 / P2-3，其余 ≥23rpx 达到项目口径 |

## 四、5 阶段外观方案核对与建议

| 阶段 | 现方案（代码实测） | 相邻差异评估 | 建议 |
|---|---|---|---|
| 1 蛋蛋 | 🥚 + egg 缩小 + wob 摇摆 | — | ✔ |
| 2 破壳幼崽 | 物种 emoji + 头顶🥚 + hop | vs 1：蛋→动物，强 ✔；但壳符号见 P2-5 | 壳移下半部/换 🐣 |
| 3 成长体 | 物种 emoji + ✨光环 + 腮红 + sway | vs 2：中（头顶物替换） | 腮红提前到 s2（渐进感） |
| 4 成年体 | 物种 emoji + 🌟 + 🧣 + sway | vs 3：中（光环→徽章+围巾） | ✔ 可接受 |
| 5 传奇伙伴 | 物种 emoji + 🪽×2 + 👑 + 横幅 + spinGlow | vs 4：中偏强（动效+横幅），但依赖 🪽 | 金色光环底衬（P2-4），翅膀方案见 P1-2 |

## 五、资产风险清单

1. **emoji 机型差异**：🪽 为唯一高危（P1-2）；其余用到的 emoji 均 ≤Unicode 12，iOS/安卓主流表情字体覆盖良好。
2. **clip-path 退化**：P2-6，加 border-radius 兜底即可。
3. **SVG 许可**：pet-on/off.svg 路径与 Phosphor `paw-fill` 一致，MIT ✔；README §12 记录滞后（P2-2），补文档即可，无合规缺口。
4. **资产孤立检查**：`images/tabbar/` 下 pet-off/on.svg 均被 custom-tab-bar 引用（选中换 src 机制），无孤立资产；pet 页无未引用图片。
5. **性能**：44 点 clip-path polygon 为静态字符串，无运行时开销；常驻动画 6 个（bob/flick/wave/rise/flutter/tw）均为 transform/opacity 合成层属性，对低端机友好。

## 六、建议修复顺序

1. P1-1 瓶内数字（可读性，孩子每天看）→ 2. P1-2 🪽 替换（真机破相）→ 3. P2-2 README §12 补记录（5 分钟）→ 4. P2-7/P2-3 触达与 cost 字号 → 5. P2-4/P2-5 阶段辨识度打磨 → 6. P2-6 兜底 → 7. P2-1 注释声明豁免（随手）。

—— 报告完（审计仅此一文件，未改动任何 miniprogram/ 代码）
