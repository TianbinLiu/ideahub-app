# GS 第 0 步：Atlas splat 的资产台账 + 落位推导 + 验收读数

> 2026-11-25 · 施工单 [`docs/gs-step0-plan.md`](gs-step0-plan.md)（方案 A：桌面盖板）· 总纲 [`docs/gaussian-splatting-workshop.md`](gaussian-splatting-workshop.md)
>
> 这一份回答四件事：**这份 splat 是哪来的、花了多少钱、怎么落进游戏坐标、第 0 步量到了什么**。
> 代码落点：`src/studio/scene/gsStep0.ts`（开关与落位常量）· `GsStep0Environment.tsx`（盖板 + 白天灯组 + 三态切换）·
> `GsStep0Room.tsx`（Spark 渲染器，懒加载）· `TableScene.tsx`（一处 `<GsStep0Environment />` + 一处盖板/桌面切换）。
> **资产本体不进仓库**（`.gitignore` 的 `public/models/study/gs/`）：29.8 MiB，且版权按生成那一刻的账号状态算（plan §5.4）。

## 1. 资产来源（台账，plan §5 第 7 条）

| 项 | 值 |
|---|---|
| 平台 / 工具 | Atlas Studio · Viewfinder 会话（`wsess_031f872f36bf4d93ac10fcbfd6ea9b7d`，会话名 `view-01.png`） |
| 账号 | Tianbin Liu，账上 10,000 Studio credits（1,000 credits = $1，plan §2.0 的付费判据）；**产物可商用**，进包前再核一次账号状态 |
| 输入 | 12 张 `view-01…12.png` 1280×720（同仓外 `gs-step0/views-1280/`，也复制在 `.tmp-gs-views/`） |
| 位姿 + 深度 | `images2PosedRGBD` 已跑完（"Camera and depth estimation completed"，Spatial Context 12 of 64） |
| 生成任务 | `posedImages2Splats`，**`refine: true`** |
| build id | `b63445b2-15cb-4d31-8ce5-4fb259e2b44c`（`Splats 1`） |
| operation id | `b2b551f21a6d43878f8f08e12eb3069e` |
| 开始 / 完成 | 2026-11-25 00:47:48 → 01:04:18（America/Los_Angeles），**16.5 分钟** |
| 扣费 | 生成前 9,956（位姿/深度那几步共 44）→ 完成后 **4,956**，这一发**实扣 5,000 credits（$5）** |
| 产物 | `splats/01-splats-1.spz`，**31,244,367 B = 29.8 MiB**，**2,000,000 个高斯** |

> ⚠ 与施工单的出入：plan §2.4 写的是 draft 500 credits，但 2026-11-25 的 Viewfinder Splats 面板**只有 refined 一档**
> （`Create splats` 5,000 credits / ~15 分钟，没有 refine 开关可关），Export 面板也只能整包下 ZIP、没有 SPZ/PLY 选项。
> 主人已按这一档授权。

## 2. 产物与落盘

| 项 | 值 |
|---|---|
| 下载 | Atlas `Export` → `Download ZIP`（13 项 = 12 帧 png + depth exr + confidence + **`splats/01-splats-1.spz`** + cameras/scene/export.json） |
| 暂存（不进仓库） | `C:\Users\tliu7\ideahub\app\.tmp-gs-step0\`（`workshop-step0.spz`、`atlas-export.zip`、一次性分析脚本） |
| 仓库外副本 | `C:\Users\tliu7\Downloads\gs-step0\splat\workshop-step0.spz` |
| 开这一档要放的位置 | `public/models/study/gs/workshop-step0.spz`（**被 .gitignore 排除**） |
| 帧图的坑 | Atlas 的 ZIP 里帧图叫 `.png`，**实际是 JPEG**（`FF D8 FF E0`）—— 按扩展名读会报"不是 PNG" |

## 3. 落位推导（splat 世界 → 游戏世界）

Atlas 的相机位姿（`document.nodes[*].position/quaternion`，也原样在 ZIP 的 `cameras.json`/`scene.json` 里）是
`rub` 坐标系（右-上-后，看向 -Z）、**Y 朝上**。12 个相机的视线做最小二乘求最近点，得它们共同的注视点（= 生成输入里"看向桌面中心"的点）：

```
C = (2.8177, 0.6917, 4.1024)   splat 单位
各机位到 C 的水平距离 2.14 ~ 3.54（机位表给的是 3.4 m / 近景 2.1 m ⇒ 拟合得 splat 单位/米 ≈ 1.061，残差 0.41 m）
```

① **朝向**：把 C 按"帧 01 在正南（+z）"转（yaw = −127.46°），得出来的是**这间屋子的原朝向** ——
   壁炉 −z、窗 −x、工具板 +x，与施工单 §1.1 的机位表逐帧对得上（02→+30°、03→+88°、05→+178°、07→−74°），
   这也是**没镜像**的证据（别用负 scale 凑朝向：法线/阴影/背面剔除会一起反，plan §4.1-6）。
   ★ 但**这间屋子的桌子长轴是 z**（`01-view-01.png` 是站在短端顺着桌长看进去的，不是施工单假定的"长轴 x"）。
   本仓桌面是 16×7（长轴 x），施工单 §4.1-3 要的正是"桌长轴 = X" ⇒ **再转 90°，最终 yaw = 142.5°**：
   长轴对上 X、**窗墙落到 −z（正前方）**，壁炉与入口分别到 +x / −x。
   ⚠ 代价写在前面：转了这 90° 之后窗墙就不在 −x 了，白天那盏 DirectionalLight 必须跟着挪到 −z，否则"窗光"与窗对不上。
② **尺度**：点云量出来桌面 **2.1 × 1.0 splat 单位**。按"1 米 ≈ 1.06 splat 单位、8 游戏单位/米"就是 **18 × 8.7 世界单位** ——
   横屏盖板（22×9）勉强吃住，**竖屏（16×7）会露出来**。所以最终 **scale = 6.6**：桌面 ≈ **14 × 6.8**，横竖两套盖板都盖得住。
   （量法：把 yaw=142.5 的变换套到 2M 个高斯上，取桌面高度那一层世界坐标的 10~90 分位；点云有 ±5 cm 噪声尾巴。）
③ **平移**：把 C 落到 **(0, −0.3, 0)**：盖板顶面 y=0、厚 0.5；交汇点比"plan 说的 −0.15"再往下 0.15，是因为桌面点云有
   ±5 cm 尾巴，只放 −0.15 会有几点从盖板顶面戳出来。另外桌面中心在 splat 里比 C 偏 **+z 1.28 世界单位**（点云量的），
   用 `SHIFT = [0, 0, −1.28]` 推回盖板正下方。

最终常量在 `src/studio/scene/gsStep0.ts`：`CENTER / YAW_DEG=142.5 / SCALE=6.6 / TARGET=[0,-0.3,0] / SHIFT=[0,0,-1.28]`，
**改落位只改那一处**；dev 下还能用 `?gsYaw=&gsScale=&gsX=&gsY=&gsZ=` 临时拧（生产构建里这些覆盖恒不生效）。

## 4. 怎么开、怎么验

```bash
# 1) 资产放进（不进 git）：public/models/study/gs/workshop-step0.spz
# 2) 独立预览页（不用登录 /studio）：
npm run dev
#    http://localhost:5173/design/gs-preview.html?gs=1
#    相机可走地址栏摆：&cx=0&cy=3.9&cz=7.4&lx=0&ly=0.2&lz=1&fov=50
# 3) 进 App：/studio 页在地址后加 ?gs=1（hash 路由：http://localhost:5173/?gs=1#/studio）
```

- 开关：`src/studio/scene/gsStep0.ts` 的 **`GS_STEP0` 常量（默认 `false`）**；dev 下临时开用 `?gs=1`。
- 回退：8 秒超时 / 加载失败 / WebGL 能力不足（缺浮点纹理扩展）→ `gsPhase = "failed"` →
  房间、灯组、桌面**原样回到今天那套**（`GsStep0Environment` 里 `LegacyRoom` 就是原来那六行，一个数没改）。
- **关着的时候与今天逐字节相同**：`TableScene` 只是把那六行搬进了 `LegacyRoom`，盖板/桌面按 `gsPhase` 二选一。

## 5. 第 0 步验收读数（plan §5）

> 全在**浏览器**里量的（headless Chrome，1384×771，dpr 1）。本仓规矩：帧率/掉帧只能真机算数 —— 下面是**基线**，不是验收结论。

| # | 项 | 读数 / 结论 |
|---|---|---|
| 1 | **接缝** | 三个机位（游戏机位 / 低角贴远边 / 侧向）：盖板外沿是一条直边，没有亮线、黑线、半透明毛边；盖板的厚度侧面也没露"悬浮缝" —— splat 桌面在盖板底面之下 0.1~0.4 单位，被完全吃住。**残留**：桌面上方烘死的物件（黄铜天平、马克杯）会从盖板顶面浮出来，是一块琥珀色糊斑 —— 这是方案 A 的天花板，要干净得等第 1 步的方案 B（把桌面与桌上物件从 splat 里切掉） |
| 2 | **卡牌不穿插** | 预览页用 5 张 1.1×1.65 的假卡贴在 `y=0.02`：全部稳稳压在盖板上，连续观察不闪（z-fight 判据）；点的还是 mesh，不交给 splat |
| 3 | **draw call / 帧率** | `calls=5`（splat 1 + 盖板 1 + 假卡 3 批）、`tris=4,000,018`（2M 高斯 × 2 三角）、`tex=12`、`geometries=6`；桌面 Chrome 上 rAF 采样 **144 fps**（被垂直同步卡住，说明这一档远没到瓶颈）。**真机 30fps × 60 秒没测**（手上没有可用的安卓 WebView 环境），这是第 0 步最大的空缺 |
| 4 | **拿掉 splat 仍可用** | 把 `public/models/study/gs/` 里的 spz 改名（= 加载失败那条真实路径）→ `gsPhase=failed` → 画回今天的程序化书房（截图：暗色书房 + 烛台 + 桶），盖板不挂、Canvas 照常出帧，**不黑屏、不报错、桌面/卡位坐标不变** |
| 5 | **玻璃奶白坑** | 第 0 步没放玻璃（第 1 步做窗时才撞，plan §9.5-2） |
| 6 | **尺度与卡位对齐** | 桌面 ≈ 14×6.8，落在 16×7（竖屏）/22×9（横屏）盖板以内；桌面中心在 (0, z≈0) 附近（点云 10~90 分位中心），四个角色位（`TABLE_ROLE_SLOTS`）都在桌沿以内 |
| 7 | **版权 / 台账** | 见 §1：付费 credits 账号、5,000 credits、taskId/时间/大小齐全；进包前再核一次账号状态 |

**已知风险（第 1 步前要拍板的）**

1. **窗墙在正前方 = NPC 逆光**：这一档的房间朝向把窗放在 −z（玩家这一侧看向窗），NPC 站在桌子对面会被窗光打成剪影。
   第 1 步要么把房间整体转 180°（窗在背后、平光），要么给 NPC 补一盏顺光。
2. **2M 高斯 / 29.8 MiB**：远超 plan §6 给手机定的"单份 ≤ 8~12 MB"。真机要 `maxSplats` 截断或按 plan §6.3 切份 + LOD；
   这一档的 `GS_STEP0_BUDGET.maxSplats = 1_200_000` 还没在真机上验过。
3. **桌面噪声尾巴**：`TARGET.y = −0.3` 是拿噪声尾巴让出来的；换一台机器/重出一版 splat 都要重新量一次（§3 的方法）。
4. **设备能力**：只判了 `EXT_color_buffer_float` / `OES_texture_float_linear` 两个扩展；老机型上的 Spark 退化路径没验过。
