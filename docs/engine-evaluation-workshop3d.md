# 工坊 3D 要不要离开 WebView？引擎路线评估（A / B / C / D）

> 2026-11-25 · **只评估、不改代码、不动资产**。
> 依据：[`gaussian-splatting-workshop.md`](gaussian-splatting-workshop.md)（§6 能重建/不能重建、§9 窗与光照、§10 待决策）、
> [`gs-step0-plan.md`](gs-step0-plan.md)、[`gs-step0-splat-log.md`](gs-step0-splat-log.md)（第 0 步读数）、
> 本仓代码与现成安装包（§1 全部标了量法）。
> 口径：**人日 = 1 人、含自测与真机走查、不含美术资产重建**，是估算不是承诺；凡是没实测的数都写了「未实测 / 未核实」，
> 文末 §6 给了每条外部事实的链接与核实状态。**这份文档最重要的结论是「现在还缺一个读数」，不是「选哪家引擎」**（§0 第 3 条）。

---

## 0. 一页结论

1. **推荐 D：不换引擎**。留在 WebView + Spark，把力气花在「切份 / LOD / 减到 1~1.2M / 烘焙兜底」上；**A 是唯一值得预留的升级方向**；
   **B（Unity as a Library）、C（Godot）现在都该否决**——不是技术不好，是它们的代价落在「包体 + 全屏限制 + 两套 UI」上，而我们的问题大概率不在这三处。
2. **为什么**：3D 场景只是这个 App 的 **4%**（`src/studio/scene/` 410 KB / 8,036 行 / 22 个文件；全仓 ts/tsx 9.93 MB / 172,298 行）。
   换引擎要重写这 4%，却把另外 96%（玩法规则、10 个 `check-game-*` 门禁、lingui 的 1.66 MB 中文文案、全部页面与设计系统）暴露在
   「两套技术栈 / 两套 UI / 两套 i18n」的风险里。**唯一能把 3D 换掉而 96% 一行不动的路线是 A**。
3. **决定这件事的数据一次都没测过**：今天只有桌面 Chrome 的 **144fps**（2.00M 与 0.80M 两档都被 vsync 卡住，分不出高低），
   **真机 0 条读数**（`gs-step0-splat-log.md` §5-3、§6.4 自己写着"第 0 步最大的空缺"）。而这个读数**已经不用写代码就能拿**：
   设置 → 这台设备 → **高斯场景（实验）** 已经进包（`gsStep0.ts` / `gsHud.ts` / release 包可开），角标会显示 fps / splat 数 / draw call / 首进耗时。
   **下一步是 1 个人日去量，不是立项写原生渲染器。**
4. **换引擎买到的是 CPU 预算和内存控制，买不到填充率**（§3.1 的算术）。高斯泼溅在手机上先撞的是「每帧要混多少像素 × 多少层」，
   这件事 three、Filament、Unity、Godot 用的是同一块 GPU。**在没分清"是 CPU 卡还是填充率卡"之前换引擎，有一半概率花 8 周换来 0 帧。**
5. **改推荐的条件**（三档，见 §4）：真机 ≥30fps 稳定 → 不动；20~30 → 先榨干 D，再用 A 的窄版；<20 且确诊为 CPU 瓶颈 → A；
   <20 且确诊为填充率瓶颈 → 要么丢 splat 改烘焙兜底，要么接受低端机降级，**不要指望 B/C 救**。
   只有「3D 从一张桌子变成多房间 / 多人动态 / 大量 NPC」这种产品级扩张，才重新考虑 B。

**速览**（详细拆解与出处见 §2/§3）

| | 接入工作量 | APK 增量 | 持续维护 | 性能上限（手机） | 保住现有玩法逻辑 | 回滚难度 | 许可 |
|---|---|---|---|---|---|---|---|
| **A** 原生渲染层 + Capacitor 插件 | **34~51 人日**（≈7~10 周） | **+5~10 MB**（引擎），splat 资产另算 | 两套（TS 决策 + 原生渲染） | 与 D 同（受填充率限），CPU 每帧省 3~6ms（估） | **~100%**（96% 代码一行不动） | **低**（删插件、关开关） | Filament Apache-2.0 |
| **B** 嵌 Unity（UaaL） | **30~45 人日**，UI 全搬则 **45~70** | **+25~45 MB** | 两套完整栈（含 UI/i18n/UI 工具链） | 与 A 同 | 玩法逻辑可留，**UI 层大概率要重写** | 中~高 | Unity Personal（<20 万美元） |
| **C** 嵌 Godot 4 | **44~67 人日**（≈9~14 周） | **+50~100 MB** | 两套完整栈，社区资料最少 | 与 A 同，且 compute 支持差 | 玩法逻辑可留，UI 要重写 | 中 | Godot MIT |
| **D** 不换引擎 | **13~20 人日**（≈3~4 周） | ±0 | 一套 | 1~1.2M 高斯 / 30fps（**待真机验**） | **100%** | 无需回滚 | three / Spark 均 MIT |

---

## 1. 先把尺子摆好：现状读数（哪些是量的、哪些没有）

### 1.1 代码规模：3D 是 4%，玩法是 96%

| 层 | 量法 | 读数 |
|---|---|---|
| 3D 场景（要重写的那部分） | `src/studio/scene/` 22 个文件 | **409,637 B（≈410 KB）/ 8,036 行**；其中 `TableScene.tsx` 89,381 B / 1,838 行、`TripoNpc.tsx` 60,853 B / 1,122 行、`PlayerArms.tsx` 55,337 B / 944 行 |
| 对局玩法 + 局内 UI | `src/studio/game/` 84 个文件 | **1,038,332 B**；其中局内 UI 47 个文件 **457 KB**（大厅 / HUD / 结算 / 战绩 / 回放 / 引导） |
| 全仓 ts/tsx | `src/**/*.ts,tsx` 505 个文件 | **9.93 MB / 172,298 行**（`src` 含文案共 13.24 MB / 511 文件） |
| 文案 | `src/locales/` | `zh.po` **1,660,350 B**、`en.po` **1,776,575 B**（lingui 提取，UI 与玩法共用） |
| 玩法门禁 | `package.json` 的 `check-game-*` | **10 个脚本**（rules / bots / lobby / online / stream / ingame / tickets / history / wrapup / spectate），`check-game-rules` 一个就 851 条断言 |

★ **一行结论**：3D 层占 ts/tsx 的 **4.1%（按字节）/ 4.7%（按行）**。所以「换引擎」的真实含义是：
**用 4% 的代码去冒 96% 的风险**——除非选到「只动这 4%」的路线（A）。

> ⚠ 与任务书的出入（以代码为准）：任务书写 `TableScene 74KB`，实测 **89 KB**（1,838 行）。
> 任务书写 **Capacitor 7**，`package.json` 实际是 **`@capacitor/*: 8.5.1`**；
> `@react-three/fiber` 锁 `^9.3.0`（本机 `node_modules` 装的是 9.6.1），Spark 精确锁 **2.4.0**，three `^0.180.0`。

### 1.2 包体：现在就已经踩在国内下载的痛点上

| 项 | 读数 | 量法 |
|---|---|---|
| 侧载 release 包（含 splat） | **100.43 MB** | `android/app/build/outputs/apk/sideload/release/app-sideload-release.apk`（2026-11-25 01:53） |
| 其中 splat 资产 | **30,512 KB（29.8 MiB）** | 解包看 `assets/public/models/study/gs/workshop-step0.spz` |
| 侧载 debug 包（**不含** splat） | **73.57 MB** | 同上目录，`app-sideload-debug.apk`（2026-11-24 22:13），解包确认**没有** `study/gs/` |
| 任务书给的读数 | 105.3 MB = 基线 + 32.3 MB | 与本机现成包差 ~5 MB，属于**不同变体 / 不同时间点**；**两条都别当验收数**，要对比就同一变体出两次包（一次带资产、一次不带） |
| 仓里已有的包体红线 | **「83MB 的包国内基本下不动」** | `scripts/release.mjs:208-211` 记着 2026-08-30 线上事故：清单里的 `apkUrl` 直通 GitHub，83 MB 国内下不动 → 必须走自家镜像 |

★ **这条比引擎选型更硬**：我们的现状是 100 MB 级、全量更新、国内镜像分发。B（+25~45 MB）和 C（+50~100 MB）会把「下载失败」
从「偶尔」变成「常态」；而 `abiFilters` 现在**一个都没配**（`android/app/build.gradle` 只有 versionCode/versionName/minify），
也就是说**任何 native 库都是全 ABI 进包**——Unity/Godot 的 `.so` 会按 ABI 叠加，除非顺带改出包链（那又牵动 `release.mjs` 的包体与自更新核对）。

### 1.3 性能读数：只有桌面，真机是 0

| 档 | 环境 | fps | tris | draw calls | 首进加载 |
|---|---|---|---|---|---|
| 全量 2.00M 高斯 | headless Chromium / RTX 4060 / 1280×720 / dpr 1 | **144（vsync 封顶）** | 4.25M | 70 | 2.9 s（缓存后 1.4~1.7 s） |
| 截断 0.80M | 同上 | **144（vsync 封顶）** | 1.85M | 70 | 缓存后 1.3 s |

出处：`gs-step0-splat-log.md` §6.4。**两档在桌面被 vsync 卡在同一个数，等于没测出差**；真机读数一条都没有。
`maxSplats` 选项**不是真截断**（只影响生成器分配容量）；真截断是初始化后改 `splat.splats.numSplats`，
代价是**打包数组是空间顺序，截尾 = 房间缺一块**（0.8M 档实测后墙/窗那半截没了，§6.3）。

### 1.4 栈与平台实况（都会影响三条路线的可行性）

| 项 | 实况 | 影响 |
|---|---|---|
| 外壳 | Capacitor 8.5.1，WebView 单页 + 原生插件（`VideoMergePlugin` 59,670 B、`QQLoginPlugin` 16,007 B、`WeChatPlugin` 13,075 B） | 现有插件都只做「功能调用」（合并 / 登录 / 分享），没有一个在屏上画像素；A 要加的是**第一个渲染视图** |
| minSdk / targetSdk | **24 / 36**（`android/variables.gradle`） | minSdk 24 = Android 7.0，Vulkan 只是「可选」，GLES3 是底线 → **任何 splat pass 必须有一条 GLES3 路径** |
| 渲染配置 | `StudioPage.tsx:425` `<Canvas dpr={[1,2]}>`，**没有开 shadows**，`preserveDrawingBuffer` 仅 DEV | splat「吃灯」「玻璃采不到 splat」这些结论都建立在今天这串参数上（§9.2.1、§9.5-2） |
| 停帧机制 | `canvasCovered`（画布 / 大厅 / 设置 / 战绩 / 观战盖着时 `frameloop` 停，`SceneClockKeeper` 接住时钟） | A 换原生后，这套「谁盖着谁停帧」的判定要**重建一份**（原生要知道浮层开没开） |
| 场景依赖 | `three 0.180` + `@react-three/fiber` + `@sparkjsdev/spark 2.4.0`（**MIT**） | D 的许可证风险几乎为零 |

---

## 2. 定量对比表

> 所有人日、包体、性能上限都是**估算 / 量级**；"保住现有玩法逻辑"按**代码是否原样留**算，不按"能不能重写出来"算。

| 维度 | **A. 留 App，3D 换原生渲染** | **B. 嵌 Unity（UaaL）** | **C. 嵌 Godot 4** | **D. 不换引擎** |
|---|---|---|---|---|
| 接入工作量（拆解见 §3） | **34~51 人日**：验证 2~3 + 插件壳 5~8 + splat pass 10~15 + 场景移植 10~14 + 桥 4~6 + 收口 3~5 | **30~45 人日**：UaaL 接入 4~6 + 场景重建 15~22 + 桥 8~12 + 包体/性能 3~5。**若局内 UI 也要搬进 Unity：45~70** | **44~67 人日**：AAR 接入 4~6 + 场景重写 18~25 + splat 渲染 12~20 + 桥/UI 6~10 + 收口 4~6 | **13~20 人日**：真机基线 1~2 + 切份/LOD 4~6 + 减面 3~4 + 烘焙兜底 3~5 + 收口 2~3 |
| APK 增量 | **+5~10 MB**（`filament-android` **5.22 MB** AAR 实测 1.81.0；自写 pass + 着色器少量）；splat 资产按 D 的预算（单套 8~12 MB）另算 | **+25~45 MB**（Unity 运行时 + IL2CPP；社区实测最小工程 ARM64-only APK ≈14 MiB 起，带 3D/URP 更大——**本仓未实测**） | **+50~100 MB**（官方 AAR **103,251,267 B**，含全部 ABI；只留 arm64 会小很多，**未实测**） | **±0**（资产预算不变；减面反而省） |
| 持续维护 | 两套渲染栈（TS 决策 + Kotlin/C++ 渲染），但**边界干净**：原生只画，JS 只决策 | 两套完整栈：Unity 工程 + Gradle 双模块 + 两套 UI + **两套 i18n**（lingui 1.66 MB 中文文案要重做）+ Unity 版本升级 | 同 B，且社区资料最少；Godot 版本升级 + 官方 AAR 版本升级 + 自家的 splat 插件要自己养 | **一套**；Spark/three 升版单独验（§4 风险 7） |
| 性能上限（手机上高斯 / fps） | 与 D **同一个 GPU 天花板**；A 多买到的是每帧 **3~6 ms 的 CPU 预算**（React/r3f 不再在渲染路径上），不是填充率 | 同 A（同一块 GPU、同样的填充率） | 同 A；**但 Godot 官方文档自己写着"compute shader 在手机上支持普遍很差（驱动 bug）"**，排序可能要退化成 CPU 排序 / 片元排序 | **1~1.2M 高斯 / 30fps**（施工单目标；**真机未测**）。2M 是今天这份资产，不是预算 |
| 保住现有玩法逻辑 | **~100%**：zustand / TS 规则 / 页面 / UI / i18n **一行不动**；只有 `src/studio/scene/` 410 KB 重写 | 规则层可原样留（Node 里跑也行），**但局内 UI 在全屏限制下大概率要重写**（§3.3） | 同 B | **100%** |
| 失败风险 / 回滚 | **低**：删插件 + 关开关就回到今天；代价是原生场景代码作废（4~10 周） | **中~高**：`unityLibrary` 可摘，但构建链、包体、UI 搬迁要一并回滚；且 UaaL **只支持全屏渲染**，浮层方案没有官方背书 | 中：删 AAR 容易，工作作废；AAR 体积会逼着改出包链 | **无需回滚**，增量迭代 |
| 许可证 / 授权成本 | Filament **Apache-2.0**；splat pass 自写则自有；参考实现 **splatkit 是 MIT**、**MCGS 没有许可证（不能抄）** | Unity **Personal 免费**（近 12 个月收入/融资 < **20 万美元**，超了必须付费版）；UnityGaussianSplatting **MIT**，但作者 2026-11 起**不再做显著开发**；splat 数据授权另算（Atlas 付费账号） | Godot **MIT**；社区 splat 插件许可要逐个核 | three **MIT** / Spark **MIT**（`node_modules/@sparkjsdev/spark/package.json` 实测），**零授权成本** |
| 一句话 | **唯一"只动 4%"的路线；但先证明它值得** | **用 25~45 MB 和一套 UI 换一个工具链** | **用 50~100 MB 换一个更小的社区** | **现在的最优解；缺点是不解决长期问题** |

---

## 3. 逐条路线的落地拆解

### 3.1 先算一笔账：换引擎能买到什么，买不到什么

高斯泼溅的开销分两半（这是**算术**，不是实测）：

- **填充率**：2M 个高斯，每个在屏幕上平均覆盖几十个像素（`gs-step0` 里桌面占画面大半、房间铺满，平均按 30~80 px² 估），
  1080p（2.07M px）下每帧要混 **60~160 M 片元**。中端手机 GPU 的填充预算按 **1~3 GPix/s** 量级估（**未实测**，机型差异极大），
  30fps 下每帧只有 **33~100 Mpx** 的额度 → **2M 高斯在 30fps 下大概率超预算 1.2~3 倍**。
  ★ 结论：**"能画多少高斯"由像素覆盖和带宽决定，跟你在哪个引擎里画没关系。**
- **CPU**：React + r3f 的每帧成本（状态、reconciler、矩阵更新），这一半**换引擎真的能省**（原生少 3~6 ms/帧，量级估算）。

所以 A/B/C 能改善的是「**同样填充率下更稳的帧时间**」和「**更好的内存/工具链**」，不能改善「**填充率不够**」。
真机 20fps 时，先要回答的是：**降分辨率 / 少画高斯，帧率会不会线性涨？**
会 → 填充率瓶颈，换引擎白花钱；不会 → CPU 瓶颈，A 有价值，B/C 也有可能但代价翻倍。
这个判定**不需要写引擎**（做法见 §4 的"10 分钟判别法"）。

### 3.2 A：保留 App，只把 3D 场景换成原生渲染

**要做的插件边界（按真实代码写，不按想象写）**

| 边界 | 具体做法 | 为什么这样切 |
|---|---|---|
| **原生渲染什么** | 只画「这间房」：splat 层 + 桌面/窗/卡牌这些**网格**。**不画任何 2D UI** | UI 全在 WebView，保住 96% 的代码；A 的回滚成本低就低在这一条 |
| **UI 怎么叠** | 原生视图贴在 Activity 的 decor 里，**WebView 叠在它上面**（背景透明），2D UI 全留在 WebView | ⚠ 最不确定的一块：`SurfaceView` 是"在窗口上挖洞再合成"，**透明 WebView 会失去硬件叠加**（功耗/延迟上升，未在本仓实测）；换 `TextureView` 则多一次拷贝。**第 1 周就要在真机上验这一条** |
| **相机与交互怎么过桥** | 相机**由原生持有**：JS 只发意图（"开画布浮层"→ 停帧；"点这张卡"→ 命中查询），原生回 object id + 屏幕坐标 | 反方向（JS 每帧发相机矩阵）会把 r3f 的每帧开销搬回过桥，白省；且高频 JNI 调用是新的抖动源 |
| **命中测试** | 原生射线拾取（卡牌/桌面是网格，坐标都在原生侧）→ 回 `{kind, id}`，JS 决定业务 | splat 不参与拾取（今天也是"点选只对 mesh 开 raycaster"） |
| **暂停与浮层** | 把今天的 `canvasCovered`（画布/大厅/设置/战绩/观战）改成**一条显式命令**发给原生 | 今天这套判定在 `StudioPage` 里，A 必须重建一份，不能省 |
| **splat pass 从哪来** | 三个选项，按风险排序：① **自写 GLES3 + Vulkan 的 splat pass**（SPZ 解析 + 深度排序 + 实例化四边形），参考 **splatkit（MIT，Android/Vulkan + React Native SDK）** 与 **Splatviewer_VR_Android（MIT）**；② 用 Filament 当"网格渲染器" + 自己写一条 splat 通道（**Filament 1.81.0 没有任何 splat 支持**，§6）；③ 抄 MCGS（**无许可证，不能抄**） | ① 最可控，但排序/带宽坑要自己踩；② 拿 Filament 的 PBR 与阴影，splat 仍要自己写 |

**工时拆解（估）**：验证 2~3 · 插件壳（视图/生命周期/透明合成）5~8 · splat pass 10~15 · 场景移植（`TableScene`+`TripoNpc`+`PlayerArms`+`gsStep0` 全部重写成原生）10~14 · 桥与命中 4~6 · 包体/发版/真机三档 3~5 = **34~51 人日**。
★ 最贵的一项不是渲染，是**场景移植**：8,036 行 three 代码里那些"手感"（相机轨道、弹簧骨、卡牌轮播、入场运镜）要一帧一帧对。

### 3.3 B：嵌 Unity（Unity as a Library）

**官方状态（已核实）**：UaaL 自 **Unity 2019.3** 起官方支持 Android/iOS/Windows/UWP；Android 侧产物是 `unityLibrary` 模块（Unity 运行时 + Player 数据）+ 一个可被替换的 `launcher`；
通过 **Intent 启动 Unity Activity** 或直接用 `UnityPlayer` Java API；生命周期有 `IUnityPlayerLifecycleEvents`（Unload / Quit）。

**必须过的桥（按数据流写）**

| 桥 | 走什么 | 坑 |
|---|---|---|
| **状态** | 回合/玩家/牌堆：JS（zustand）↔ Unity（C#）。要么 JS 当唯一真相、每回合推一份快照；要么把规则搬 C#（= 重写 851 条断言那套） | 两份状态一定漂移；建议 JS 当真相、Unity 只做表现 |
| **点击** | Unity 侧 raycast → 回 object id → JS 决定（出牌/选目标） | 拖拽（`GameDragLayer`）要多帧上报，桥的吞吐要够 |
| **出片结果** | 券 / 回合结果 / 影片回放：这些都是 **HTTP + 本地缓存**，继续留在 JS；Unity 只收"播这一段"的指令 | 视频播放要回到 WebView/原生播放器，别在 Unity 里再实现一套 |
| **券 / 鉴权 / 推送 / 战绩** | 全部不动（JS + 服务端） | 一旦有人想在 Unity 里做支付/登录，就是**第二套凭证链**——这是最该拒绝的一步 |
| **UI** | ★ **真问题**：大厅、局内 HUD、结算、战绩、回放、设置、画布浮层**今天全是 WebView 浮层** | UaaL 官方限制写明 **"只支持全屏渲染"**（Unity Industry 除外）→ 要么 Unity 全屏 + WebView 浮层（**官方不背书**），要么把这些 UI 搬进 Unity（**+15~25 人日，且丢掉 lingui / Tailwind / 现有设计系统**） |

**官方限制清单（全部已核实）**：只支持全屏渲染；**不能加载/集成多个 Unity 运行时实例**；`Application.Unload` 后仍常驻 **80~180 MB**（取决于分辨率）；
不能作为 **Play Feature Delivery** 的动态模块；与 Xamarin 不兼容；原生/托管插件可能要改。
另：**UnityGaussianSplatting 自己说**"只在 D3D12 / Metal / Vulkan 上已知可用"，**OpenGL/GLES 不工作（issue #26）**，**部分 Android 机型不工作（issue #112）**，
作者 2026-11 起**不再做显著开发**——把它当第三方依赖，风险要按"没人维护"计。

**工时拆解（估）**：UaaL 接入 4~6 · 场景重建 15~22 · 桥 8~12 · 包体/性能 3~5 = **30~45 人日**；**UI 搬进 Unity 再 +15~25**。

### 3.4 C：Godot 4（★ 任务书的前提要纠正）

**任务书写「Godot 4 无官方路径（嵌进现有 Android App）」，这一条不成立。** 已核实：

- Godot 官方文档有一页 **"Embedding Godot in existing Android projects"**，官方把引擎打成 **AAR** 发在 Maven Central（`org.godotengine:godot`），
  宿主 Activity 实现 `GodotHost`，用官方提供的 **`GodotFragment`** 挂进去（= 它是 **View/Fragment 级嵌入**，比 Unity 的全屏限制更灵活）；
  双向通信走 `GodotPlugin` + signal。
- 官方同时写明两条硬限制：**一个进程只支持一个 Godot 实例**；**自动 resize/旋转事件不支持，可能崩**，要自己锁方向或用 `configChanges` 吃掉。
  （我们的 Manifest 已经声明了 `configChanges` 与 `screenOrientation="portrait"`，这一条**恰好不咬人**。）

**那为什么 C 仍然不适合现在做**（按代价从大到小）：

1. **体积**：官方 AAR `4.7.2.stable` = **103,251,267 B（≈98.5 MiB，含全部 ABI）**。即便只留 arm64 会小很多（**未实测**），
   它也要和我们 100 MB 级的包叠在一起，还要改全 ABI 的打包策略。
2. **没有能直接用的 splat 渲染器**：Godot 没有官方 3DGS；要自己写。而 **Godot 官方文档写着 compute shader 只能在 Forward+/Mobile 渲染器用，且"手机上支持普遍很差（驱动 bug）"**
   —— splat 的深度排序正是最吃 compute 的那一步；退到 Compatibility（GLES3）连 compute 都没有。这等于在 B 之外**再多一个自己养渲染器的活**。
3. **场景重写 + UI 重写**：同 B，且 Godot 的 C#/GDScript 与我们的 TS 世界没有复用面；社区资料与排错人天比 Unity 更贵。
4. **收益与 A 完全重叠**：C 唯一比 A 多的东西是"编辑器 + 场景组织 + 动画工具链"，而我们今天的问题是**填充率与包体**，不是缺编辑器。

**工时拆解（估）**：AAR 接入 4~6 · 场景重写 18~25 · splat 渲染 12~20 · 桥/UI 6~10 · 收口 4~6 = **44~67 人日**，包体 **+50~100 MB**。

### 3.5 D：不换引擎，把 WebView 里这条路走到头

**具体手段（按性价比排序）**

| 手段 | 做什么 | 收益 | 天花板 / 代价 |
|---|---|---|---|
| **1. 真机基线** | 用已进包的「高斯场景（实验）」+ 角标（fps / splat 数 / draw call / 首进耗时）在中端机量 3 档：静止 / 绕桌 / 开窗光+阴影 | **这一步是所有决策的前置** | 1~2 人日 |
| **2. 切份 + LOD** | 按 plan §6.3 把房间切 3~4 份（桌面近景 / 书墙 / 椅子 / 地毯），首屏只上 1 份，按相机距离加载 | 首进时间与常驻显存都降；**不影响画质** | 4~6 人日；切分要重新对齐坐标（§7 第 6 步那套要重做一次） |
| **3. 减到 1~1.2M（保覆盖的剪枝）** | 在 SuperSplat / Blender 里删浮尘、按可见性剪枝，**不是**今天那种"截尾 = 房间缺一块" | 直接降填充率与显存 | 3~4 人日；单套 8~12 MB 的预算要靠它 |
| **4. 分辨率与 per-frame 预算** | 动态分辨率（`dpr` 上限压到 1.5 或按帧率降）、splat 只在静止/低速旋转时全量 | 手机上最立竿见影的一招 | 画面会糊一点，要真机看 |
| **5. 烘焙兜底** | 低端机：多角度烘焙序列帧 / 光照贴图 / 静态全景；老机型直接回程序化书房（**今天已经有这条回退**） | 保住"所有机型都能玩" | 3~5 人日；本质是承认"低端机没有真 splat" |
| **6. Spark paged** | `SplatPager` 按块取，两套光照 = 两个 pager（**不能共用**） | 体积/首屏更好 | 与"多套烘焙"绑在一起才划算（§9.3a） |

**天花板（写清楚，免得以为是万灵药）**：D 能到的是 **1~1.2M 高斯、中端机 30fps（待验）**；它**不会**让 2M 全量在低端机跑起来，
也**不会**解决"两套光照 = 双倍资产"。这些是产品取舍，不是工程优化。

---

## 4. 决策树（按真机实测 fps 分档）

前置：**先量**（用已进包实验开关，中端机、60 秒、`renderer.info` 与角标同记；按 `gs-step0-plan.md` §5 第 3 条那个口径）。

```
真机实测（1.2M 档、中端机、60 秒、1080p 附近）
│
├─ ≥30fps 稳定 ────────────────► 不动引擎。把预算花在美术/玩法；D 只做切份与减面维持余量。
│                                 （若 CPU 每帧 >12ms 但帧率够：先查 GC/状态更新，不必上 A）
│
├─ 20~30fps ──────────────────► 先榨干 D（2 周内）：动态分辨率 → 切份/LOD → 减到 0.8~1.0M → 复测。
│                                 ├─ 复测 ≥30 ──────────► 收工，记录机型白名单
│                                 └─ 复测仍 <30 ────────► 走下面「<20」的判别
│
└─ <20fps ────────────────────► 先做「10 分钟判别法」分清谁卡：
                                  · 把渲染分辨率降到 0.5×（今天 Canvas 写死 `dpr=[1,2]`，临时把下限改成 0.5，一行）：帧率明显涨（≥40%）→ **填充率瓶颈**
                                  · 帧率几乎不变 → **CPU 瓶颈**
                                  │
                                  ├─ CPU 瓶颈 ──► **A（窄版）**：原生只画场景、UI 全留 WebView。
                                  │               先做 2~3 人日验证（原生画一帧 vs WebView 画同一帧），
                                  │               确认能拿到 ≥1.5× 才继续投。B/C 不做（它们改善同一个 CPU，
                                  │               但要 +25~100 MB 与整套 UI）。
                                  │
                                  └─ 填充率瓶颈 ► 换引擎无效（§3.1）。二选一：
                                                  ① **丢 splat**：低端机走烘焙序列帧/静态全景（D 的第 5 项）
                                                  ② 接受**机型分档**：低端机不上高斯房间，高端机全量
                                                  ③ 只有产品愿意把"一张桌子"扩成"多房间/动态多人"时，
                                                     才重新评估 B（那时 UI 反正要重做，B 的罪变小）
```

**两个正交判据**（不在这三档里，但会改写结论）：

- **3D 范围**：仍是「一张 16×7 的桌子 + 4 个角色位 + 固定机位」→ A/D 足够；
  要变成「多房间、多人实时同屏、每个 NPC 有动画状态机」→ 那时才轮到 B（Unity 的动画/场景工具链确实值钱）。
- **包体预算**：侧载镜像与国内下载已经因为 100 MB 出过事故（`release.mjs:208-211`）。**任何 +25 MB 以上的路线都要先回答"更新怎么下"**。

---

## 5. 最坏情况分析

### 5.1 A 失败：损失 7~10 周与一层原生代码，不会伤到产品

- **损失**：34~51 人日；已写的 splat pass / 场景移植作废；多一套要维护的 Kotlin/C++（如果没删干净就是长期债）。
- **不会失去的**：玩法、UI、i18n、服务端契约——**A 的最大优点是它的失败面被设计成"可删"**：
  原生只画、JS 只决策，删插件 + 关开关就回到今天（这也是为什么 §3.2 明确写"不搬 UI、不搬玩法"）。
- **最阴的失败方式**：透明 WebView 合成在某些 OEM 上掉帧/发绿/切换闪黑（**未实测**）。所以 A 的**第 1 周就要在 3 台真机上验合成**，
  不要等到第 5 周才发现"画面叠不上去"。
- **工期**：这 7~10 周里，建议在**第 2 周（壳 + 合成）**和**第 5 周（splat pass 出帧）**设两道硬门槛，过不了就止损。

### 5.2 B 失败：双栈债 + 一次"UI 迁移"的不可逆投入

- **损失**：30~45 人日（UI 全搬则 45~70）；**永久多一套 C#/Unity 工程**；Unity 版本升级、Gradle 双模块、两套 UI/两套 i18n 的长期成本；
  包体 +25~45 MB（国内下载本来就疼）；`Application.Unload` 后 **80~180 MB** 常驻（中端机会被系统杀后台）。
- **最坏的一步不是性能，是 UI**：一旦为了绕开"只支持全屏"把大厅/HUD/结算搬进 Unity，**回滚就不再是"删一个模块"**，而是"UI 再搬一次"。
  ★ 所以 B 的正确姿势是：**先只换 3D，UI 留在 WebView 上叠着**——但这条**官方不支持**（全屏限制），要自己承担 OEM 风险。
  这一条本身就足以让 B 现在不立项。
- **审核/分发**：Play 渠道走 AAB（现 68.57 MB），加 Unity 后体积上升；侧载镜像的"下载失败"会被放大；`release.mjs` 的权限表/包体核对也要跟着改。

### 5.3 C 失败：损失最大、回收最少

44~67 人日 + 50~100 MB 包体；splat 渲染器要自己养（Godot 官方说手机 compute 支持差）；社区资料最少 → 排错最贵。**回滚容易（删 AAR），但沉没成本最高。**

### 5.4 现有代码怎么保住（一张表说清"哪些能原样留 / 哪些必须重写"）

| 资产 | A | B | C | D |
|---|---|---|---|---|
| `src/studio/game/rules.ts` + 10 个 `check-game-*`（851 条断言起） | **原样** | 原样（但会与 C# 侧重复表达） | 原样 | **原样** |
| zustand stores / `api/` / `data/` / 服务端契约 | **原样** | 原样 | 原样 | **原样** |
| 页面与组件（`src/pages` 1.7 MB、`src/components`） | **原样** | 局内 UI 部分**重写** | 局内 UI 部分**重写** | **原样** |
| lingui 文案（zh 1.66 MB / en 1.78 MB） | **原样** | 搬进 Unity 的部分要重做 | 同 B | **原样** |
| `src/studio/scene/`（410 KB / 8,036 行） | **重写**（原生） | **重写**（C#） | **重写**（GDScript/C#） | **保留 + 迭代** |
| `gsStep0` 落位常量（`CENTER/YAW/SCALE/SHIFT`）与验收口径 | 数值可复用 | 数值可复用 | 数值可复用 | **原样复用** |

★ **一句话**：三条换引擎路线里，只有 A 做到"重写 4%、其余 96% 一行不动"。这是 A 唯一的、但足够重要的优势。

### 5.5 如果最终决定"不换"，会不会留下技术债？

会，但是**可控的债**：路径是「1~1.2M 高斯 + 切份/LOD + 低端机烘焙兜底」。它的债是"高端机也只能 1.2M 高斯"，
而不是"两套技术栈永远并存"。**前者是美术预算问题，后者是组织问题。**

---

## 6. 来源与依据

### 6.1 仓内实测（本机 2026-11-25 量的）

| 事实 | 读数 / 出处 |
|---|---|
| 场景代码规模 | `src/studio/scene/` 22 文件 409,637 B / 8,036 行（含 `TableScene.tsx` 89,381 B / 1,838 行） |
| 玩法逻辑规模 | `src/studio/game/` 84 文件 1,038,332 B；`src/studio/game/ui` 47 文件 457 KB |
| 全仓 ts/tsx | 505 文件 9.93 MB / 172,298 行 |
| 包体 | 侧载 release **100.43 MB**，内含 `workshop-step0.spz` **30,512 KB**；侧载 debug **73.57 MB**（无该资产） |
| 栈版本 | `package.json`：capacitor 8.5.1 / three ^0.180.0 / r3f ^9.3.0 / spark **2.4.0**；`android/variables.gradle` minSdk 24、target 36 |
| 许可 | `node_modules/@sparkjsdev/spark` = **MIT**、`three` = **MIT**；`filament-android:1.81.0.aar` 见 §6.2 |
| 包体红线 | `scripts/release.mjs:208-211`（83 MB 国内下不动，2026-08-30 事故） |
| 渲染配置 | `src/studio/StudioPage.tsx:425` Canvas `dpr=[1,2]`、无 `shadows`；`canvasCovered` 停帧机制同文件 |
| GS 第 0 步读数 | `gs-step0-splat-log.md` §5（浏览器基线 / 143.9fps / 4.25M tris / 70 draw calls / 首进 2.9s）、§6.3（`maxSplats` 不截断、0.8M 截尾缺半间房）、§6.4（两档都被 vsync 卡住） |
| 光照与混合方案 | `gaussian-splatting-workshop.md` §9（splat 不吃灯、玻璃采不到 splat、推荐 a+c，首版 9.5~14 人日） |

### 6.2 外部官方文档（已核实）

| 来源 | 用来支撑 | 核实状态 |
|---|---|---|
| [Unity Manual — Using Unity as a Library](https://docs.unity3d.com/2022.3/Documentation/Manual/UnityasaLibrary.html) | 2019.3 起官方支持；**只支持全屏渲染**；不能多实例；Unload 后常驻 **80–180 MB**；不能做 Play Feature Delivery 动态模块 | 已逐条读过（2022.3 页面，2026-11-25 取） |
| [Unity Manual — Integrating Unity into Android applications](https://docs.unity3d.com/2022.3/Documentation/Manual/UnityasaLibrary-Android.html) | `unityLibrary` 模块 + `launcher` 可替换；Intent / `UnityPlayer` API；`IUnityPlayerLifecycleEvents`；限制清单 | 同上 |
| [Godot Docs — Embedding Godot in Android projects](https://docs.godotengine.org/en/stable/tutorials/platform/android/embedding_in_android_projects.html) | **官方嵌入路径存在**：Maven 依赖 + `GodotFragment`/`GodotHost`；**单进程单实例**；自动 resize/旋转可能崩 → 锁方向或 `configChanges` | 已读官方 rst（`godot-docs` master） |
| [Godot Docs — Godot Android library](https://docs.godotengine.org/en/stable/tutorials/platform/android/android_library.html) | 官方 AAR 发在 Maven Central；可嵌入现有工程 | 已读 |
| [Maven Central — `org.godotengine:godot`](https://repo1.maven.org/maven2/org/godotengine/godot/) | 最新 **4.7.2.stable**；AAR **103,251,267 B** | 目录页实测（含全部 ABI；未拆包核 ABI 构成） |
| [Godot Docs — Using compute shaders](https://docs.godotengine.org/en/stable/tutorials/shaders/compute_shaders.html) | compute 只在 Forward+/Mobile（RenderingDevice）渲染器可用；**"手机上支持普遍很差（驱动 bug）"** | 已读官方 rst |
| [Filament README](https://github.com/google/filament/blob/main/README.md) | 后端：GLES 3.0+ / Vulkan 1.0 / Metal / WebGPU；Android 依赖坐标；**功能表与目录里没有任何 splat/点云渲染** | 已读（1.81.0 口径） |
| [Filament RELEASE_NOTES](https://github.com/google/filament/blob/main/RELEASE_NOTES.md) | 到 **v1.81.1** 为止**没有**高斯泼溅相关条目 → "Filament 不内置 splat，得自己写 pass" | 已通读 |
| [Maven Central — `filament-android`](https://repo1.maven.org/maven2/com/google/android/filament/filament-android/) | 最新 **1.81.0**；`filament-android-1.81.0.aar` = **5,221,423 B（≈5.0 MiB）** | 目录页实测 |
| [aras-p/UnityGaussianSplatting](https://github.com/aras-p/UnityGaussianSplatting) | MIT；**只在 D3D12/Metal/Vulkan 已知可用**；OpenGL/GLES 不工作（#26）、**部分 Android 机型不工作（#112）**；**作者 2026-11 起不再做显著开发**；内存 28 B/高斯（无 SH）、36/48/60（SH1/2/3），排序混合模式另需 44 B/高斯 GPU 显存 | 已读 readme.md（main 分支） |
| Unity 定价 | **Personal 免费**：近 12 个月收入/融资 < **20 万美元**；超出必须付费版 | 已核实门槛（[Unity 支持文档](https://support.unity.com/hc/en-us/articles/28114350573460-Which-Unity-Editor-license-should-I-use-purchase)）；**具体 Pro 报价未核实**，以合同为准 |

### 6.3 社区 / 第三方（当量级参考，不当验收数）

| 来源 | 用途 | 状态 |
|---|---|---|
| [splatkit](https://github.com/Xget7/splatkit)（MIT，Android/Vulkan + iOS/Metal + React Native SDK） | A 的 splat pass 可参考的骨架 | 仓库页确认 MIT 与定位；**未跑过**，24 星、2026-09 建 |
| [MCGS](https://github.com/MouseChannel/MCGS)（Vulkan compute 的 splat 渲染，支持 Android） | A 的另一种参考 | **无许可证 → 不能直接抄**；37 星 |
| [Splatviewer_VR_Android](https://github.com/Enndee/Splatviewer_VR_Android)（MIT，Unity/C#，Quest 等安卓头显） | B 的 splat 播放先例 | 仓库页确认；**未跑过** |
| [Unity 构建体积对照实验（16 个 APK）](https://discussions.unity.com/t/what-actually-grows-a-unity-android-build-i-measured-16-apks-reproducible/1730482)、[velog 同题实测](https://velog.io/@hanostudio/unity-build-analyzer-01-build-size-experiment) | 「空工程 ARM64-only APK ≈14 MiB 起、libil2cpp 单项 30~55 MB」的量级 | 社区实测，**未在本仓复现**；只用作"Unity 不可能 +5 MB"的量级证据 |
| [Optimizing Gaussian Splatting Rendering for Mobile and Standalone VR（ACM）](https://dl.acm.org/doi/10.1145/3721251.3734056) | 「手机端 splat 是排序 + 实例化绘制的填充率/带宽问题」 | 论文摘要/正文口径（radix sort + per-splat quad）；具体数字**未引** |

### 6.4 明确「未核实 / 未实测」的清单（别当结论用）

1. **真机上 2M / 1.2M / 0.8M 三档的 fps、显存、发热** —— 一条都没有。
2. 透明 WebView + 原生 Surface/Texture 合成的帧率、功耗、OEM 兼容性。
3. Unity 与 Godot 在本仓这套 Gradle/CI/发版链里接入后的**实际**包体与首进时间。
4. Godot AAR 只留 arm64 后的体积；Unity 最小工程在本仓的实测 APK 增量。
5. Spark 在真机 WebView 上的每高斯内存开销（Unity 实现是 36~60 B/高斯 + 44 B GPU，Spark **未核实**）。
6. Atlas 资产在高斯剪枝后的画质下限（减到 1.2M 会不会"墙起泡"）——要真机看。

---

## 7. 要主人拍板的三件事

1. **先量还是先立项**：我的建议是**先量**（1~2 人日，用已进包的实验开关，中端机三档各 60 秒）。
   ★ 没有这个读数，A/B/C/D 的选择只是在赌概率；有了它，§4 的决策树就是一条指令。
2. **包体红线**：现状 100 MB 级、国内镜像、全量更新，`release.mjs` 记着 83 MB 就"基本下不动"。
   如果要走 A（+5~10 MB）可以接受；**B（+25~45 MB）/ C（+50~100 MB）在定下"更新怎么下"之前不要开工**。
3. **3D 的范围**：是「这一张桌子做到极致」，还是「明年要有多个房间 / 多人同屏动画」？
   **前者选 D、预留 A；后者才值得把 B 重新拉回桌上**（那时 UI 反正要重做，B 的罪变小）。
