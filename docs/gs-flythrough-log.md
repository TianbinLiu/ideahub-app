# 穿窗转场：图像化点 → 点云廊 → 渐黑（`feat/gs-flythrough-dissolve`）

> 2026-11-27。主人看完真机第一版穿窗转场的截图后说"窗景碎成黑白麻点，效果不对"，
> 这一轮把 0~2.4 s 的演出按**明确的秒级时间线**重做：平贴图 → 高斯点 → 点云廊 → 渐黑 → 匹配中。
>
> 代码：`src/studio/scene/flyTimeline.ts`（时间轴与共享 uniform）、`flyCorridor.ts`（点云廊 / 光尘）、
> `FlyCloud.tsx`（挂载点）、`matchCam.ts`（相机 + 黑幕）、`moonGeometry.ts`（飞行轨迹 / 横滚）、
> `WindowLook.tsx`（贴图化点 + 夜空淡出 + 平贴图预热）、`WindowSplat.tsx`（**每点 stagger** + 穿窗淡出）、
> `TableScene.tsx`（把横滚真的转到相机上）。
>
> 资产（agent-63 同一分支提交）：`window-moon-full.spz` / `window-sea-full.spz`（整图 26 万点，大厅底表）、
> `window-moon-deep.spz`（夜间 24 m 深空副本，**本版没接线**）；点云廊用旧的两份 12 万点
> `window-moon.spz` / `window-sea.spz` 当底表。真机 `3C15CJ00C8V00000`（Android 16 / 2800×1274）。

## 1. 时间线：要的演出 vs 实现

常量只有一处：`flyTimeline.FLY_TIMELINE = { dissolve: 0.6, travel: 1.4, fade: 0.4 }`（秒），
减少动态档 `FLY_REDUCED = { dissolve: 0.3, fade: 0.4 }`。相机与画面**读同一个采样函数**
`flySampleAt(ms)`，所以不存在"相机先走了、点还没出来"这类错拍。

| 段 | 时间 | 相机 | 画面 |
|---|---|---|---|
| 化点 | 0 ~ 0.6 s | **不动**（`pagePose`，离窗 1.6 m） | 平贴图按随机块退场；窗洞那一圈的 splat 按每点随机延迟出现、尺寸 0.2→1.0 |
| 在点中穿行 | 0.6 ~ 2.0 s | 沿飞行方向前进 `FLY_TRAVEL = 6.4 m`（smoothstep 两端慢中间快）+ 轻微横滚/抖动 | 点云廊不透明度：0.42 s 起淡入、0.78 s 全开；底表 splat 在 0.66~0.85 s 淡出（交给走廊）；光尘一起出现 |
| 渐黑 | 2.0 ~ 2.4 s | 再往前 `FLY_FADE_TRAVEL = 0.9 m`（"点飞过镜头"的收尾） | 点云廊 2.0→2.35 s 淡出；页面层黑幕 CSS 0→1（400 ms，与这一段同拍） |
| 之后 | 2.4 s | 停在窗外（黑幕全黑） | 匹配中那一屏（现有逻辑一行没改） |

- 黑幕在**渐黑段开始**那一拍才拉到 1（旧版是"穿窗那一拍"就黑，太早）。
- 匹配成功 → 房间：沿用现有 `MatchCurtain` 那套（等房间 spz ready，再 400 ms 淡出），本轮没改。
- 相机横滚真的生效：`CamPose.roll` 由 `TableScene` 在 `lookAt` 之后 `camera.rotateZ(roll)`；
  幅度 ≤ 2.6°、位移 ≤ 8 mm（`moonGeometry.flyTravelPose` 里两个常数，是审美旋钮）。

### 真机实测（`__matchCam.sample` 每帧采样，一次真实点击）

| 事件 | 设计 | 实测（采样间隔 ~16 ms） |
|---|---|---|
| 点「匹配 4 人局」 | 0 ms | 0 ms（首帧采样 13.7 ms） |
| 化点结束 / 穿行开始 | 600 ms | 首个 `travel` 采样 **595.4 ms** |
| 穿行结束 / 渐黑开始 | 2000 ms | 首个 `fade` 采样 **1995.4 ms**；同帧黑幕 veil=1 |
| 全黑 / 匹配中 | 2400 ms | `phase=end` 在 **2400.6 ms**，`stage=outside`、`veil=1` |

## 2. 化点：同一张图 + 同一份 splat，同一拍

### 2.1 平贴图（`WindowLook.makePaintMaterial`）

- 保留 `MeshBasicMaterial`（sRGB / toneMapped 由 three 管），用 `onBeforeCompile` 往
  `#include <map_fragment>` 后面注入一段：每个像素按**两级网点 hash**（窗面 14 格 / 38 格，混 32%）
  算随机阈值，`uFlyDissolve` 推过去时**逐块退场**，不是整层淡出。
- 第一版网点是 120 / 260 格（很细），真机连拍里几乎看不出"散成点"——贴图掉的洞被同一张图的
  splat 补上了。放到 14 / 38 格之后，连拍里能同时看到"缺块的贴图残影 + 点"。
- `uFlyDissolve = 0` 时 alpha 逐像素不变；平贴图只在"这一档本来就是贴图 / 正在转场"时挂，
  并在 spz 就绪后以 opacity 0 预画两帧（编译 program），转场开始那一拍不现编译。

### 2.2 窗景 splat（`WindowSplat.makeDissolveModifier`）

- 用 Spark 的 **`SplatMesh.objectModifier`（dyno，逐 splat 在 shader 里算）**，**没有 CPU 遍历**：
  每点随机数 = `hashFloat(center)`（点自己的局部坐标，稳定、不用额外 attribute）；
  `local = clamp((progress − rnd·0.72)/0.28)`，`opacity ×= smoothstep(local)`、
  `scales ×= mix(0.2, 1.0, local)` —— 随机延迟 ≈ 0.43 s、出现过程 ≈ 0.17 s，总和正好 0.6 s。
- 不飞时 `active=0` ⇒ 输出 = 原值（大厅 / 房间逐像素不变）。
- **整图底表之后加了一道窗洞掩码**：只让局部半径 < 0.52 m 的那一圈化点。底表含整面墙，
  若整份都散，墙会化成点、背景露出来（正是旧的"背景透明"）。
- 相机快穿到窗面（穿行 4%~18%）时把底表 splat 淡出：夜档整图深度只到 ~1.8 m、26 万点在近处会
  糊成整屏白；昼档底表有纵深，但近场同样糊屏（见 §4）。淡出后由点云廊接手。

## 3. 点云廊（`flyCorridor.ts`）

- **源**：旧的 `window-moon.spz` / `window-sea.spz`（12 万点、只含窗洞内容、0.22 m 厚）。
  ★ 不能用整图底表：它 74% 的点是墙，复制 6 层会是"6 面墙的隧道"。
- **做法**：从源 `PackedSplats` 的 `packedArray` **直接复制 6 份**到**同一个**新 `PackedSplats`
  （每层：z 偏移 `0.25 + l·1.25` m + 随机 ±0.4；放大 `1.5 + 0.55·l`；自转 ±0.45 rad；
  每点再抖 ±0.75 m；高斯尺寸 ×0.5），只建 **1 个 `SplatMesh`**。
  建一次 ~40~100 ms（`toHalf/fromHalf` 是 Float32Array/Uint16Array 视图互转），
  在窗景 splat 就绪之后的大厅空闲 250 ms 建；**飞行中一个字节都不改**。
- **光尘**：1 个 `THREE.Points`（420 点，加色、圆形柔光贴图，冷暖两色），沿飞行路线撒开。
- **draw call**：Spark 每个 SplatMesh 每帧一次 accumulate，所以走廊只 **+1**；光尘 **+1**；
  另有 1 个 `SplatMesh` 隐藏的"源"（只读数，不进场景、不画）。合计 **新增 +2**，
  满足"新增 draw call ≤ 4"。
- 尺寸：6 层 × 12 万 = 72 万点（PackedSplats 按 2048 对齐后 718,848），约 **11.0 MB**。
  与整图底表 26 万加起来 978,848 < Spark 的 `maxSplats` 983,040（只剩 4k 余量，**不能再加层**）。
- 近相机那一份底表会淡出，点云廊从 0.42 s 起淡入，两者交叉，读起来是"图散了 → 人已经在点里"。

## 4. 夜 / 昼两档的穿行策略（几何不一样）

agent-63 对整图底表的实测（透视视锥内）：夜档窗外内容 z 1.67~1.82 m、>3 m 占 **0%**；
昼档 z p95 **29.4 m**、52.8% 的点 >3 m。窗前 1.5 m 的点数：夜 16,713 → +2.5 / +3 m **0**；
昼 +2.5 m 62,125 / +3 m 59,494。

- **夜档**：底表深度只到 1.8 m，"穿出去还有点"**完全靠点云廊**（6 层，12 万点/层）。
  底表在穿行 4%~18% 淡出（0.66~0.85 s），之后画面只有走廊 + 光尘。
- **昼档**：底表有真实纵深，但它的**近场密点**在相机一动时同样糊成"一张图"（真机连拍
  t≈1.2~1.8 s 是一整幅海天）。所以这一版昼档也把底表淡出（4%~22%，比夜档多 0.05），
  由同一个 6 层走廊接管；底表的纵深价值留在**化点段与穿行开头那 0.3 s**。
  以后想"昼档少复制层"，可以把 `FLY_CLOUD.layers` 做成按皮肤分档；这一版为观感一致保留 6 层。
- `window-moon-deep.spz`（24 m 外同一张窗景、6.3 万点）**本版没接线**：它与点云廊叠会亮一倍
  （二选一）。留着当"走廊被裁掉时"的保险。

## 5. 真机读数（`3C15CJ00C8V00000`）

| 读数 | 值 | 说明 |
|---|---|---|
| 大厅 fps | **68.2**（rAF 2 s）/ 探针 70 | 120 Hz 屏、本场景 ~68 |
| 穿行 fps | **57**（探针，整段稳定） | 走廊 71.9 万点 + 光尘在画 |
| 房间 fps | **56.9**（rAF）/ 57（HUD） | 与拆分之前一致 |
| 大厅 draw calls / tris | **56 / 777k** | 窗景整图 26 万点 |
| 穿行 draw calls | 17 → **4** | 17 = 底表 + 走廊 + 光尘 + 夜空 + spark；底表淡出后 4 |
| 房间 draw calls / tris | **115 / 3.46M** | 与拆分之前一致 |
| 点云廊建时 | 41~97 ms | 大厅空闲，一次 |
| 匹配成功 → 房间挂上 / 首帧 | **609 ms / 1367 ms** | 房间 spz ready 762 ms（`roomLoadMs`），首帧 770 ms（`roomFrameMs`） |

## 6. 验收证据（截图不进仓库，路径在本机 `.tmp-gs-fly/`）

- 夜间连拍联络图：`.tmp-gs-fly/final-night/contact-sheet.png`（20 张，t = 0/120/…/2280 ms，
  每张带 t 标签；从 CDP screencast 帧里抽，1400×636）
- 白天连拍联络图：`.tmp-gs-fly/day/contact-sheet.png`（同一套抽帧规则）
- 三张关键静帧（夜间，2800×1272）：
  - 化点中 `t=300 ms`：`.tmp-gs-fly/final-night/cast-diss/f2.jpg`（贴图缺块 + 点同时可见）
  - 点云廊中段 `t=1400 ms`：`.tmp-gs-fly/final-night/cast/f2.jpg`
  - 全黑前 `t=2250 ms`：`.tmp-gs-fly/final-night/cast-preblack/f2.jpg`
- 连拍里读到的观感：贴图 → 缺块溶散 → 窗框最后消失 → 全屏高斯点（有大小/疏密）→ 渐暗 → 全黑。

### 6.1 对局流程（初始金币 → 买卡 → 第一段真出片）

同一次真机验收里走通（没新造经济系统，全部走现有 `rules` / `flowStore`）：

1. 匹配成功 → 「用 AI 开局」：初始金币 **4**；点风格卡 → 锁定开局。
2. 第一回合商店买卡：买「实习生导演」（角色，1 金）+「黄昏天台」（场景，1 金）→ 余 **2 金**、背包 2 张。
3. 把两张卡分别拖到角色位 / 场景位（DOM 背包条 → 3D 卡位，`GameDragLayer` 的现有手势）。
4. 写一句提示词 → 「🎬 视频生成」→「① 先画首帧（约 26.7k token）」：首帧真的画出来了
   （截图 `.tmp-gs-fly/game-segment-ready.png`）。
5. 「② 出片（用 1 张游戏券）」→ MiniMax 草稿档 5 s 片；等了约 3~4 分钟，
   回来显示「用这一条交片 / 重拍一次」→ 点「用这一条交片」。
6. 状态栏：**「这一期交片了——真出片的那一条」**，本段 5 秒；对局继续（展映/投票）。
   ⇒ 初始金币买卡 + 第一个视频段生成**均走通**，没有改一条游戏规则。

## 7. 取消 / `prefers-reduced-motion`（真机实测）

- **取消**（飞行中右上「✕ 取消」）：实测点完 700 ms 的那一拍取消 →
  `stage=idle`、`veil=0`、`sample` 复位（`dissolve=0 / image=1 / corridor=0`），
  大厅回到首屏、**没有发匹配请求**（页面文案里没有"正在等真人"）。
- **安卓返回键**：飞行中按 `KEYCODE_BACK` 走同一 handler（`useBackLayer`）——
  同样 `stage=idle / veil=0`，`adb dumpsys activity` 里 `topResumedActivity` 仍是本 App（没退出）。
- **减少动态**（`gsFlyReduced=1` 强制口）：实测 `reduced=true`，
  `dissolve` 段 0~315 ms → `fade` 段 315~700 ms → `end`（状态轴 elapsed=700 ms，整体约 0.71 s）；
  `corridorMax = 0`（点云廊不挂）、相机全程停在匹配页机位。之后进匹配中。

## 8. 构建 / 合并 / 出包

- `npm run build` 绿（tsc + 40 项 check + lingui；本轮修过一次 i18n：GLSL 模板串里的中文注释
  会被当成界面字面量，已改成英文注释）。
- 分支 `feat/gs-flythrough-dissolve` → PR → CI 绿 → merge（agent-63 的 spz + 文档同分支提交）。
- 本轮**不动**默认开关：GS 仍是 `GS_STEP0 = false` + 机型自动判定；转场只在 GS 档开着时生效。
- 出包只留必要 spz/webp：两份整图底表（大厅）+ 两份旧的 12 万点（点云廊源）进包；
  未接线的 `window-moon-deep.spz` 在 `scripts/prune-app-assets.mjs` 里**裁掉**（0.78 MB 不进包，
  资产仍在仓库里）。

## 9. 剩余风险

1. **Spark `maxSplats` 只剩 4k 余量**：整图底表 26 万 + 走廊 718,848 = 978,848，上限 983,040。
   以后底表点数再涨，要先减 `FLY_CLOUD.layers` 或走廊按皮肤分层。
2. **走廊是"同一张图的 6 份"**：靠每层缩放/自转/每点抖动打散；在最近的那一层上仍能隐约认出
   窗框十字（连拍 t≈0.95 s 一张）。要彻底消掉得按点位随机抽稀/重分布，成本更高。
3. **昼档底表纵深没被利用**：本版为了"四周全是点"把昼档底表也淡出了。想利用纵深可以给昼档
   单独做 `layers` 更少 + 底表不淡；需要真机重新看观感。
4. **`window-moon-deep.spz` 在仓库里但不出包**（`prune-app-assets` 已裁，0.78 MB）。要接线时
   删掉那条 PRUNE 再设计"走廊 or 深空副本"二选一（不能叠）。
5. 截图/读数仍在模拟器同一台真机上量的，**没在 8 人局 / 极端低端机**上复验；
   转场本身不依赖对局人数，但走廊 11 MB 的显存占用在低端机上需要单独看。
