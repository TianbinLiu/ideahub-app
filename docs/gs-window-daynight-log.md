# 窗景两套装扮（昼 = 明亮海天 · 夜 = 月）+ ml-sharp 单图转 3D

> 2026-11-27，分支 `feat/gs-window-daynight`，基线 `main f4659052`。
> 主人拍板：**方案 2（夜间月·薄涂）+ 方案 3（明亮海天·厚涂）都要**，按**设备时间**自动切，
> 并配套"墙面亮晕 / 窗光"变化；**并且要用视频里那个单图→3D 场景工具**把窗景做成真 3D。
> 截图与一次性脚本都在 `.tmp-gs-win/`（**不进仓库**）；spz 在 `public/models/study/gs/`（gitignore 排除）。

## 0. 一句话结论

| 要求 | 结果 |
|---|---|
| ml-sharp 把两张窗景做成 3D 场景 | ✅ **跑通了**（本地一键包，CPU 出图，2 张共 3 min 31 s），产出 2 份 3DGS → 2 个 `.spz` |
| 窗洞里的窗景用 splat | ✅ 落地，`splat` 优先、贴图回退（§6 起两份 12 万点 spz **进包**，只在大厅/匹配页那一档挂） |
| 按设备时间切 day / night | ✅ `windowSkin.ts` 一处判定，07:00–18:59 昼、其余夜；`?winskin=` / localStorage 可覆盖 |
| 交叉淡入 0.6~1.0 s | ✅ **800 ms**（`WINSKIN_FADE_MS`） |
| day 墙面亮晕 + 窗光调白调强 | ✅ 加色环（`#ffcf94` @ 0.5）+ 窗内点光 `#fff3e0` @ 5.6 |
| 窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉一律不动 | ✅ 几何一个数没改（只是从 `MoonWindow.tsx` 挪进了"只留窗框"的那一份） |
| 视差（不是纯平面） | ✅ 有，但**小**：±6° 时窗景内部各层移动 9~17 px 之差（1024² 画布） |
| `npm run build` 绿 | ✅ |
| 体积 | 贴图 2 张共 **198 KB**（webp 1024²），spz 2 份共 **5.4 MB**（**不进包**） |

## 1. ml-sharp：怎么跑起来的、耗时、坑

包：HF `GemosDodo/MLSharp-3D-Maker-by-GemosDodo`（5.6 GB zip）→ 解到 `D:\mlsharp\`（不进仓库）。
里面是真的全套：`python_env/`（嵌入式 Python 3.11 + torch 2.8.0）、`model_assets/sharp_2572gikvuh.pt`（2.8 GB，
Apple SHARP 权重）、`app.py`（FastAPI + viewer.html 的网页壳）。

**没走网页壳**，直接调它自己的 CLI（网页壳背后就是这条命令）：

```
python_env\python.exe run_predict.py predict -i <输入目录> -o <输出目录> -c model_assets\sharp_2572gikvuh.pt --device cpu -v
```

| 阶段 | 耗时 |
|---|---|
| 下载 5.6 GB（HF 直连，16 MB/s） | ≈ 6 min |
| 解压 46179 个文件 | 268 s |
| 载入 2.8 GB checkpoint（CPU） | 47 s |
| 月（`window-moon.png` 1536²）推理 + 保存 | 87 s（其中前向 75 s） |
| 海天（`window-sea.png` 1536²） | 71 s（前向 59 s） |
| **合计（两次出图）** | **3 min 31 s** |

### 踩到的坑（都不是"没 CUDA"这么一句能盖过去的）

1. **包里自带的 torch 是 CPU 版**：`torch 2.8.0+cpu`、`cuda.is_available()=False`。但 `~orch/lib/` 里躺着
   928 MB 的 `torch_cuda.dll` + cudnn 9（pip 升级中断留下的残骸）。**试过把 `~orch` 合回 `torch/`**：
   能加载 DLL，但 `torch._C` 那个 pyd 是**更老的版本**（没有 2.8 才有的 `AcceleratorError`），
   一 import 就 `AttributeError`。⇒ 放弃 CUDA，**退回 CPU 跑通**（一张 1536² 只要 60~75 s，够用）。
   机器是 RTX 4060 Laptop / 驱动 CUDA 13.4 —— 卡没问题，是包里的 torch 不是 CUDA 版。
2. **批量处理会把每张图算两遍**：`io.get_supported_image_extensions()` 同时返回 `.png` 与 `.PNG`，
   在大小写不敏感的 Windows 上 `glob('**/*.PNG')` 匹配到同一批文件 ⇒ "Processing 4 valid image files"
   （只喂了 2 张）。驱动脚本里把扩展名收成 `['.png']` 解决。
3. **在后台任务里 `> log 2>&1` 会卡死**：pwsh 后台作业里把 python 的 stdio 重定向到文件，
   进程会停在 import 阶段不动（CPU 时间几乎不涨）。改成 `cmd /c run.bat`（bat 内部自己重定向）就正常。
4. **ml-sharp 的深度是"相对"的，两张图的量级差 100 倍**：月那张 z ∈ [1.25, 5.84] m，
   海天那张 z ∈ [0.63, **70.12**] m（地平线被估成"很远"）。见 §3 —— 这一步必须自己重定标。

### 输入怎么来的

`out-2.png` / `out-3.png` 是 **1536² 工作图**（不是 3072²），窗洞圆心 (768,768)、r=339。
所以窗洞内容只有 **678²**：裁外接方图 `(429,429,1107,1107)` → Lanczos 放大到 **1536²**（ml-sharp 内部固定
1536²，方图才不压扁）。**信息上限就是 678²** —— 再放大不会多出细节，这一点如实记（原图若在 3072²
上重出，窗景会明显更锐）。

## 2. `.ply` → `.spz` 这条链

```
sharp predict → window-moon.ply / window-sea.ply  （各 63 MB，1,179,648 个高斯）
   ↓ .tmp-gs-win/clean_ply.py        （剥掉非 vertex 元素 + 圆裁 + 抽稀 + 深度盒）
   ↓ design/ply2spz.mjs              （Spark 自己的 transcodeSpz，v2 / 0 阶 SH / fracBits 12）
window-moon.spz / window-sea.spz     （各 2.7 MB，260,000 点）
```

### `.ply` 里果然有多出来的 element（任务书说的那条，实测坐实）

```
元素：vertex=1179648 其它=[('extrinsic',16), ('intrinsic',9), ('image_size',2),
                        ('frame',2), ('disparity',2), ('color_space',1), ('version',3)]
文件体 66,060,416 B 与"只有 vertex"推断的 66,060,288 B 不符（差 128 B）
```

照"严格读取器按 vertex 字节数核对"的说法，这多出来的 128 B 就会让它整份读不进来。
`clean_ply.py` 只写**只含 vertex 元素**的 ply 头，输出一定干净。

### SPZ 写端也有坑

- `transcodeSpz()` 回来的**已经是 gzip 过的**。第一版照着"输出必须 gzip 一层"又压了一次 ⇒
  `gzip(gzip(NGSP))`：文件大小"看着对"（2.9 MB），加载器只解一层、看到的不是 `NGSP` 魔数 ⇒ 加载不出来。
  现在 `design/ply2spz.mjs` 先探 `1f 8b` 魔数，**写盘前再解一遍确认是 NGSP** 才落盘。
- 必须给 `maxSh: 0`（0 阶 SH，f_dc 只有 3 个）与 `fractionalBits: 12`，并 `version: 2`
  （与仓库里现有的 `workshop-step0-1.6.spz` 同一种，加载器只走一条路径）。

### 圆裁 + 深度盒（这一步是"有想法"的地方，别跳过）

- **圆裁**：喂进去的是外接方图，四个角是窗框/墙。不裁的话贴进窗洞之后那四角会伸到 0.64 m 半径处
  （窗框外径只有 0.58 m）—— 墙上多出四块碎屑。判据用 ml-sharp 自己的相机模型：
  `(x/z)² + (y/z)² ≤ tan²`，其中 `tan = 768 / f_px`，**f_px = 1506.17**（`sharp/utils/io.py` 的
  `convert_focallength` 走**对角线**：30 mm@35mm ÷ 43.2666 × 1536√2；不是 30/36×1536 = 1280，
  按半宽算会把圆裁小 18%）。留下的比例：月 77.3%、海天 74.8%。
- **角压缩 k = 0.5516**：ml-sharp 按 f_px=1506.17 假定半视场 **27.02°**，而这 678² 裁图在 App 里
  只覆盖 **15.71°**（0.45 m 半径 / 1.6 m）。不压，splat 会按 27° 张开、描边糊到窗框外的墙上。
- **深度盒 [1.34, 1.56] m（跨 0.22 m）**：按 ln z 均匀重排、**方向 (x/z, y/z) 保持不变** ⇒ 从摆它用的
  那台机位看，投影与平贴图逐像素一致，视差只由这 0.22 m 给。高斯大小乘 `k·Z/z`（不乘会糊成一团）。

## 3. App 落地

### 3.1 `windowSkin.ts`（新模块，判定只有这一处）

- 边界常量 `WINSKIN_HOURS = { dayStart: 7, dayEnd: 19 }`（07:00–18:59 昼，其余夜）。
- 覆盖优先级：`?winskin=day|night` > `localStorage["ideahub.winskin"]` > **设备本地时间**；
  只认 `day` / `night` 两个值，写错就当没写。
- `useWindowSkin()` 60 s 复查一次（跨过 07:00 / 19:00 最多晚 1 min 换装），并监听 `storage` 事件。
- `useSkinFade()` 0→1 推进 **800 ms**，`skinWeight()` 过一道 smoothstep；**首次挂载不淡入**
  （验收截图不会拍到半成品）。
- 窗光 / 亮晕 / 方向光的数值也在这个文件里：`WINSKIN_LIGHT` / `WINSKIN_GLOW` / `WINSKIN_SUN`。

### 3.2 换装落在哪

| 层 | night | day |
|---|---|---|
| 窗洞画面 | `window-moon.spz`（或 `window-moon.webp`） | `window-sea.spz`（或 `window-sea.webp`） |
| 夜空球 / 月亮盘（程序化，穿窗之后才看得见） | 深蓝紫 + 象牙月 | 片元里整体 mix 到明亮的海天蓝（`uSkin`） |
| 墙上一圈 | **暗环**（压住点云里烘死的磨砂亮边） | **暖白亮晕**（加色、窗前 0.42 m 内渐隐） |
| 窗内点光（只照 mesh） | `#dfe9ff` × 2.4、距离 7 | `#fff3e0` × 5.6、距离 8 |
| 窗外方向光（只照 mesh） | `GS_DAY.sun` 原值 | `#fff2dc` × 1.75 |

`WindowLook.tsx` = 画；`MoonWindow.tsx` = **只留窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉**（一个数没改）。

### 3.3 交叉淡入怎么做到"不瞬切"

平贴图是**两张圆面叠着画**：夜（renderOrder 18）当不透明底、昼（19）按权重淡入 ⇒ 屏幕上就是
`(1−t)·夜 + t·昼`。splat 那一层用 `SplatMesh.opacity` 跟同一个权重。灯、亮晕、暗环、夜空 `uSkin`
全部由同一个 `weight` 推。**两张平面必须定先后**（18 / 19）——同 renderOrder 的话插入顺序固化，
反向淡入会变成"昼永远在上"。

### 3.4 三个真坑（按踩到的顺序）

1. **GLSL 模板串里不能出现反引号**。注释里写 `` `uPaint=0` `` 直接把模板串截断 ⇒
   `WindowLook.tsx: Missing semicolon`，屏幕上是整页红。本仓 GLSL 注释里一律不加反引号。
2. **夜空球 renderOrder 从 19 降到 12**。19 与"白天那张贴图"同号、又排在"夜里那张"（18）之后 ⇒
   夜空（片元只裁掉窗洞**外**的方向）把 18 那层整块盖掉，夜里窗洞里只剩一片黑 + 几颗星。
3. **材质必须"带着 map 出生"**。先挂一块 `map=null` 的白圆面、等贴图到了再改 `map`，
   three **不会**为"运行时换 map"重新编译 program ⇒ 屏幕上一整片 `#e2e2e2`（ACES 把纯白压到 226/255）。
   改成 `texNight &&` 才挂，材质出生就带图。

### 3.5 splat 为什么一开始"在画却一个像素都看不见"

Spark 把场景里**所有** `SplatMesh` 收进**同一个 accumulate pass**，那个 pass 的 renderOrder 是 0（房间那份），
而夜空球是 mesh（透明队列 12）—— mesh 排在 pass 之后 ⇒ **夜空把窗景 splat 整块盖掉**。
`SplatMesh.renderOrder` 改 11 / 17 都没用（排序在 pass 内部，不看 renderOrder）。

证据链：`tris` 从 3.72M 掉到 524k（= 260k 高斯 × 2），说明 splat 确实在画；
`forEachSplat` 读回的点位在 `(±0.44, z 1.34~1.56)`、颜色 `#424d66…`（月面的深蓝夜空）都对；
把同一份 splat 挪到相机前 1 m 就整屏可见。

修法：`uPaintSplat` —— splat 在场时，相机在室内就**不画夜空**（窗洞被 splat 铺满，不需要纸底），
穿出窗面之后照画（满天都是天）。顺带把点云里烘死的毛玻璃用 `SplatEdit` 的**球状 SDF** 裁掉
（球在墙面上切出来正好是圆 = 窗洞本体；盒子会多切掉四个角的墙）。

## 4. 验收读数

### 4.1 四张截图（1024² 画布，`design/gs-window-shot.html`）

| 图 | 档 | 机位 | 窗洞（`__probe()`） |
|---|---|---|---|
| `acc2-night-front.png` | night | 窗正前 1.6 m、平视窗心 | 圆心 (512,512) r=226 |
| `acc2-night-6deg.png` | night | 绕窗心偏 6°（x +0.167 m） | (519,512) r=225 |
| `acc2-day-front.png` | day | 同上正对 | (512,512) r=226 |
| `acc2-day-6deg.png` | day | 同上偏 6° | (519,512) r=225 |

观感：夜是冷银蓝的薄涂月（笔触、云、星点都在，窗格压在画面上）；昼是奶油云 + 青绿海 + 金色小鱼，
窗外一圈暖白把冷蓝墙照出一圈光，不再是"贴了一张亮纸"。窗框 / 十字棂 / 圆钉 / 铆钉四张里完全一致。

### 4.2 视差（块匹配，见 `.tmp-gs-win/parallax.py`）

把两张图各自按**自己的窗洞圆**归一化到 512²（圆占满整幅），再在归一化图上找同一块纹理的位移 ——
归一化之后还剩的位移只能来自窗景自己的深度。

| 档 | 位移中位 | 最大 | 折算到 1024² 画布 |
|---|---|---|---|
| 夜（月） | 15 局部 px | 17（最小 10） | 13.3 px |
| 昼（海天） | 10 局部 px | 21（最小 9） | 8.9 px |

★ 老实说：**各层之间有 6~12 px 的差（这就是视差），绝对值里有一份是"整体平移"**
（归一化用整数像素裁切 + 缩放，本身会带几像素偏差）。所以能说的是"**明显不是一张贴在窗面上的
平面图**"，不能说"视差很大"。上限就在这儿：ml-sharp 单图深度的可压缩余量是 0.22 m 盒子，
再深就会从窗框外溢出去（窗框外侧只有 13 cm 余量）。

### 4.3 fps / 体积

HUD 读数（`gsHud`，切图那一刻）：

| 档 | fps | calls | tris |
|---|---|---|---|
| night（splat） | 112~143 | 17~18 | 3.72M（房间 1.6M + 窗景 260k） |
| day（splat） | 33.8~69 | 18 | 3.72M |

★ 这几个数是**在浏览器里、同一台机器还跑着别的重活时**读的，且 `design` 页是 1024² × dpr1 的抓图页，
**不能当手机帧率引用**。手机上的读数要等真机（`3C15CJ00C8V00000`）那一轮。

体积：

| 资产 | 大小 | 进包？ |
|---|---|---|
| `window-moon.webp` | 109 KB | ✅ |
| `window-sea.webp` | 89 KB | ✅ |
| `window-moon.spz` | 2.72 MB →（§6 压到 1.28 MB / 12 万点） | §6 起 ✅（只在大厅那一档挂） |
| `window-sea.spz` | 2.65 MB →（§6 压到 1.25 MB / 12 万点） | §6 起 ✅ |

贴图两张共 **198 KB**（每张远低于 1.5 MB 的上限）。**这一版（`feat/gs-window-daynight`）里 spz 不进 APK** ——
线上窗景是平贴图，splat 只在本地有 spz 时自动接管（`initialized` 404 → `onState("failed")` → 回退贴图，不抛错）。
★ 下一轮 `feat/gs-scene-split` 已经把两份压到 12 万点并放进包里，**只在大厅/匹配页那一档挂**，见 §6。

## 5. 剩余风险 / 下一步

1. **窗景 splat 只在本机可见**（这一版 spz 不进仓库）。★ 下一轮（§6）已压到 120k 点 / ~1.25 MB/张
   **进包**，并且**只在大厅/匹配页那一档挂**；房间那一档按主人拍板改用平贴图。
2. **夜间的平贴图与 splat 有一点点色差**：splat 的 COLMAP/SH 色彩绕了一圈 sRGB→SH→sRGB，
   比原图略"发灰"，夜那张尤其明显（截图里月亮边缘比贴图版软）。
3. **视差上限 0.22 m**。要更大的视差只有两条路：喂更高分辨率的原图（现在只有 678²）让
   深度估得更准，或者接受"窗内 splat + 窗外远景用程序化夜空混合"的混合方案（这一版没做）。
4. **真机没上**（这一版）：`4.3` 的 fps 是浏览器读数。★ 真机读数（大厅进入耗时 / 房间加载 /
   两档 fps / PSS）记在 §6.5。
5. **crossfade 只在浏览器里验过**：真机上 800 ms 的 uniform 推进是否跟手（尤其 splat 的 `opacity`
   每帧写一位）要真机确认。

## 6. 两套场景拆分（2026-11-27，`feat/gs-scene-split`）

> 主人拍板：**匹配页 / 大厅（未开局）只挂窗景**（窗景 splat + 窗框 mesh + 窗内点光，不加载房间那份
> 1.6M spz / 24.8 MB）；**匹配成功进房间**才加载房间、窗洞改回平贴图；交接时那一套要**真的释放**。
> 窗景压到 12 万点并**进 APK**；真机（`3C15CJ00C8V00000`）量大厅与房间两档读数。

### 6.1 两套场景各挂什么

| | 大厅 / 匹配页（`lobby`） | 房间（`room`：开局 / 正常工坊） |
|---|---|---|
| 房间 1.6M spz | **不加载**（一个字节都不请求） | 加载（默认 1.6M 档） |
| 窗景 12 万点 spz | ✅ `WindowSplat`（两套装扮按设备时间切） | ❌ 只用平贴图 `window-moon/sea.webp` |
| 窗框 / 窗棂 / 铆钉 | ✅ `MoonWindow`（几何一个数没动） | ✅ 同一份 |
| 窗内点光 / 夜空 / 月盘 | ✅（`WindowLook`） | ✅（`WindowLook`，`uPaintSplat=0`） |
| 灯组 / 壁炉真火 / 桌子 / NPC | ❌ 不在这棵子树里（匹配页机位在相机背后） | ✅ `DayLights` / `HearthFire` |
| SparkRenderer | 两套**共用一台**（`GsSparkStage`，切场景不重建） | 同左 |

判据只有一处：`sceneSplit.effectiveSceneKind(lobbyOpen, inGame)`（页面层算完当 prop 传给
`TableScene → GsStep0Environment`；3D 层不 import store）。
冷启动 `/studio?lobby=1`（CreatePage 的落点）由 `main.tsx` 在 render 前打 boot 标记 —— **第一帧就按大厅挂**，
避免 openLobby 那个 effect 跑之前房间的 lazy chunk 已经把 24.8 MB 发出去。
`ui/MatchCurtain` 改成**等房间就绪**才撤黑幕（`roomPhase` ready / failed）；关大厅回工坊时先 `coverDesign()`
把黑幕拉起来，房间成了再淡出 —— 中间不会露出"桌子浮在没有墙的背景上"。

### 6.2 窗景 splat 压到 12 万点：均匀抽样 + **尺寸/不透明度补偿**

只做均匀抽样（260k → 120k，留 46.2%）时**不能看**：窗洞变成一半黑一半白的麻点 —— 窗景是单图重建的
稀疏点云，每个高斯只盖自己那一小片；房间那份 2M→1.6M（留 80%）看不出来，留 46% 就碎。

`design/decimate-spz.mjs` 这一轮加了三样（默认行为不变，房间三档逐字节不变）：

- 输入**自动认 gzip**（窗景 spz 本来就是一层的）；
- `--out-name=` 单档时指定文件名（沿用 `window-moon.spz` / `window-sea.spz`）；
- `--compensate`：按保留率 r 自动补 ① 尺寸（`scale 字节 + round(-8·ln r)`，SPZ v2 的 scale 是
  `exp(byte/16-10)` ⇒ 线性放大 `1/√r`）② 不透明度（`a' = 1-(1-a)^(1/r)`，少了一半叠加层不会变暗）。

| 文件 | 点数 | 原始文件 | 抽稀后（gzip） | 补偿 |
|---|---|---|---|---|
| `window-moon.spz` | 120,000（46.2%） | 2,724,309 B | **1,281,733 B** | scale +6（×1.45）/ alpha 合并 2.17 层 |
| `window-sea.spz` | 120,000（46.2%） | 2,648,593 B | **1,246,518 B** | 同上 |

核对：解压后 `NGSP` v2 / shDegree 0 / fractionalBits 12 / flags 1 / `numPoints=120000`、
文件长度 = 16 + N×19（脚本自检逐字段比对 + 头复核都过）。两份合计 **2,528,251 B ≈ 2.41 MiB**
（加上两张 webp 198 KB，窗景资产合计 ≈ 2.60 MiB）。

**观感对比**（`design/gs-window-shot.html` 1024²、窗洞直径 452 px，逐像素只算窗洞圆内）：

| 版本 | mean\|Δ\| | >16 级像素 | 结论 |
|---|---|---|---|
| 120k 只均匀抽样 | 22.96/255 | 45.5% | ❌ 麻点，不能用 |
| 120k + scale +6（alpha 不变） | 6.70/255 | 9.4% | 接近；缩到 App 窗洞 210 px 时几乎看不出 |
| 120k + scale +10 | 7.65/255 | 11.5% | 更糊、反而更远 |
| **120k + `--compensate`（采用）** | **6.67/255** | **9.3%** | 452 px 下细看有少量颗粒，210 px（真机窗洞大小）与原图分不出 |

### 6.3 切场景时释放了什么（浏览器实测）

自建计数（`sceneSplit`，`window.__gsSplit.snapshot()`）在**同一页面**里来回切两次：

| 时刻 | 场景 | 场景里 SplatMesh | SparkRenderer | room 建/放 | window 建/放 | `info.memory` 几何/纹理 | programs |
|---|---|---|---|---|---|---|---|
| 房间（基线） | room | 1（房间） | 1 | 2/1 | 0/0 | 78 / 52 | 24 |
| 进大厅 | lobby | 1（窗景） | 1（**没重建**） | 2/**2** | 2/1 | 77 / 49 | 41 |
| 回房间 | room | 1（房间） | 1 | 4/3 | 2/**2** | 78 / 55 | 47 |
| 再进大厅 | lobby | 1（窗景） | 1 | 4/4 | 4/3 | 77 / 49 | 48 |
| 再回房间 | room | 1（房间） | 1 | 6/5 | 4/**4** | 78 / **55** | **47** |

结论：**任何时刻场景里只有 1 个 SplatMesh**（房间与窗景从不同时在场）；切走后那一份
`SplatMesh.dispose()` 计数与建数严格对齐（房间卸掉时 disposed=created，窗景卸掉时同理）；
**SparkRenderer 全程 1 台**（从 2→1 后不再重建）。`info.memory` 在热起来之后**两轮不涨**
（房间 77/55/47 → 78/55/47，大厅 77/49/41 → 77/49/48）：首轮 +3 纹理是房间那几样材质/贴图
第一次上传（不是每轮泄漏）。顺带修掉一处真泄漏：`WindowLook` 的两张 webp 原来 `useEffect(..., [])`
的 cleanup 抓的是首帧 `[null,null]`，每挂一次多两份纹理、永不释放（本表大厅 50→49 就是修完之后）。
Spark 内部另有少量 program/texture 池子，第二次之后稳定（见 §6.7）。

### 6.4 APK 体积

| 资产 | 之前 | 现在 | 进 APK |
|---|---|---|---|
| `window-moon.spz` | 2.72 MB（不进） | 1.28 MB | ✅ |
| `window-sea.spz` | 2.65 MB（不进） | 1.25 MB | ✅ |
| 两张 webp | 198 KB | 198 KB | ✅（本来就在） |
| 房间 1.6M spz（24.8 MB） | 不进仓库；本地出包时在 `public/` 里 | 同左 | ✅（原有的） |

窗景那一部分新增 ≈ **2.53 MB**（十进制）/ **2.41 MiB**；`git` 里新增的就是这两个 spz
（`.gitignore` 从"整个目录排除"改成 `public/models/study/gs/*` + 两条 `!` 例外，房间那几份仍排除）。
实测 APK 增量见 §6.5（`dist`/APK 差值与 `du` 一栏）。

### 6.5 真机读数（`3C15CJ00C8V00000`）

__DEVICE_NUMBERS__

### 6.6 四张截图观感

__SHOTS__

### 6.7 剩余风险

1. **窗景 splat 的颗粒**：抽到 46% 后按 452 px 看仍有少量颗粒（210 px 窗洞下看不出）。要更干净只有
   两条路：更好的 LOD 合并（成对高斯合并位置/四元数，而不是保留一个），或者接受 150k~160k 点
   （单张 ~1.6 MB）。这一版按主人给的 12 万点 / ~1.3 MB 交。
2. **每次大厅↔房间都要重新读一次 spz**（房间 24.8 MB 在 HTTP 缓存里；浏览器 0.4~0.9 s，真机见 §6.5）。
   黑幕把加载盖住了，但"回工坊"会比拆之前多一次短暂的暗场。要消掉只有两条路：把房间常驻内存
   （那就违背这一轮的初衷），或者把 1.6M 再压小。
3. **Spark 内部池**：program/texture 在第一次进房间之后不再增长（§6.3 表），但不是归零 ——
   那部分归 Spark 管，我们只保证两份 SplatMesh 的 `packedSplats` / 纹理随卸载释放。
4. **窗景 spz 进包后**，404 回退平贴图那条路仍然保留（老包 / 被裁过的包 / 磁盘坏）。
