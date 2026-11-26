# Atlas Developer API → 高斯泼溅（SPZ）：工坊「魔女阁楼」11 视角

2026-11-26 实测记录。素材是 `~/Downloads/workshop-views12/` 里 12 张 AI 伪多视角
（Seedream 逐张重绘的同一间房），本轮剔除 18mm 的 view-11，用 **11 张 1280×720**
走 Atlas 官方 Developer API：**曝光/白平衡归一 → 上传资产 → images2PosedRGBD 估位姿+深度
→ posedImages2Splats（draft 校验 + refined 成品）→ 下载 SPZ**。全过程脚本化、可断点续跑。

> 结论先行：**posedImages2Splats 必须先有位姿和深度**，而我们的伪多视角没有真实位姿，
> 所以必须走 `images2PosedRGBD` 这条路，不能直接把 11 张图丢给 splats。
> refined 一次 **5,000 credits（$5）**，draft **500**；`images2PosedRGBD` **2 credits/输入图**
> （平台定价页，docs/billing.md 未列）。失败的任务不扣钱。

## 1. 文档结论

### 1.1 认证

- Base URL：`https://api.atlas.worldlabs.ai/api/v2`
- 每个受保护请求带 **`WLT-Api-Key: <project-scoped key>`** 头；不接受 query 参数。
- key 绑定 project，路由里不需要 account/project id；换项目要换 key。
- 需要的 scope：`tasks.create`、`operations.read`、`assets.create`、`assets.read`。
- key 从 `~/ideahub/server/.env` 的 `ATLAS_API_KEY` 读（或环境变量），**脚本从不打印 key**。

### 1.2 资产上传（四步）

```
POST /assets                       {asset:{displayName}}         → id（CREATED）
POST /assets/{id}:createUploadUrl  {contentType, contentLength}  → uploadUrl / method / headers
PUT  <uploadUrl>                   原样带 headers，不带 WLT-Api-Key
POST /assets/{id}:completeUpload   {}                             → READY（读得到类型/尺寸）
```

- `contentType` / `contentLength` 必须与实际字节一致；不一致 `completeUpload` 会拒。
- 上传 URL 30 分钟有效、一次成功；过期重新 `:createUploadUrl`。
- 只有 `READY` 的资产能被任务使用；未完成的上传两小时后自动清理。
- 任务输出也可以是资产：`response` 里同时给 `assetId` 和 24 小时有效的 `url`；
  把输出喂给下一个任务要用 **`assetId`**，不要用 `url`（url 会被重新抓取存成新资产）。
- `url` / `uploadUrl` 都是短期秘密，脚本日志与落盘 JSON 都会剥掉。

### 1.3 没有位姿：任务链是固定的

`posedImages2Splats` 要求每帧 **image + camera + depth**（线性深度 EXR，来自
`images2PosedRGBD` 的 `depth.depthAsset`，或 `atlasGenerate` 的 `returnDepth`）：

```
POST /tasks:images2PosedRGBD   {frames:[{imageAsset}], targetResolution:[1280,720], refinePoses}
  → response.frames[i] = { imageAsset, camera{extrinsics,intrinsics}, depth{depthAsset} }
POST /tasks:posedImages2Splats {posedFrames:[{imageAsset, depth, camera}], prompt, enhancePrompt}
  → refined: response.refinedSplats { "<splatCount>": {assetId,url} }
  → draft:   response.draftSplat {assetId,url}
```

- 相机网格必须是 `1280x720 / 720x1280 / 960x720 / 528x704` 之一，且所有帧同一个网格；
  **`targetResolution:[1280,720]` 把它钉死**（我们的输入本来就是 1280×720，不会裁 FOV）。
- `images2PosedRGBD` 的 `refinePoses` 默认 false；我们设 true。实测这次返回
  `poseRefinementAccepted: false`（解算没通过服务端的移动上限，按文档退回未 refine 的位姿，
  **这是成功不是失败**）。11 帧没有触发错误。
- 帧数：refined 2–512，draft 2–32。我们 11 帧。官方建议单房间 8–16 个视角。
- `canonicalizeToFirstFrame: true`：第一台相机放到原点朝前（实测 x/z 归零、y 保留 1.354m
  的重力高度），方便下游直接看。

### 1.4 价钱（平台定价页实读，2026-11-26）

| 任务 | 单位 | credits |
| --- | --- | --- |
| images2PosedRGBD | 输入图 | **2 / 张** |
| posedImages2Splats refined（默认） | 成功一次 | **5,000**（$5） |
| posedImages2Splats draft（`refine:false`） | 成功一次 | **500**（$0.50） |
| splats2Mesh | 世界 | 500 |

- **失败免费**；只有成功扣钱。
- Developer API **没有余额/credits 查询端点**。余额看平台
  Settings → Developer Platform → Credits (API)。脚本把 HTTP **402**
  `CREDITS_UNAVAILABLE` / `SPEND_LIMIT_EXCEEDED` 当作余额不足的唯一信号。
- 本轮开始前该账号显示 **10,000 credits available（≈ $10.00）**。

### 1.5 operation 与重试语义

- 所有任务异步：提交返回 `{id, done:false}`；`GET /operations/{id}` 轮询，
  **唯一终态信号是 `done`**，`done:true && error:null` 才算成功。
- 提交时带稳定的 **`Idempotency-Key`**：传输超时/断线用**同一个 key 重试同一 body**
  会拿回原 operation，不会开第二份工作；换 body 复用 key 会 409。
- 脚本的设计：**拿到 operation id 立刻写 `atlas-state.json`，之后只轮询、永不重复提交**。
  一个 refined 任务 5,000 credits，重复提交就是重复扣。
- 重试：429/500/503/504 按 `Retry-After` + 指数退避（带 jitter）；400/401/403/422 不重试。
- operation/response 保留 30 天；输出资产留在项目库直到删除。刚提交后短暂 404 可以重试。

### 1.6 文档与实测的两处出入（重要）

1. **`refine` 字段**：任务指南明确写 “Set `refine` to `false`” 走 draft，draft 还返回
   `draftSplat`；但 `docs/api-reference/posed-images2-splats.md` 的
   `PosedImages2SplatsRequest` schema 里**没有 `refine` 字段**（`additionalProperties:false`）。
   **实测：传 `refine:false` 被服务端接受**，draft 正常返回 `draftSplat` —— 以任务指南为准，
   但公开 schema 是落后的，写客户端时别只信 schema。
2. **`enhancePrompt:false` 必须配非空 `prompt`**：实测第一次 draft 提交被 422 拒：
   `Value error, enhancePrompt=false requires a non-empty prompt`。`prompt` 在 schema 里是
   optional，但和 `enhancePrompt:false` 组合时不是。脚本改成固定的 `SCENE_PROMPT` +
   `enhancePrompt:false`（跳过 prompt enhancement，省时且可复现）。

### 1.7 其他坑

- 轮询别用 `?wait=true` 等 refined：负载均衡 60 秒就断（文档明说），会 504。
- 输出 SPZ 可能是 **gzip** 包着的（本轮 draft 就是）：先按 `1f 8b` 解压再读头；
  脚本也处理了 zip（PK）容器。
- SPZ 头 16 字节：`magic uint32 LE = 0x5053474e ("NGSP")`、`version uint32`、
  `numPoints uint32`、`shDegree u8`、`fractionalBits u8`、`flags u8`、`reserved u8`。

## 2. 输入与归一

脚本：`design/atlas-prep-views.py`（Pillow；只做整图 LUT 缩放，不重采样/不裁切）。

- 剔除 **view-11**（唯一 18mm 广角，notes.md 里位姿风险第一）。
- 白平衡：每张通道均值拉到 12 张通道均值的中位数（gray-world，gain 夹 [0.75,1.33]，
  本轮没有任何一张被夹）。
- 曝光：在 WB 之后解一个标量 k，使整图平均亮度（Rec.709 luma，0–255，与 notes.md 同口径）
  等于 **12 张的中位数**（37.219）。用直方图 + 二分 60 次求解，误差 < 0.01 灰阶。
- 输出：`~/Downloads/workshop-views12/norm/view-XX.jpg`（1280×720 JPEG q92 / 4:2:0 /
  progressive），只输出 11 张。

| 视角 | 归一前 | 归一后 | 偏差 | WB gain R/G/B |
| --- | --- | --- | --- | --- |
| 01 | 43.22 | 37.23 | +0.03% | 0.845 / 0.858 / 0.940 |
| 02 | 42.68 | 37.22 | −0.00% | 0.868 / 0.871 / 0.914 |
| 03 | 37.08 | 37.22 | +0.01% | 1.033 / 0.998 / 1.025 |
| 04 | 40.91 | 37.23 | +0.02% | 0.898 / 0.910 / 0.958 |
| 05 | 33.64 | 37.22 | −0.00% | 1.163 / 1.113 / 1.016 |
| 06 | 34.48 | 37.22 | +0.00% | 1.120 / 1.086 / 1.005 |
| 07 | 37.64 | 37.22 | −0.00% | 0.995 / 0.990 / 0.995 |
| 08 | 35.19 | 37.22 | −0.00% | 1.042 / 1.064 / 1.070 |
| 09 | 37.36 | 37.21 | −0.01% | 0.977 / 1.002 / 1.018 |
| 10 | 38.22 | 37.22 | +0.00% | 0.980 / 0.977 / 0.967 |
| 12 | 35.91 | 37.22 | +0.00% | 1.110 / 1.032 / 0.991 |

11 张归一前 33.64–43.22（中位 37.36，约 0.7 档差），归一后 37.21–37.23，
**max |dev| = 0.03%**（要求 ±2%）。view-11 未输出（归一前 18mm 那张的亮度见
`normalize-report.json` 的 `excluded_views`）。

## 3. 脚本

### 3.1 `design/atlas-prep-views.py`

```bash
python design/atlas-prep-views.py            # 写 11 张 norm
python design/atlas-prep-views.py --dry      # 只量不写
```

产物：`norm/view-XX.jpg` ×11 + `norm/normalize-report.json`（每张前后亮度/增益/输出字节）。

### 3.2 `design/atlas-splat.mjs`（Node 18+ 内置 fetch，零依赖）

```bash
node design/atlas-splat.mjs --dry-run     # health + 认证 + 上传 1 张 + credits 说明
node design/atlas-splat.mjs --pose-only   # 上传 11 张 + images2PosedRGBD + 校验位姿
node design/atlas-splat.mjs --splat-only  # 用 posed-rgbd.json 跑 posedImages2Splats
node design/atlas-splat.mjs --run         # 两步连跑；有 state 就续跑
node design/atlas-splat.mjs --status      # 看本地 state/产物
```

关键设计：

- **断点续跑**：`atlas-state.json` 记资产（按文件 sha256）、operation id、结果。
  有 id 就只轮询，绝不重复提交付费任务。
- **先估位姿再校验再花钱**：`--pose-only` 会把 `images2PosedRGBD` 的 response 落盘，
  并校验内参网格、四元数模长、深度资产、相机基线；基线 < 0.02 视为纯旋转，
  默认拦下（`--allow-pure-rotation` 才继续），避免拿 5,000 credits 去建一个 2.5D 平板。
- **日志/落盘不含 secret**：不打印 key；uploadUrl / readUrl / base64 写盘前剥掉。
- 产物目录 `.tmp-gs-step2/`（已被 `.gitignore` 的 `.tmp-gs-*/` 覆盖，不进仓库）。

## 4. 干跑结果

```bash
node design/atlas-splat.mjs --dry-run
```

- `GET /health`：`{"status":"ok","service":"marble-api-server"}`（不需要 key）。
- 认证：`GET /assets?pageSize=1` 通过（key 有效且有 `assets.read`）。
- 上传 1 张 view-01：`asset_701fa29074a24c12bcdcb5013c40586f`，READY，1280×720，182,622 bytes，0.9 s。
- credits：API 无余额端点；平台页面读数 **10,000**；文档单价见 §1.4。

## 5. 全量跑结果

| 步骤 | operation | 耗时 | 结果 |
| --- | --- | --- | --- |
| 上传 11 张 | — | 8.5 s | 11 个 READY 资产（复用干跑那张） |
| images2PosedRGBD | `8fd66eed3b0b47539ce6758f6375a191` | **27.1 s** | 11 帧，内参 1280×720，fx≈753.7，`poseRefinementAccepted:false` |
| posedImages2Splats **draft** | `249ce8b318f3465ab9841ce5aed2a2e4` | **41.2 s** | 524,288 splats，SPZ 9,961,488 B（gzip 下载 7.82 MiB） |
| posedImages2Splats **refined** | `67d1fab076574354b01e98cac7f494c1` | **1,107.5 s（18.5 min）** | **2,000,000 splats**，SPZ 38,000,016 B（36.24 MiB；gzip 下载 29.86 MiB） |

位姿统计（`--pose-only` 自动校验）：11 帧全部通过；相机两两最大距离 **2.717**
（不是纯旋转），质心 `[-1.160771, 1.236124, -0.694104]`。
**但要注意**：这 11 张的"真实"机位是同一墙角的三脚架旋转（±8° yaw / 0–2° pitch），
Atlas 估出来的相机中心却移动了 2.7 m —— 伪多视角的视差/细节漂移被当成了平移，
这是本轮最大的质量风险（见 §7）。

### credits 账

| 项 | credits |
| --- | --- |
| images2PosedRGBD 11×2 | 22 |
| splats draft | 500 |
| splats refined | 5,000 |
| **合计** | **5,522** |
| 运行前余额 | 10,000 |
| 运行后余额（平台页面，2026-11-26 实读） | **4,478**（= 10,000 − 5,522，逐分对上） |

## 6. SPZ

- draft：`.tmp-gs-step2/scene-draft.spz`，header `magic=NGSP (0x5053474e) version=2
  numPoints=524288 shDegree=0 fractionalBits=12 flags=64`。
  文件 **9,961,488 B = 16 + 524,288 × 19**（v2 布局：positions 9 + scales 3 +
  rotations 3 + alphas 1 + colors 3），与格式定义逐字节对上；按 v2 解出的位置
  1%–99% 分位：x −2.575…2.783、y −0.038…4.273、z −7.070…0.319（房间尺度，
  另有到 ±30 的少量飞点）。只做了包围盒/正交投影抽查（`scene-draft-bounds.png`），
  没有做真实渲染。
- refined：`.tmp-gs-step2/scene.spz`，header `magic=NGSP (0x5053474e) version=2
  numPoints=2000000 shDegree=0 fractionalBits=12 flags=64`。
  文件 **38,000,016 B = 16 + 2,000,000 × 19**，同样与 v2 布局逐字节对上；
  位置 1%–99% 分位：x −2.695…2.754、y 0.013…3.844、z −7.063…0.594
  （refinement 后飞点明显收敛：全幅 min/max 只到 x −3.6…4.5、z −7.8…1.7）。
  SHA-256：`0deb84e647c372e2ad41f65791f3c95a74c518d6e32751cd773a110576f6554d`。
- 注意：两个 SPZ 下载下来都是 **gzip**（`1f 8b`），不是裸 SPZ；脚本解压后才落盘成 `.spz`，
  头按 16 字节解析。refined 的 operation response 里 `draftSplat` 为 `null`、
  `refinedSplats` 按 splat 数（`"2000000"`）索引；draft 的 response 里
  `refinedSplats` 为空对象、结果在 `draftSplat`。
- ★ **入包（App / Spark）时相反：要 gzip 那一层。** 2026-11-26 在 App 里实测：裸 `NGSP` 文件会被
  Spark 判 `Unsupported NGSP version: 2`（它读的就是 gzip 包着的 `.spz`），必须把裸文件 gzip 回去再放进
  `public/models/study/gs/`。详见 [`gs-step2-splat-log.md`](gs-step2-splat-log.md) §1.1。

## 7. 风险与后续

1. **伪多视角的几何不一致**（最高）：12 张是逐张重绘，不是同一台相机的真实拍摄；
   Atlas 估出 2.7 m 的相机位移，说明它把生成图的视差/细节漂移吃成了平移。
   refined splats 很可能在离开原始 ±8° 视锥后出现重影/拉伸；这是输入决定的，不是 API 参数问题。
   要更好：用 `atlasGenerate` 以 1–3 张好帧为 context、`returnDepth:true` 生成环绕视角
   （每张 40–50 credits + 8–10/额外帧），或实拍/引擎渲染真位姿。
2. **覆盖窄**：11 张全部从同一个墙角看同一间房，没有背面/侧面。官方建议 8–16 个
   "分布良好"的视角；我们数量够，分布不够。
3. **view-11 已剔除**：18mm 广角桶形/拉伸最伤位姿，与 notes.md 判断一致。
4. **薄/反光/低纹理**：黄铜细环、玻璃标本罐、雕花椅柱、毛玻璃圆窗、深色木地板，
   都是 splats 的已知弱项（见 docs/splat-best-practices）。
5. **文档落后**：`refine` 不在公开 schema 但实测可用；`enhancePrompt:false` 需要 prompt。
   脚本已按实测行为写，并在注释里标了日期。
6. **余额/额度没有 API**：只能人看平台页面；脚本用 402 兜底。
7. refined 结果**没做真实渲染验收**：本轮只校验了 SPZ 头、文件尺寸与 v2 布局逐字节对上、
   位置包围盒/正交投影抽查（`.tmp-gs-step2/scene-bounds.png`）。下一轮若要在 App 里用，
   建议先用 `design/gs-preview.html` / Spark 从原相机位与几个环绕位看一遍再决定是否入包。

## 8. 复现

```bash
# 1) 归一（需要 Pillow）
python design/atlas-prep-views.py

# 2) 干跑
node design/atlas-splat.mjs --dry-run

# 3) 位姿
node design/atlas-splat.mjs --pose-only

# 4) draft 校验（可选，500 credits）
node design/atlas-splat.mjs --splat-only --draft

# 5) refined 成品（5,000 credits）
node design/atlas-splat.mjs --splat-only
```

环境变量：`ATLAS_API_KEY`（优先）/ `ATLAS_ENV_FILE` / `ATLAS_NORM_DIR` /
`ATLAS_OUT_DIR` / `ATLAS_API_BASE`。默认读 `~/ideahub/server/.env`。
