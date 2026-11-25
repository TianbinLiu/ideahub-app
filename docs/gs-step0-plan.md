# 第 0 步施工单：桌面 + 近景小样（GS 落地的第一步）

> 2026-11-24 · 依据 [`docs/gaussian-splatting-workshop.md`](gaussian-splatting-workshop.md) 的 §5（Atlas）、§7（九步流程）、§9（窗 / 玻璃 / 光照的混合方案）与 §10 待决策第 5 条；主人 2026-11-24 拍板：**桌面从 splat 里拿出来做网格**。
>
> 本文件只写"怎么做、怎么算过"：**本轮不接 App 代码、不动服务端、不调 Atlas**。Atlas 那一步要主人登录后按 §2 跑，**draft 500 credits ≈ $0.5**（refined $5 这一步不点）。
>
> 输入素材在仓库外：`C:\Users\tliu7\Downloads\gs-step0\` —— `views/`（12 张 1280×720 webp）、`views-1280/`（同名 png，给 Atlas）、`manifest.json`（每张的机位 / 完整提示词 / 模型）、`contact-sheet.jpg`（12 张拼图）、`gen-views.mjs` + `make-manifest.py`（复现）。

## 0. 读完这五条就够开工

1. **只买一次 draft**（$0.5，约 30 秒）；refined 是 $5 且**修不了几何不一致** —— draft 就是用来验几何与覆盖的（§5.2）。
2. **12 张输入已备好**（§1）：8 个 45° 环绕 + 2 个低机位 + 2 个近景，全部 1280×720、相邻重叠约 40–50%、哑光、无人物、无发光板、无炉火、无玻璃反光。
3. **桌面的可见顶面从第 0 步起就是网格**（§4.2 方案 A）：一张哑光 PBR 盖板压在 splat 桌面之上 2 cm，卡牌继续用 mesh。splat 里的桌面只当背景，**不参与最终成像**。
4. 要验的六件（§5）：接缝、卡牌穿插、真机 30fps × 60 秒、拿掉 splat 仍可用、**玻璃奶白坑**（§9.5-2）、尺度与卡位对齐。
5. **版权**：draft 若在免费账号上出，产物只能个人非商业（§5.4，按生成那一刻的账号状态判定）→ **只作验证、不进包**；上线资产必须在付费账号上重出（§2.0）。

---

## 1. 输入规范（12 张，已产出）

### 1.1 机位表

方位以房间俯视图为准：**壁炉墙 = 北（-z）**、**窗墙 = 西（-x）**、**工具板墙 = 东（+x）**、**入口门 = 南（+z，玩家一侧）**。编号即绕行顺序（南 → 东南 → 东 → 东北 → 北 → 西北 → 西 → 西南），全部看向桌面中心。

| # | 方位 | 眼高 | 距桌心 | 画面要点 | 第二参考图 |
|---|---|---|---|---|---|
| 01 | 南（入口端） | 1.5 m | 3.4 m | 玩家视角：桌沿从下缘向壁炉收，窗墙在左、工具板在右 | —（只参考 04） |
| 02 | 东南角 | 1.5 m | 3.4 m | 壁炉在右前、窗墙在左前、工具墙在身后右侧 | 01 |
| 03 | 东（长边，工具板前） | 1.5 m | 3.4 m | 正对西：窗墙在正前、壁炉在右、入口墙在左 | 02 |
| 04 | 东北角 | 1.5 m | 3.4 m | 窗墙在右前、入口墙在左前、壁炉在身后左侧 | 03 |
| 05 | 北（壁炉前，短边） | 1.5 m | 3.4 m | 正对南：入口门在正前、窗墙在右、工具墙在左 | 04 |
| 06 | 西北角 | 1.5 m | 3.4 m | 工具墙在右前、入口墙在左前、窗墙在身后右、壁炉在身后左 | 05 |
| 07 | 西（长边，窗前） | 1.5 m | 3.4 m | 正对东：工具板在正前、入口门在右、壁炉在左 | 06 |
| 08 | 西南角 | 1.5 m | 3.4 m | 壁炉在左前、工具板在右前、窗墙在身后左 | 07 |
| 09 | 东南角（低机位） | 1.0 m | 3.4 m | 掠桌面平视，桌面边缘与椅子侧影更清楚 | 03 |
| 10 | 西北角（低机位） | 1.0 m | 3.4 m | 同 06 方位、眼高 1.0 m | 07 |
| 11 | 东（近景） | 1.35 m | 2.1 m | 俯 25° 看桌面：五张卡 / 马克杯 / 笔记本 / 黄铜天平都可读 | 03 |
| 12 | 西（近景） | 1.35 m | 2.1 m | 同一批桌面物件，背景是工具墙 | 07 |

- 镜头：26 mm 等效广角（近景 30 mm），**无鱼眼、无畸变**。
- 为什么相邻重叠要 40–50%：Atlas 拿这些帧估相机位姿 + 深度（`images2PosedRGBD`），重叠太少相邻帧对不上，位姿会散；45° 步长 + 26 mm 等效（水平视场约 74°）时帧宽约 4.8 m、相邻机位间距约 2.6 m ⇒ 重叠约 46%。
- 为什么还要两个低机位 + 两个近景：低机位给桌面与椅腿的**侧面高度**（GS 最怕只有俯视，桌面高度会糊）；近景给桌面木纹与摆件的**像素密度**（draft 的高斯数有限，近景帧能把桌面细节撑住）。

### 1.2 分辨率与格式

- 生成端 2560×1440（`gpt_image_2_6_sunburst` 原生档），LANCZOS 降到 **1280×720**。
- 交付两份：`views/view-XX.webp`（q92，210–285 KB，人看）与 `views-1280/view-XX.png`（1.3–1.5 MB，**Atlas 用这份**；它吃 png/jpg，png 少一道有损）。
- 为什么必须是 1280×720：Atlas 的相机网格**只认 1280×720 / 960×720 / 528×704 / 720×1280**，且**所有帧同一网格**（§5.2、`posedImages2Splats` 文档）；1280×720 是其中最大的一档。

### 1.3 为什么把「投影光幕」从输入里去掉（这条最容易被忽略）

- splat 里每个高斯的颜色是"从某个方向看过去是什么颜色"（3 阶球谐），**光在训练时就已经乘进颜色里**；渲染时没有任何一步会拿灯的位置再算一遍（§9.1、§9.2.1）。浮空光幕是一块**假光源**，把它拍进输入 = 让 GS 把一片亮斑**烘死**在桌子中央，换任何视角它都不随灯变，重建出来就是一块悬浮的雾。
- 同理去掉的还有：**炉火**（动态 + 发光，必须单独做粒子）、**玻璃反光 / 镜面高光**（不守恒，跨视角会变成一层漂浮的雾，§9.1）、**人物**（GS 不能 rig）。
- 第 0 步的输入里只保留**哑光、静态、有纹理**的东西：木头、石头、布、纸、陶、绿植。桌面上留了五张卡、马克杯、笔记本、黄铜天平 —— 它们会在 splat 里被烘死，但 §4.2 的盖板会把整块桌面盖住，不影响最终成像（卡牌本来就永远走 mesh，§6.2）。

### 1.4 一致性检查结论

**12/12 通过，重出 0 张。** 检查方法：12 张逐张过目 + 4×3 拼图横向对照（`contact-sheet.jpg`）。

| 检查项 | 结论 |
|---|---|
| 桌子数量 | 每张 1 张长桌（浅色旧木、无桌布） |
| 椅子数量 | 每张 4 把；09 等 3 张里有 1 把被桌面挡住（正常遮挡，不是少画） |
| 壁炉位置 | 每张都在北墙、同一石砌造型与深色木壁炉架；从南/东/西看的位置关系一致 |
| 墙面色调 | 暖奶油 + 浅木 + 灰石，12 张同一套 |
| 四面墙关系 | 窗墙（西）/ 工具墙（东）/ 入口门（南）/ 壁炉墙（北）12 张一致 |
| 禁项 | 无人物、无文字、无发光板、无炉火、无镜面高光 |

已知漂移（**不重出，写进来是为了后面不被它坑**）：

- 桌子的长宽比在端视（03/07）与斜视（01/02）之间略有漂移 —— 生成图通病。第 0 步正好把桌面换成网格盖板，**这段漂移被盖板吃掉**。
- 窗洞在 2–3 个窗格之间浮动（同一面墙）。对 splat 的墙面影响小，第 1 步窗改网格时再按实测窗洞量。

---

## 2. Atlas 操作步骤（★ = 需要主人登录 / 点头的环节）

### 2.0 账号与钱（先定这条，再谈别的）

- **免费账号的产物归 World Labs**，只给"个人、非商业"使用；**付费账号（有订阅或买过 credits）才拥有产出**，且**按生成那一刻的账号状态判定** —— 免费号做出来的东西，事后升级也还是非商业（§5.4）。
- 计价：draft 500 credits（$0.5）/ refined 5,000 credits（$5）/ **失败免费**；1,000 credits = $1（§5.3）。
- 第 0 步的口径：**draft 可以在免费账号上跑**（只验几何、只在本机看）。★ **主人要做**：登录 `atlas.worldlabs.ai`，在 Billing 页确认账号状态；如果要直接出"能进包"的资产，就得先付费（买 credits 或订阅），否则这一步的产物只能当验证。

### 2.1 登录 + 上传 12 张（★ 主人登录）

1. ★ 打开 `https://atlas.worldlabs.ai`，用主人账号登录。
2. 新建场景 / New scene → 上传 **12 张 `views-1280/view-01.png … view-12.png`**。
3. **12 张一次一起提交**，不要分两批 —— 分开做位姿会各自落在**不同的世界坐标**里（Atlas 文档：重叠的相机视图只有在"同一地点一起重建"或"Atlas 生成"时才允许重叠，见 How to use Atlas §1）。
4. 位姿这一步（`images2PosedRGBD`）的 `targetResolution` 必须是 **1280×720**，和输入一致。

### 2.2 检查位姿（这一步不过就别往下走）

- 在场景里看 12 个相机：应该**围着桌子成一圈**、高度分两档、都朝桌心。谁飞到墙外/桌下 ⇒ 删掉那一张重跑位姿。
- 位姿失败的特征：某几张的视角与图对不上（比如 03 被摆到北边）、深度图整片糊。**看到就停**，按 §2.6 回退。
- 每帧都要有深度（`images2PosedRGBD` 会回深度；`posedImages2Splats` 要求每帧 image + camera + depth，缺一帧都不行）。

### 2.3 不要补视角（这一步是省钱的关键）

- §7 的老路线是"单图 → atlasGenerate 补 6~12 个视角 → 重建"。**本步不走那一段**：我们已经有 12 个真实机位，补视角反而会引入"模型编的房间"，和这 12 张打架。
- 补视角的单价官方**没有公开**（§5.3），第 0 步不去试。

### 2.4 draft 重建（★ 主人点这一下）

- 任务：`posedImages2Splats`，**`refine: false`**（draft 档）—— 收 2~32 帧，12 张正好；约 30 秒，500 credits，出 `draftSplat`。
- Studio 里选 **Draft** 档（不要 Refined）；★ 点下去之前主人确认一次"这是 draft、$0.5"。
- 产出格式：SPZ 一个文件。

### 2.5 下载与落盘

- 下载 `.spz`（Studio 的下载按钮 / API 的 `draftSplat.url`）。
- 先放**仓库外**：`C:\Users\tliu7\Downloads\gs-step0\splat\workshop-step0-draft.spz`。
- 进仓库时放 `public/models/study/`（和 `night.hdr` 同目录；**先不进 `protected/`** —— 那份是加密产物，第 0 步还没到发版那一步）。
- 记一笔：**哪个账号（免费/付费）出的、taskId、时间、文件大小**，写进资产台账（§5 第 7 条要查）。

### 2.6 如果位姿失败（画风图的真实风险）

12 张是**二维手绘动画背景**，不是照片：`images2PosedRGBD` 是拿真实世界的 SfM + 单目深度训练的，遇到平涂大色块可能估不出位姿。**回退顺序**：

1. 先删掉明显对不上的两张再试（重叠冗余够，删 1~2 张不影响覆盖）。
2. 还不行 → 走 §7 老路线：**只用 01 一张**做 `images2PosedRGBD`（单图必定能出相机 + 深度），再 `atlasGenerate` 要 8 个绕桌视角（`returnDepth: true`），然后重建。这条路的代价是"补视角的钱不透明"（§5.3），但几何是 Atlas 自己保证一致的。
3. 再不行 → 这 12 张改用 Blender + COLMAP 手动摆相机（Atlas 允许"独立 pose 的图放在同一个场景"，但要求相机视图**不重叠**）—— 第 0 步先不做到这一步，真到了再评估。

### 2.7 CLI / API 路线（可选；要主人自己的 Developer API key）

Studio 之外的等价路线，命令按 Atlas 官方 CLI 文档（2026-11-24 读）：

```bash
# ★ 主人在自己的终端里做，不要把 key 贴进聊天
npm install -g @worldlabsai/cli
worldlabs setup            # 打开 API keys 页，key 走隐藏输入
worldlabs auth status      # 通了才往下

worldlabs assets upload views-1280/view-01.png --json   # 12 张各上传一次
worldlabs tasks run images2PosedRGBD --request pose.json --wait --json > pose.json
worldlabs operations download <operation-id> --out scene --json

worldlabs tasks run posedImages2Splats --request splats.json --wait --json > splats.json
#   splats.json: { "posedFrames": [ … 每帧 imageAsset + camera + depth … ], "refine": false }
```

CLI 的 billing 走**项目 API key**（不是 Studio 账号），用它之前同样要先付费（§2.0）。第 0 步**默认走 Studio**：少一道 key 管理，主人只需要登录。

---

## 3. 在 Three.js / Spark 里加载

### 3.1 版本（2026-11-24 现查）

| 包 | 版本 | 说明 |
|---|---|---|
| `three` | `0.180.0`（本仓 `package.json` 已锁 `^0.180.0`） | §9.6 读的就是这个版本的源码 |
| `@react-three/fiber` | `9.3.0`（本仓已锁） | r3f v9 |
| `@sparkjsdev/spark` | **`2.4.0`**（npm latest，2026-11-24） | §9 读的是这一版的 `dist/types`；**第 0 步先精确锁 2.4.0**，别用 `^` |
| `@react-three/drei` | 可选 | 第 0 步不装（§9.6 说清仓里没有；要装只为一个 OrbitControls 不值） |

### 3.2 最小片段（r3f；Spark 不发 React 组件，官方就是用 `extend()`）

```tsx
// npm i three@0.180.0 @react-three/fiber@9.3.0 @sparkjsdev/spark@2.4.0
import { Canvas, extend, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// Spark 没有 React 封装：官方示例就是 extend 之后当 <Spark> / <Splats> 用
const Spark = extend(SparkRenderer);
const Splats = extend(SplatMesh);

function RoomSplat({ url }: { url: string }) {
  const gl = useThree((s) => s.gl);
  return (
    <>
      <Spark args={[{ renderer: gl }]} />
      <Splats args={[{ url }]} />
    </>
  );
}
```

- **一个 Canvas 里只放一个 `SparkRenderer`**：它按帧把所有 `SplatMesh` 整理进自己那个 mesh 里画（§9.5-1）。
- 想先限高斯数：`<Splats args={[{ url, maxSplats: 300_000 }]} />`（`SplatMeshOptions.maxSplats`，2.4.0 有）。
- 想调色/调透明：`SplatMesh.opacity`、`SplatMesh.recolor`（2.4.0 的类型里有；`recolor` 在实现里是 `THREE.Color`）。
- ⚠ **TypeScript**：`extend()` 出来的 `<Spark>` / `<Splats>` 在 r3f v9 里要补 JSX 类型声明（`declare module "@react-three/fiber"` 里加 `Spark` / `Splats`），否则 `tsc` 会报未知标签。第 0 步先放在独立预览页里，类型声明一起写在那个文件里，**不进 `src/`**。

### 3.3 三个必须知道的坑

1. **splat 默认是透明物**：`transparent: true`、`depthWrite: false`（§9.5-1）。它挡不住之后画的透明物（玻璃、投影光、UI 面片），谁先谁后只由 `renderOrder` 决定 ⇒ 第 0 步就把 `renderOrder` 写死：**网格桌面 / 卡牌 0，splat 10，玻璃 / 光效 20**。
2. **splat 不吃灯**：`SparkRenderer` 的 material 是 `ShaderMaterial`、three 只给要灯的材质上传灯光 uniform（§9.2.1）⇒ `DirectionalLight` / `RectAreaLight` 只照桌面与卡牌，**照不到 splat**。所以桌面的亮度要**对着 splat 校**（§4.3 末）。
3. **玻璃采不到 splat**：three 的透射只把**不透明**那一批渲进折射用的 target（§9.5-2）⇒ 玻璃在 splat 前面会是一片奶白。这正是第 0 步要**先撞一次**的坑（§5 第 5 条）。

### 3.4 先做一个独立预览页（不进 App）

- 起一个**独立入口**（Vite 多入口或一个单独的 `preview/` 小工程）：只放 `RoomSplat` + 一张桌面 + 一盏灯 + 一个固定相机，相机就抄 `LAND_CAM` 的 `(0, 3.9, 7.4)` 与 `fov: 50`。
- **不要在工坊里直接试**：`TableScene` 的相机是游戏机位（`CameraRig` 每帧按 aspect 选机位），混上 splat 出问题分不清是相机还是资产。
- 预览页用来做三件事：对尺度（§4.1）、对桌面亮度（§4.3）、验接缝（§5-1）。
- 验收通过再谈接进 `TableScene` —— 那是第 1 步之后的事。

---

## 4. 对齐 + 桌面改网格

### 4.1 尺度与朝向（Blender 5.3）

Atlas 的尺度是任意的、朝向也不一定是我们的坐标系（§4.7）。桌宽 16 单位是唯一参照：

1. Blender 新建空场景；拖入 `workshop-step0-draft.spz`（§5.2 说 Blender 5.3 原生支持 splat；**本仓未自查**，版本不够就先用 SuperSplat 看，导出 ply/spz 再进 Blender）。
2. 建一根 **16 单位**的参照（立方体 16×0.1×0.1）。
3. 缩放 splat，让**桌宽 = 16**；旋转到**桌长轴 = X 轴**；平移让**桌心落在原点**。
4. **桌面顶面对到 y = −0.15**（不是 0）—— 给网格盖板留约 2 cm 净空（16 单位 ≈ 2 m 桌宽时 1 单位 ≈ 12.5 cm，0.15 单位 ≈ 1.9 cm）。这样卡牌坐标不用改（卡牌本来就 `CARD.lift = 0.02` 起）。
5. `Ctrl+A` 应用旋转与缩放（**烘进顶点**），再导出 SPZ；把最终 transform 记下来（要么烘进去用 identity，要么写进 three 里 —— **别两处都做**）。
6. ⚠ 别用负 scale 去镜像：法线、阴影、背面剔除会一起反。方向不对就转 180°。

### 4.2 桌面改网格：方案 A（第 0 步默认）/ 方案 B（第 1 步再做）

**方案 A：盖板（第 0 步就用这个）**

- 一块 `BoxGeometry(16.04, 0.5, 7.04)`：顶面在 **y = 0**、比 splat 桌面外扩 2 cm、往下包 0.5 单位（≈6 cm，正好是一块厚桌板）。position.y = −0.25。
- 为什么不是"把桌面从 splat 里切掉"：A 能把第 0 步要验的三件事（**窗光/影落在桌面上、卡牌不穿插、接缝**）一次验完，且**不动 splat 资产**、随时能拿掉；B 要动刀、要补桌面下的地面（那里没有任何视角看到过，切完是一个洞）。
- 可见顶面从这一刻起就是网格：splat 里烘死的桌面（含五张卡、杯子、笔记本、天平）全被盖板盖住 —— 这些物件本来也**不能**留在 splat 里（卡牌要换面/点选/淡入淡出，§6.2）。
- 盖板边缘与 splat 桌面边缘的那条缝，就是 §5-1 要验的接缝。

**方案 B：从 splat 里切掉桌面（第 1 步切窗时一起做）**

- SuperSplat（或 Blender）里框选桌面体积（x ±8、y −6~−0.15、z ±3.5）**整块删掉**；
- 网格做完整桌子：桌面 + 裙板 + 四条腿；
- **补一块桌面下方的地面**（深色、几乎看不见，但别留洞）；
- 好处：桌面厚度、桌腿与地面的接触阴影全是真的；坏处：要重切/重对齐一次。

### 4.3 桌面 PBR：参数与贴图从哪来

**贴图（两条路，推荐先程序化、再考虑裁图）**

1. **程序化木纹（推荐第 0 步用）**：`CanvasTexture` 1024² —— 纵向板缝（每块板宽 60~90 px，缝一条深色线）+ 年轮（正弦 + 两层噪声的条带）+ 少量节疤；`RepeatWrapping`、`repeat.set(2, 1)`（木纹沿长轴 X）。
   - 为什么先程序化：可重复、无版权问题、板缝位置能和盖板尺寸对齐（裁图做不到"无缝 + 与 16×7 对齐"）。
2. **从 04 / view-01 裁桌面区域**：取一块**没有卡片/杯子/笔记本**的桌面（view-01 右前角或 view-11 左下角，约 300×170 原始像素太少）→ 用 Pillow 做**平场校正**去光斑（`albedo / 高斯模糊(albedo, r=64)` 再拉回中灰）→ 偏移拼接做无缝 → 放大到 1024²。
   - 只有"想要画风里那层手绘纹理"时才值得；分辨率不够会糊，第 0 步不用它。
3. **normal / roughness**（两路都适用）：从 albedo 的亮度图算 —— 灰度 Sobel → normal（`normalScale` 0.3~0.5）；roughness = 亮度重映射到 **0.55~0.75**（深色年轮略粗糙）。

**材质参数起点（`MeshStandardMaterial`，不用 Physical —— 手机省一档）**

| 参数 | 值 | 为什么 |
|---|---|---|
| `map` | 木纹 albedo，`colorSpace = SRGBColorSpace` | 颜色贴图必须标 sRGB，否则整体发灰 |
| `normalMap` + `normalScale` | (0.35, 0.35) | 桌面斜看时要有木纹的起伏，太大出塑料感 |
| `roughness` | **0.62**（配合 roughnessMap 0.55~0.75） | §9.2 给的 0.55~0.75 中值；哑光木蜡油，别到 0.4 以下（会像清漆） |
| `metalness` | **0** | 木头没有金属反射；给了就会把环境贴图反射成一层灰 |
| `envMapIntensity` | 0.5 | 只吃一点环境光，主要靠 directional |
| `clearcoat` / `sheen` | **不开** | 手机上多一趟 pass，且会把窗光变成塑料高光 |
| 贴图尺寸 | albedo 1024²、normal 512²、roughness 与 albedo 共用一张 | 卡面贴图都限 512（`workshop-game-design.md` §2.6b），桌面给 1024 已经很大方 |

**桌面亮度必须对着 splat 校**（§9.2.1：splat 不吃灯）：预览页里在同一个机位截两张（一张只开 splat、一张只开网格桌面），比桌面区域的中位亮度；**差 > 10% 就调 albedo 明度或曝光**，别靠加灯 —— 加灯只会让网格更亮、splat 不动。

### 4.4 灯：第 0 步只做"白天一档"

坐标系（§4.1 对齐之后）：窗墙在 **−x**、壁炉墙在 **−z**、玩家/相机在 **+z**。

| 灯 | 参数起点 | 注意 |
|---|---|---|
| **`DirectionalLight`**（管方向与影） | `position = (-12, 8, 3)`、`target = (0,0,0)`（自动指向原点的话就 `lookAt` 桌心）；`intensity ≈ 2.4`、`color #fff2df`；`castShadow`；`shadow.mapSize 1024`（手机）/ 2048（平板）；`shadow.camera` 收紧到 `left/right ±9`、`top/bottom ±7`、`near 1`、`far 40`；`shadow.bias −0.0005`、`normalBias 0.02` | ★ 阴影框**只框"窗 + 桌面"那一块**（§9.2.2）：框整间房 = 把有限的阴影像素摊薄，窗棂的影就没了。薄投影最容易出 acne / peter-panning，这几个数要在预览页里现调（draft 就这点好：30 秒能重来） |
| **`RectAreaLight`**（管窗面泛光） | `width 6`、`height 3`（按窗洞实测改）、`position (-7.8, 3.2, 0)`、`lookAt (0,0,0)`、`intensity 4`（nit，对着曝光调） | ★ 三条硬限制（§9.2.2 读源码得来）：**不支持阴影**、**只支持 PBR 材质**、**必须先 `RectAreaLightUniformsLib.init()`**（WebGL 下不 init 就是黑的） |
| **环境（HDRI）** | 一张**白天 / 窗光方向**的 CC0 HDR（Poly Haven 1k，~1 MB）→ `PMREMGenerator` → `scene.environment`；`scene.environmentIntensity = 0.45` | ⚠ `MagicStudy` 的 `StudyEnv` 会把 `scene.environment` 换成 `/models/study/night.hdr`（§9.2.2）—— **同一个字段不能两个主人**。第 0 步的预览页**不挂 `MagicStudy`**，白天这张环境光由预览页独占 |

**⚠ 美术上的硬冲突（第 0 步必须让主人看一眼）**：现在的 `TableScene` 是**昏暗神秘**基调 —— 背景 `#05070f`、雾 16~40、冷环境光 0.2 + 两盏冷暖 point（`TableScene.tsx:1789-1796`）。这批 splat 是**午后白天**。第 0 步的预览页按白天做（这也是 04 那张基准图的光），但**进工坊时要么整体改成白天，要么第二套夜里 splat（§9.3a）** —— 这条不在第 0 步解决，写在这里是防止"预览好看、进游戏变两张皮"。

### 4.5 卡牌与 renderOrder

- 卡牌继续 mesh（`CARD = 1.1 × 1.65`），贴在桌面 `y = 0.02`（`CARD.lift`）上，**不进 splat**（§6.2）。
- `renderOrder` 固定队伍（§9.5-1）：桌面 / 卡牌 / 椅子 mesh = `0`；splat = `10`；玻璃 / 投影光 / UI 面片 = `20`。写死在预览页里，进 `TableScene` 时照抄。
- 点选只对 mesh 开 raycaster；splat 的 `depthWrite = false` 不会替你挡 —— 别把点选交给 splat。

---

## 5. 验收清单（可勾；照 §9.4 第 0 行展开）

> 全在**真机**上验（本仓规矩：合并、出片都只能装机验，splat 的帧率同理）；浏览器好看不算。

- [ ] **1. 接缝（§9.4-②）**：相机推到桌面盖板边缘 **1 米内**（≈ 8 单位，§9.4 末尾的距离换算）截图。要求：**不出现硬边、不出现空缝、不出现闪烁**。三个机位各一张：正视 / 俯视 / 低角。判定方式：截图放大看接缝那一圈有没有"亮线/黑线/半透明毛边"。
- [ ] **2. 卡牌不穿插（§9.4-③）**：4 个角色位各放一张卡，相机绕桌一圈；要求：卡不陷进桌面、不被 splat 遮挡、点得中；连续 10 秒不闪（z-fight 的判定就是"会不会闪"）。
- [ ] **3. 真机 30fps × 60 秒（§9.4-①）**：中端安卓机（WebView）**稳定 30fps、连跑 60 秒不掉帧**；记录 `renderer.info.render.calls / triangles` 与 `renderer.info.memory.textures`（这两个数就是后面第 2 步的基线）。掉帧按 §9.5-4 的顺序砍：shadow mapSize → 透射 → splat 份数。
- [ ] **4. 拿掉 splat 仍可用（§9.4-④）**：把 `<Splats>` 拿掉（或 url 置空、或模拟加载失败），场景仍可用：桌面、卡牌、点选、灯全在，不白屏、不报错。这一条是**兜底没被写死**的证明（§6.3 第 3 条）。
- [ ] **5. 玻璃奶白坑（§9.5-2）**：在 splat 前面放一块玻璃（`transmission: 1`、`ior: 1.52`、`thickness: 0.008`、`roughness: 0.08`、`transparent: false`），相机从左到右扫一遍。要求：**玻璃里不是一片奶白**；如果奶白 → 命中 §9.5-2，结论写回来（第 1 步玻璃只能走"窗外先渲成贴图"那条兜底，不上 drei 的 `MeshTransmissionMaterial`）。
- [ ] **6. 尺度与卡位对齐（§9.4 末尾）**：桌宽 = 16 单位之后，卡位坐标与网格桌面对得上（差 < 0.1 单位）；四个角色位投影到桌面都在桌沿以内。
- [ ] **7. 版权 / 资产台账**：这份 draft 是哪个账号状态出的（免费 / 付费）、taskId、时间、文件大小，记在 `manifest.json` 旁边（`splat-log.md`）。**免费号产物标注"仅验证、不进包"**。

---

## 6. 风险与回退

| # | 风险 | 会出现什么 | 兜底 |
|---|---|---|---|
| 1 | **Atlas 位姿估不出来**（二维画风图） | 12 个相机乱飞 / 深度糊 / 任务直接失败 | 先删 1~2 张再试；不行走 §2.6 的单图 + `atlasGenerate` 老路线；失败免费，不心疼 |
| 2 | **draft 太大 / 高斯太多** | 下载几十 MB、WebView 显存爆 | `maxSplats` 先截断看可用性；SuperSplat 按 §6.3 切 3~4 份、按距离 LOD；单份预算先定 ≤ 8~12 MB（§9.5-3） |
| 3 | **老机型不支持**（浮点纹理 / WebGL2） | splat 不显示或整页崩 | `try/catch` + 8 秒超时 + 能力探测 → **回今天的程序化桌面**（`Table` 组件原样不动，splat 层直接不挂）。兜底必须在第 0 步就验（§5 第 4 条） |
| 4 | **白天 splat vs 夜里工坊** | 预览好看，进游戏两张皮 | 第 0 步的预览页按白天做；进工坊前先拍板"整体改白天"还是"第二套夜间 splat"（§9.3a，+$5/套） |
| 5 | **桌面漂移 / 盖不住** | 盖板边缘露出 splat 里烘死的卡片 | 盖板外扩 2 cm；还露就换方案 B 切掉桌面；再不行重出那两张输入（`gen-views.mjs --only=01 --force`） |
| 6 | **版权**（免费号） | 产物不能商用，上架前才发现 | 第 0 步就记账号状态；上线资产用付费号重出（refined $5 + draft $0.5），**别拿免费号的 draft 直接进包** |
| 7 | **Spark 升版把 API 打散** | `extend` / `SplatMesh` 选项改名 | 精确锁 `@sparkjsdev/spark@2.4.0`，升级单独一步、单独验 |

**回退到"今天的程序化桌面"的具体做法**（风险 3）：splat 加载放在一个 `<ErrorBoundary>` + `Promise.race(timeout 8s)` 里；失败就把 splat 那棵子树整个不挂（不是 `opacity: 0` —— 那还在吃显存和帧），`Table` / 卡牌 / 灯全走现在的代码。**验证方式就是 §5 第 4 条**：手动置空 `url`，场景必须和今天一模一样。

---

## 7. 本步产出与下一步

**产出（第 0 步做完时手上应该有）**

1. 1 份 draft SPZ（仓库外，附账号状态与 taskId）。
2. 1 个独立预览页（splat + 桌面盖板 + 一盏 directional + 一张白天 HDR + 玻璃测试块）。
3. 验收记录：§5 七条各一句结论 + 截图 / `renderer.info` 读数。
4. 资产台账：`splat-log.md`（谁出的、花没花钱、能不能进包）。

**下一步（§9.4 第 1 步：窗 + 玻璃 + 窗外，3~4 人日）**

- 继承第 0 步的 `renderOrder` 与白天灯组；
- 窗框 / 窗棂低模 + 玻璃 `MeshPhysicalMaterial` + 窗外视差板（**不透明**）；
- 玻璃那条坑的结论（§5 第 5 条）直接决定第 1 步玻璃怎么写；
- 顺带把方案 B（切桌面）做了，桌面厚度与桌腿接触阴影就能全真。

---

## 附录：复现命令（仓库外，不打印 key）

```bash
cd C:\Users\tliu7\Downloads\gs-step0
node gen-views.mjs                                   # 缺哪张补哪张（01 → 12 链式）
node gen-views.mjs --only=03 --force                 # 只重出某一张
"C:\Users\tliu7\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" finalize.py       # 2560→1280，webp + png + 拼图
"C:\Users\tliu7\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" make-manifest.py  # 机位 + 提示词 + 模型 → manifest.json
```

- 渠道：`server/.env` 的 `RUNWAY_API_KEY` → Runway `/v1/text_to_image`（`gpt_image_2_6_sunburst`），key **只在脚本里读、不打印**。
- 每张的完整提示词、参考图（master / neighbor）、taskId、耗时都在 `manifest.json` 里。
