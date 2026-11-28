# 对局流程机 + 三机位（相机与阶段这一轮）

> 2026-11-28。分支 `feat/game-camera-phases`，基线 `main 0d8894e1`（工作时主干前进了
> `7d8815b6` —— 那一笔只加 `design/` 案稿，与本轮代码不碰同一批文件）。
> 模拟器验收：`emulator-5554`（`sdk_gphone64_x86_64` / Android 16 / 1080×2400 / dpr 2.625，
> 横屏视口 864×360、画布 852×348 CSS）。截图在 `.tmp-cam/shots/`（**不进仓库**）。

这一轮把"现在该摆哪一屏、镜头该在哪、商店开没开"从组件里的散判收进**一个流程机**，
并把对局相机从工坊的轨道（`studioStore.enterShopCam`）拆成**独立的演出三机位**。
主人点名的五件事与落点：

| # | 要求 | 落点 |
|---|---|---|
| 1 | 匹配完成 → 室内，相机在 NPC 对面、桌子对侧，固定俯视桌面（不可自由转） | `scene/gameCam.ts` 的 `tableTop`（终点 = `layout.defaultCamFor` 的设计机位） |
| 2 | 第 1 轮不自动开商店；进「选视频风格」= 全屏浮层（工作流那套波浪 / 3D 停帧不卸载），选完消失回桌面 | `game/matchFlow.ts` 的 `shopAutoOpen`；`ui/StylePick` + `ui/waveReveal` + `StudioPage.canvasCovered` |
| 3 | 点商店 → 顶部商店栏 + 相机移到 NPC 正前方；允许点 NPC 拉近（~0.8 m）与滑屏小幅移动（±6°/±3°） | `gameCam.npcFront` + `freeLookEnabled` / `gameCamClickNpc` |
| 4 | 离开商店（点栏外 / 再点商店）→ 相机复位 + 禁用滑屏 | `matchFlow.setShopOpen`（幂等）→ `GameLayer` 的 stage effect → `gameCam.tableTop` |
| 5 | 阶段机集中一处、导出给 UI；`voting` / `leaderboard` 只留接口占位 | `game/matchFlow.ts`（10 格 + 转移函数 + `reconcileMatchFlow`） |

---

## 1. WIP 接手：留用 / 修 / 换

上一个 agent 崩溃时留下的是**接近完成的一版**（10 个改动文件 + 4 个新文件）。
逐块判断后的处置：

| 块 | 处置 | 说明 |
|---|---|---|
| `game/matchFlow.ts` | **留用** | 10 格 / 转移函数 / `reconcileMatchFlow` / `cameraModeOf` / `freeLookOf` 全部照用；`store` 的 set 层唯一同步点是这一版的骨架 |
| `scene/gameCam.ts` + `gameCamSpec.ts` | **留用** | 三机位、600 ms 缓动、距离跟随、环视夹紧、`__gameCam` 验收读数照用 |
| `store.ts` 的 `set` 包装 / `toggleShop` / `beginGenerating` / `markSubmitted` | **留用** | 每写一次 state 自动 `reconcile`；商店开关同一目标态返回**同一个对象** |
| `TableScene` 的 gameCam 接管 / 手势门 / `TripoNpc` 点击 / `StudioPage` 停帧 | **留用** | 三处接线都照用 |
| `package.json` 的 `check-game-matchflow.mjs` | **留用** | 不是加依赖，是把新门禁接进 `build` 串（CI 与 land 都会跑） |
| gameCam 接管时没同步**取景右移** | **修** | `gameCam` 那一支早退，下面的 `syncGsFrameShift` 轮不到 ⇒ 桌面机位的 4% viewOffset 会带进 NPC 正前。现在两支各同步一次（实测 `viewOffsetOn` 桌面 `true` / NPC 正前 `false`） |
| 点 NPC 被"点栏外收起商店"吞掉 | **修** | 模拟器验收抓到：点她那一拍先被窗口监听当"栏外"把商店关了，`gameCamClickNpc` 于是变空操作。新增 `scene/interactivePick.ts`（TableCatcher 注册同一条射线）让"点栏外"跳过 3D 互动物件 |
| 选风格浮层的入场 | **换** | 原来只是 160 ms `ingame-rise`；按主人"复用工作流那套：波浪/淡入"改成 `ui/waveReveal` 的圆扩散（与 `WorkflowWindow` **同一份实现**，顺手修了 `fill: "forwards"` 导致 clip 清不掉的旧问题） |
| 调试残留 | **删** | 无 |

---

## 2. 流程机：`src/studio/game/matchFlow.ts`

### 2.1 十格与来源

| stage | 含义 | 从哪来 |
|---|---|---|
| `matching` | 没开局 / 匹配页（镜头归大厅那套） | 初始值；`state === null` |
| `stylePick` | 匹配完成 → 选视频风格（全屏浮层） | rules.phase `style` / `ready` |
| `table` | 桌面（规则上在商店阶段，但商店栏**收起**） | rules.phase `shop` 且 `shopOpen === false` |
| `shop` | 商店栏开着（顶部商店栏 + 相机 NPC 正前） | rules.phase `shop` 且 `shopOpen === true` |
| `placing` | 摆卡 / 出片前（创作阶段） | rules.phase `create` |
| `generating` | **真出片那一发**在跑 | `GenSheet.generate` 的 `beginGenerating`；rules 层看不出来（仍属 create），`reconcile` 保留现场 |
| `waiting` | 交片了、等其他人 | `store.saveEntry` 显式 `markSubmitted` |
| `voting` | 展映 / 投票（**下一轮实现**，本轮占位） | rules.phase `screening` / `voting` |
| `leaderboard` | 结算 / 结束（**下一轮实现**，本轮占位） | rules.phase `event` / `round-end` / `over` |
| `nextPhase` | 关排行榜 → 下一期之间的过渡（占位） | `closeLeaderboard`（接口） |

顺序常量 `MATCH_STAGES` 与主人给的链逐字一致；`phaseIndex` 是 **0 起始**（第 1 回合 = 0），
由 `phaseIndexOf(round)` 从 rules 的 1 起始现算 —— 不另存一份。

### 2.2 转移函数（导出的动作）

- `setShopOpen(flow, open)` —— 只在 `table` / `shop` 两格有效；同一目标态返回**同一个对象**（幂等：连点 / StrictMode 双跑不抖）；其它格（placing / generating / waiting / voting / leaderboard）是空操作。
- `startGenerating` / `finishGenerating` —— placing|table → generating → placing（失败也回摆卡页，能改词重试）。
- `markSubmitted` / `backToPlacing` —— placing|generating|table → waiting；waiting → placing（重交接口）。
- `enterVoting` / `openLeaderboard` / `closeLeaderboard` / `advancePhase` —— 投票页 / 排行榜 / 下一期的**占位接口**：能进能出，本轮不实现投票、名次、利息。
- `shopAutoOpen(phaseIndex)` —— 第 1 轮 `false`，第 2 期起 `true`（见 §4）。
- `reconcileMatchFlow(flow, {phase, shopOpen})` —— rules 阶段 → 流程阶段的**唯一翻译表**。
- `cameraModeOf(stage)` / `freeLookOf(stage)` —— 流程阶段 → 相机三档（`off` / `tableTop` / `npcFront`）与"这一格能不能自由环视"。

### 2.3 store 的同步点（一条）

`useGame` 里的 `set` 被包了一层：每个动作照旧只写自己那几个字段，**写完同一拍**用
`reconcileMatchFlow(旧 match, {新 state.phase, 新 shopOpen})` 校正阶段。这样 20 多个动作
不用各写一次 `match`，也漏不了。显式给阶段的动作（交片 → `waiting`）传 `match` 覆盖。
组件侧只读 `useGame((s) => s.match.stage)`，**不再自己拼 `phase === "shop" && shopOpen`**。

### 2.4 幂等

```ts
const next = setShopOpen(match, desired);
if (next === match) return;   // 同一目标态：不写 store、不重渲、相机不重起过渡
set({ match: next, shopOpen: next.stage === "shop" });
```

模拟器读数：商店已开时再调 `toggleShop(true)`，`match` 引用不变（`sameObject: true`）。

---

## 3. 相机：`src/studio/scene/gameCam.ts` + `gameCamSpec.ts`

### 3.1 三机位（模拟器实读，GS 米制房间；NPC 头骨 (x −0.834, y 0.597, z −0.230)）

| 机位 | pos | look | 触发 | 能不能转 |
|---|---|---|---|---|
| `tableTop`（俯视桌面） | **(1.600, 1.060, 0.060)** | **(−0.150, 0.020, 0.020)** | stylePick / table / placing / generating / waiting / voting / leaderboard / nextPhase | **不能**（手势整段不接） |
| `npcFront`（NPC 正前 1.6 m） | **(0.766, 0.597, −0.230)** | **(−0.834, 0.597, −0.230)** | `shop` | 单指 ±6°/±3° + 捏合/滚轮 0.8~1.6 m |
| `npcClose`（点 NPC 后 0.8 m） | **(−0.034, 0.600, −0.230)** | **(−0.834, 0.600, −0.230)** | shop 里点她 / 捏合 / 滚轮 | 同上（环视只转视线、不动位置） |

- `tableTop` 的终点直接借工坊的 `defaultCamFor(aspect)`（GS 档 = `GS_CAM`，横竖屏/老场景分支都在那一处）；
- `npcFront` / `npcClose` 是**头骨 + 面朝方向现算**（`gameCamSpec.npcFrontPose`），换模型 / 挪站位自动成立；
- 三档的切换全在 `stepGameCam(dt, aspect, currentPos, currentLook, outPos, outLook)` 里收成一个位姿，
  `CameraRig` 只负责赋给相机；它排在开场运镜 / 轨道 / matchCam 之前（开了局镜头只归它）。

### 3.2 参数（`gameCamSpec.GAME_CAM`，改行为只改这一处）

| 项 | 值 | 说明 |
|---|---|---|
| 过渡时长 | **600 ms** | smoothstep（两端速度为 0）；≤ 主人给的 0.6 s 上限 |
| 基准距离 / 拉近 | **1.6 m / 0.8 m** | NPC 正前基准、点她后拉近 |
| 距离夹紧 | **0.8 ~ 1.6 m** | 捏合 / 滚轮只能在段内走（`zoomPerPx 0.004` m/px） |
| 距离跟随 | 12 /s | 点 NPC 不是瞬移，约 0.2 s 贴过去 |
| 环视上限 | **±6° / ±3°** | 与工坊米制档同一组数（`GS_LOOK`）；灵敏度 0.0014 / 0.0010 rad/px（75 px ≈ 6°、52 px ≈ 3°） |
| 环视行为 | 只转视线、位置不动 | 松手**不回中**（商店这一档是临时窗口，离开商店即复位） |

### 3.3 过渡实测（模拟器）

- 配置 `transitionMs = 600`；实读路程覆盖：**90% @ 549 ms、95% @ 549 ms、99% @ 631 ms**；
- "读数完全落定"（连续 3 个 50 ms 采样位移 < 2.5 mm）**960 ms** —— 多出来的是 smoothstep
  尾巴 + 采样粒度，不是过渡变长；真机 30~60 fps 时按 dt 积分，落定时间就在 600 ms 附近。

### 3.4 手势与"点栏外"的分工

| 阶段 | 3D 手势 | 说明 |
|---|---|---|
| tableTop 及其它 | **不接** | `TableCatcher.mode()` 直接回 null（主人点名的"不可自由转"） |
| shop | `gameLook` | 单指转视线（±6°/±3°）；双指/滚轮改距离；点 NPC = 拉近 0.8 m |
| 点 NPC 的判定 | `TripoNpc.onClick` → `gameCamClickNpc()` | 非商店阶段是空操作，**不会**弹工坊对话框 |
| 点商店栏外面 | `GameLayer` 的 window 监听 | 位移 < 8 px、不在对局 UI DOM 里、**也不在 3D 的 NPC/卡上**（`interactivePick`）→ 收起商店 |
| 再点商店键 | `BagBar` → `toggleShop()` | 与上面同一条 `setShopOpen`（幂等） |

**修掉的一个坑**：`gameCam` 那一支早退时不会走下面的 `syncGsFrameShift`，桌面机位的 4%
取景右移（`viewOffsetOn`）会一直留在相机上、把 NPC 正前那台悄悄右移。现在两支各自同步：
桌面 `viewOffsetOn = true`、NPC 正前 `false`（真机/模拟器都读了）。

**修掉的第二个坑**（模拟器验收抓到）：点 NPC 那一拍，`GameLayer` 的"点栏外收起"先跑（window
capture），它看到的目标永远是 `<canvas>`，分不清"空白桌面"与"她" —— 商店一关，`gameCamClickNpc`
就变成空操作。现在 `scene/interactivePick.ts` 让 3D 层把同一条射线注册给 UI 层，点在互动物件上
不算"栏外"。验收读到的命中链：`SkinnedMesh`（最近祖先 `eventCount = 1`）@ **1.504 m**，点后
距离 1.6 → **0.8 m**、相机位姿 = `npcClose`（见 §6）。

---

## 4. 选视频风格：全屏浮层 + 工作流那套波浪

- **流程**：`startGame` 建局（rules.phase `style`）→ 流程机 `stylePick` → 全屏浮层盖住舞台；
  选完 → 第 1 回合桌面（`table`）。
- **波浪**：`ui/waveReveal.ts`（从 `WorkflowWindow` 抽出的唯一实现）—— 圆心 = 视口角落
  （本屏固定右下角），半径 0 → `hypot(视口宽, 视口高)`，**开 520 ms / 收 460 ms**，ease-out；
  `prefers-reduced-motion` 时退成 **180 ms 淡入**。
  实测：`__stylePickWave = {corner:"rb", originInPanel:[858,354], radius:936, viewport:[864,360]}`；
  播完后 `getComputedStyle(panel).clipPath === "none"`（WAAPI `fill:"forwards"` 要 cancel 才清得掉，
  旧 WorkflowWindow 那一行其实没生效，本轮一并修）。
- **3D 停帧、不卸载**：`StudioPage.canvasCovered` 含 `stylePick` → `frameloop="never"`；
  实测帧计数 700 ms 内 **4 → 4 不变**（场景没卸、镜头状态没丢），离开这一格自动回来。

---

## 5. 第 1 轮不自动开商店

判据只有一处：

```ts
// matchFlow.ts
export function shopAutoOpen(phaseIndex: number): boolean {
  return phaseIndex > 0;   // 第 1 期 = 0 → 不开；第 2 期起照旧自动开
}
```

调用点（三条，全部走它，不再各处硬写 `shopOpen: true`）：

| 入口 | 改动 |
|---|---|
| `store.finishStyle`（选完风格开第一回合） | `shopOpen: shopAutoOpen(phaseIndexOf(advanced.state.round))` |
| `store.nextRound`（下一期） | `shopOpen: shopAutoOpen(phaseIndexOf(opened.state.round))` |
| `store.beginOnlineRound` / `resumeOnlineRound`（联机重连） | 同上（服务端推来的阶段也按这一条落） |

模拟器实读（选完风格那一拍）：`stage = table`、`round = 1`、`phaseIndex = 0`、
`shopOpen = false`、**商店栏 DOM 不存在**；点「商店」→ `stage = shop` + 商店栏出现，再点商店键
→ `table`（两条路都通，见 §6 第 6 张）。

---

## 6. 验收（模拟器 `emulator-5554`）

设备：`sdk_gphone64_x86_64` / Android 16 / 1080×2400 / dpr 2.625，横屏视口 **864×360**、
画布 **852×348 CSS**；GS 房间 splat 1.60M 点（load 2734 ms，24.8~51.4 fps）。
验收开关：`gsAcceptDebug=1`（挂 `__game` / `__gameCam` / `__gsAccept` / `__pickProbe`）+
`gsStep0Experiment=1` + `gsStep0Quality=refined`；清掉 `gsSceneCam` / `gsScenarioCam`。
驱动：`__game.startGame(20261128,{playerCount:4})` → `pickStyle` → `toggleShop`，3D 点按/滑屏用
CDP `Input.dispatchTouchEvent`（真机/模拟器上 `adb shell input tap` 打不到 3D 画布）。

| # | 截屏（`.tmp-cam/shots/`，不进仓库） | 阶段 | 相机读数 | 其它读数 |
|---|---|---|---|---|
| 1 | `01-stylepick.png` | `stylePick`（全屏浮层） | 相机待机（浮层盖住） | 波浪 rb / r936 / 520 ms；帧计数 4→4（停帧）；`shopOpen=false` |
| 2 | `02-tabletop.png` | **第 1 轮桌面，第 1 轮不自动开商店** | `tableTop` pos (1.6,1.06,0.06) look (−0.15,0.02,0.02)；`viewOffsetOn=true` | `round=1 / phaseIndex=0 / shopOpen=false / 商店栏 DOM=false` |
| 3 | `03-shop-npcfront.png` | 点商店 → `shop` | `npcFront` pos (0.766,0.597,−0.23) look (−0.834,0.597,−0.23)；`viewOffsetOn=false` | 过渡 600 ms（90%/95% @549 ms、99% @631 ms）；连点幂等 `sameObject=true` |
| 4 | `04-npc-close.png` | 点 NPC → 拉近 | `npcClose` pos (−0.034,0.600,−0.23) look (−0.834,0.600,−0.23) | 命中探针 `true`（SkinnedMesh ec1 @1.504 m）；距离 1.6 → **0.8 m** |
| 5 | `05-freelook.png` | 滑屏（dx150/dy120） | 位置不动；视线 yaw **6.0°** / pitch **3.0°**（硬停） | `maxYawDeg 6 / maxPitchDeg 3` |
| 6 | `06-shop-closed.png` | 关商店（点栏外）→ `table` | 复位 `tableTop` pos (1.6,1.06,0.06)；`viewOffsetOn=true` | 关后再拖 180 px：pos/look/yaw **全不变**（滑屏已禁用）；再用商店键开→关一次也通 |

> 6 张图只截了"界面看起来对"的那一帧；上面每个数都是从页面现读的（`__gsAccept` /
> `__gameCam.snapshot()` / `__game` 的 store），不是看截图估的。

复现（一次性脚本在 `.tmp-cam/`，**不进仓库**）：

```bash
npm run apk
adb -s emulator-5554 install -r android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk
adb -s emulator-5554 shell am start -n com.ideahub.branchvideo.debug/com.ideahub.branchvideo.MainActivity
# 等 WebView：pidof com.ideahub.branchvideo.debug
# adb forward tcp:9335 localabstract:webview_devtools_remote_<pid>
# localStorage: gsAcceptDebug=1 / gsStep0Experiment=1 / gsStep0Quality=refined → reload
# __game.getState().startGame(20261128,{playerCount:4}) 起局；再按上表逐拍驱动
```

---

## 7. 构建 / 门禁 / 合流

- `npm run build`（`npm run apk` 内跑同一串）：**通过** —— tsc + lingui extract + 全部构建期检查
  （含新增的 `check-game-matchflow`，**102 条断言**）+ vite build；随后 `cap sync` + gradle
  `assembleSideloadDebug` **BUILD SUCCESSFUL**。
- 出包：`android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk`，
  **114,728,709 B**（109.4 MiB），装在模拟器上验收（`versionCode 95`，debug 壳）。
- 分支 `feat/game-camera-phases` → PR（代码 + 本文档 + `scripts/check-game-matchflow.mjs`）→
  CI 绿 → merge。PR 号与 CI run 见 PR 页面；`.tmp-cam-*` / `.tmp-cam/` / 截图不入库。

---

## 8. 剩余风险 / 下一步

1. **只在模拟器上验过**：真机 `3C15CJ00C8V00000` 本轮没插（模拟器是宿主机 GPU，fps 不能当结论）；
   `npcFront` 的 0.8 m 近景在真机上的观感（她的脸占屏比例）与店栏遮挡没量。
2. **点名"点 NPC 拉近"在模拟器上有过一次**（修 `interactivePick` 之前）：那一拍被"点栏外收起"
   先关掉商店，于是看着像"点她没反应"。修好后的最终版验收读到：中心点的命中链是
   `SkinnedMesh ec1 @1.50 m`，点后距离 1.6 → 0.8 m；但**正中一点恰好压在头发/脸轮廓边缘**时
   仍可能打空 —— 界面兜底是商店栏那颗「收起商店」与再点商店键（两条都通），下一轮可在命中
   为空时把"点她"的判定放宽到她屏幕包围盒。
3. **过渡的墙钟时长在极低帧率下会拉长**：`stepGameCam` 的 dt 夹了 0.1 s（防后台切回来瞬移），
   所以 < 10 fps 时 600 ms 的缓动会走更久。模拟器 24~51 fps 下 99% 路程 631 ms。
4. **`voting` / `leaderboard` 只有阶段占位**：流程机能进能出（`reconcile` 会自动落进去，
   下一期由 `nextRound` 落回 shop/table），但没有投票页 / 排行榜 / 利息；那三样是下一轮。
5. **自由环视的角度离开商店后仍留在 `gameCam` 状态里**（yaw 6°/pitch 3°），因为相机已回
   `tableTop`、这一层不生效；下次进商店时 `setGameCamStage` 会归零。不影响观感，但读
   `__gameCam.snapshot()` 的人要看清楚"这不是当前相机的角度"。
6. **`beginGenerating` 只接了 `GenSheet` 的真出片那一发**：对局里其它"画首帧 / 预览"不走
   `generating`（刻意的，见 store 的注释）；以后若加第二条出片入口，要一并打这两下。
