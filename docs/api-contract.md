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
{ _id, owner: ObjectId(User), cardId, type, name, summary, cover, hot?, tags?,
  modelUrl?, genPrompt?,                       // 3D 建模指针 / 生成蓝图
  published?, publishedAt?, description?,      // 分享到创意工坊
  createdAt }
```
`cardId` 是客户端生成的稳定 id（市场卡为 `mkt_*`），`{ owner, cardId }` 唯一索引。

⚠ **`hot` 不是热度**。它是客户端发上来的种子值（`mock/ai.ts` 里手打的 18 个数字），
没有任何东西会去加它。真热度看下面的「卡片/卡组的互动与热度」。保留这个字段只为向下兼容。

⚠ **同一个 `cardId` 会有 N 份文档**（唯一索引是 `{owner, cardId}`，每个装过它的人各一份）。
所以任何「这张卡的计数」都必须按 **cardId 聚合**，不能挂在某一份文档上——挂上去的话
每个安装者看到的都是自己那份的 0，表现出来就是数据丢了。
同理，「哪一份是权威的」也只有一条规则：`{publishedAt: 1, _id: 1}` 最早发布的那份
（controller 里的 `AUTHORITATIVE_SORT`）。广场展示与 install 必须取同一份，否则
用户看到的卡和装到的卡不是一张。

### BranchDeck（卡组）
```
{ _id, owner: ObjectId(User), name, cardIds: [String], coverCardId?,
  published?, publishedAt?, description?,      // 分享到创意工坊
  cards?,                                      // 发布瞬间的卡片快照（自包含）
  installs?, sourceDeck?,                      // 被装走次数 / 装来的记住来源
  createdAt, updatedAt }
```

### BranchComment（评论，含楼中楼与 @提及）
```
{ _id, video, author, text, parent?, likes, mentions?: [{ user, token }], createdAt }
```
`mentions` 是**服务端解析并解析成功的**那些 @（存下来，隔天再读也还能高亮）。
★ 客户端**不许**自己再解析一遍正文来高亮：那样会把服务端没认出来的 @ 也画成链接，
用户就看不出自己那个 @ 到底有没有生效了。没解析出来的 `@xxx` 保持纯文本，这是**故意的**。
`parent` = 被回复的评论（顶层评论没有这个字段）。**判据是「有没有 parent」**，
不是拿它和某个哨兵值比——历史评论这一项是 `undefined`。
回复只有两层：回复一条回复时服务端会把 `parent` 归到它的顶层父评论
（`parent.parent || parent._id`），通知仍然发给被回复的那个人。

### BranchCommentLike（评论点赞去重）
`{ user, comment }` 唯一索引。与 BranchLike 同构——计数由本表 `countDocuments` 回写，
不做裸 `$inc`，避免并发下漂移。

### BranchAssetStat / BranchAssetLike / BranchAssetView（卡片与卡组的互动）
```
BranchAssetStat  { kind: "card"|"deck", key, views, likes, bookmarks }   唯一 {kind, key}
BranchAssetLike  { user, kind, key, action: "like"|"bookmark" }          唯一 {user, kind, key, action}
BranchAssetView  { kind, key, viewer, expiresAt }                        唯一 {kind, key, viewer} + TTL
```
`key`：卡片是 **`cardId`**（理由见上），卡组是发布出去那条的 `_id`。
`viewer` 是 `u:<userId>:<UTC日>` 或 `a:<sha256(日+pepper+ip) 前32位>`——**不存原始 IP**，
每日换盐，所以昨天的匿名行关联不到今天。它是浏览量的**真正的门**：限流只减慢速度，
挡不住刷（60/分钟乘一小时也够把热度顶上去）。

### BranchLike（点赞去重）
`{ user, video }` 唯一索引。

### BranchDanmaku（弹幕）
`{ video, author, at, text, color }` + timestamps。索引 `{video, at}`（播放端按时间轴取）
与 `{video, createdAt}`（取最新 N 条）。字段口径见下「弹幕」。

## 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/branch/videos` | optional | 列表。query：`feed=recommend\|following`、`category`、`q`、`author`(用户 id)、`cursor`、`limit`(默认 12)。返回 `{ ok, items, nextCursor, author? }`；`items[].liked` 表示当前用户是否已赞。**只返回公开作品 + 自己的作品**（见下「可见性」）。★ `author` 生效时会**原样回显**在响应里 —— 老服务端会把这个 query strip 掉然后照常回推荐流，客户端只能靠"这个键在不在"分辨"按作者筛过、这人没作品"与"压根没筛"，判内容或判状态码都分不出来 |
| POST | `/api/branch/videos` | required | 发布。body=DraftVideo（title/category/description/cover/segments/branchTree/**deck**/**visibility**/**clientId**）。**服务端负责把 body 里的外链资源转存**（见下）。带 `clientId` 时按 `{author, clientId}` 幂等：重发返回首次那条、状态码 200（首发是 201） |
| GET | `/api/branch/videos/:id` | optional | 详情（含 comments 前 50 条）。非作者访问 private 作品返回 **404**（不是 403） |
| PATCH | `/api/branch/videos/:id` | required | 作品编辑，仅作者。body `{ title?, category?, description?, visibility? }`，**至少给一个字段**（空对象 400）。segments / branchTree / deck 一律被 strip —— 发布即定稿 |
| DELETE | `/api/branch/videos/:id` | required | 仅作者可删 |
| POST | `/api/branch/videos/:id/play` | optional | 播放计数 +1，返回 `{ ok, plays }` |
| POST | `/api/branch/videos/:id/like` | required | 点赞，返回 `{ ok, likes, liked: true }` |
| DELETE | `/api/branch/videos/:id/like` | required | 取消，返回 `{ ok, likes, liked: false }` |
| GET | `/api/branch/videos/:id/comments` | optional | 评论列表。每条带 `parentId` / `likes` / `liked` |
| POST | `/api/branch/videos/:id/comments` | required | 发评论 `{ text, parentId? }`。带 `parentId` = 回复。正文里的 `@username` 由**服务端**解析并回写到 `mentions`。限流 **20/分钟按账号**（`branch:comment` 桶，与弹幕分开） |
| POST | `/api/branch/videos/:id/comments/:commentId/like` | required | 评论点赞 → `{ ok, likes, liked: true }` |
| DELETE | `/api/branch/videos/:id/comments/:commentId/like` | required | 取消 → `{ ok, likes, liked: false }` |
| GET | `/api/branch/videos/:id/danmaku` | optional | 弹幕列表（见下「弹幕」）。query `limit`(默认 200，上限 500)。返回 `{ ok, items, truncated }` |
| POST | `/api/branch/videos/:id/danmaku` | required | 发弹幕 `{ at, text, color? }` → 201 `{ ok, danmaku }`。限流 **30/分钟**（按账号） |
| GET | `/api/branch/cards` | required | 我的卡片 |
| POST | `/api/branch/cards` | required | 批量新增 `{ cards: Card[] }`（按 cardId 幂等） |
| DELETE | `/api/branch/cards/:cardId` | required | 删除一张 |
| GET | `/api/branch/cards/shared` | optional | 创意工坊的卡片广场。**必须注册在 `/cards/:cardId` 之前** |
| POST | `/api/branch/cards/:cardId/publish` | required | 分享到工坊 `{ description? }`（仅作者）。挂第三方版权模型的卡 **400** |
| DELETE | `/api/branch/cards/:cardId/publish` | required | 取消分享 |
| POST | `/api/branch/cards/:cardId/install` | required | 装走一张（按 `{owner, cardId}` 幂等：首次 201，之后 200 + `alreadyInstalled`） |
| GET | `/api/branch/decks` | required | 我的卡组 |
| POST | `/api/branch/decks` | required | 建组 `{ name, cardIds? }` |
| PATCH | `/api/branch/decks/:id` | required | 改名/改卡 `{ name?, cardIds?, coverCardId?, description? }` |
| DELETE | `/api/branch/decks/:id` | required | 删组 |
| GET | `/api/branch/decks/shared` | optional | 卡组广场。**必须注册在 `/decks/:id` 之前** |
| POST | `/api/branch/decks/:id/publish` | required | 分享整套 `{ description? }`。组里有第三方版权模型的卡 **400 并说明是哪张** |
| DELETE | `/api/branch/decks/:id/publish` | required | 取消分享 |
| POST | `/api/branch/decks/:id/install` | required | 整套装走，原组 `installs` +1 |
| POST | `/api/branch/assets/:kind/:key/view` | optional | 浏览 +1。限流 **60/分钟**，且同一访客同一天只计一次 |
| POST\|DELETE | `/api/branch/assets/:kind/:key/like` | required | 点赞/取消。限流按**账号**（换出口比换账号便宜） |
| POST\|DELETE | `/api/branch/assets/:kind/:key/bookmark` | required | 收藏/取消。与 like 共用一个限流桶 |
| GET | `/api/branch/assets/:kind/:key/stats` | optional | `{ views, likes, bookmarks, heat, liked, bookmarked }` |

`:kind` ∈ `card` \| `deck`。写端点会先校验这个 key 真的对应一张卡/一套组，对不上返回 **404** ——
不校验的话随便编个 key 就能凭空造出一行谁也够不着、也删不掉的计数。
读端点 `/stats` 故意不校验：它不写库，造不出任何行，而客户端手里合法地存在只在本机有的 `cardId`。

关注沿用既有 `/api/users/:id/follow` 与 `Follow` 模型，不新建。

## 热度（`heat`）

**只有一个公式**，实现在 server 的 `src/utils/hotScore.js`：

```
likes×6 + comments×4 + bookmarks×3 + min(views, 5000)×0.04
```

权重是从 `ideas.controller.js` 的 `getIdeaHotScore` 原样搬过来的（那边现在也调用这个 util，
全仓就这一份）。卡片/卡组的 `comments` 恒为 0 —— 服务端没有卡片评论表，评论只存在客户端。

★ 客户端 `data/social.ts` 里有一份**镜像**（`heatFormula`），只在离线或对着老服务端时用。
两份必须**权重与入参都相等**：入参不等的话，联网那一刻数字会当着用户的面跳一截。
（同价目表的处境——两仓不在一个 CI 里，只能各留一份，改一边必须改另一边。）

## 通知（分支视频）

沿用既有的 `/api/notifications`（列表 / `unread-count` / `:id/read` / `read-all`），新增：

- `Notification.type` 增加 `BRANCH_LIKE`、`BRANCH_COMMENT`、`BRANCH_COMMENT_REPLY`、`BRANCH_COMMENT_LIKE`、`BRANCH_MENTION`
- `Notification.videoId`（ref `BranchVideo`）。★ **不要复用 `ideaId`** —— 它 ref 的是 `Idea`，
  塞一个 BranchVideo 的 id 进去不会报错，只会 populate 成 `null`，标题和跳转地址一起没了，全程零日志。
- 列表接口的 `actorId` 现在 populate `username displayName avatarUrl role`，并额外 populate
  `videoId` 的 `title cover visibility`
- `read-all` 接受可选的 `type` 过滤（与列表接口同样的逗号分隔写法）。**不传时行为一个字节都没变**。
  ★ App 的消息页只显示上面四种 BRANCH_*，所以它必须传这个过滤 —— 不传的话用户点一下「全部已读」，
  会把网站那边他**从没看过**的通知一起标成已读。

去重与限流（都在 server 一处实现，见 `notifyBranch` / `NOTIF_DEDUP_KEYS`）：
- `BRANCH_LIKE` 按 `{userId, actorId, videoId, type}` 24 小时内只发一条 —— 点赞是幂等 upsert，
  但「取消再点」会删行再插行，不去重的话一个循环就能把对方的通知箱刷爆。
- `BRANCH_COMMENT_LIKE` 的去重键额外带 `commentId`（否则赞了同一作品下的第二条评论就不通知了）。
- 评论与回复**不去重**：每一条都是新内容，压掉就是真的丢消息。
- **弹幕不发通知**。弹幕的回包刻意不带作者（只有一个 `mine` 布尔），发通知等于把它去匿名化。
- **`BRANCH_MENTION` 不去重**：@ 永远搭在一条**新评论**上，按 24 小时去重的话，一段正常对话
  从第二轮起就再也不提醒了 —— 那是丢消息，不是防刷。刷的成本由另外三道闸门管：
  评论 20/分钟（按账号）、单条评论最多 10 个有效 @、以及下面那条「一条评论只通知你一次」。
- **一条评论只给同一个人发一条通知**。作品作者被 @ 时只收 `BRANCH_COMMENT`，
  被回复的人被 @ 时只收 `BRANCH_COMMENT_REPLY` —— 结构性的那条信息更全（它同时说明了
  "这是回给你的 / 这是你作品下的"），@ 让位。判重在 `addComment` 里一个 `notified` 集合上。
- **拉黑了就通不过**：所有 BRANCH_* 通知统一在 `notifyBranch` 里过一次 `hasAnyBlockBetween`。
  少了这一道，被拉黑的人就能靠 @ 把消息塞进对方的通知箱 —— 而拉黑对用户的承诺正是"这个人碰不到我"。
- **@ 也受可见性约束**：只有**看得见这条作品**的人才会收到 `BRANCH_MENTION`。
  否则在私密作品下 @ 一个人，就等于告诉他"存在这么一条你看不到的作品"，@ 成了探针。

## @提及（`@username`）

token 是 **`@username`**，不是 `@昵称` —— `username` 唯一且不可变，`displayName` 既不唯一也能随便改，
拿它当身份就是本仓已经栽过一次的那种坑（见 `data/videos.ts` 的 `renameMyVideos`）。
解析在 server 的 `utils/mentionParser.js` 一处，正则 `/(?<![\w@])@([A-Za-z0-9_-]{1,32})/g`：

- 前置的 `(?<![\w@])` 是为了让 `someone@example.com` 里的 `@example` **不**算提及
  （否则粘一个邮箱地址进去就会给一个陌生人发通知）；
- 大小写不敏感靠 collation（`utils/username.js` 的 `CI_COLLATION`，与 `username_ci` 索引同一份）；
- 32 是 `username` 的长度上限，两个数字必须相等，否则超长用户名会**永远 @ 不到**且不报错；
- 非 ASCII 的 `@中文名` 解析不了（CJK 没有词边界，贪婪匹配会把半句话吞成一个 token）。
  它会保持纯文本 —— 用户看得见它没变成链接，这是**故意**的降级方式。

★ App 侧必须有 @ 自动补全（`components/MentionInput.tsx`）：这个 App 从头到尾显示的是
`displayName`，`username` 一处都不露脸。没有补全的话用户根本不知道该打什么，
每一次 @ 都会静悄悄地谁也通知不到。补全用的就是下面这条搜索接口。

## 找人 `GET /api/users/search`

query `q`、`limit`(默认 8，上限 20)。返回 `{ ok, users: [{ _id, username, displayName, avatarUrl }] }`。

- **必须同时匹配 `displayName`**：App 里满屏显示的都是它，只按 `username` 匹配的结果是
  "用户搜自己每天看到的那个名字，一个人都搜不到"，而接口 200 + `users: []` —— 看着就像查无此人。
- 回包**只加不减**：`_id`/`username` 是官网客户端已经在读的，删任何一个都会当场打断它。
- `q` 一律走 `utils/regex` 的 `searchRegex`（转义 + 截断）。自己 `new RegExp(q)` 是本仓真出过事的 ReDoS 口子。
- 精确命中（`username` 等值）**单独发一条查询**，不与模糊那条合并后再 `limit` ——
  合并的话，一群把昵称改成你账号名的人可以把那一页占满，账号真叫这个名字的人一行都取不回来。
- 超时返回 **503**，不返回空列表：`users: []` 会让"服务器没查完"和"查无此人"在界面上长得一模一样。
- 限流按 **IP**（`users:search`，120/分钟）。这条是 `optionalAuth`，按账号限流等于没限
  —— 攻击者不带 token 就绕过去了。

## 可见性（`visibility`）

`BranchVideo.visibility` ∈ `"public" | "private"`，默认 `public`。`private` = 仅作者自己可见。

判定规则**只有一条**，服务端在下面每一处都用它（改一处必须改全部）：

- Mongo 查询：`{ $or: [{ visibility: { $ne: "private" } }, { author: 我 }] }`（未登录时只有前半）
- 内存判定：`doc.visibility !== "private" || 是作者`

★ **必须写成 `!== "private"` 而不是 `=== "public"`**：这个字段是后加的，存量作品这一项是
`undefined`，按等值判会把库里所有老作品从首页上抹掉——而且一点错都不报。
响应里的 `visibility` 已经归一过（`undefined` → `"public"`），客户端不用判缺省。

挡的地方不止详情：`GET /videos`（含 `q` 搜索）、`GET /videos/:id`、`POST /:id/play`、
`POST|DELETE /:id/like`、`GET|POST /:id/comments`、`GET|POST /:id/danmaku` **全部**按
同一条规则挡，非作者一律 404。只挡详情等于给私密作品留了个探测旁路。
服务端这几处收敛在 `branchVideo.controller.js` 的 `assertVisible()` 一个函数里
（原来是各写各的，加一条子端点就多抄一遍）。

## 弹幕

B 站式弹幕：一句话 + 它该在**视频第几秒**飘过去。与评论是两件事，各自一张表
（`BranchDanmaku`）—— 评论按发布时间倒序读完就行，弹幕脱开 `at` 就什么都不是。

**字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `at` | number | 出现在**全片累计秒**（多段作品要把前面几段时长加上，与播放器进度条同口径）。`0 ≤ at ≤ 86400` |
| `text` | string | 正文，trim 后 **1–40 字**。40 是契约值，客户端的 `DANMAKU_MAX_LEN` 必须与它相等 |
| `color` | string? | `#rrggbb`，**只收这一种格式**。缺省/空串 = 客户端默认色（白） |
| `mine` | boolean | 响应字段。这条是不是当前请求者发的 |

★ `color` 会原样进客户端的 `style.color`。收任意字符串等于把一段用户可控的文本
喂进 CSS，所以服务端用 `/^#[0-9a-f]{6}$/i` 钉死，不合格直接 400。

★ **响应里没有作者**，只有 `mine`。弹幕在这套心智里是匿名的：挂上 username，
一条作品的弹幕墙就成了"谁在什么时间看了这个视频"的公开记录。客户端要作者信息的
唯一用途是给自己发的那条描个边，一个布尔就够。

**采样口径**：`GET` 先按 `createdAt` 倒序取最新的 `limit` 条，再**按 `at` 升序**返回。
不是"按 at 取前 N 条"——那样一条爆火作品的前 10 秒会被老弹幕占满、后发的永远看不见。
返回值里的 `truncated` 明说这是不是全部；没有这个标记，客户端分不出
"这条作品就这么多弹幕"和"被我们截断了"。

★ 返回**必须是 `at` 升序**：播放端是按游标扫时间轴放的，乱序会整段漏放。

## 随作品发布的卡组（`deck`）

`{ name, cards: [{ cardId, type, name, summary, cover, tags }] }`，**内嵌快照**，
不是对 `BranchCard` 的引用——作者事后删掉自己库里的卡，已发布作品里的卡组不能跟着少张。

- 客户端 `Card.id` 落库统一叫 `cardId`（与 `BranchCard` 对齐），两个名字服务端都收
- `cards[].cover` 与帧字段走同一套转存（dataURL → Cloudinary）
- 无卡组时响应里**没有** `deck` 键，不会给一个空对象

★ 这个字段在 2026-08-10 之前是**发得出、存不下**的：`publishBody` 的 zod schema 没声明它，
`z.object` 默认 strip 未声明字段，于是客户端发了、服务端 201 了、读回来是空的。
往 DraftVideo 里加字段时记得同步这份 schema。

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
| POST | `/api/me/wallet/recharge` | **已改为下单**（见下「充值」）。`{ tokens }` → **202** + 订单，余额不变 |
| POST | `/api/me/wallet/plan` | **已改为下单**。`{ planId }` → **202** + 订单，余额不变 |

- `plan` = 当月套餐额度，**跨月刷新、未用完作废**；`addon` = 直充与退款，**永不过期**。扣减先 plan 后 addon
- 用户文档**刻意没有 `tokenWallet` 的 schema default**：有没有这个字段就是"要不要初始化"的
  判据本身（`{$exists:false}` 条件原子更新抢占初始化并补一条 `grant` 流水）。给了 default，
  老账号读出来就凭空有余额、却没有对应流水，账本和余额从第一天起就对不上
- 三条不变量（并发不超付 / 没受理必须退 / 月度刷新只发生一次）见
  `server/src/services/tokenWallet.service.js` 的文件头，回归测试见 `server/tests/tokenWallet.spec.js`

## 充值（订单 + 回调）

挂载点：`app.use("/api/pay", require("./routes/pay.routes"))`。

发币的口子**只有一个**：渠道回调结算（`services/payment/order.service.js` 的 `applyCallback`）。
钱包路由的 `/recharge` 与 `/plan` 曾经是"调一下就到账"，也就是任何有登录态的人都能
给自己发 token；现在它们只下单，返回 **202 Accepted** —— 用 202 不用 200 是因为
"请求收下了"和"余额变多了"是两回事，老客户端拿 200 会把余额刷成新的然后又掉回去。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/pay/config` | 无 | `{ channels, payable, mock, packs, plans }`。`payable=false` = 现在收不了钱，UI 必须说出来 |
| POST | `/api/pay/orders` | required | `{ kind: "recharge", tokens } \| { kind: "plan", planId }` → 201 `{ order, payParams, payable }` |
| GET | `/api/pay/orders/:orderNo` | required | 查单（仅本人）。客户端付款后轮询它等 `status: "settled"` |
| GET | `/api/pay/orders?limit=` | required | 我的订单列表 |
| POST | `/api/pay/orders/:orderNo/close` | required | 用户取消（仅未支付的） |
| POST | `/api/pay/callback/:channel` | **无** | 渠道异步通知。安全**全靠** adapter 验签 |
| POST | `/api/pay/mock/pay` | required | 仅 `PAY_ALLOW_MOCK=1` 时存在，演示用 |

订单状态：`created → paid → settled`，或 `closed` / `failed`（都是终态）。

### 三条不变量

- **O1 一笔订单只发一次币。** 支付回调**必然重复**（渠道重试、运维重推、网络抖动补发）。
  靠 status 判"处理过没有"不够——读到 paid 再写 settled 中间有并发窗口。
  用**条件原子更新**抢 `settledAt: null → now`，只有抢到的那一条才真的 credit。
  重复回调返回 200（回失败渠道会一直推）。
- **O2 金额以订单快照为准。** 商品、价格、数量全读下单那一刻写进订单的快照，
  绝不读回调体里的同名字段——那是外部输入。实付 < 应付不发币。
- **O3 未注册的渠道一律 400。** 没有 adapter 就没有验签；把未知渠道当成功处理，
  等于任何人 POST 一下就白拿 token。

回归测试 `server/tests/payOrder.spec.js`（24 条）。

### ⚠ 现在一个真实渠道都没接

`services/payment/channels.js` 的注册表是空的，所以下单能下、但没人会把订单推进到
settled。这是**故意**的：宁可"充不了值"，也不要留一个谁调谁得 token 的口子。
接渠道 = 写一个 adapter（`verify` 验签是它唯一也是全部的职责）+ 注册，路由与结算不用动。

`PAY_ALLOW_MOCK=1` 打开演示用假渠道（**没有验签**）。默认关；生产环境开着会被启动自检
直接拒绝（`config/preflight.js`）。

### 价目表两边必须一致

`server/src/services/payment/order.service.js` 的 `RECHARGE_PACKS` 与
`server/src/config/tokens.js` 的 `PLANS`，必须和 **app 仓 `src/data/economy.ts`** 逐条相等。
app 那份是【报价】（按下按钮前给用户看的），server 这份是【结算】（真扣钱的）。
对不上就是"页面写 ¥25、扣了 ¥15"。两仓不在一个 CI 里，`payOrder.spec.js` 末尾把 app 那份
抄了一遍钉住，改价时会红。金额一律**整数分**。

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
