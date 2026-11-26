# GS 第 2 步：11 视角伪多视角 → Atlas 估位姿重建 · 落位 + 真机（模拟器）渲染验收

> 2026-11-26 · 上一版（单图 → Atlas 补 12 视角 → 单视角重建）见 [`gs-step1-splat-log.md`](gs-step1-splat-log.md)；
> 上游流水线（Atlas Developer API 怎么跑、credits、坑）见 [`atlas-api-splat.md`](atlas-api-splat.md)。
>
> 代码落点：`src/studio/scene/gsStep0.ts`（开关 / 落位常量 / 画质档 / 验收探针）·
> `GsStep0Room.tsx`（Spark 渲染器，读 `gsAssetUrl()`）· `gsHud.ts`（角标多了画质档与探针角）。
> **资产本体不进仓库**（`.gitignore` 的 `public/models/study/gs/`）。

## 1. 资产（本次换的是"同一间房的另一版重建"）

| 项 | 值 |
|---|---|
| 输入 | `~/Downloads/workshop-views12/norm/view-*.jpg` **11 张 1280×720**（12 张里剔掉 18mm 的 view-11；曝光/白平衡已归一，max \|dev\| 0.03%） |
| 位姿 | `images2PosedRGBD` 估出 **11 个真位姿**（不再是上一版那 11 个占位值）；`poseRefinementAccepted: false`，相机两两最大距离 2.717 |
| 高斯 | `posedImages2Splats` **refined 2,000,000**（5,000 credits / 18.5 min）+ **draft 524,288**（500 credits / 41 s） |
| SPZ | 两个都是 `NGSP` **v2** / shDegree 0 / fractionalBits 12 / flags 0x40；裸文件 refined **38,000,016 B**、draft **9,961,488 B**（16 + N×19，与 v2 布局逐字节对上） |
| 放进仓库（被 gitignore） | `public/models/study/gs/workshop-step0.spz`（refined，**gzip 层 31,180,000 B**）+ `workshop-step0-draft.spz`（draft，**gzip 层 8,190,470 B**） |
| 与上一版的关系 | 同一间「魔女阁楼」概念，上一版是**一张图补 12 视角**（实质单视角），这一版是 **11 张 AI 伪多视角**；两版的 splat 世界坐标系都是"以第一帧相机为原点"各自估的，**不能沿用上一版的 yaw/scale/tilt** |

### 1.1 ★ 踩坑：Spark 要的是 **gzip 包着的那一层**，裸 `NGSP` 会被判 `Unsupported NGSP version: 2`

第一次把脚本解压出来的裸 SPZ（38,000,016 B）放进 `public/`，App 里加载直接失败：

```
[gs] splat 加载失败 → 回退今天的程序化书房 Unsupported NGSP version: 2
```

而**上一版仓库里那份 31.3 MiB 的 `workshop-step0.spz` 本来就是 gzip**（`1f 8b` 开头，解开才是
38,000,016 B 的 `NGSP` v2）—— 所以它一直能加载。也就是说 **`.spz` 落盘前要 gzip 回去**：

```bash
python -c "import gzip;gzip.open('public/models/study/gs/workshop-step0.spz','wb',mtime=0).write(open('.tmp-gs-step2/scene.spz','rb').read())"
```

（`atlas-api-splat.md` §6 那句"解压后才落盘成 `.spz`"对**分析脚本**成立，对**入包**不成立；
两个文件都不能提交，`.gitignore` 已排除。）

## 2. 落位推导（这次是"点云几何量测"，不是参考图对位）

上一版只能拿参考图的像素锚点打射线（因为 11 个位姿是同一个占位值）；这一版**位姿是真的**，
11 张图在估计出的世界坐标系里点云是连续的一间房，所以直接量几何。量法：解 SPZ v2 →
最小面积外接矩形定房间轴向 → 两面侧墙 / 远墙拟合平面（SVD）→ 圆窗 = 最亮簇 →
桌面 = "相对地板 0.74~0.80"那一层。一次性脚本在 `.tmp-gs-step2/`（`decode.py` / `planes.py` /
`basis.py` / `table.py`，不进仓库）。

### 2.1 房间基与锚点（全部 splat 单位）

| 项 | 读数 | 说明 |
|---|---|---|
| 房间尺寸 | 纵深 **d 7.96** × 宽 **s 4.31** × 高 3.84 | 由 11 个位姿重建出来的房间 |
| 地板 | `y = -0.02313·d + 0.03890·s + 0.19252`（残差 std 0.035） | 倾斜 **1.4°**：Atlas 把世界 canonicalize 到第一帧相机，而第一帧 pitch -1.24° |
| 墙 | 两墙法线的 y 分量 0.011 / 0.014 ⇒ 侧墙对世界竖轴只差 **0.7°** | 所以仍只写 yaw + tilt 两位，不引 roll |
| 远墙 | 书柜前脸 u≈6.45（比墙凸 0.4）；窗在 **u 6.83** | |
| 圆窗 | 中心 **(s -1.303, d 6.83, y 1.515)**、直径 **0.90** | 最亮 0.1% 点的簇；v∈[-1.88,-0.88]、y∈[1.13,1.91] |
| 长桌 | 桌面顶面中心 **(s -1.27, d 3.20, y 0.835)**、**2.50（沿 d）× 1.17（沿 s）** | 桌面比该处地板（y=0.070）高 **0.765** |
| 中线 | 屋子（s 中心 -1.28）/ 桌子（-1.27）/ 窗（-1.30）三点共线 | ⇒ 朝向只剩一个 yaw |
| 壁炉 | 左墙 s≈-3.33，台面那层 y≈1.5~2.0 | 炉膛位置被家具挡住，**fire 锚点 (s -3.18, d 4.80, y 0.50) 是估的**（火默认关，见 `GS_FIRE`） |

### 2.2 四个数（`gsStep0.ts` 里改这一处）

```ts
const ANCHOR = { tableS: -1.27, tableD: 3.20, tableTopY: 0.835,      // 桌面顶面中心
                 win: { s: -1.303, d: 6.83, y: 1.515, dia: 0.90 },
                 fire: { s: -3.18, d: 4.80, y: 0.50 } };
const toSplat = (s,d,y) => [0.9387*s + 0.3446*d, y, 0.3446*s - 0.9387*d];  // 房间基 → splat 帧
const CENTER  = toSplat(ANCHOR.tableS, ANCHOR.tableD, ANCHOR.tableTopY);
const YAW_DEG = 20.15;    // R_y·F = -z
const TILT_DEG = -6;      // 远端下压 6°
const SCALE = 3.2;        // 桌面 8.00 × 3.74 世界单位
const TARGET = [0, -1.1, 0];
```

- **yaw = +20.15°**：房间"朝窗"方向 F = +e1 = (0.3446, 0, -0.9387)（`R_y(69.84°)` 的转置矩阵
  第一行；由墙法线定）。`R_y(20.15°)·F = (0,0,-1)` ⇒ 圆窗 **-z（正对面）**、壁炉墙 **-x（左）**、
  书柜墙 **+x（右）**。★ 与上一版的 -36.87° 差得远，纯粹因为两版重建**各自的 splat 世界坐标系不同**。
- **SCALE = 3.2**（沿用上一版，两版观感差就只剩重建质量差）：桌面 2.50 × 3.2 = **8.00** 世界单位，
  桌面中心落到 TARGET 之后整张桌子在 **z ∈ [-3.98, +3.98]**、**y ∈ [-1.52, -0.68]** —— 22×9 的盖板
  （z∈[-4.52,+4.52]）把它整张盖住（**两侧各 0.54 的余量**）。上限：桌面 2.50·SCALE ≤ 9 ⇒ **≤ 3.60**。
- **TILT = -6°**（上一版 -14°，小得多）：这一版窗心只比桌面高 **0.77** splat 单位 = 2.46 世界单位，
  而相机在桌面上方 5.0，窗心几乎在视平线上 —— 不压就会顶出画面顶。把点云按候选落位投进
  `LAND_CAM`（fov 50、1280×720）量窗口亮点的像素包围盒：

  | tilt | 窗在屏幕上的 y | 说明 |
  |---|---|---|
  | -3° | 19 ~ 147 | 窗顶贴着画面顶 |
  | **-6°** | **46 ~ 171** | **取这个：上留 46 px、下留 26 px（可见带是 y 0~197）** |
  | -8° | 64 ~ 187 | 窗底快贴上盖板远边 |

- **TARGET = [0,-1.1,0]**：y=-1.1 时桌面最高点 -0.68，整张桌子（含 tilt 抬起的近端）躲在盖板下；
  z=0 让桌子落在盖板正中。★ 这一版**没有**上一版"沉屋子保壁炉"的两难：壁炉台在世界 y≈1.5，
  怎么压都在盖板之上。

### 2.3 窗与火的世界落点（算出来的，别手抄）

| 点 | 世界坐标 |
|---|---|
| 圆窗心 | **(-0.10, -0.15, -11.78)**（相机前 19.2；上一版 +0.17 / -14.72） |
| 桌面顶面中心 | (0, -1.10, 0)（= TARGET） |
| 炉膛（占位光） | (-6.11, -2.70, -4.98) —— 比盖板顶面低 2.7，**火看不见**（与上一版同一条已知风险） |

`GS_DAY.window`（窗面泛光）现在也是**按 ANCHOR 现算**的（`toWorld(toSplat(win))`），
直径 0.90×3.2 = 2.88（上一版 6.08 —— 只有 1/4 面积，所以 intensity 3 → 4）。

## 3. 验收方法（模拟器 + 一个验收探针）

- 设备：**`-s emulator-5554`**（真机没动）。debug 包 = `npm run apk` → `app-sideload-debug.apk`
  （117.6 MB，含两份 spz），装成 `com.ideahub.branchvideo.debug`。
- 打开实验档：设置里的「高斯场景（实验）」= localStorage `gsStep0Experiment=1`（release/debug 包里
  `?gs=1` 不生效，见 `devOn()` 的注释）。
- **±6° 平移视角**（App 的相机是固定机位，正常用户看不到这个角度；这是**压力测试**）：
  `gsStep0.ts` 里加了一个验收探针 —— localStorage **`gsStep0YawProbe`**（度，夹 ±30°），
  它把 splat **绕相机所在竖轴**转 θ。旋转是纯的 ⇒ 与"相机原地转头 θ"逐像素等价；
  盖板 / NPC / 卡牌是网格、**不参与**旋转（所以那两张里房间相对桌子偏了一点，是设计如此）。
  角标上会写 `probe -6deg`，截图自带证据。
- 截图：`adb shell screencap`（CDP 的 `Page.captureScreenshot` 拿不到 WebGL 那一层，会是黑屏）。
- 读数：HUD 角标（fps / splat / tris / calls / load）+ `[gs]` console。

## 4. 读数（模拟器，864×360 CSS / dpr 2.625，App 锁横屏）

| 项 | refined（2.00M） | draft（524k） |
|---|---|---|
| fps | **60.0 ~ 60.1**（三张同） | **60.2** |
| 高斯 | 2,000,000（cap all） | 524,288（cap all） |
| tris / calls | 4.25M / 70 | **1.30M** / 70 |
| 首进 load（进工坊→splat 出现） | **1.90 s**（进程冷启动后第一次进工坊）/ 1.59~1.79 s（同一进程内再进）/ 2.26 s（装好后第一次） | 1.39 s |
| HUD 首次出现 | 切到工坊后 3.4 s | 5.4 s（含整页 reload） |

- **两者都被 vsync 卡在 60**，所以模拟器上量不出"refined 比 draft 慢"—— 和桌面浏览器（143.9 fps，也被
  144 的 vsync 卡住）一个结论：**瓶颈不在填充率**。模拟器是宿主机 GPU（ANGLE），**不能代表真机**；
  真机读数仍空缺（上一版也没量到），要手机时按设置页"全部 / 0.8M"那两档 + 角标量。
- 观感差异（同机位对比）：refined 的书脊、窗框、壁炉雕花都是**连贯的线**；draft 变成**块状/斑驳**
  （书脊糊成一片、壁炉时钟的边缘发毛、墙面出现大块的明暗团）。结论：**draft 只配当成本对照，不配当画质档**。
- 首进 1.90 s 里 spz 31 MB 从 APK 资源读（不是网络）；`GS_STEP0_BUDGET.timeoutMs` 从 8 s 抬到 **12 s**
  （2M/38 MB + Spark chunk 的冷启动，8 s 在模拟器上贴太近）。

## 5. ★ 结论：伪多视角到底有没有造成重影？

**在 App 的实际机位和 ±6° 里：没有明显重影/拉伸/飞点。** 依据（三张截图 +
`docs` 同目录的 `.tmp-gs-step2/` 一次性产物）：

1. **三张（正面 / 左 6° / 右 6°）里，墙、书脊、窗框、壁炉边都是单边**，没有"两条边"或半透明的第二层。
   窗在正面机位**正对中线**（屏幕 x≈0.49），上下留 46 / 26 px，整颗都在可见带里。
2. 量出来的"面厚度"解释了为什么是**糊**而不是**双**：地板的平面残差 std **0.035 splat**（≈0.11 世界单位，
   19 m 外约 4~5 px）、侧墙 0.028、远墙 0.032 —— 也就是 11 张图对不齐的深度被 Atlas 拟合成了一层
   **~10 cm 厚的面**，在画面上表现为柔化，而不是两条分开的几何。
3. 桌子**完整**：盖板 22×9 无洞、5 个卡位与卡组都在；splat 自己那张长桌**整张在盖板底下**
   （z ∈ [-3.98,+3.98]、两侧各 0.54 余量、最高点 -0.68），在画面上看不到"第二张桌子"。
4. 重影**从 ±10~15° 才开始出现**（额外在浏览器预览页量了 ±15°/±25°，`.tmp-gs-step2/probe-wide.png`）：
   ±15° 时圆窗的外圈**错开成两圈**（错位约 8~10 px）、书柜顶板边缘发毛；±25° 时窗圈明显双影、
   画框左右两端的墙出现拉伸条纹。**App 的相机是死的，正常使用停在 0°**，所以这一条算"压力测试的上限"，
   不是产品缺陷。

**清晰度 vs 上一版（单图重建）**：**结构/透视上明显更好，像素级锐度没有提升、反而更软。**
- 好：这一版是一间**有透视的房间**（书柜成排后退、壁炉台与器物的前后关系对、墙板与梁的接缝连续），
  上一版是"一张画贴在一条视线上"（所以才有窗/桌/墙互相挤、左右两角糊成一片）。
- 差：上一版在**原始视锥内**的纹理是源图像的纹理，锐；这一版是 11 张互相对不齐的图平均出来的，
  书脊的铭牌、壁炉时钟的镂空都糊。**要锐度只能拿真位姿/引擎渲染的真多视角，伪多视角到头了。**

## 6. 已知风险 / 下一步

1. **只有一条观察方向**：11 张都是同一个墙角 ±8° 的 yaw，背后/两侧没有数据 ⇒ 侧墙靠近相机处
   （画框最左/最右那两个角）是一层薄壳，转 15° 以上就露馅。画面里那两处发暗、发糊是**缺覆盖**，
   不是重影。要补只能重拍/重生成环绕视角（`atlasGenerate` + `returnDepth`）。
2. **真机帧率仍没量**（模拟器 60 fps 是宿主机 GPU）。2M 高斯 / 4.25M tris 在手机上要按设置页那两档量。
3. **APK 体积**：两份 spz 一共 37.6 MiB（gzip 后）进包，而这一档默认关（`GS_STEP0=false`）。
   正式发版前要么只留 refined、要么改成按需下载（与 `protected/` 那些模型同一条思路）。
4. **炉膛仍在盖板之下**：`GS_FIRE` + `GS_FIRE_LIGHT.position` 只是占位接口（位置这次是**估的**，
   被家具挡住量不到），真火要等桌面切除（方案 B）。
5. **地板那 1.4° 倾斜没纠**：要纠就得多一位 roll；窗/桌/墙按 yaw+tilt 定位后肉眼无差，先记着。
6. 验收探针（`gsStep0YawProbe`）是**给验收用的**，默认 0；真机不用重出包也能写 localStorage 再刷新复验。

## 7. 复现

```bash
# 0) 资产（不进仓库）：gzip 回去再放，否则 Spark 判 Unsupported NGSP version: 2（§1.1）
python -c "import gzip;gzip.open('public/models/study/gs/workshop-step0.spz','wb',mtime=0).write(open('.tmp-gs-step2/scene.spz','rb').read())"
python -c "import gzip;gzip.open('public/models/study/gs/workshop-step0-draft.spz','wb',mtime=0).write(open('.tmp-gs-step2/scene-draft.spz','rb').read())"

# 1) 浏览器预览（快，先对落位）
npm run dev
#   http://localhost:5173/design/gs-preview.html?gs=1[&quality=draft]
#   预览页的相机抄 layout.LAND_CAM、fov 50；dev 还能用 &gsScale/&gsYaw/&gsTilt/&gsX 临时拧

# 2) 模拟器（App 里的真实渲染）
npm run apk
adb -s emulator-5554 install -r android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk
adb -s emulator-5554 shell am start -n com.ideahub.branchvideo.debug/com.ideahub.branchvideo.MainActivity
#   验收开关：设置里「高斯场景（实验）」，或 WebView 调试口写 localStorage：
#     gsStep0Experiment=1 / gsStep0Quality=refined|draft / gsStep0YawProbe=-6|0|6
#   WebView 调试口：adb forward tcp:9334 localabstract:webview_devtools_remote_<pid>
#   截图用 adb shell screencap（CDP 的 Page.captureScreenshot 拿不到 WebGL 那一层）
```
