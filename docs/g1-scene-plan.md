# G1 实施计划：工坊横屏桌面（横屏 / 桌子重做 / 开场运镜 / 删人偶）

> 2026-11-22。这份是**动手前的施工单**：G1 动的是 `src/studio/scene/` 里最大的一块（`TableScene.tsx` 74KB +
> `PlayerArms.tsx` 55KB + 第一人称眼位相机），所以先把它拆成 4 个可单独合、单独回滚的提交。
> 设计意图见 `docs/workshop-game-design.md` §2.6 / §2.6b。

---

## 0. 现状（先看清楚再动）

- 场景是**竖屏优先**：`layout.ts` 的注释写死"竖屏可视 x≈±1.55 → 3 张窗口化"，`TABLE = { w: 16, d: 7 }`；
- 相机是**第一人称眼位**：`cameraOrbit.ts` 按 `PLAYER_HEAD` 求 `eyeCam`，`DEFAULT_CAM` 只是兜底；
- 玩家自己有一具 3D 模型（`PlayerArms.tsx`：手臂/上身，`VrmNpc`/`TripoNpc` 是 NPC 铸卡师）；
- 卡位常量全按竖屏算过：`CHAIN`（节点链）、`MARKET`（市场平摊）、`SPREAD`、`DECK_POS`。

---

## 1. 删掉玩家那具粗糙模型（最小、最先做）

- 目标物：`TableScene` 里挂的**玩家侧身体/手臂**（`PlayerArms`），不是 NPC（铸卡师要留）。
- 做法：把它的挂载点收进一个 `SHOW_PLAYER_BODY = false` 常量后面（先留代码、关显示），
  确认没有别处读它的骨骼/眼位之后再删文件。
- ⚠ **先查依赖**：`cameraOrbit.playerEye()` 可能用 `PLAYER_HEAD`；删模型后眼位要改成固定机位
  （直接用 `DEFAULT_CAM` 或 G1 的新机位），否则相机求值拿到空对象会黑屏。
- 验收：进工坊看不到那具人偶；相机不再跟着一个不存在的头走。

> **落地记录（2026-11-22）**：已摘 —— 开关在 `layout.SHOW_PLAYER_BODY`（改回 true 即整条回滚）。
> 相机兜底机位用 **`DEFAULT_CAM`**（俯视那台，本来就是"模型未加载完"的兜底）。
> ⚠ 试过 `NPC_CAM` 但不合用：它在 z=2.45，而卡组堆 / 展开排 / 桌面卡位都在 z=2.75 ——
> 会落到相机**背后**，而 3D 桌面上的卡组堆是 `openDeckView` 的唯一入口（点不到就开不了卡组窗）。
> 这条留给第 4 步的新机位一起解决（§4 的落点比 `DEFAULT_CAM` 靠后、能看全铸卡师）。
> 摘模型时还清出了三处"别处依赖玩家"：`PlayerScreenAnchor`（换形象按钮的头侧锚点）、
> `AvatarSwapButton`、以及 `openDeckView` 的第三人称滑梯（`DECK_CAM` + `orbit:"player"`）；
> 三处都走同一个开关，`PLAYER_HEAD / PLAYER_TORSO / playerEye` 随之不再被写入（相机也不再读）。

## 2. 横屏

两条路，**建议先走 A**：

- **A. 应用内锁横屏**（真横屏）：进 `/studio` 时调 Capacitor 的屏幕方向插件锁 `landscape`，退出解锁；
  3D 画布按 `window.innerWidth > innerHeight` 重算 aspect；UI 用宽布局（左：背包条；中：桌面；右：道具栏）。
  - 要先确认原生侧有没有 orientation 插件（没有就得加一个，`@capacitor/screen-orientation`）。
- **B. 伪横屏**（CSS 旋转 90°）：不推荐 —— 手势、拖拽层、WebView 的触摸坐标全要对齐旋转，
  坑比 A 多得多。

## 3. 桌子重做（宽度按横屏比例）

- `layout.ts` 加一组**横屏常量**（不要改竖屏那套，竖屏还在用）：
  ```ts
  export const TABLE_LAND = { w: 22, d: 9, thick: 0.35 };   // 横屏：更宽更浅
  ```
- 卡位常量按新桌面重算：`CHAIN.maxVisible` 5 → 7、`MARKET.perRow` 3 → 4、`SPREAD` 的 `dx`/`centerX` 重算；
- 桌子网格（`TableScene` 里的长桌 mesh）读新常量；**中线、两侧木纹、光带**跟着拉伸；
- 验收：横屏下桌面占满宽度、两侧不留黑边，卡片不重叠、不出桌。

## 4. 开场运镜（俯冲 → 近处）

- 位置：`TableScene` 挂载后 **2.6 秒**的一次性动画（可点屏幕跳过）；
- 关键帧（横屏机位）：
  - 起点：`pos [0, 18, -6]`（高处俯视，看得见整张桌子与四把椅子）
  - 终点：`pos [0, 4.2, 6.2]`、`look [0, 0.2, -1.2]`（接近现在 `NPC_CAM` 的对坐高度）
  - 缓动：`easeOutCubic`，前 30% 慢、中段快、末尾稳；
- ⚠ 与 `cameraOrbit` 互斥：动画期间**暂停** orbit 的同步（否则鼠标/陀螺仪把镜头抢回去），
  结束后 `syncOrbitFromCamera()` 一次，把手感交给原来的控制；
- 验收：进工坊像「货币战争」那样从高处冲下来，落定后可以继续用原来的拖拽/缩放。

---

## 5. 验证清单（真机）

1. 进工坊：自动横屏、镜头俯冲、落定后能拖拽旋转；
2. 看不见玩家那具人偶；NPC（铸卡师）还在；
3. 桌面上的卡：节点链 7 张不重叠、市场 4 张一行不出屏；
4. 退出工坊：回到竖屏、其他页面布局不变；
5. `npm run build` 全绿（3D 代码多，`tsc` 必须过）。

## 6. 提交切分（每个都能单独回滚）

| # | 内容 | 风险 |
|---|---|---|
| 1 | 删/隐藏玩家身体 + 相机兜底机位 | 低 |
| 2 | 横屏（插件 + aspect + 宽布局壳） | 中（原生依赖） |
| 3 | 桌子加宽 + 卡位重算 | 中（视觉回归多） |
| 4 | 开场运镜 + 跳过 + 与 orbit 互斥 | 低 |
