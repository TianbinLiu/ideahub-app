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
- **授权完成后自动绑定 asset id**：`groups` 的 `items[]` 字段名要等真有一条授权入库才看得到
  （现在恒 totalCount:0）。核对后把"查状态"接成"自动把 asset id 绑进卡"。

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

## 3. 其它（较小）

- **合成成片的 AIGC 角标真机拍照验证**：逻辑上确定（单一 merge 循环，`drawAigcBadge` 两条路径都调了），但没在真机上拍照留证。
- **隐式 AIGC 元数据**：浏览器写不了 webm 元数据，需服务端做（已在 doc 里如实记为 TODO）。
- **Runway 计费未接**：`runway.routes.js` 的 `contentModeration` 已服务端钉死为关，但**计费链路没接** ⇒ **生产环境绝不可配 `RUNWAY_API_KEY`**，配了就是无计量出网。
- **MiniMax H3 档位评估**：评论区反馈 H3 是当前真人向的主流选择之一，值得与现有海螺 2.3 档比一次质量/价格。
