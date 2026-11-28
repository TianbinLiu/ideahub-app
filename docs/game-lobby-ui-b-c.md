# 对局大厅三屏换皮：匹配页 B / 匹配中 C / 加载页 B（`feat/ui-match-b-c`）

2026-11-27 · 基线 main `131fccf9` · 设计源 [`design/ui-mockups/match-ui-variants.html`](../design/ui-mockups/match-ui-variants.html)
（`?v=2` = B、`?v=3` = C、`?s=match|searching|loading`）· 截图基线 `C:\Users\tliu7\Downloads\match-ui\`。

> 主人拍板：**大厅 / 匹配页用 B「卡片桌游」，匹配中用 C「沉浸全屏」的呼吸光环版，加载页用 B**。
> 本文记三屏还原了什么、和 3D 窗景怎么共存、C 的光环怎么对齐月亮、与设计稿的差异、实测读数与剩余风险。

---

## 1. 一句话结论

- 三屏都换了皮，**匹配逻辑一行没改**（`findMatch` / 队列 / AI 补位 / 超时 / 房间仍全在 `lobbyStore` 与 `useLobbyOnline`），
  **穿窗时间线一行没改**（`scene/flyTimeline.ts` / `matchCam` 的相机段原样），**两场景切换没改**。
- 底**不是**一块盖满的纯色：匹配页/加载页是半透明绒布 + 边缘暗角，匹配中是冷色暗角 + 星点；
  中间留给 3D 的窗与月亮。老场景（没有窗）/ 房间 / 公开房才回 `bg-ink` 实底。
- C 的三圈呼吸光环、B 加载页的黄铜进度环，都由 `ui/moonAlign.moonScreenRect` 投出来的
  **月亮屏幕圆**定位（与 3D 月亮同心、同半径），并暴露对齐容器与 DEV 读数：
  `[data-lobby-moon-halo]` / `[data-lobby-moon-emblem]`、`window.__lobbyUi.moonRect()`。
- `npm run build` 绿（tsc + lingui extract + 全部构建期检查 + vite build）。

---

## 2. 三屏还原

### 2.1 匹配页（B · 卡片桌游）—— `ui/MatchLobbyB.tsx`

- **材质与色**：绒布底（`index.css` 的 `.lobby-velvet`：45° 织物纹 + 中心透明 + 底部/四周暗角）、
  黄铜金（`#d8b26a` 系）、米白（`#ece4d2`）；标题用衬线栈，副标题「开一桌？」用**烫金渐变**的手写体栈。
- **三张厚卡**：4 人匹配 / 8 人匹配 / 自定义房间，圆铜印（4 / 8 / #）+ 标题 + 一行说明 + 角标
  （AI 补位 / 房主开局）；选中态 = 金边 + 微微上浮 + **右侧 ✓**（保留新手引导里「右上角亮起 ✓」的说法）。
  点卡片仍然**只选中**（`aria-pressed`），开局仍是主键的事。
- **黄铜主键**：`落座 · 匹配 4 人 / 落座 · 匹配 8 人 / 开一间房 · 落座`，**接线没动**：
  点它仍然 `await beginFlyThrough()`，转场结束才 `chooseMatch(size)`。
- **票根「凭码加入」**：撕票缺口 + 虚线 + 6 格码格 + 描边「加入房间」。6 格下面是一个**真实 `<input>`**
  （透明文字、原生键盘；输入进 `lobbyStore.joinCode`，输满 6 位按钮才可用），不是 6 个只能看的格子。
- **原有的东西一个不少**：4/8/自定义三模式、公开房入口（能力位为真才摆）、
  「公开这间房（别人能搜到）」开关（选中自定义房间且能力位为真时摆）、券 / token 余额、
  最近一局回放、`?` 玩法说明、`✕ 返回工坊`、联机状态（挪到右上，底栏只说错误/原因）、
  新手引导三个锚点（`lobby-modes` / `lobby-start` / `lobby-join`）。
- **摆位**：左列底对齐（模式卡 + 主键），右列底对齐（票根 + 公开房 + 建房开关），中间整块留给窗与月亮。
  窗下那块「明 月 窗」铜牌只在 3D 窗真在屏上时出现（取消过穿窗 / 老场景不出现）。

### 2.2 匹配中（C · 沉浸全屏）—— `ui/SearchingC.tsx`

- **月亮被三圈呼吸光环围住**：光环挂在 DOM 层，按 `moonAlign` 投出来的月亮屏幕圆同心定位；
  三圈半径 = 月盘半径 × `1.22 / 1.51 / 1.85`（与设计稿的 256/316/386 vs 209 同一比例），
  5 s 呼吸、依次延迟 0.6 s；`prefers-reduced-motion` 下停成静态三圈。
- **UI 收到屏幕边缘**：顶部窄带 = `‹ 工坊` + `● 匹配中 · N 人局` + **已排队 mm:ss / 这一池 2/4 人**；
  底部窄带 = 这一池人数与一句说明 + 大秒表（已排队 + 预计 mm:ss/最多 1 分） + **取消**。
  中间只剩月亮、光环与座位点（我 = 亮；池里已有的人 = 亮；空位 = 暗）。
- **原有匹配状态全保留**：`queue.queued / need / etaSec`、60 秒上限、超时退回 AI、
  没连上房间服务、AI 补位、取消。只是换了画法，判定与数据还在 store / 本地现算。
- **离线/超时那一支**没有"排队"这回事：时钟写 `--:--`、标签写「未排队」，
  底部多给一颗「用 AI 开局」主键（取消仍在）；此时不编造"已排队 N 秒"。
- **不摆假数据**：设计稿右侧那列「对手情报 / 排名 / 示例」在 App 里没有真实数据来源，
  这一版不摆（摆示例数据等于骗人）；座位点用的是真实的池子人数。
- 穿窗黑幕（页面层 `ui/MatchCurtain`）与穿窗时间线都没被盖住：进匹配中时黑幕淡出、镜头回到窗正前方
  （C 要能看见月亮），离开匹配中时按原路复位；游戏开局仍由 MatchCurtain 的"房间就绪再淡出"收口。

### 2.3 加载页（B · 正在铺桌）—— `ui/DealingB.tsx`

- **三张发牌顺序卡**：`01 AI 补位 → 02 选风格 → 03 锁定`，卡面是厚卡（铜印 + 标题 + 一行说明 + 状态），
  01 完成亮 `完成 ✓`、02 当前亮金边 `进行中 62%`、03 等待。
- **黄铜进度环**：`conic-gradient` + `mask` 的 3px 铜环，套在 3D 月亮外面（无窗时是居中的铜牌徽记）；
  大号手写百分比 + 「正在铺这一局」+ **取消开局**（h-11 / 44px）。
- **语义（这是本次唯一新增的一段"过场"，请按这个读）**：
  - 它是 `startFromLobby` **之前**约 1.6 s 的开局过场，进度环的百分比 = **这段过场自己的计时**，
    不是服务端/规则层的进度（界面上不冒充事实，文档里注明）；
  - 01「AI 补位」：过场走完才真的调 `startFromLobby`（AI 补位在那时发生），所以写"准备补 N 个空座"；
  - 02 / 03 是**接下来在游戏里发生的事**（StylePick 先选、选完锁死），这里提示顺序；
  - **取消 = 什么都没发出去**：`startFromLobby` 还没调，不欠房间、不欠队列；取消回大厅首屏并回窗景。
  - 联机房间「服务端开局」那一支由 `useLobbyOnline` 直接建局（原有路径）——不经过这段过场；
    只有本机 AI 补位 / 联机退回 AI 那一支会播。

---

## 3. 与 3D 窗景怎么共存（不是说了一句"半透明"）

三屏的底都分两层：

| 层 | 匹配页 / 加载页（B） | 匹配中（C） |
|---|---|---|
| 实底 `bg-ink` | 只在**没有窗**时出现（老场景 / 房间 / 公开房），有窗时 opacity 0 | 同左 |
| 气质层 | `.lobby-velvet`：45° 织物纹 + 径向暗角；**中心 40% 透明**，纹理只压在桌沿 | `.lobby-c-scrim`：冷色径向暗角 + 四周星点；中心同样透明 |
| 暗角 | 底部 `120% 120% at 50% 122%` 的压暗，让两列 UI 有对比 | 顶部/底部各一条渐变窄带（文字都在带里） |

- **窗与月亮的几何位置**：852×348 上窗洞直径约 201 CSS px、月亮约 182，屏幕正中（x 426 / y 174）；
  左列 272 px、右列 236 px，中间净空 ≥ 240 px ⇒ **月亮主体一个像素都不被卡片压住**（截图为证）。
- **文字对比**：所有压 UI 的地方都有暗角/绒布垫底；正文米白 `#f2e7d2`、小字金 `#a88d5c`/`#8e7c5d`，
  不使用本仓禁用的 `text-slate-600`；`<Trans>` 全部走 lingui。
- **字体**：2026-11-28 起**自带子集化字体**（`Lobby Serif SC` = Noto Serif SC 可变字重子集，
  35.3KB；`Lobby Hand SC` = Ma Shan Zheng 子集，12.1KB），`@font-face` + `font-display:swap`
  + `<link rel=preload>`；系统回退栈（Palatino / Songti / SimSun / Segoe Script / Kaiti …）一个都没删。
  方案、体积与真机观感见 §10.3。

---

## 4. C 光环 / B 铜环怎么对齐 3D 月亮

- 唯一实现：`ui/moonAlign.ts`
  - `moonScreenRect(width, height, fov = 50)`：取 `scene/moonGeometry` 的**匹配页机位**（`pagePose`）与
    月亮盘（`moonDisc`），按相机基向量 + 透视除法算出月亮在屏幕上的 `{cx, cy, r}`（CSS px）。
    相机垂直 FOV 与 `StudioPage` 的 `camera={{ fov: 50 }}` 同一口径（`LOBBY_CAMERA_FOV` 里注明改一处要改两处）。
  - `useMoonRect()`：`ResizeObserver` 量大厅根节点（与 3D 画布同一块舞台）的 CSS 尺寸，转屏/换画幅时跟着重算。
- 对齐容器：
  - C：`[data-lobby-moon-halo]`，带 `data-moon-cx / cy / r`（容器本身 0×0，三圈环以它为中心摆）；
  - B 加载：`[data-lobby-moon-emblem]`，同样带 cx/cy/r；铜环是它的 `inset: -18px` 的 conic 弧。
  - DEV / `gsAcceptDebug=1` 时 `window.__lobbyUi.moonRect()` 返回同一个函数的投影，验收可比。
- 实测（852×348，dpr2）：`halo.cx/cy/r = 420 / 168 / 91.1`，`moonRect = 420 / 168 / 91.13`（同一函数，
  差值是取整）；加舞台内边距（p-1.5 = 6 CSS）后屏幕坐标 = `426 / 174`，与 3D 窗心一致。
  800×363 时是 `394 / 175.5 / 95.2`（舞台 788×351）。
- 光环尺寸：月盘 2r=182，窗洞约 201，三圈 222 / 274 / 337 —— 最外圈在 348 高时上下各切一点（与设计稿一致）。

---

## 5. 热区与安全区实测

### 5.1 hitbox ≥ 44×44（三屏全部交互元素，实测 `getBoundingClientRect`）

| 视口 | 匹配页 B | 匹配中 C | 加载页 B |
|---|---|---|---|
| 852×348 @ dpr2 | 9/9 通过 | 2/2 通过 | 1/1 通过 |
| 800×363 @ dpr3.5（真机口径） | 9/9 通过 | 2/2 通过 | 1/1 通过 |

具体：模式卡 256×44、黄铜主键 256×48、票根输入 210×44、加入房间 210×44、
顶栏券/token 44 高、`?` 44×44、`✕ 返回工坊` 80×44、C 顶部返回 44×44、C 底部取消 44 高、
加载页取消开局 44 高。

### 5.2 安全区（`--safe-float-top`）

真机横屏 `env(safe-area-inset-top)` 量到 41 px（前一轮 gs-ui-moon-polish 的读数），
`--safe-float-top = 41 + 8 = 49px`。浏览器里 `env()=0`，所以验收时**注入 `:root{--safe-float-top:49px}`**
模拟真机状态栏，再量：

- 三屏所有交互元素 `y ≥ 41`（没有一颗压在状态栏底下）；全部仍然 ≥44×44；
- 标题底沿 89，左列 eyebrow 顶 99.6 ⇒ 10.6 px 净空（这一轮把左列间距收紧过：
  hand 的 `leading-none`、卡间距 1、主键上间距 1.5）；
- 截图：`08-safe-home-800x363.png`、`09-safe-searching-800x363.png`、`10-safe-loading-800x363.png`。

---

## 6. fps（浏览器实测，读数环境写在下面）

| 视口 | 匹配页（3D 窗景 + 绒布层） | 匹配中（3D + 三圈呼吸 + 冷色暗幕） |
|---|---|---|
| 852×348 @ dpr2（headless Chromium，RTX 4060 Laptop） | **60.2 fps**（p95 17.4 ms） | **60.3 fps**（p95 17.4 ms） |
| 800×363 @ dpr3.5（真机几何，headless Chromium） | **60.1 fps**（p95 17.4 ms） | **60.5 fps**（p95 17.4 ms） |

> 这一轮 headless 浏览器按 60Hz 节流；同一套代码在更早的一次无节流跑里读到 141.2 / 133.9 fps。
> 两层新增的 DOM 都只做 transform/opacity/box-shadow（合成层），没有新增每帧 JS 或大图。
> **真机 fps 这轮没量到**：见 §10。

---

## 7. i18n

- 所有新文案走 lingui：`<Trans>` / `useLingui().t`；没有把中文硬编码进 JSX。
- 新增 39 条 msgid，`en.po` 全部补了英文（`check-i18n` 的 E 项：en 缺译 0 条）；
  中文基线（A 项）没有新增裸字面量。
- 构造性文案（人数、秒数、百分比）用插值（`{size}` / `{pct}` / `{clock}`），不拼中文串。

---

## 8. 构建 / 门禁 / 改动面

- `npm run build` **绿**（`tsc` + `lingui extract` + 全部构建期检查 + `vite build`，最后 `built in 64s`）。
- 构建期检查里有两处**门禁本身**跟着新结构更新，都是有意的：
  - `scripts/check-game-ingame.mjs`：
    ① 大厅三个引导锚点拆到 `Lobby.tsx + MatchLobbyB.tsx`，断言改成两份文件相加；
    ② 800×363 的引导锚点实测值（`lobby-modes / start / join`）按 B 案重测后更新；
    ③ 文件末尾新增了一段 reduced-motion（B/C 规则后置）⇒ 把对局内 P0 的两条（`ingame-rise/spin`、
    `sticker-bubble`）在这段里也登记了一遍（脚本取的是**最后一段** prefers-reduced-motion）。
  - `scripts/check-game-spectate.mjs`：公开房入口 / 公开这间房开关的源码断言改成
    `Lobby.tsx`（能力位判断）+ `MatchLobbyB.tsx`（摆不摆）两份一起看。
- 新增文件：
  - `src/studio/game/ui/MatchLobbyB.tsx`（B 匹配页的两列）
  - `src/studio/game/ui/SearchingC.tsx`（C 匹配中）
  - `src/studio/game/ui/DealingB.tsx`（B 加载页）
  - `src/studio/game/ui/moonAlign.ts`（月亮屏幕投影 + `useMoonRect`）
- 修改：`Lobby.tsx`（三屏分支 / 背景层 / 开局过场 / 安全区 / 原有入口）、`MatchCurtain.tsx`
  （匹配中进/出的镜头收口）、`index.css`（B/C 皮肤与 reduced-motion）。
- **没有改**：`lobbyStore` / `useLobbyOnline` / `lobby.ts`（匹配逻辑与状态机）、
  `flyTimeline.ts` / `matchCam.ts` 的相机段（穿窗时间线）、`sceneSplit.ts` / `effectiveSceneKind`（两场景切换）、
  `game/store.ts` / 规则层。
- DEV / `gsAcceptDebug=1` 的验收钩子：`__lobbyUi.hold()` / `startDealing(size)` / `release()` / `cancel()` /
  `state()` / `moonRect()`（与 `__matchCam` / `__gsAccept` 同一把开关）。

---

## 9. 与设计稿的差异清单（合理差异与原因）

| # | 设计稿 | 这一版 | 为什么 |
|---|---|---|---|
| 1 | 窗 / 月是 HTML/CSS 画的 | 保留**真实 3D 窗景 + 月亮**，DOM 只画绒布/暗角/光环 | 任务要求"必须与 3D 窗景共存"，真实窗景也才有昼夜两档 |
| 2 | B 的三张卡 + 第四张公开房卡在左列 | 公开房入口挪到右列票根下方；「公开这间房」开关也在右列 | 348 高 + 真机 41px 安全区时，左列四张卡 + 主键 + 说明会顶到标题；右列底部正好空着 |
| 3 | B 顶栏只有品牌 + 对局大厅 + 货币 | 保留了回放 / `?` / `✕ 返回工坊`，联机状态从底栏挪到右上 | 这些是原有功能，不能因为换皮丢；底栏只留错误/原因，省出两列高度 |
| 4 | 票根 6 格是静态的 | 一个透明 `<input>` 覆盖 6 格（原生键盘、`joinCode` 状态、输满 6 位才可加入） | 不能做成"只能看的格子"；`data-guide="lobby-join"` 仍指整张票 |
| 5 | C 右侧「对手情报 / 排名 / 示例」一列 | 不摆 | App 没有对手情报的真实数据；摆示例数据等于骗人。座位点用真实池子人数 |
| 6 | C 只有联机等匹配一支 | 多了离线/超时退回 AI 的一支：时钟 `--:--`、未排队、用 AI 开局 + 取消 | 原有状态字段全保留；离线时不能拿 `00:00` 冒充"排了 0 秒" |
| 7 | B 加载页「选风格 62%，候选：暖金织物 · 胶片夜景」 | 62% = 这段过场自己的计时；不写具体候选 | 风格卡在游戏开局后才抽，预先写一个候选就是假数据 |
| 8 | B 加载页窗景在背后 | 从匹配中进 → 有窗；从自定义房间开局 → 没有窗，铜环是居中徽记 | 房间屏的相机不在窗前（两场景切换没改）；不硬把镜头拽回窗 |
| 9 | 手写体 / 宋体（Windows 字体） | **自带子集化字体**：衬线 Noto Serif SC（400~700 可变）+ 手写 Ma Shan Zheng；只收 B 案 UI 实际用字（衬线 137 字 / 手写 99 字），35.3 + 12.1KB | Android WebView 没有 Palatino / 宋体 / 华文楷体，靠系统栈会整片落到无衬线（真机验收 P0）。字体文件进仓库，系统回退栈保留，见 §10.3 |
| 10 | 昼是明亮海天（厚涂） | 昼沿用现有 `window-sea` splat（本仓既有资源） | 窗景两档是上一轮已交付的资产，这轮不重做 |
| 11 | 1280×720 桌面预览 | 只做 App 的横屏布局（852×348 / 800×363） | 这是手机 App；桌面预览只是稿子的对照尺寸 |

---

## 10. 设备验证与剩余风险

### 10.1 真机 / 模拟器（如实记录）

- **真机 `3C15CJ00C8V00000`（CPH2771）**：本轮构建的 `app-sideload-debug.apk`（114.5 MB，
  versionName `2.83-debug` / versionCode 95）**安装成功**并启动；但调试包与线上服务端同源，
  启动后停在**生产账号登录页**（密码登录 / 邮箱 / 手机号），仓库里没有主人的生产账号凭据
  （`docs/game-lobby.md` 之前也记过这条），**没法登进去看大厅**。验收结束后已把手机交还桌面（Home），
  没有退出/改动主人的账号。
- **模拟器 `emulator-5554`**：同样装了 debug 包。为了强制本机模式把模拟器断网后，App 停在
  「正在确认登录状态…」（本地没有可回退的会话）；恢复网络后已停掉调试包，模拟器网络已恢复。
  没有拿模拟器的软件渲染画面当 UI 证据（GS 档在软件渲染上没有参考价值）。
- **因此三屏的视觉证据是浏览器**（852×348 dpr2 与 800×363 dpr3.5，与真机同一套 CSS 几何），
  安全区用注入 `--safe-float-top:49px` 模拟真机 41px 状态栏。**真机 UI 观感是这一轮最大的未验证项**。

### 10.2 剩余风险

1. **真机没有亲眼看过**（登录墙）；字体栈在 Android WebView 的实际落字、绒布/金边在 OLED 上的观感、
   真机 fps 这三件只能等下一次有账号的验收。建议主人用自己的账号扫一眼 §11 的三屏。
2. **加载页的进度是计时而非真实进度**（见 §2.3）。如果以后要做成真实进度，应把 `startFromLobby`
   拆成可观测的阶段（AI 补位 → 风格 → 锁定）再驱动 `progress`，而不是改这个百分比文案。
3. **联机服务端开局那一支不经过加载页**（由 `useLobbyOnline` 直接建局）。若主人要求所有开局都看这段过场，
   要在 `startOnlineFromLobby` 那条路上加同一个门闩（这会多 1.6 s 开局延迟，需单独拍板）。
4. **C 的光环按"匹配页机位"投影**：如果以后匹配中换了机位（比如穿出去之后不回窗前），`moonAlign` 的
   注释里写明了要改成"读当前相机"；本轮 `MatchCurtain` 已经保证进匹配中必回窗前。
5. **舱内高度**：800×363 + 49px 安全区下，左列顶到标题下方只有 ~10px 净空；再往左列加东西
   （比如第四个模式 / 更长的说明）会重新压到标题。`MatchLobbyB` 里收间距的注释写明了这一点。
6. **`lobby-radar` 等旧 CSS** 现在没有调用方（匹配中已换成 C 光环），留着是为了不制造无意义的 diff；
   下一轮可以连同旧 `MatchRadar` 的样式一起清掉。

### 10.3 2026-11-28 真机四项修复（`feat/ui-fonts-hud-fixes`）

> §10.1 的"登录墙"是上一轮的情况。这一轮真机上的**正式包保持登录态**（同一包名同一签名覆盖安装，
> 安装前后都是主人的线上账号），所以下面全部是**真机 `3C15CJ00C8V00000` 的读数与截图**，不再用浏览器代替。
> 落盘：`npm run build` 绿（含 `scripts/check-lobby-fonts.mjs` 新门禁）；截图不进仓库，
> 目录见 §10.3.5。

#### 1）字体：自带 Open Font License 子集（修"安卓没有宋体/手写体"）

| | 衬线 | 手写 |
|---|---|---|
| 字体 | **Noto Serif SC** 可变字重 400~700（SIL OFL 1.1） | **Ma Shan Zheng 马善政毛笔楷书**（SIL OFL 1.1） |
| `@font-face` 家族 | `Lobby Serif SC` | `Lobby Hand SC` |
| 文件 | `public/fonts/lobby-serif-sc.woff2` | `public/fonts/lobby-hand-sc.woff2` |
| 体积 | **36,156 B（35.3 KB）** | **12,344 B（12.1 KB）** |
| 字符数 | 137（46 个中文 + 4 标点 + 可打印 ASCII） | 99（4 个中文 + 4 标点 + 可打印 ASCII） |
| 用在哪 | `.lobby-serif`（对局大厅 / 正在铺桌）、`.lobby-card-b b`、`.lobby-brass-cta`、`.lobby-ghost-btn b`、`.lobby-ticket-h`、`.lobby-ticket-join`、`.lobby-stage-card b`、`.lobby-seal` | `.lobby-hand`：「开一桌？」与载入页大号百分比 |
| 合计 | **47.4 KB**（验收上限每份 ≤120KB / 合计 ≤300KB，余量充足） | |

- **子集化**：`scripts/gen-lobby-fonts.mjs` 用 Google Fonts 的 `text=` 参数只取清单里的字
  （服务端切好，比先下 20MB 全字库再 `pyftsubset` 少一步）；字符清单只有一份
  `scripts/lib/lobby-font-chars.mjs`（中文 + 标点 + 可打印 ASCII —— 英文界面下同一批元素整句是英文）。
- **接线**：`index.html` 两条 `<link rel=preload as=font type=font/woff2 crossorigin>`；
  `src/index.css` 两个 `@font-face`（`font-display: swap`、`font-weight: 400 700` 覆盖可变区间）；
  `.lobby-serif` / `.lobby-hand` 与七处重复栈统一走 `--lobby-serif-stack` / `--lobby-hand-stack`。
- **回退栈一个没删**：`"Lobby Serif SC", Palatino / Iowan Old Style / Georgia / Songti SC / Noto Serif CJK SC / SimSun, serif`；
  手写同理（Segoe Script / Kaiti / KaiTi / STKaiti）。正文 `body` 仍是系统无衬线 —— 自带字体只给 B 案。
- **构建门禁**：`scripts/check-lobby-fonts.mjs`（44 条）核对文件存在 / wOF2 / 每份与合计上限 /
  **真实码点覆盖**（`scripts/lib/woff2-cmap.mjs` 直接解 woff2 的 cmap，不靠字库体积猜）/ 清单与生成物逐字一致 /
  preload 三属性 / `@font-face` 的 swap 与可变区间 / 系统回退栈仍在 / `body` 没被换掉。
  改 B 案文案要补 `lobby-font-chars.mjs` 并重跑 `node scripts/gen-lobby-fonts.mjs`（漏字只会让那个字回退，不崩）。
- **真机读数**：`document.fonts` 里两份都是 `loaded`；`document.fonts.check('600 19px "Lobby Serif SC"','对局大厅')` 与
  `check('52px "Lobby Hand SC"','开一桌？')` 都为 true；`getComputedStyle` 的首选家族分别是 `Lobby Serif SC` / `Lobby Hand SC`。
  截图 ①（§10.3.5）：标题「对局大厅」是衬线、副标题「开一桌？」是毛笔手写且烫金渐变生效。

#### 2）GS 读数角标：生产默认隐藏 + 永远在可点 UI 之下

- **默认生产隐藏**：`gsHudWanted()` 是唯一判据 —— 只有 `?gs=1`、`localStorage.gsAcceptDebug=1`、
  或设置 →「高斯场景（实验）」**被用户显式点开**（`gsStep0Experiment=1`）才挂。
  **自动判定为开不算**（那正是"正式包在够格机器上常驻"的来源）。没有信号时 `mountGsHud()` 直接返回 `() => {}`，
  连节点都不建 —— 真机默认包里 `document.querySelector("[data-gs-hud]") === null`。
- **位置**：左上、安全区以下（`left:8px`，`top: calc(var(--safe-float-top))`），`pointer-events:none`，
  背景半透明 `rgba(0,0,0,.55)`，`opacity:.78`，`max-width:46vw`。
- **z-index 9999 → 25**：对局 UI z-30、大厅与 StylePick z-40、设置 z-50 —— 读数在**任何可点界面之下**，
  永远压不到键。叠层满的屏（商店 / 事件）里它会被面板盖掉一部分，这是有意的取舍（调试读数不抢 UI）。
- **两处整屏再藏一层**（`setGsHudHidden(next, key)`，按 key 计数，避免两个 effect 抢一个布尔）：
  大厅开着时 `"lobby"`、风格选择屏开着时 `"stylepick"`。所以即使有调试信号，StylePick 那一屏也读不到角标（`display:none`）。
- **真机验证**：默认包（`gsAcceptDebug` / `gsStep0Experiment` 均未写）在大厅与对局里 `[data-gs-hud]` **不存在**；
  写 `gsAcceptDebug=1` 后，StylePick 里节点存在但 `display:none`；锁定风格进商店后可见，`rect = (8, 49, 368×90)`，
  `pointer-events:none`。生产默认不会再挡住「锁定这张风格，开局」。

#### 3）StylePick 的显式退出（修"整屏盖住了 ✕ 结束对局"）

- 右上角新增 **「✕ 返回大厅」**：真机实测热区 **80×44 CSS px**（`rect = 702,55,80,44`，≥44），
  位置在安全区以下、与标题不重叠。
- 点击与安卓返回键走**同一条路**：`ui/quitGame.quitGameToLobby`
  （`rounds.leaveNow()` 退房 → `game.endGame()` 收局 → `lobby.openLobby()` 开大厅），
  与工坊顶栏的「✕ 结束对局」、设置页「退出游戏」、PhaseBar「🏁 返回大厅」是同一份实现。
  `useBackLayer(true, quitGameToLobby, "game-style")` 让系统返回键先关这一屏。
- **零消耗**：这一屏还在一局的最前面，一张片都没出；游戏券只在局内出片时扣（`data/gameTicketRules`）。
  真机点退出前后顶栏都是 **🎟 6 / ⚡ 300k**（未变），且 `game.state === null`、大厅 `screen === "home"`。
  联机局退出时 `leaveNow()` 会把服务端房间退掉，不把账号留在房里。
- 边界那一支（「风格已经锁定」）也摆了同一颗出口，不会有"只能锁定"的整屏。

#### 4）联机状态竞态：大厅"已接通" / 匹配中"AI 补位"

**根因（三处叠加，不是一句"时序"）：**

1. **缓存键**：`refreshOnline()` 调的是 `probeServerCaps(true)`，而这个函数的 `true` 只跳过
   "dev 没配 API_BASE 当没有服务端"那一条；**`caps` 已存在时它直接回缓存**（`if (caps) return Promise.resolve(caps)`）。
   于是大厅打开 / 进匹配前那些"强制刷新"从来没有发出过第二个请求，"已接通"可以是一整场会话之前的结论。
2. **两个字段各说各的**：大厅右上角读 `serverOnline`（能力位探测结果），匹配中 C 屏读 `online`
   （这一局是否真的在服务端队列里）。`chooseMatch()` 进屏时先把 `online` 写成 **false**，再等
   `refreshOnline()` + 第一发 `findMatch`；C 屏把 `online === false` 直接读成"本机 AI 补位"，
   于是这几百毫秒~10 秒里画的是「AI 补位 · 未排队」，底部同一时刻写着「正在连接房间服务…」——
   与大厅的「联机已接通」自相矛盾。弱网 / 请求超时下这个窗口能有好几秒，看起来就是"卡住了"。
3. **回归**：修法把 `online` 提前置为"已知联机"后，匹配轮询 effect 会提前开跑；它的超时判据是
   `Date.now() - matchStartedAt >= 60_000`，而队列未落地时 `matchStartedAt === 0`，于是**第一拍就判超时**
   （真机复现 3/5 次）。**唯一判据**是 `matchStartedAt > 0`，没建队就不该开拍、更不该判 60 秒。

**修法（单一状态源 + 真刷新）：**

- `data/serverCaps.refreshServerCaps()`：**绕过 `caps` 缓存**真打一发健康端点（与 `probeServerCaps` 共用同一段请求 / 收尾，
  单飞复用同一个在途 promise）。失败只影响"这一刻通不通"，不清 `caps`（能力位是"会不会"，两件事）。
- `lobbyStore.refreshOnline({ fresh: true })`：`openLobby()` 与进匹配前用它；其余动作仍用缓存结论。
- `Lobby.startPicked()`：点主键就**先起火**一发 fresh 探测，与 2.4 s 穿窗并行；`chooseMatch()` 里那一发
  fresh 单飞复用它，不额外延迟。
- `chooseMatch()`：`online` 不再先写 false，而是 `get().serverOnline === true`（大厅那份最新结论）；
  `busy` 表示"这一拍还没落地"。
- `SearchingC`：`connecting = busy && queue === null && note === null`。连接中一屏**不写**「AI 补位 / 未排队」，
  写「正在连接房间服务… / 正在排队 / 正在连接」；队列落地才切「匹配中 / 已排队」。
- `useLobbyOnline`：匹配轮询只在 `matchStartedAt > 0` 时开拍（见根因 3）。

**验证方法（真机 + CDP 注入 3 s 网络延迟，把窗口放大到能采样）：**

- 前置：大厅右上角必须显示「联机已接通」；点主键 → 穿窗 2.4 s 结束 → 从 2.6 s 起每 0.4 s 采一次 C 屏文案，共 6 个采样点。
- **改前**（main `b3d2ab05` 的同一份代码，临时开 debuggable 的 release 包）：**5/5 次**都命中，
  30 个采样点里 **28 个**是「AI 补位 · 未排队」（多数同时也写着「正在连接房间服务…」）；
  证据截图 `.tmp-fonts/device-before-race.png`。
- **改后**：**5/5 次、30 个采样点里 0 个**出现「AI 补位 / 未排队」；28 个采样点是
  「正在连接房间服务… / 正在排队」，其余是队列落地后的「匹配中 · 4 人局 / 已排队 00:00」。
  即：大厅与匹配中现在读同一份"刚刚问到的"结论，不再有自相矛盾的那一窗。
- 改后 5 次运行的明细：`.tmp-fonts/device-race-after.json`；改前：`.tmp-fonts/device-race-before.json`。

#### 5）五张真机截图（不提交，路径供验收）

目录：`C:\Users\tliu7\ideahub\_agent67_evidence\`

| # | 文件 | 看什么 | 结论 |
|---|---|---|---|
| 1 | `01-lobby-800x363.png` | 大厅首屏（最终正式包） | 标题衬线、副标题毛笔手写、烫金渐变生效；GS 角标不存在 |
| 2 | `02-stylepick-800x363.png` | 选风格屏（最终正式包） | 右上「✕ 返回大厅」可见；底部「锁定这张风格，开局」无任何遮挡；GS 角标不存在 |
| 3 | `03-back-lobby-800x363.png` | 点「✕ 返回大厅」之后 | 回大厅首屏；顶栏 🎟 6 / ⚡ 300k 与退出前一致 |
| 4 | `04-ingame-hud-800x363.png` | 调试信号打开后的对局（商店，临时 debuggable 包） | 角标在左上 `(8, 49) 368×90`、半透明、`pointer-events:none`、z-25；商店面板盖在它上面（它压不到键）；StylePick 里它是 `display:none` |
| 5 | `05-matching-800x363.png` | 匹配中（最终正式包） | 顶部「匹配中 · 4 人局」、右侧「已排队 00:01 / 这一池 1/4 人」，与大厅「联机已接通」一致；无 GS 角标 |
| — | `race-before.png` / `race-before.json` / `race-after.json` | 竞态对照 | 改前「AI 补位 · 未排队 / 正在连接房间服务…」；改后 30 个采样点 0 次 |

> 最终正式包（非 debuggable、同一包名覆盖、登录态保留）上是第 1/2/3/5 张；第 4 张是临时 debuggable 包
> （只为开 CDP 读位置），同一份 JS/UI。StylePick 里 `[data-gs-hud]` 节点：默认正式包**不存在**；
> 写调试信号后节点存在但 `display:none`（上层 UI 也盖得住它）。

#### 6）包体增量

- 字体资产：`public/fonts/` 新增 47.4 KB woff2 + 8.7 KB OFL 许可全文 + 3.7 KB 清单（未压缩）≈ 59.8 KB。
- **APK 增量**：以真机同一条 main（`b3d2ab05`）出的 `app-sideload-release.apk` 为基线
  （**109,621,393 B**）→ 本次最终包（非 debuggable）**109,676,069 B**，差 **+54,676 B（+53.4 KB）**。
  与"字体 47.4 KB + 代码/清单几 KB"对得上。
  （中间用 debuggable 包做 CDP 验收时，APK 会因 dex 带调试信息 / 资产压缩级别不同而 +3.6 MB ——
  那不是本改动的体积，最终包以非 debuggable 那份为准。）

#### 7）分支 / PR / CI / main

- 分支：`feat/ui-fonts-hud-fixes`（从 main `b3d2ab05` 开）
- PR：**#564** <https://github.com/TianbinLiu/ideahub-app/pull/564>
- CI（GitHub Actions，run `46137215130`，head `56292103`）：build ✅ / android ✅（debug 变体编译，不设 required）
- main：**`dd8c4df3`**（`Merge pull request #564 from TianbinLiu/feat/ui-fonts-hud-fixes`）
  - 代码 + 字体：`f5813c30`；文档补记：`10ff562a` / `56292103`
  - 文档补记 PR #565 合并后当前主干：`2fb22861`

#### 8）剩余风险

1. **字体只覆盖 B 案那几处文案**：若以后在 `.lobby-serif` / `.lobby-hand` 里写新字而没补
   `scripts/lib/lobby-font-chars.mjs` 并重跑生成脚本，那个字会回退到系统衬线/手写（不空白、不崩；
   构建门禁会核对"清单与字体一致"，但不会扫描 JSX 文案）。
2. **调试角标在叠层密集的屏里会被面板盖住一部分**（z-25 是有意的）；它只在三种调试信号下存在，
   生产默认玩家看不到。如果以后要"开发时也能看全"，应做成一个可展开的小胶囊，而不是把 z 抬回 UI 之上。
3. **联网竞态只修了"状态自相矛盾"这一层**：`findMatch` 本身超时（10 s）仍会退回本机 AI 并把原因写在底栏
   （这是既有的诚实兜底，不是这次要改的）。弱网下从点主键到进队列仍可能要几秒 —— 但屏幕上不再说反话。
4. **字体 preload 是全局的**：即使用户从不进大厅，App 启动也会预取 48 KB（首屏 JS 的零头）。
   如果以后要抠这 48 KB，可改成进大厅路由时注入 `<link rel=preload>`；当前选的是"进大厅不跳字"优先。
5. 真机验收期间为了挂 CDP，临时把 release 变体开成 `debuggable true` 出过两个中间包；**最终装到手机上的是
   非 debuggable 的正式包**（同一包名同一签名覆盖安装，登录态保留）。中间包没有提交。


---

## 11. 证据（截图不进仓库）

主目录：`C:\Users\tliu7\ideahub\_agent65_evidence\`

| # | 文件 | 看什么 |
|---|---|---|
| 1 | `01-match-night-852.png` | B 匹配页 · 夜：窗/月居中、左右两列、三张厚卡、黄铜主键、票根 |
| 2 | `02-match-day-852.png` | B 匹配页 · 昼：窗景仍为主体、UI 不压窗 |
| 3 | `03-searching-c-852.png` | C 匹配中（联机队列演示）：三圈光环与 3D 月同心、顶部已排队/2/4、底部取消 |
| 4 | `04-loading-b-852.png` | B 加载页：三张发牌顺序卡 + 62% 黄铜进度环 + 取消开局 |
| 5 | `05-flythrough-852.png` | 点黄铜主键后穿窗（冻在 0.30 / 点云阶段），取消键在右上 |
| 6 | `06-cancel-home-852.png` | 从匹配中取消 → 回大厅首屏（窗景还在） |
| 7 | `07-searching-c-ai-852.png` | C 的离线/超时分支：未排队、`--:--`、用 AI 开局 + 取消 |
| 8–10 | `08-safe-home / 09-safe-searching / 10-safe-loading` | 模拟真机 49px 安全区：按钮都在状态栏以下 |
| 11–16 | `11..16-*-800x363.png` | 同一组三屏在 800×363 @ dpr3.5（真机几何） |
| 17 | `17-game-start.png` | 加载页走完 → 真的进对局（StylePick 选风格卡） |
| — | `readings-852.json` / `readings-800.json` / `readings-safe.json` / `readings-flow.json` | hitbox / fps / 月亮投影 / 安全区 / 交互流程的原始读数 |

---

## 12. 分支、PR、CI、main

- 分支：`feat/ui-match-b-c`（从 main `131fccf9` 开）
- PR：**#562** <https://github.com/TianbinLiu/ideahub-app/pull/562>（代码 + 本文；截图不进仓）→ **已合并**
- CI（GitHub Actions，run `46124508625`）：
  - `build` ✅ 1m12s（tsc / lingui extract / 全部构建期检查 / vite build）
  - `android` ✅ 1m56s（debug 变体编一遍，不设 required）
- main：**`f0caac56`**（`Merge pull request #562 from TianbinLiu/feat/ui-match-b-c`）
  - 代码提交 `95ef6130`；文档提交 `ad83f115`


