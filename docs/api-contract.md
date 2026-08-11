# 分支视频 · 服务端 API 契约（v1）

接入 `ideahub-server`（Express 5 + MongoDB + JWT）。所有响应遵循既有约定：
成功 `{ ok: true, ... }`，失败 `{ ok: false, message }`；鉴权用 `requireAuth` / `optionalAuth`。
挂载点：`app.use("/api/branch", require("./routes/branchVideo.routes"))`。

## 资源模型

### BranchVideo
```
{
  _id, title, category, description, cover,      // cover=图片 URL（Cloudinary）
  clientId,                                       // 客户端幂等键（可选），{author, clientId} 唯一（partial index）
  segments: [{ title, plot, firstFrame, lastFrame, durationSec, videoUrl?, videoTier?, aspect? }],
  // aspect: "portrait" | "landscape"，该段出片时的画幅。**缺省一律按 landscape 读**
  // （画幅可选之前的老数据全是写死的 16:9）。它只是播放端的排版提示——真正的判据是
  // 视频解码出来的宽高，所以服务端**丢掉这个字段不会让画面出错**，只会让首帧解码前
  // 那一瞬按横屏排版、解码后跳一下。videoTier 同理，只是创作侧的档位快照。
  branchTree?: { rootId, startChoices?, nodes },
  author: ObjectId(User), plays, likes, commentCount,
  createdAt, updatedAt
}
```
索引：`{ author: 1, createdAt: -1 }`、`{ category: 1, createdAt: -1 }`、`{ createdAt: -1 }`

### BranchCard（用户卡片）
```
{ _id, owner: ObjectId(User), cardId, type, name, summary, cover, hot?, tags?, createdAt }
```
`cardId` 是客户端生成的稳定 id（市场卡为 `mkt_*`），`{ owner, cardId }` 唯一索引。

### BranchDeck（卡组）
```
{ _id, owner: ObjectId(User), name, cardIds: [String], createdAt, updatedAt }
```

### BranchLike（点赞去重）
`{ user, video }` 唯一索引。

## 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/branch/videos` | optional | 列表。query：`feed=recommend\|following`、`category`、`q`、`cursor`、`limit`(默认 12)。返回 `{ ok, items, nextCursor }`；`items[].liked` 表示当前用户是否已赞 |
| POST | `/api/branch/videos` | required | 发布。body=DraftVideo（title/category/description/cover/segments/branchTree/**clientId**）。**服务端负责把 body 里的外链资源转存**（见下）。带 `clientId` 时按 `{author, clientId}` 幂等：重发返回首次那条、状态码 200（首发是 201） |
| GET | `/api/branch/videos/:id` | optional | 详情（含 comments 前 50 条） |
| DELETE | `/api/branch/videos/:id` | required | 仅作者可删 |
| POST | `/api/branch/videos/:id/play` | optional | 播放计数 +1，返回 `{ ok, plays }` |
| POST | `/api/branch/videos/:id/like` | required | 点赞，返回 `{ ok, likes, liked: true }` |
| DELETE | `/api/branch/videos/:id/like` | required | 取消，返回 `{ ok, likes, liked: false }` |
| GET | `/api/branch/videos/:id/comments` | optional | 评论列表 |
| POST | `/api/branch/videos/:id/comments` | required | 发评论 `{ text }` |
| GET | `/api/branch/cards` | required | 我的卡片 |
| POST | `/api/branch/cards` | required | 批量新增 `{ cards: Card[] }`（按 cardId 幂等） |
| DELETE | `/api/branch/cards/:cardId` | required | 删除一张 |
| GET | `/api/branch/decks` | required | 我的卡组 |
| POST | `/api/branch/decks` | required | 建组 `{ name, cardIds? }` |
| PATCH | `/api/branch/decks/:id` | required | 改名/改卡 `{ name?, cardIds? }` |
| DELETE | `/api/branch/decks/:id` | required | 删组 |

关注沿用既有 `/api/users/:id/follow` 与 `Follow` 模型，不新建。

## 资源转存（关键）

客户端传来的 `cover` / `segments[].firstFrame` / `lastFrame` 可能是 **dataURL**（Seedream 出图落地的 base64），
`videoUrl` 是**火山方舟 TOS 的临时链接（约 24h 过期）**。发布时服务端必须转存：

1. dataURL → 解码 Buffer → `uploadToCloudinary(buffer, "branch-frames", userId)` → 得到永久 URL
2. 方舟 videoUrl → 服务端 `fetch` 下载 → Cloudinary `upload_stream({ resource_type: "video" })` → 永久 URL
3. 已经是 http(s) 且非方舟域的 URL → 原样保留

转存失败的单个资源降级并记录 warn，不阻断整条发布。降级规则视频与卡片**共用一套**
（环境变量 `BRANCH_INLINE_FALLBACK_MAX`，默认 512KB）：小于阈值的 dataURL 原样内联落库，
超过就丢弃置空——否则没配 Cloudinary 时每条记录都带着 MB 级 base64，
`GET /cards` 一次性返回全部卡面会撑出几十 MB 的响应体。

## 账号端点（沿用既有 `/api/auth` 与 `/api/me`，实测口径）

| 方法 | 路径 | body / 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{ username, email, password }`，password ≥ 6；冲突 409。**不接受 displayName**（controller 只解构 username/email/password/role），昵称要注册后补一次 profile |
| POST | `/api/auth/login` | `{ emailOrUsername, password }` —— 字段名不是 `account`；用户名和邮箱都能填 |
| GET | `/api/auth/me` | 只返回登录态字段（`_id/username/email/role/avatarUrl`），**不含 displayName/bio** |
| GET | `/api/me/profile` | 本次新增，对称于既有的 PUT，返回 `username/displayName/bio/avatarUrl/role/createdAt`。缺了它换设备登录后昵称会退回 username |
| PUT | `/api/me/profile` | `{ displayName?, bio?, avatarUrl? }`，返回更新后的 user |

### 登录方式按出口 IP 分流

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/capabilities` | 无需鉴权。服务端用 `detectRegion(req)` 认**请求的出口 IP**，返回 `{ region, country, emailPasswordEnabled, oauthEnabled, phoneEnabled, providers[] }`。大陆 IP 关掉 `oauthEnabled`（Google 在墙内点了只会转圈）；短信通道没真配则 `phoneEnabled=false`（不摆发不出码的死按钮）。可用 `AUTH_FORCE_OAUTH` / `AUTH_FORCE_OAUTH_IN_CN` 强制覆盖 |

★ **客户端不得自行判断地区**：判据（国家库 + 上面两个强制开关）全在服务端，两边各判一次
必然分叉，而且客户端那份还能被随便改。探测失败就退到最小集（邮箱 + 密码）。

### 验证码（authOtp.routes）

| 方法 | 路径 | body → 返回 |
|---|---|---|
| POST | `/api/auth/email/register/start` | `{ email, username, password }` → `{ ok }`。**只发码，不建号** |
| POST | `/api/auth/email/register/verify` | `+{ code }` → `201 { ok, token, user }`，验码通过才真正建号并登录 |
| POST | `/api/auth/email/reset/start` | `{ email }` → `{ ok }` |
| POST | `/api/auth/email/reset/verify` | `{ email, code, newPassword }` → `{ ok, token, user }` |
| POST | `/api/auth/phone/login/start` | `{ phone }` → `{ ok }`。真发短信、真扣费，限流 5/分钟 |
| POST | `/api/auth/phone/login/verify` | `{ phone, code }` → `{ ok, token, user }`，该号没注册过则**自动建号**（登录即注册） |

⚠️ **这几条返回的 `user` 用的是 `id`，不是 `_id`** —— authOtp.controller 里是手写的对象字面量，
与 auth.controller 的 `serializeAuthUser` 不是同一套。客户端在 `api/auth.ts` 里归一，
不要让上层去认两种形状。

### 第三方登录回跳（含 App 深链）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/oauth/:provider?next=<目标>` | `provider` ∈ 服务端 `providers`（google / github）。授权完成后 302 带 token 回 `next` |

`next` 只接受两类值，其余一律被 `safeNextPath()` 打回 `/`：

1. **站内路径**（`/` 开头，且排除 `//`、`/\` 与控制字符）→ 回跳
   `CLIENT_BASE_URL/oauth/callback?token=…&next=<路径>`
2. **App 深链**：**完全等于** `${APP_OAUTH_SCHEME}://oauth` → 直接 302 到该深链，
   形如 `ideahub://oauth?token=…`（回 App 时不再带 `next`）

★ 深链是**严格等值**匹配，不是前缀匹配 —— `ideahub://oauth@evil.com/` 这类写法必须落回第 1 类，
否则等于把开放重定向从另一个门放回来。`APP_OAUTH_SCHEME` 留空则该特性整体关闭。

★ 为什么 App 不能直接在 WebView 里登：Google 对嵌入式 WebView 的授权请求一律返回
`disallowed_useragent`（反钓鱼策略，措辞绕不过）。所以 App 侧必须
**系统浏览器跑授权页 → 服务端深链回 App**。三处 scheme 要一致：
server 的 `APP_OAUTH_SCHEME`、app 的 `src/utils/oauth.ts` `APP_SCHEME`、
`android/app/src/main/AndroidManifest.xml` 的 intent-filter。

★ Google Cloud Console 里登记的授权回调**只有服务端那一个**
（`<SERVER_BASE_URL>/api/auth/oauth/google/callback`）。自定义 scheme 不需要、也不能
登记到 Google —— 它是服务端拿到 token **之后**自己发起的第二跳。

## 语音合成（工坊 NPC 的嗓子）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/tts/health` | 无 | `{ ok, tts: boolean }` —— 这台服务器配没配 `TTS_API_KEY`。不回密钥本身 |
| POST | `/api/tts` | **必须** | 合成一句台词，回 `audio/mpeg`。按用户限流 30 次/分钟 |

请求体（除 `text` 外都可省）：

```jsonc
{
  "text": "≤300 字，超出截断",
  "voice": "zh_female_gaolengyujie_uranus_bigtts",  // 只允许 [A-Za-z0-9_.-]{1,64}，非法值回落默认音色
  "mix":   [{ "id": "…", "w": 0.6 }],               // 混音配方，权重服务端再归一化；只吃 1.0 音色
  "emotion": "happy", "instruct": "用更冷静的语气",
  "rate": 0,        // [-50,100]，0 = 1.0 倍
  "pitch": -1,      // [-12,12]
  "expressive": true // 2.0 ICL 音色专属；<cot> 标签生效的前提
}
```

状态码约定（客户端据此决策，见 `app/src/studio/speech.ts`）：

- `501` 服务端没配密钥、`404` 没挂路由、`401/403` 掉登录 → **本会话永久关掉云端合成**，退回浏览器内置合成器
- `502/504` 上游偶发失败 → 只是这一句没出声，不关云端（下一句照常重试）
- `400` 空文本

★ **这个端点必须在服务端，不能只留在 app 仓 `vite.config.ts` 的 dev 中间件里**：
打成 APK 后 vite 不存在，`/api/tts` 无人应答，工坊 NPC 全程哑巴（安卓 WebView 的
`speechSynthesis.getVoices()` 常年返回空数组，退回本地也没声）。密钥更不能进前端包。

★ 与 `ARK_API_KEY` 是**两套凭据**：不同域名（openspeech vs ark）、不同鉴权、不同控制台。
方舟没有 TTS。控制台要开通的是 **2.0**（`seed-tts-2.0`），1.0 是另一件商品。

## 火山方舟代理（App 整条 AI 出片管线）

挂载点：`app.use("/api/ark", require("./routes/ark.routes"))`。凭据是服务端 `.env` 的 `ARK_API_KEY`。

| 方法 | 路径 | 鉴权 | 限流 | 说明 |
|---|---|---|---|---|
| GET | `/api/ark/health` | 无 | — | `{ ok, ark: boolean }`，只说配没配 key |
| POST | `/api/ark/images/generations` | required | 30/min | Seedream 出图（卡面 / 首尾帧） |
| POST | `/api/ark/contents/generations/tasks` | required | 30/min | Seedance 出视频 / Seed3D 建模（同一个异步任务端点） |
| GET | `/api/ark/contents/generations/tasks/:id` | required | 90/min | 轮询任务状态（每 5s 一次，一段视频最多 120 次，所以单独一个桶） |
| POST | `/api/ark/chat/completions` | required | 30/min | 豆包对话 / 看图说话 |
| GET | `/api/ark/asset?url=…` | required | 90/min | 取方舟产物（图片 / 视频 / 3D zip），域名限 `*.volces.com`、`*.volccdn.com` |

请求体与响应**原样透传**方舟 v3（含错误码：`400` 敏感词、`429` 限流——客户端对这两者的
处置完全不同，聚合成 502 会把区分抹掉）。`POST /api/ark` 的 body 上限放宽到 50MB
（Seedance 任务带 base64 首尾帧），闸门同 `/api/branch`：先验 JWT 签名再决定给多大缓冲区。

**这是白名单转发，不是通用反向代理**：只有上表这几条上游路径可达，且 `model` 必须在
`ALLOWED_MODELS` 里（对应 `app/src/ai/arkClient.ts` 的 `MODELS` 与
`app/src/data/economy.ts` 的 `VIDEO_TIERS`）。**App 新增视频档位 = 服务端要补一行** ——
每加一个模型都是一笔新单价，应该有人明确点头。回归测试见 `server/tests/arkProxy.spec.js`。

状态码约定（客户端据此决策，见 `app/src/ai/arkClient.ts`）：

- `501` 服务端没配 `ARK_API_KEY` → 提示"这台服务器没有配置方舟密钥"
- `401` 掉登录 → 提示重新登录
- **响应不是 JSON**（`Content-Type` 不含 json）→ 提示"这台服务器没有 `/api/ark` 代理"

★ **最后这一条不是防御性编程，是修一个真故障。** 真机上 Capacitor 的本地静态服务器
对未命中路径做 **SPA 回退**：`POST https://localhost/api/ark/...` 拿回的是 **200 + index.html**
而不是 404。于是 `res.ok` 为真、`res.json()` 一头撞进 `<!doctype html>`，用户看到的是
「第 1 段生成失败：Unexpected token '<', "<!doctype"... is not valid JSON」，
工坊 NPC 对话同时哑火（走同一条路）。**判断"这台服务器有没有这个能力"要看
`Content-Type` 或专门的健康端点，永远不要信状态码**（`/api/tts` 当年栽的是同一条）。

★ 与 `TTS_API_KEY` 是**两套凭据**：不同域名、不同鉴权、不同控制台。互换一定 401。

### 扣费

**先扣钱、再转发；上游没受理就原路退回。** 顺序不能反：先转发再扣钱的话，余额不足的
请求已经把钱花掉了；而"先查余额、转发、再扣"更糟——查和扣之间的窗口正是并发双花的入口。
所以服务端的口径是「条件原子扣减成功 = 拿到了这次调用的许可」。

| 端点 | 计费 |
|---|---|
| `POST /images/generations` | 13,300（一次 Seedream 出图） |
| `POST /chat/completions` | 400（一次豆包往返） |
| `POST /contents/generations/tasks`（Seedance） | `时长×1280×720×24/1024 × 档位系数`（极速 0.3 / 标准 1 / 高清 1.6） |
| `POST /contents/generations/tasks`（Seed3D） | 160,000 |
| `GET /contents/generations/tasks/:id` | **0**（轮询高频，按次收会把一段片的价格翻几倍） |
| `GET /asset` | **0** |

- 余额不足 → **402** `{ code: "INSUFFICIENT_TOKENS", need, balance }`，**方舟根本不会被调用**
- 上游非 2xx（400 敏感词 / 429 限流 / 5xx / 501 没配 key）→ 扣掉的原路退回 **addon**
  （不退回 plan：plan 跨月作废，月末退回去几小时后就蒸发了）
- ⚠ 任务**被受理之后**才失败（Seedance 排队跑完报 failed）**不退**——那时算力已经消耗、
  方舟也已经向我们计费。刻意为之，不是遗漏。
- 每个响应都带 `X-Wallet-Plan` / `X-Wallet-Addon`（CORS `exposedHeaders` 已放行），
  App 的钱包镜像据此同步，省掉一次 `GET /api/me/wallet`

★ **定价表两边都有，必须一起改**：服务端 `src/config/tokens.js` 是**结算**口径，
App `src/data/economy.ts` 是**报价**口径。不一致的后果是"报价 216k、余额掉了 243k"，
用户会觉得被偷了钱。已知的两处不一致写在 `tokens.js` 的 `priceOf` 注释里。

## AI token 钱包

挂载点：`app.use("/api/me/wallet", require("./routes/wallet.routes"))`，全部 `requireAuth`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me/wallet` | `{ wallet: { plan, addon, planId }, plans }`。顺带完成初始化与跨月刷新 |
| GET | `/api/me/wallet/ledger?limit=` | token 流水（"我的钱花哪儿了"） |
| POST | `/api/me/wallet/recharge` | `{ tokens }`，只收在册面额（200k / 1M / 5M） |
| POST | `/api/me/wallet/plan` | `{ planId }`，free / std / pro |

- `plan` = 当月套餐额度，**跨月刷新、未用完作废**；`addon` = 直充与退款，**永不过期**。扣减先 plan 后 addon
- 用户文档**刻意没有 `tokenWallet` 的 schema default**：有没有这个字段就是"要不要初始化"的
  判据本身（`{$exists:false}` 条件原子更新抢占初始化并补一条 `grant` 流水）。给了 default，
  老账号读出来就凭空有余额、却没有对应流水，账本和余额从第一天起就对不上
- 三条不变量（并发不超付 / 没受理必须退 / 月度刷新只发生一次）见
  `server/src/services/tokenWallet.service.js` 的文件头，回归测试见 `server/tests/tokenWallet.spec.js`

⚠ **充值与购套餐仍是模拟支付**（没有接真实支付网关）。把钱包从客户端搬到服务端
**没有堵上"自己给自己发 token"这个洞** —— 有一个有效登录态就能调。搬过来的意义是：
口径唯一、有流水可审计、有每日上限兜底（`DAILY_RECHARGE_CAP` / `DAILY_PLAN_BUYS`），
接支付回调时只改一处。**别看到"已经在服务端了"就以为可以开门收钱。**

### 客户端那份钱包是镜像，不是账本

`app/src/data/account.ts` 的 `walletOf/canAfford/spendTokens` 在远端模式下只负责
**显示余额**与**按下按钮之前提前拦一道**，被绕过不会造成任何损失（服务端不认它）。
25 处调用点因此保持同步签名不变；权威值随 `/api/ark` 的响应头覆盖回来，最多短暂偏差且自愈。
离线模式（没配 `VITE_API_BASE`）下它仍然是唯一账本——那种包本来就不出网。

## 客户端接入约定

- `app/src/api/client.ts` 统一封装：`API_BASE`（`VITE_API_BASE`，缺省时走本地 IndexedDB 离线模式）、
  JWT 存 localStorage、401 自动登出、`serverAlive()` 探活（`GET /api/health`，整个会话只探一次，
  `data/videos.ts` 与 `data/account.ts` 共用同一个结论）。
- `app/src/data/*.ts` 保留同名同签名的导出，内部按"有无 API_BASE"选择远端或本地实现，
  页面层基本不动。
- **配了地址 ≠ 跑在远端**：服务器打不通时两个数据层都把 `remoteLive` 留成 false，
  整体回退 IndexedDB（照常能登录、炼卡、看种子作品），`isRemoteMode()` 返回的也是这个
  实际值——登录页据此在"密码登录"与"本地账号"两套表单之间切换。
