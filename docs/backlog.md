# Backlog（ideahub-app）

> 只记**已经决定要做、但这一轮不做**的事，以及**做之前必须先定的前置**。
> 想法/调研放各自的 design doc；已完成的从这里删（git history 里有）。

---

## 1. 方舟 2.0/2.5 真人路（2026-08-27 读官方文档后**重写**）

> ⚠ **本节此前的内容有错**，已作废：那时写的 REST 路径（`POST /api/asset-library/real-person/sessions` 之类）
> 来自**转售商的代理文档**，不是方舟官方流程。官方原文见
> [`docs/82379/2315856`（录入真人形象素材）](https://www.volcengine.com/docs/82379/2315856)、
> [`docs/82379/2608626`（含人脸素材的三条方案）](https://www.volcengine.com/docs/82379/2608626)、
> [`docs/82379/2223965`（虚拟人像库）](https://www.volcengine.com/docs/82379/2223965)。
> 文档是 JS 渲染的 SPA，WebFetch 读不到正文——**要用浏览器打开读**（这次就是这么拿到的）。

### 1.1 官方给的是**三条**路，不是一条

| # | 路 | 要不要授权 | 能不能 API 驱动 | 适配我们哪个场景 |
|---|---|---|---|---|
| A | **信任模型产物**（本账号 30 天内的产物） | 不要 | ✅ 全程 API | 「AI 形象」——最自动化 |
| B | **预置虚拟人像库**（平台免费提供） | 不要 | ⚠ 消费能，**检索只能在控制台** | 想要真人风格但不指定具体人 |
| C | **已授权真人素材**（扫码授权） | 要（本人） | ❌ 授权全在控制台 | 用户指定某个真实的人 |

**A · 信任模型产物**（最有价值、此前完全不知道）：方舟**信任本账号近 30 天内**由这些模型产出的含人脸素材，可再喂给 Seedance 2.0/2.5 而**不触发输入审核**：
- Seedance 2.5/2.0 生成的含人脸视频（2026-03-11 起）
- 上述视频的**尾帧图片**（2026-04-16 起）
- **Seedream 5.0 lite/pro 文生图**得到的含人脸图片（2026-04-16 起）

⚠ 硬约束：同平台、**同账号**、**仅原始产物**（二次剪辑/压缩/转发即失信）、30 天有效期、原始 URL 只活 **24 小时**（建议转存 TOS）。**只信任输入**，输出仍可能被安全审核拦。
⚠⚠ 注意是**文生图**。我们的 `portraitViews` 走的是**图生图**（拿用户裁剪当参考）——从一张真人照片 i2i 出来的图**大概率不在信任范围**（也理应不在：那等于给真人肖像洗白）。这条要**实测**才能定，别按"应该可以"写代码。

**B · 预置虚拟人像库**：平台预置、免费、合规，每个形象一个 `asset://<id>`。
⚠ **检索与拿 ID 只能在方舟体验中心（控制台）**，**没有列表/检索 API**。⇒ app 里做不了"浏览虚拟人像"，只能让人**粘贴 asset ID**。
⚠ 这一页还写着「当前暂不支持使用真实人物形象生成视频」，与 C 那页（2026-08-11 更新）**互相矛盾**——多半是本页过时。以更新更晚的 C 页为准，但真做之前要再确认。

**C · 已授权真人素材**（就是 LibTV 那套）：
1. 使用方在**方舟体验中心**（控制台）→ 我的 → 真人人像 → 管理素材 → **创建资产组**，设**授权有效期**、同意《真人人像使用协议》→ 生成**邀约二维码**；
2. **被拍的本人**扫码、**登录自己的火山账号**、做真人认证（活体）、上传素材、授权给你的账号；
3. 使用方回控制台**接收**（也可拒绝）。
- 账号须完成**个人或企业认证**（⚠ 修正：不是只有企业能用）。
- 一个素材组 = **一个演员**，不同妆造可多传，只做一次真人认证；同组不许传不同人。
- 每次上传做**同人一致性校验**（视频隔秒抽帧、全部通过才入库）。
- **素材格式硬门**（照抄官方）：
  - 图片 jpeg/jpg/png/webp/gif/heic，<30MB，宽高比 (0.4, 2.5)，边长 (300, 6000)px
  - 视频 mp4/mov，≤50MB，时长 [2,15]s，帧率 [24,60]，边长 [300,6000]px，像素 [409600, 927408]
  - 音频 mp3/wav，≤15MB，时长 [2,15]s
  - 全身参考图：竖版、全身正面；人脸特写：竖版、正面无表情、肩部以上、面部约占 2/3

### 1.2 生成侧的确切用法（官方示例，已核对）

```json
{ "type": "image_url", "image_url": { "url": "asset://asset-20260401123823-6d4x2" }, "role": "reference_image" }
```
- 模型 `doubao-seedance-2-0-260128`；base `https://ark.cn-beijing.volces.com/api/v3`
- 参数：`generate_audio` / `ratio`（**支持 `"adaptive"`**）/ `duration` / `watermark`
- **提示词里必须用「素材类型+序号」引用**（`图片1`），**绝不能写 asset ID 原文** —— 官方明确标了正确/错误用法。这与我们 `blockoutPrompt` 那套点名句是同一个道理。
- `reference_video` 这个 role **确实存在**（官方示例里用它做视频编辑）。

### 1.3 已落地（2026-08-27）：「粘贴 asset ID」最小可用

按 1.2 的结论开工，做完的部分：

- **`data/cardAsset.ts` 侧库**：按 cardId 存 `{ assetId, scope, note }`。不进 `Card`——
  除了 cardVoice 那两条理由，还多两条更硬的：资产**绑死在某个火山账号**下（随卡分享出去
  对别人只会 400），以及它背后是**某个真人的肖像授权**，让它随卡走等于我们替被授权人
  做了他没同意的授权。`scope` 是**枚举不是布尔**（为将来"形象公开化"留迁移空间）。
- **`normalizeAssetId` / `assetUri`**：控制台上「复制 asset ID」与「复制 URI」是两颗按钮，
  两种粘贴都收；拼 `asset://` 只有一处实现。
- **`VideoTier.assetRef`**：跟**模型代次**走（2.0/2.5 收 asset://，1.0 不收），与 `realFace`
  是两件事（后者说"能不能直接传真人照片"，前者说"能不能用已授权的那份"）。
  ⇒ `hd`(2.0-mini) 与 `ultra`(2.5) 为 true，`fast`/`std`(1.0) 与 `real`(MiniMax) 为 false。
  **不用新开档位**——2.0/2.5 本来就在白名单里且已有计价。
- **`realFaceIssue` 学会认授权**：真人卡 + 该档收 asset:// + **每一张真人卡都绑了素材** → 放行。
  三种拒绝语各自指对路（1.0 档 → 换档并授权；2.0/2.5 档缺授权 → 去做授权；白模那条照旧）。
- **出片侧**：`prepareMaterialRefs` 里在守门**之前**分流 —— 绑了素材的卡整张只发
  `asset://` URI 不发图。⚠ 不分流的话 `prepRefImage` 会因为它既不是 `data:` 也不是
  `http(s)` 而返回 null，这张卡被当成坏图**整张丢掉**，零报错。
- **肖像闸门**（此前**缺失**，与 1.4 的产品决定相悖）：真人卡不许分享/发布。
  app 侧 `shareBlockReason` 让按钮灰掉，**服务端 `publishCard` / `publishDeck` 是权威那份**
  （整发 400 并点名是哪张卡，不悄悄剥掉）。spec A14 钉住。

**仍未验证（要一发探针 / 一个真 asset ID）**：
- 绑定后 `hd`/`ultra` 的出片**没有跑过真的**（我们手上没有 asset ID —— 那要控制台建组 +
  真人扫码）。请求形状按官方文档拼，但**没量过就不是结论**。
- **`asset://` + `reference_video`（白模 r2v）**：`ultra` 同时有 `assetRef` 与 `refVid`，
  所以代码上现在**允许尝试**了 —— 这正是"真人卡 × 白模"那个双向死路的可能解。
  官方没有同时使用的示例，成不成要实测。⚠ 失败不扣钱（`genNode` 是 `res.url` 成了才
  `spendTokens`），所以让用户去试是安全的，但**文案不许把它说成已经能用**。

### 1.4 这对我们意味着什么（当时排的落地成本，已按 1.3 执行）

- **最小可用**：给人物卡加一个"**粘贴方舟 asset ID**"的口子 + 出片时按 `asset://` 传参。因为**没有检索 API**，app 本来也只能做到这一步 —— 这比原计划（在 app 里做整套扫码授权 UI）小一个数量级，而且**那套 UI 根本做不出来**（授权在控制台）。
- **A 路值得先探**：它全程 API、不需要任何人扫码。若 Seedream 5.0 **文生图**出的人脸能喂给 Seedance，那"AI 形象"这条就完全自动化了。⚠ 但要新增 Seedream 5.0（我们现在的出图档位里有没有它要先看）。
- **仍需一发探针**：`asset://` 主体 + `reference_video`（白模 r2v）**能不能同用**。两个 role 都在同一个 `content` 数组里合法，看着可行，但官方没有同时使用的示例 —— 没量过就不写结论。这条通了才解得开"真人卡 × 白模模板"那个双向死路。
- **计价**：Seedance 2.0 纯生成 46 元/百万 token（≈1 元/秒）、含视频输入 28 元/百万 —— 约本仓锚点（15 元/百万）的 3×。要单开档位与 `flatCost`，报价=实扣跨仓钉死（照 MiniMax 真人档先例）。

### 1.5 控制台实操记录（2026-08-27，真机走查）

**已建成**：邀约二维码已在控制台生成（授权接收 = 企业认证账号 2130650312 · 深圳玖兴贸易有限公司；
授权时间 **2026-08-27 ~ 2027-08-27**）。等被拍者扫码授权、控制台「接收」后才有 asset id。

⚠⚠ **两颗按钮不是一条路**（官方文档没写，实操踩到）：
- 「我的 → 真人人像」空态那颗大的「**添加真人人像**」→ 弹的是《上传**虚拟人像**素材合规承诺函》，
  要承诺"不会与任何自然人的肖像、形象相同或相似"——**与录真人的目的正好相反，勾了就是不实承诺**。
- 走右上角「管理资产 → **创建资产组**」→ 才是对的《个人信息处理规则》+ 授权时间 + 邀约二维码。

⚠ **两个有效期别混**：授权时间（选的 1 年）是**素材可用期**；邀约二维码本身只有 **7 天**
（页面小字「二维码及分享图将包含账号标识信息（…过期）」）——码过期就回控制台重生成，授权期不受影响。
另：分享码即默认对方可见接收方企业信息（应该的，被拍者得知道在授权给谁）。

### 1.6 「app 内授权」（LibTV 同款体验）—— 有路，差一发探针

**问题**：能不能不去控制台，让用户在我们 app 里完成整套邀约→授权→拿 id？

**关键证据（2026-08-27 抓包，控制台生成二维码时的真实调用）**：
```
POST console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/CreateAuthorizationUUID      ← 生成邀约
POST console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/ListAuthorizationAssetGroup  ← 列资产组/授权状态
```
`/api/top/{service}/{region}/{version}/{Action}` 是火山控制台对 **Top OpenAPI** 的标准代理
⇒ 底下是正规 OpenAPI（service=`ark`、Version=`2024-01-01`），**理论上可用账号 AK/SK v4 签名
从 `open.volcengineapi.com` 直调**，不依赖控制台登录态。二维码内容 = 火山自己的移动 H5
（`ark.volcengine.com/region:cn-beijing/mobile/livenees-face-manage/…`，原文拼写如此）。

**架构（若探针通过）**——LibTV 的"在 app 里授权"就是这套的产品化：
1. server 存管理员 **AK/SK**（新 env：`VOLC_AK`/`VOLC_SK`，**绝不进 app**），新端点：
   - `POST /api/ark/portrait/invite` → 签名调 `CreateAuthorizationUUID` → 回 H5 链接；
   - `GET /api/ark/portrait/groups` → 调 `ListAuthorizationAssetGroup` → 授权状态 + asset id。
2. app 真人卡详情页：「请本人扫码授权」→ 渲染二维码（H5 链接）→ 轮询 groups → 授权完成后
   **自动**把 asset id 绑进卡（替代现在的手工粘贴，粘贴口保留作退路）。
3. **做不进 app 的那一步谁都做不进**：活体认证 + 登录火山账号 + 上传素材发生在**火山的 H5** 上
   ——LibTV 也一样。我们能做的是把"出示二维码"和"收结果"两头搬进 app。

**✅ 探针已跑通（2026-08-27，AK/SK 直调 OpenAPI，只读零费用）**：
- 端点确认：`POST https://open.volcengineapi.com/?Action=<Action>&Version=2024-01-01`，
  service=`ark`、region=`cn-beijing`，**火山 V4 签名**（与 AWS SigV4 同构，terminator=`request`，
  签名头 `content-type;host;x-content-sha256;x-date`）。
- 鉴权确认：新建的 IAM 子用户 `ideahub-ark-api`（仅 `ArkFullAccess`、只编程访问）**签名一次通过**——
  失败会是 403/SignatureDoesNotMatch，而实际是接口在逐字段教 schema，等于完全接受这对钥匙。
- `ListAuthorizationAssetGroup` 的入参 schema（摸出来了）：`{ Filter: { AssetOwnership: "All" } }` → **HTTP 200**
  `Result: { Items[], TotalCount, PageNumber, PageSize }`。`AssetOwnership` 是**枚举且大小写敏感**，
  实测只有 **`"All"`** 收（`Owned`/`Authorized`/`Self`/`owned` 全报 `InvalidParameter`）——
  别猜别的值，接的时候直接写 `"All"` 再在客户端按 `Items[].` 的字段筛归属。
- **两个 Action 的入参 schema 都摸通了（2026-08-27，逐字段实证）**：
  - `CreateAuthorizationUUID`（生成邀约）：必填 `Validity`，形状是
    **`{ Validity: { Start:<秒级时间戳>, End:<秒级时间戳> } }`** → 200 `Result: { UUID }`。
    ⚠ Start/End 只收**秒级 Unix 时间戳**（日期串 `"2026-08-27"` / datetime / ISO8601 / 毫秒 全报
    `InvalidParameter.Validity.Start`）。返回的 `UUID` 就是拼邀约 H5 链接的那一段
    （二维码指向 `ark.volcengine.com/region:cn-beijing/mobile/livenees-face-manage/…?…UUID…`，
    确切 query 参数名等接 UI 时用一个真 UUID 拼出来核对）。
  - `ListAuthorizationAssetGroup`（查授权状态/asset id）：`{ Filter: { AssetOwnership:"All" } }`
    → 200 `Result: { Items[], TotalCount, PageNumber, PageSize }`。`Items[]` 的字段要等**真有
    授权入库**后才看得到（现在 TotalCount:0）——接 app 轮询前用一条真授权把 `Items[].` 的字段
    （asset id、状态、演员名）抠出来，别猜。
- ⇒ **「app 内授权」这条路成立**：server 用 AK/SK 直调即可，不依赖控制台登录态。
  密钥进 server `.env`（`VOLC_AK`/`VOLC_SK`，已配好、已 gitignore、绝不进 app 包）。

**✅ 已开工（2026-08-27，server 一半 + app 骨架）**：
- `server/src/services/arkOpenApi.service.js` —— 火山 V4 签名的**唯一实现**（AK/SK，
  区别于 arkGateway 的 API Key 推理网关；这套不烧 token、不进钱包）。封装
  `createAuthorizationInvite` / `listAuthorizationAssetGroups`。**端到端活测通过**
  （真 AK/SK → 200 → 拿到 UUID）。
- `server/src/routes/arkPortrait.routes.js` —— `POST /api/ark/portrait/invite`（生成邀约链接）、
  `GET /api/ark/portrait/groups`（查授权/asset id）。全 requireAuth；未配 AK/SK 回 503 让 app
  退回手填；火山业务错原样透出（502 + 火山 Code/Message）。
- `preflight` 加了 AK/SK **半配自检**（只配一个 → 生产起不来，同 QQ 那条）。
- `tests/arkPortrait.spec.js` 6 例：401 / 503 未开通 / days 上限 / "签了名但没真出网 + 头形状" /
  业务错透传 / **V4 签名可复现**。107/107 绿（含既有三套）。
- `app/src/api/portrait.ts` + 详情页「🪪 方舟可信素材」区加「🔗 在 app 内发起授权」骨架：
  生成链接 + 复制（发给本人打开）+ 查状态。手填 asset ID 退路保留。

**⚠ app UI 现在是骨架，两处等真机核对后补**（都在 docs 里标了）：
- ~~二维码渲染~~ **已完成（2026-08-27）**：从控制台真二维码抠出并核对了链接格式 ——
  `https://ark.volcengine.com/region:cn-beijing/mobile/livenees-face-manage/**index**?uuid=<UUID>`
  （此前服务端少了结尾 `/index`，已修；query 名 `uuid` 猜对了）。加了零传递依赖的
  `qrcode-generator`，`components/QrCode.tsx` 自己画 SVG 格子（白底黑点写死不吃主题色 ——
  对比度是功能）。详情页「发起授权」现在出真二维码 + 复制链接双通道。
  **✅ 2026-08-27 真机实测通过**（debug 包装机 + 真登录态 + 打生产 api.ideahubs.org）：
  详情页点「🔗 在 app 内发起授权」→ 服务端签名调火山 → 拿真 UUID → **二维码在真机上渲染出来**
  （viewBox 49 = 45 模块 + 2 格静默区、1046 码点、白底黑点），链接为核对过的
  `/index?uuid=…`，「复制链接 / 查授权状态」两颗按钮就位。截图留证。
  ⚠ 真机测顺带修掉一个文案 bug：JSX 里写了 Markdown `**加粗**`，星号原样显示给用户了
  （JSX 不渲染 Markdown）——已改 `<b>`。
- ~~「本人就在这台手机上」不用第二台机~~ **已完成并真机验过（2026-08-27，release 包 v2.28(39)）**：
  从"造一张真人卡"到"火山那一页出现在屏幕上"整条**零第二设备**跑通了 ——
  工坊「从视频提取卡片」→ 勾「画面里是真实人物」+ 肖像同意 → 存卡 → 详情页
  「🪪 方舟可信素材」区出现 → 「🔗 在 app 内发起授权」拿到真 UUID
  （`d8d0bfb7-…`，有效期 1 年）→ 点「📱 就是我本人 · 在这台手机上完成授权」→
  **Chrome Custom Tab 打开火山「扫码上传人像资产」那一页**（`Browser.open`，
  `CustomTabActivity` 已确认在前台），页面正常渲染出登录弹层。
  同屏还顺带验了两条：`GET /portrait/groups` 在真机上 200 且如实回
  「还没有已授权的素材——请本人扫码/打开链接、完成活体认证与授权后再查」（不是静默空白）；
  肖像分享闸生效 ——「分享到创意工坊」灰掉并写明「这张卡声明过是真实人物…肖像授权只覆盖你自己使用」。
  ⚠ **仍未验（且只能由本人做，不该由工具代做）**：火山那一页的**手机号登录**与**活体人脸认证**。
  ⚠ 待观察：H5 底部那颗 CTA 写的是「扫码上传人像资产」—— 带着 `?uuid=` 进去、
  登录后到底是直接续上这条邀约，还是仍要再扫一次码，**登录后才看得到**。若是后者，
  「就是我本人」这条路要改成"本机扫自己屏幕上的码"以外的走法，文案也得跟着改。
- ~~**授权完成后自动绑定 asset id**~~ **已完成（2026-08-28，用真授权抠出字段后接的）**。
  这一发探针纠正了一个从头错到尾的假设：

  **★★ 组 ≠ 素材，是两层**（此前一直当成一层，`asset://` 差点就拿组 ID 去拼了）：
  - `ListAuthorizationAssetGroup` → **组**：`Items[] = { AssetGroup:{Id:"group-20260828131552-jlbz5",
    Name,GroupType:"LivenessFace",ProjectName,CreateTime,UpdateTime}, Status:"Authorized",
    Validity:{Start,End}, AccountType:"Company", CompanyName, CreditCode, AssetOwnership:"SelfUploaded" }`
  - `ListAssets` → **素材**（出片要的那个）：`Items[] = { Id:"asset-20260828131637-4872q", Name, URL,
    AssetType:"Image", GroupId, Status, Error?:{Code,Message}, Moderation:{Strategy},
    CreateTime, UpdateTime, ProjectName }`
    入参必填三件：`Filter.GroupType:"LivenessFace"` + `PageNumber` + （`PageSize` 不给走默认 10）；
    `Filter.GroupId`（**单数**）生效。
  - `GetAuthorizationAssetGroup{GroupId}` / `GetAssetGroup{Id}` 也存在（单组详情）。
  - 不存在（全 404 `InvalidActionOrVersion`）：`ListAuthorizationAsset(s)` / `ListAsset` /
    `ListAssetGroupAsset` / `ListLivenessFaceAsset` / `DescribeAuthorizationAssetGroup`。
    ⇒ 找 Action 名的手法记一下：**空 body 打一发**，不存在回 404 `InvalidActionOrVersion`、
    存在但缺参回 400 `MissingParameter.X` —— 一发就能把名字和必填参数一起问出来。

  **⚠⚠ 组 `Authorized` ≠ 有素材可用**，而且这正是第一次真授权的结局：两个组都 `Authorized`，
  素材却只有 1 份且 `Status:"Failed"`、`Error.Code = InputImageSensitiveContentDetected.PolicyViolation`
  （"输入图片可能涉及版权限制"），另一个组里 0 份。**只看组就是"看起来成了、其实一张都不能用"**
  —— 老的「查授权状态」正是只看组，会回一句"已有 2 条已授权素材，去控制台复制 ID"，
  而控制台里根本没有可复制的可用 ID。已改成只认 `assets`。

  **⚠ `Validity.End` 回来是 `253399593600`（≈9999 年 = 永久），不是我们建邀约时给的一年。**
  原因 2026-08-28 在火山那一页上看到了原文，不用再猜：
  > 扫码账号与授权账号一致，已识别为**自有操作**，授权**立即生效**，有效期由
  > "2026年8月27日 - 2027年8月27日"**变更为永久**。若无其他授权逻辑，您可随时从控制台手动删除。

  ⇒ ① **自己授权自己**时，我们传的 `days` 会被火山**直接改成永久**，而且**立即生效、
  不经过"接收"这一步**（这也解释了为什么 `Accept*` 系列 Action 一个都探不到 ——
  这条路上根本没有那一步）；② 所以 app 里那句「授权有效期至 X」**只对"授权别人"成立**，
  自己授权自己时它是错的。⚠ 现在 UI 上还是照 `invite.endSec` 写死那一年 —— 已知不准，
  但**修不了**：邀约刚发出去时我们并不知道扫码的会是本人还是别人。要做对只能等
  `groups` 回来之后按真实 `Validity.End` 显示（TODO，与"过审素材的状态串"一起补）。

  **⚠ `Status` 只见过 `"Failed"`**（还没有一张过审的），所以可用性一律**判否定**
  （`assetUsable = status !== "Failed"`，`api/portrait.ts` 唯一实现）。等真有一张过审的，
  把成功那个字符串补进注释。

  落地：server `listPortraitAssets` + `GET /api/ark/portrait/assets`（**白名单挑字段，
  把签名 TOS 直链挡在服务端** —— 那是真人肖像原图，`X-Tos-Expires=41400`）；
  app 的「查授权状态」四种结局各说各的：正好一份可用 → **自动绑**；多份 → 列出来挑；
  一份可用的都没有但有失败的 → **把方舟的原话摆出来**；一条都没有 → 再问一次组，
  分清"还没授权"与"授权了但没传素材"。spec 加 2 例（入参三件套 + "原因透出 & 直链不许外泄"）。

- **⚠⚠ `ListAssets` 对不认识的 `Filter` 键静默忽略**（2026-08-28 补探，**先写错过一次**）：
  `AssetType:"__bogus__"` / `Status:"__bogus__"` 都照样 200 + 全量返回，不报错。
  ⇒ 按组过滤**只有复数 `GroupIds:[…]` 生效，单数 `GroupId` 是被忽略的**。
  写成单数的后果零报错：「按这个组查」悄悄返回了**所有组**的素材，拿去自动绑就可能把
  **别人那份肖像素材**绑到这张卡上。
  ★ 更值得记的是**当初为什么判错**：验证时拿的是"唯一那份素材所在的组"，而**生效与被忽略
  在这种测法下结果一模一样**——那不是证据。改用**空组**（结果应该为 0）才定案：
  | 条件 | TotalCount |
  |---|---|
  | 只给 GroupType（全量） | 1 |
  | `GroupId` = 空组 | **1**（被忽略） |
  | `GroupIds` = [空组] | 0 |
  | `GroupIds` = [有料组] | 1 |
  ⇒ 给这个 Filter 加任何新键，一律拿**"结果应该为空"的反例**证一遍。

- **枚举值问不出来**（试过，记下省得再试）：给 `GroupType` / `AssetOwnership` 传非法值，
  火山只回 `InvalidParameter.X is invalid`，**不列合法值**。

- **「接收授权」的 Action 仍未抓到**：`Accept/Reject/Confirm/Audit/Review + Authorization…`
  等 10 个候选**全部 404**。猜名字这条路已经走不通 ⇒ 等真有**别人**授权给本账号时，
  从控制台的网络请求里抓（`console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/<Action>`）。
  ⚠ 本账号目前是自己授权自己（`AssetOwnership:"SelfUploaded"`），根本走不到那颗按钮 ——
  也就是说**自己给自己授权不需要"接收"这一步**，这条路现在是通的。

- ~~过审的素材长什么状态~~ **已实证（2026-08-28）：`Status: "Active"`**
  （`asset-20260828141416-5zb5l`，`AssetType:"Image"`）。可用性判据仍然**判否定**
  （`assetUsable = status !== "Failed"`）—— 现在知道成功值叫 Active，但别改成
  `=== "Active"` 白名单：处理中/审核中那些状态串我们还是没见过，白名单会把它们
  一律判成不可用。

- **⚠⚠ 出片前置：方舟账号必须开通「Asset Service」，否则 `asset://` 整条 400。**
  2026-08-28 拿真 asset id 直连方舟出片（hd / `doubao-seedance-2-0-mini-260615`，
  `reference_image` 带 `asset://`）拿到的原话：
  > `InvalidParameter` · `content[1].image_url.url` … `Your account has not activated
  > the Asset Service. You may activate it at https://console.volcengine.com/ark/
  > region:ark+cn-beijing/openManagement?…&tab=ComputerVision`

  两条结论：
  ① **`asset://` 这个形状是被认的** —— 报错是"服务没开通"，不是"参数看不懂"，
     也就是说请求体拼对了（`{type:"image_url", image_url:{url:"asset://…"},
     role:"reference_image"}`）；
  ② 这是**账号级开关**，和「开通 2.0 系列模型」是两件事，要在**开通管理 →
     ComputerVision** 那一页单独开。⇒ 归到"部署前置"里，与 keystore、
     `public/models/protected/` 同一类：不开就是**每一次**真人卡出片都 400。
  ★ 失败是**同步 400、未受理、不扣费**，且报错点名了参数与开通地址 —— 这一发探针
    因此是**零成本**的。
  ⚠ 那句报错对**终端用户**没有意义（控制台是我们的账号，他打不开也开不了）。
    真要给用户看，得翻成"平台侧未开通"，别把控制台链接原样甩给他
    （CLAUDE.md「界面上摆一个用户看不懂也做不了事的东西」）。目前**没做**这层翻译 ——
    开通之后这条错基本不会再出现，不值得为它现在加一处映射；等真撞上再说。

- ✅ **整条链路已跑通（2026-08-28）**。开通 Asset Service 后同一发请求 **200 → succeeded**：
  - 任务 `cgt-20260828142756-2ngg4`，`doubao-seedance-2-0-mini`，720p / 9:16 / 5s / 24fps，
    `generate_audio:true`，约 **85 秒**出片，回 `content.video_url`（TOS 直链，`X-Tos-Expires=86400`）。
  - `usage.completion_tokens = 108,900`。按控制台该模型「不含视频输入 0.0092 元/千tokens
    （折后价）」折算 ≈ **¥1.00 / 5 秒**。
  - 请求体就是 app 那份：`{type:"image_url", image_url:{url:"asset://asset-…"},
    role:"reference_image"}` + 提示词里按「图片1」点名（**没写 asset ID 原文**）。
  ⇒ 「真人卡 → 本人授权 → 绑 asset → hd 档出片」这条**官方合规路**从头到尾成立，
    不再有未验环节。

  **开通那一步的记录**（别人接手时会问）：控制台 → 开通管理 → 右上角
  「开通素材资产库权限」→ 勾《素材资产功能使用规则》。⚠ 那份规则里有两条要知道：
  ① **自定义/授权素材**：使用方**承诺**合法享有权利或已获充分授权，权属瑕疵导致火山被
     第三方追责时**火山可向使用方追偿全部损失**；
  ② **参考素材**（火山预置虚拟人像库）生成的内容**仅限"模型效果体验和内部使用"**，
     未经书面同意不得他用 —— ⇒ **§1.1 的「路 B 预置虚拟人像库」按此条不能用于对外产品**，
     那条路到此为止，别再把它当备选。

**动工前置（按顺序）**：
1. ~~建 AK/SK~~ **已完成**（子用户 `ideahub-ark-api` + `ArkFullAccess`，密钥在 server `.env`）。
2. ~~只读探针~~ **已完成**（见上，200 通过）。
3. ~~摸 `CreateAuthorizationUUID` 入参~~ **已完成**（`Validity:{Start,End}` 秒级时间戳 → `{UUID}`，见上）。
4. 「**接收授权**」那一步的 Action 还没抓到（要等真有人扫码授权后控制台才出现那颗按钮）——
   接收前先抓它，别猜名字。
5. ToS 面：正规网关格式、非逆向私有接口，但**未见公开文档** ⇒ 接受"可能变动无通知"，
   凡调它的地方都要能整句报错并退回"去控制台手工操作"（铁律八）。

### 1.5 产品形态（仓库主人 2026-08-24 拍板，仍然有效）

- 仍是一张**人物卡** + 一枚「真人认证」标记；**默认不可分享、不可发布市场**（资产绑在我们账号下，被授权人授权的是"给这个账号用"）。实现是**一道闸**（`shareBlockReason` / 发布路径 / 卡组快照三处，判据唯一实现）。
- 授权态设计成**枚举**（`private` / `public`）而不是布尔 —— 将来放开"形象公开化"时，存量数据才分得清"没授权"和"只授权了自己"。
- `asset://` 持有者**按账号存**（`ownerVolcAccount`），别写死成平台账号 —— 将来让用户绑自己的火山账号时才不用迁移。
- ⚠ 新增约束（这次读文档才知道）：**授权有效期是创建资产组时设的**，会过期；而且**被拍的人自己也要有火山账号**。后者是真实的产品摩擦，写文案时别把流程说得比实际轻松。

## 2. 提示词方案市场（已完成，留几条约束）

三件剩余项 2026-08-24 全部做完：**自建方案编辑屏**、**预览示例图**、**远端共享市场**
（server 的 `PromptScheme` + `/api/branch/schemes`，6 例 spec）。

⚠ 后续改这块时不能破的三条：
- **市场不得按"绕过真人检测的成功率"排序或标注**——那会把中立工具变成主动帮凶
  （design doc §B2）。`faceless` 只描述**产出形态**，排序键也只有它 + 更新时间。
- **预览示例图不得是真人**（判据唯一实现 `promptSchemes.exampleIssue`）。
- **`data/promptSchemes.ts` 必须保持叶子**（只依赖 types）。联网那半边在
  `data/schemeMarket.ts`：promptSchemes 一旦 import videos 就成环
  （videos → account → mock/ai → promptSchemes），Vite 下拿到半初始化模块。

## 2.5 造卡侧改版（2026-08-28 仓库主人拍板，Phase A 已落地）

主人实测「自己传图做卡片」后点名的缺口 + 新设计。拍板两条：**详情页授权区删掉、
只留"真人卡 + 没绑上"时的窄条修复入口**（授权异步：本人可能隔天做完、照片还会被审核拒，
没绑上的卡要有就地修的地方）；**节点自定义分期**——先纯帧，示例视频（要动 server r2v
计费闸）下一批。

**Phase A 已完成（同日，浏览器逐项验过）**：
- **「自己传图做卡片」接上方案体系**：人物卡的图位不再写死三格，由所选方案定
  （与提取那条路同一套方案库；此页不出图，方案只定结构）。人物卡图位按 **tag** 键存
  （`schemeShots`），与非人物卡的 kind 库互不相通 —— 涉及人物卡的换卡种**什么都不丢**。
  换方案时 tag 对得上的留、对不上的取下**并说明**（与 changeType 同一条纪律）。
- **真人授权挪进造卡流程**：`components/PortraitAuthPanel` 抽成**唯一实现**（回调制——
  造卡时卡还没有 id，面板只交出 assetId，落库时机宿主定），三处宿主：自己传图、
  从视频提取（勾真人当场做）、详情页窄条。pendingAsset 与声音样本同规则：
  **addCards 成功后才落侧库**（卡没入库就是孤儿）；换下一张卡时清掉（把 A 的肖像绑给
  B 的卡是事故）。
- **详情页 CardAssetSection → 窄条**：只在「真人卡 + 自己的 + 还没绑上」时出现，
  绑上整块消失。**绑定后无解绑入口是有意的**（拍板"绑上即消失"）——真要换绑等真实需求。
- **无脸主推落到默认值**：`promptSchemes.defaultSchemeFor({realPerson})` 唯一实现 ——
  勾真人且用户没亲手挑过方案时默认切无脸；亲手挑过的**不动**（主推≠强制）。
  两处宿主（自己传图 / 提取）同规则。
- **跟读录音**：`components/VoiceRecorder`（长按录、照示例词念、松手停，2~15s 窗口）。
  WAV 编码抽到 `utils/wav`（提取抓音与麦克风跟读共用，**唯一实现**）。
  ⚠ **要新出包才能用**：`RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` 这次才进 AndroidManifest，
  **老包（versionCode ≤40）上跟读永远拿不到麦克风**（Capacitor 的 WebChromeClient 只在
  清单声明了才弹系统授权，否则静默拒）——录音报错文案专门写了这一情况。
  示例词刻意与产品无关（句子带品牌词/台词会被 AI 当成"这个人说过"串进成片）。
- **素材原图刻意不从服务端代取**（造卡页只提示"照片就在你相册里，再选一次"）：
  那条签名直链指向真人肖像原图，而**组↔用户目前无法归属**（§1.6）——代理开给所有
  登录用户等于把每个授权人的照片发给任何账号。等按用户归属做出来再考虑。

**Phase B 已完成（2026-08-28，纯帧版·三面浏览器实测）**：节点「自定义直出」。

**核心设计（为什么它几乎没动生成侧一行）**：帧本来就挂在 `Proposal` 上、`genNode` 只认
`chosenOf(node)` —— 所以「自定义」= **一条用户亲写的单方案**，不是新结构。
`FlowNode.custom` 只是个车道开关（与真人档 `flatTier` 直出同形状的第三车道），
genNode / nodeCost / clampCursor / 承接 / segmentGen **零改动** —— 帧给得越全报价越低
（缺的帧 AI 按提示词补画照价），这是 `segmentCost(hasFirstFrame/hasLastFrame)` 本来的行为。

- **flowStore.setNodeCustom（FlowNode.custom 唯一写点）**：三道闸实测过 ——
  生成中拒、已出片拒（改帧不改成片，还会把下一段的承接帧换成假的：`nodeCarry` 读的
  `chosenOf(prev).lastFrame` 出片时已被真实尾帧顶替）、套着模板拒（指去「摘掉模板」，
  不静默替人摘）。开启时 `tpl` 顺手钉成**明确 null** + `pinUnstatedTpl`（自定义段绝不许
  被 store 级模板兜底认成白模段——那是「真把参考视频发给方舟」的入口）；方案台若正摊着
  就收起，**已推演的方案保留**（花过钱的）。
- **帧写入走 `setFrame`（既有唯一实现）**：pinned 上锁、上传首帧自动断承接（chain:false）、
  清帧语义全在那边，第三车道没抄第二份。
- **工作流画布**（NodePanel 第三车道）：勾「✍ 自定义首尾帧」→ 帧格×2（传图/清掉/融图）+
  承接状态照实说 + 时长 3/5/8/10（低于档位 minSec 的禁着并写原因）+ plot 直写 + 直出按钮
  （价 = nodeCost 同一把尺）。融图 = 既有 FuseFrameSheet（候选 fuseSourcesOf 唯一实现）。
- **简约**（NodeScreen 折叠条）：「🖼 自定义首尾帧（选填）」，与画布共用
  `components/flow/CustomFrameSlots` 一份 markup。给了帧与「直接用卡片形象出片」互斥
  （方舟首尾帧不收参考图同发）—— 界面明说，判定仍是 nodeRefOn 一处。
- **工坊**（studioStore.layCustomNode + 投影窗）：编辑器的 FrameCard 接上**尾帧上传**
  （endFrame），新按钮「✍ 直接生成方案（跳过推演·免费）」把帧+要求铺成一张**已选定
  单方案**的节点卡（锚点/挂载规则与 generateNode 逐条相同，但同步、零 AI 调用、零扣费）；
  出片仍走方案台那颗「炼这一段视频」。⚠ 顺带打开了一条此前的死路：**真人档（flatCost）
  在工坊走不了推演**（deriveIssue 拦），现在可以从这条免费直铺进方案台出片。
- **「中间帧」的形状**（按设计映射落地，没有新参数）：方舟单段只有 first/last_frame ⇒
  N 张关键帧 = 逐段铺（每段自定义尾帧 = 下一个关键帧），相邻段靠既有「真实尾帧承接」
  无缝。多图合成一张边界帧 = 融图（首尾帧模式不收参考图同发，方舟同步 400）。
- ~~示例视频分期~~ **已做（2026-08-28 主人点名提前）**：r2v 第三条合法来源「用户素材
  参考视频」全链上线 —— server：MaterialRefVideo 登记表 + /uploads/material-video/register
  （复用模板直传三件套；时长服务端向 Cloudinary 取回写死）+ resolveR2v 分支三（素材私有、
  reference 子任务专属钉子：omni ∈ {缺省,"reference"}、duration 3~10 有限数、720p）+
  tokens.materialRefTokens = (输入[4,30]+输出[3,10])×21600×2.8（arkProxy spec 79/79）。
  app：economy.materialRefCost 逐字镜像；flowStore.customRef（挂/摘视频、中间帧参考图
  上限 CUSTOM_MID_MAX=2）；segmentGen 素材产线（用户帧转存 https 后当 reference_image，
  customRefPrompt 唯一实现地点名「图片1是第一帧画面…」——**软引导不是硬承诺**，文案不许
  说成保证）；arkClient refTask:"reference"。画布自定义车道：真上传格（直传分块+进度+
  登记）、挂上后中间帧=同段参考图、没挂时中间帧=拆段——两种语义 UI 里分清。
  ⚠ 尚未花真钱端到端出过一发（形状全对、闸门与计价 spec 钉死）；首发时顺带核账单。

**Phase C 已完成（2026-08-29/30 两拍，浏览器实测）**：

- **成片圈选改片进工坊/工作流**（debf435）：SegPlayer 从 FlowCanvas 抽成共用组件
  （回看 + 抓帧 + FrameAnnotator 圈选），工坊投影窗方案卡加 ▶ 圈选入口——两面同一份
  实现，圈选标注挂 `node.anns`、genNode 消费（逐处 refineFrame + 要求并进提示词），
  报价并进 nodeCost（annRedrawCost，与实扣同一把尺）。
- **自定义车道「示例视频优先」翻页**（debf435）：画布 NodePanel 与工坊编辑器都拆出
  第一页 = 传示例视频（不传的文字键刻意做小当附庸）；传了自动截首尾帧
  （utils/videoFrames，媒体事件全带超时——后台窗口那坑）+「🎞 调节首尾帧/加中间帧」
  开 RefFrameSheet 拖拽取帧；没传退回纯帧页。
- **「自己传图做卡片」人物卡拆四步向导**（e0b7018，主人点名）：①选来源（自传图不花钱
  / 传素材 AI 逐格生成，价印按钮上）→ ②图位预览（⭕圈选改图 = Seedream i2i 单张价，
  失败不扣）→ ③人物信息（AI 车道连 name/summary/info/tags 一起按素材写好，chatVision
  一跳，解析成功才扣）→ ④定名铸卡。图位数量随方案走：**fromCrop「原片截图」格从本页
  去掉**（那格只在视频提卡路上是对照物）——全身立绘+面部特写 2 格、白模三视图/规格图
  各 3 格。非人物卡保持单页流。两条车道浏览器端到端实测（AI 车道真花了一发：两图 + 文案
  全按素材落，成卡即详情页）。

## 2.7 卡片系统 ↔ 出片管线兼容性审计（2026-08-28，主人点名的调研）

**结论先行：五种卡都真实参与出片，但参与深度差很大；发现一处提示词自相矛盾（P1）、
一处 UI 承诺与实现不符（P1）、两处可放宽的自设限制（P2）。**

### 各卡种现状矩阵（读代码得出，非猜测）

| 卡种 | 图 → Seedream（画首尾帧） | 图 → Seedance（视频） | 文字 → 提示词 |
|---|---|---|---|
| 人物卡 | face→body 最多 2 张（方舟指南：多视图加剧 ID 漂移），绑定句锁形象 | 仅三条参考图路：简约 refMode / 白模 r2v（≤30 张紧凑绑定）/ 素材参考；**经典首尾帧路一张都不发**（方舟三场景互斥，协议使然非缺陷）。真人卡走 asset://，声音样本仅 refMode+有声档 | `materialText`：名字+简介前 40 字 |
| 场景卡 | 1~2 张，绑定句=「定场参考：空间结构一致，光线天气跟剧情走」 | 同上三条路 | 同上 |
| 背景卡 | 1~2 张，绑定句=「只取色调光比光向，别画成物体」 | 同上 | 同上 |
| 道具卡 | 1~2 张，绑定句=「实物参考」；同卡多图并进一句（防"两件罗盘"） | 同上 | 同上 |
| 风格卡 | 1~2 张，绑定句=「只沿用笔触/上色，别画内容」——**但见 P1-a** | 同上 | 同上 |

预算：经典路总共 `MAX_REF_IMAGES=3`（自设启发式）；白模路 `ARK_REF_IMAGES_MAX=30`（2.5 协议）。
`display` 图位（三视图/规格图）全线硬排除——正确，别动。

### 发现的问题

- **P1-a【已修 2026-08-28，frameArtStyle】风格卡在方案台被写死画风词顶掉**：`real.ts framePrompts → frameStyle → STYLE_SUFFIX`
  给**每一张**方案首尾帧拼「二次元厚涂插画风」，而挂了风格卡时绑定句同句在说「只沿用
  〈图片N〉的画法」——两句打架，模型挑一句听，实际听谁没保证。卡面铸造那侧 2026-08-11
  已修过同一件事（`cardStyleSuffix` 对 style 卡不拼画风词），**帧管线漏了**。
  修法：`materials` 里有风格卡时 `frameStyle` 不拼 `ART_STYLE`（或换成「画风严格跟随
  画法参考图」）。`generateCover`（补帧路）措辞中性，无此问题。
  【同日二改，主人追加拍板】默认厚涂**整个去掉**：四档判定 = 风格卡点名 > 真人写实 >
  挂了带图的卡且真发了图 →「画风严格跟随参考图」（与 promptSchemes STYLE_CLAUSE 同一条
  产品规则）> 什么都没挂 → 只留质感词不注明画风（纯文字首段两帧可能各画各的——主人
  明选"让模型自己定"）。refsOn 参数保证"跟随参考图"只在真发图时说。
  【同日三改】**卡面也跟素材走**（ART_STYLE 常量整个退役）：cardStyleSuffix 只剩质感词；
  forgePrimary 有用户素材图时拼 STYLE_FOLLOW_REF（照片→写实卡面、插画→同风格）；
  forgeSlots 后续图位「画风与〈图片1〉完全一致」；mintCards 加 styleRef 入参——派生卡组/
  视频提卡/模板提卡把**成片真帧**（中段帧）当画风参考 i2i（STYLE_FOLLOW_MINT：要笔触
  上色不要内容；5.0 首张输入图不加价；白模路提卡本就整段跳过，灰白模帧进不来）。
  纯文字铸卡（无任何素材）不注明画风。⚠ 塔罗金框/题名条是 UI 层叠加，不受画风影响。
- **P1-b【已修 2026-08-28，Card.idLine——方案与出处见 §2.9】`genPrompt`（「〈类型〉信息」，≤500 字）出片时一个字都不读**：详情页/造卡页对
  用户说「AI 复刻这张卡的画面时会读这段，写得越具体越像」，实际出片提示词里每张卡只有
  名字+简介 40 字（`materialText`）；genPrompt 唯一的消费方是详情页展示。两条修法二选一
  （或并用）：① 出片时给 hero 卡的 genPrompt 留 60~80 字额度（400 字硬顶下塞不进全量，
  且截断从正文头下刀——动之前先算好 room）；② 把 UI 那句承诺改成如实的（它主要影响
  铸卡时的图位质量，出片靠的是图）。**别不改**：这是铁律五形状的承诺落空。
- **P2-a【已放宽并实测钉住 2026-08-29】简约 refMode 预算沿用了 Seedream 的理由**：
  refMode 的图直接进 Seedance，却按「Seedream 画一张帧塞不下多主体」的启发式砍到
  3 张——挂第 2 张人物卡的用户拿到的是模型瞎编的脸，钱照付零报错。已改为 multiChar
  式直通分配（每人物卡 face+body、其余各 1 再补第 2 张），上限按**档位协议**走：
  `VideoTier.refImagesMax`（hd 的 2.0 系 9 张 / ultra 的 2.5 是 30 张）经
  `prepareMaterialRefs` 新的 `direct` 参数传入；白模照旧 `strict`（人物卡零图整句拒），
  refMode 传 `strict:false` 保住既有降级（零图改画设定帧并说明——它的提示词里还有
  素材设定文字兜底）。付费一发钉住（design/p2a-refmode-budget.mjs，≈¥2，任务
  cgt-20260829121121-d92dq）：① 2.0-mini 收 5 张 reference_image 受理成功（协议 9 张
  上限的实证半发）；② `completion_tokens=108,900` 与 2 图那发（ab-bind-syntax）**逐位
  相同**——参考图张数不进计费，报价侧零改动成立；③ 抽帧比对：两位人物卡（银发金星
  发夹披风少女 / 黑发狐面暗红和服青年）+ 道具灯笼（六角青光波纹）各归各位、零串脸，
  老预算下进不了模型的第二位身份完全锁住。卡详情页「取舍规则」同步补上第二条例外路。
- **P2-b【已随 P1-a 三改一并了结 2026-08-28】方案台帧画真人卡会被动漫化**：`framePrompts`
  的厚涂词对真人照片参考同样生效。现有产品答案是"真人出片走 MiniMax 档或 asset://
  refMode"，首尾帧承接路本来就不是真人主路——当时记录在案，建议"修 P1-a 时顺手让
  「有真人卡」也压掉画风词"。P1-a 三改把默认厚涂**整个退役**后这条自动成立：
  frameArtStyle 四档里 realPerson 是第 2 档（真人 → 照片级写实），厚涂词已无处生效。

### 结论：卡片内容要不要改形状贴合 Seedance？

**不用加新字段/新卡种。** Seedance 2.5 能吃的素材（参考图/首尾帧/参考视频/音频样本）
卡片系统全都有对应承载：views（face/primary/aux 角色分工）、voice、asset://、模板 refVideo、
素材参考 materialRef。缺的不是形状，是上面 P1 两条的**接线质量**。
「运镜/特效」这类平台流行的玩法维度，落点应是**模板市场的分类与预设**（见 2.8 外部对标），
不是第六种卡——新卡种是跨仓改动（server zod/迁移/UI 三处），而运镜本质是提示词片段。

## 2.8 外部对标：模板/玩法/Skill 体系（2026-08-28 调研，底稿见 platform-template-survey-2026-08.md）

**主人点名的两个平台都是真的**：LibTV = 哩布哩布（LiblibAI）2026-03 发布的视频创作平台
（无限画布+节点工作流+Agent Skill 包，聚合 Seedance/可灵/Wan）；updream = B 站官方创作
助手（技能广场 + "/" 唤起技能 + 长记忆画布，付费档接 Seedance 2.0）。加上即梦、可灵，
2026 年头部全部收敛到「画布/逐段工作流 + 可复用封装物（技能/模板）+ 多模型报价」——
**我们的"卡组+模板+方案市场"结构不落后，缺的是封装物的市场化呈现**。

**「照搬它们的 skill 信息/提示词/封面当我们初始模板」——结论：形可以抄，物不能搬。**
- 可抄（想法/方法层）：分类法（Vidu 的 Love/整活/变身/节日/电商）、模板数据模型
  （PixVerse 的 display_prompt+[SUBJECT] 槽位+GIF 封面+hot/new 角标）、技能卡墙形态
  （Higgsfield 的"名字+动图+一个键"）、做同款闭环（可灵/即梦 = 复制提示词+参数进生成器）、
  运镜受控词表（海螺方括号 DSL，≤3 个叠加）。
- **绝不能搬**：任何平台的封面图/示例视频/GIF 预览、成套提示词库、对方效果名直译——
  条款一律禁爬禁转（即梦 5.3(4)/9.1、PixVerse 禁爬条款原文在底稿），且有**杭州互联网法院
  2021 剪映模板案**在前（短视频模板被认定类电作品，搬进自家 App 判赔）。
- 灰色：**单条**提示词意译重写基本安全（上海黄浦 2025-11 判例：罗列式提示词不构成作品），
  "场景化叙事"的长提示词按作品对待——只取其意、完全重写。
- ⇒ **初始模板一律自产**：封面/示例视频用自己的 Seedream/Seedance 出（管线现成：
  gen-market-cards / gen-scheme-examples 就是这么干的），提示词自己写并留存迭代记录
  （苏州判例：能再现创作过程才攒得下"我们的模板构成作品"的举证）。

十条可执行建议（详见底稿末节；与 §2.7 的 P1/P2 合并排期）：
① 模板登记表补 PixVerse 式字段（槽位化 display_prompt/GIF 封面/角标/价签）——
【2026-08-29 复盘后按"实质已覆盖"结案：GIF 封面 = ④ 的循环视频预览；槽位声明 =
白模 roles（卡面上「N 个角色位可换人」）；display_prompt = recipe.beats 的 {{主题}}
占位 + intro/source；marker 角标补了「新」（七天内登记）——**刻意不做「热」**：模板
互动计数首发是本机的，拿本机数标热是撒谎，等计数上服务端再补；价签在详情页
（报价=实扣那套），卡面减法后不回卡面】；
② 首页流加「做同款」（带模板+提示词+参数进工作流）——【已落地 2026-08-29：
flowStore.remakeNodesOf 纯建料（分段剧本/时长/档位/画幅照抄、plan:"picked" 直出、
requirement 预填可重推演、随片卡组挂每段、**帧一张不带**——抄配方不抄成片）；
入口两处 = 首页底部 chip（与互动 chip 同排不动纵向几何、付费未解锁不给）+ 详情页
整宽键（按当前 P）；**第八条整表覆盖入口**，守卫走 useApplyTemplate 同一份三件套；
seed 被拒时两处各自就地印 err（flowStore.err 只画在工作流页）】；③ 模板市场分类改人话
（情感互动/整活/变身/节日/带货）——【已落地 2026-08-29：types.TPL_CATEGORIES 六类，
货架 chips 按行筛（分段组按组头归类不拆组），分类唯一写路 = 详情页作者工作台
setTemplateCategory（远端先 PATCH /:id/category 成了再落本机三份），存量模板判否定
只在「全部」下出现、作者随时可补】；④ 模板卡片做减法（名称+循环预览+生成键，参数进二屏）
——【已落地 2026-08-29：白模卡面 = 参考视频静音循环自动预览（IntersectionObserver
≥0.6 视口才播、preload=metadata），作者/播放/点赞/简介收进详情页，整宽单键；
白模/角色位/暂时不可用三枚承重角标保留】；
⑤ 方案升级为可分享 Skill（agent 输入条 "/" 唤起）——【交互半已落地 2026-08-29：
AgentBar 魔杖钮/输入 "/" 唤起句式面板（AGENT_PHRASES 与 op 白名单同文件钉死——
只列真办得了的八式，时长/画幅/画质刻意不列：Op 里没有、两档必拒，那是"永远点不动
的选项"的词表变体）+ 我的模板直填「第N段套模板「标题」」（名字打错是被拒头号原因）。
**发布半也已落地 2026-08-29（主人点名）**：技能 = 存了名字的一句 agent 指令
（卡组/参数就骑在句子里，不另立结构），本体 ≤VIDEO_PROMPT_MAX（常量本体挪进
types.ts，data 叶子与 ai 共用一处）。存/发布/装全长在 "/" 面板（SkillPanel）——
用武之地就是输入条，不塞 SchemeMarketSheet；装来的句子仍走 canvasAgent 白名单 +
确认卡，**不多开任何一道闸**。三层照方案市场逐字镜像：server AgentSkill
（(ownerId,skillId) 唯一键、shared 路由先于 /:skillId、装取幂等不覆盖、upsert 不动
published，agentSkillMarket.spec 6/6）↔ api/skills.ts ↔ data/agentSkills（叶子）+
data/skillMarket（remoteOn 唯一开关，离线整区不显示）。已发布的先下架再删
（本机行一删，广场那条就成没人能下架的孤儿）】；⑥ 点名句标准化 @槽位语法——【已验证并落地
2026-08-29，主人点名出的付费 A/B（design/ab-bind-syntax.mjs，hd 档两发同素材同剧情，
各 108,900 tokens ≈ ¥2 + 参考图 ¥0.4）：A=现状长句尾置（267 字）vs B=@槽位紧凑式
前置（176 字），六帧比对身份贴合（银白长发/金星发夹/蓝绿瞳/深蓝披风全锁死）与遵词
**同水平**、计费同价 ⇒ 采纳 B。落地范围只有验证过的那条车道：refMode（简约参考生
视频）的视频提示词改用 bindCompact 前置（构造器与白模 bind 同一个，一处实现），
省约 90 字正文额度、语法与白模统一、契合方舟「重要素材前置」；**Seedream 画帧仍用
长句**（未做 A/B 不动）；白模路本就是紧凑式零改动。§2.9 那条"刀口方向"随本发一并
验掉：前置未见任何劣化】；
（与即梦万能参考/Runway image_N 同构）；⑦ 方案台加运镜 chips（受控词表，≤3 叠加）
——【已落地 2026-08-29，components/flow/CameraChips：文字是唯一真身（chips 亮灭从
文本反推、不加节点字段不进草稿迁移），插的是 Seedance 指南的自然语言措辞，画布
要求/剧情栏两种绑定同源】；
⑧ 模板声明输入槽位并前置校验（缺卡禁用+写明原因，本仓早有同款纪律）——
【2026-08-29 逐条核对后按"实质已覆盖"结案，六道闸全在位且各只有一处实现：
声明 = 货架卡「角色位」角标（④）+ 画布 PickRow 行内「N 个角色位」+ 挂卡钮「已挂 N/M」；
校验 = 选模板时不可用的行内 disable+refVideoIssue 整句、named 空正文生成键灰
+textarea placeholder 指路"先去挂卡"、applyCast 三类整句拒（卡没了/位子被删/重名）、
prepareMaterialRefs 花钱前逐卡门禁（人物卡零图整句拒，第 13 发教训）、部分挂卡的
即兴风险按第 12 发实测写在挂卡面板、agent 路「还没有点名句——先挂卡」。
唯一放行的"零挂卡出片"是手打正文那条 —— 刻意不拦：纯文字换主体（换成一只柴犬）
是合法用法，且要走到那里必须无视 placeholder 亲手打字，不是"忘了"的形状】；
⑨ 初始模板全自产（上面红线的正面版）——【首批已上线 2026-08-29：官方账号「启梦官方」
（support@ 邮箱可重置；钱包与来历见 memory/qimeng-official-account）发布「雨夜递伞」
（emotion，2 角色位）与「三连节拍」（fun，3 角色位）。生产路线（工具+提示词留档
design/gen-seed-templates.mjs，四阶段可复跑）：**t2v 直出白模人偶源片**（¥1/条，省掉
¥9/条的白模化 edit——V1 登记路本来就收"作者自带白模视频"，编舞纪律：一镜到底/
2~3 人/左右站位绝不交换）→ 官方账号走**真实登记链**（签名直传 → createTemplate →
分类 → detect-roles 序数确认[vision 首发可能抖，重试一次即中] → 经 /api/ark 代理
试炼置 provenAt → 发布）——与所有用户同一条状态机，"要样板就发真的"（种子模板
删除时的原话）。两发试炼抽帧全对：雨夜递伞 左凛雪/右玄墨、三连节拍 左中右三位
各归各位零串脸。**第二批同日补齐其余四类**：巷口对峙（story，2 位）、月光变身
（morph，1 位——单角色位实测 ordinalSlots(1)=「最左边」且挂卡全对）、中秋提灯望月
（festival，2 位，赶在 2026 中秋前一个月上架）、新品展示（commerce，1 位近景）——
六发试炼 6/6 全对（变身流光/巨月桂瓣/产品瓶等画面元素全程保留，形象只跟点名走）。
**六个分类每类至少一条官方模板，市场冷启动结案**。两批合计真实成本 ≈¥70
（源片 6×¥1 + 形象图 ¥1.2 + 试炼 6×¥9 + vision；官方账号钱包对账：std 月度 2M
+ addon 2.5M 共注 4.5M 虚拟，余 136,640——虚拟系数 2.8 倍于真实成本，属钱包设计使然）。
后续批次直接往 design/gen-seed-templates.mjs 的 TEMPLATES 表加条目复跑四阶段】；
⑩ 每周一个热点特效的运营节奏——【纯运营，工具已就位（⑨ 的四阶段脚本）；
中秋提灯望月就是第一拍节日档，之后按周挑热点加条目即可。做不做、谁来做等主人排班】。

## 2.9 卡片「设定信息」→ 提示词的分层（2026-08-28 二轮调研 + 当日落地）

**主人点名"学 LibTV 们怎么处理角色信息"的调研结论（关键出处）：**
- 方舟官方（视频生成 API 文档原文）："中文提示词不超过 500 字……字数过多易导致信息
  分散，模型可能忽略细节"；Seedance 2.0 官方指南："主体用 **2~3 个清晰、稳定的静态
  特征**描述""重要素材**前置**""请勿直接将完整剧本作为提示词"。
- LibTV 主体库：建资产时"一键智能生成主体描述（自动拼接到 prompt）"——**没有**让用户
  写长文的入口；即梦「出演角色」= 名字+一句 30 字特征+参考图；火宝短剧（同栈开源，
  12k star）：铸资产时压身份句、出片时角色只以 @名字 出现，外观长文**不进**视频提示词。
- 业界分工共识：**形象靠图，文字只留一句短身份锚定 + 本镜动作**；逐镜**复用同一措辞**
  本身就是一致性手段（Sora 官方 "reuse phrasing"、CHAR 方法论"其余内容一字不改"）。

**当日落地（Card.idLine，2.7 的 P1-b 即此，已修）**：铸卡时豆包随文案**同一次调用**顺带
产出 ≤60 字固定身份句（配方 ID_LINE_SPEC 一处：名字+2~3 个不变的视觉特征+标志物，
性格转神态）；出片时人物卡在 materialText / hero 绑定句里用它（idLineOf 唯一兜底：
老卡退回"名字+简介40字"=原行为）；genPrompt 保留原职（只喂 Seedream 出图），
详情页对两者各自的去向如实分工（那句"AI 会读这段"的承诺落空就此了结）。
搬运点全链：types.Card / api.branch ApiCard+addCards / account.toLocalCard /
WorkshopPage.toLocalShape / server 五处（branchAsset zod + BranchCard + BranchDeck 快照 +
controller 四映射）。**server 侧要随下一次部署上线**——没上线前远端账号存卡会把
idLine strip 掉（app 读侧兜底成老行为，不炸但弱化）。

**刀口方向【已验 2026-08-29，随 2.8-⑥ 的付费 A/B 一并】**：refMode 点名句前置 vs 尾置
两发实测无差（身份贴合/遵词/计费全同水平）⇒ refMode 已改为**点名句前置、素材设定
尾置、截断只砍正文**（segmentGen 的 bindHead/room）。白模 V2 的点名句仍在用户输入框
里（位置由用户所有，不代挪）；Seedream 帧提示词未动。

## 3. 其它（较小）

- **合成成片的 AIGC 角标真机拍照验证**：逻辑上确定（单一 merge 循环，`drawAigcBadge` 两条路径都调了），但没在真机上拍照留证。
- **隐式 AIGC 元数据**：浏览器写不了 webm 元数据，需服务端做（已在 doc 里如实记为 TODO）。
- **Runway 计费未接**：`runway.routes.js` 的 `contentModeration` 已服务端钉死为关，但**计费链路没接** ⇒ **生产环境绝不可配 `RUNWAY_API_KEY`**，配了就是无计量出网。
- **MiniMax H3 档位评估**：评论区反馈 H3 是当前真人向的主流选择之一，值得与现有海螺 2.3 档比一次质量/价格。
