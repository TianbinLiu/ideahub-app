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
  takedown?: { by: ObjectId(User), at: Date, reason: String },   // 见下「平台下架」
  author: ObjectId(User), plays, likes, commentCount,
  createdAt, updatedAt
}
```
索引：`{ author: 1, createdAt: -1 }`、`{ category: 1, createdAt: -1 }`、`{ createdAt: -1 }`

#### 平台下架（`takedown`）

**有这个子文档 = 已被平台下架。** 没下架时服务端**根本不发这个键**（不是 `null`、不是 `false`）。

| 谁 | 读不读得到这条作品 | 回包里有没有 `takedown` |
|---|---|---|
| 陌生人 / 未登录 | ❌ 列表、搜索、他人主页、按 id 直取全部没有 | — |
| **作者本人** | ✅ 照常读得到 | ✅ 带 `{at, reason}`，**不带 `by`** |
| 管理员 | ✅ 按 id 直取读得到（列表里与常人一样） | ✅ 带 `{at, reason}` |

三条不许踩：

1. **不能拿 `visibility=private` 当下架。** 那是作者自己的开关，作者照样看得见，
   而且 `PATCH /videos/:id` 只校验"是不是作者" —— 他能一键改回 public。
   两个开关**互不顶替**：下架的作品把 visibility 改成 public 也还是下架。
2. **作者必须看得见它，并且看得见原因。** 直接从作者眼前抹掉比下架更糟：
   他只会以为系统吞了自己的作品，然后**原样再发一遍**。
3. **`by`（谁下的架）只留在库里，不出回包。** 把审核员透给被处理的用户
   等于把他摆到被骚扰的位置。

作者**改不掉**它：`PATCH /videos/:id` 的 zod（`updateBody`）没有声明 `takedown`，
z.object 默认 strip，塞进去会被丢掉。★ 这条靠的是 strip 语义，所以
**谁给那个 schema 加 `.loose()` 就会静默打开这个后门** —— 服务端有用例从外面钉住它。

客户端判据一律是"这个键在不在"，不是 `takedown.xxx === 某值`：
`takedown: null` 这类坏数据的失败方向必须是"作品照常显示"，
而不是"作品被判成已下架"（老服务端没有这个键，缺省一律当没下架 —— 铁律七）。

### BranchCard（用户卡片）
```
{ _id, owner: ObjectId(User), cardId, type, name, summary, cover, hot?, tags?,
  modelUrl?, genPrompt?,                       // 3D 建模指针 / 生成蓝图
  views?: [{ url, kind, note? }],              // 形象参考图（0~3 张），见下
  published?, publishedAt?, description?,      // 分享到创意工坊
  createdAt }
// imageTier?  —— 客户端 Card 上有，服务端**目前不存**，见下面单独一节
```
`cardId` 是客户端生成的稳定 id（市场卡为 `mkt_*`），`{ owner, cardId }` 唯一索引。

#### `views` —— 卡片的形象参考图

`{ url: string, kind: "face" | "body" | "detail", note?: string }`，**最多 3 张**。
它是"多图参考"的载体：客户端推演三套方案时把这些图当 Seedream 的参考图，
人物形象因此被烤进首尾帧，出片仍旧只按首尾帧走（Seedance 请求形状一个字没变 ——
方舟规定「图生视频-首帧 / 首尾帧 / 全模态参考生视频是 3 种**互斥**场景，不可混用」）。

- **`url` 只收 http(s)，不收 dataURL。** 一张卡 3 张 dataURL 会把随作品发布的卡组快照
  （`deck.cards`）撑爆 —— `modelUrl` 当年正是为这件事改成 `idb:` 指针的。客户端在
  `data/cardViews.ts` 里先走 `/api/uploads/image` 转存拿永久 URL 再发上来。
- **上限 3 不是拍脑袋**：方舟提示词指南「不建议用满素材上限，过多素材会导致模型难以
  判断特征优先级」。人物卡的推荐组合是 `face`（大头照）+ `body`（全身照）两张。
  ⚠ 同一个人的**多角度视图是反效果**（指南原文：模型易将其识别为多个不同主体，
  加剧 ID 漂移），所以客户端 UI 不给"多角度"这种引导 —— 服务端也不要在文档/示例里写。
- **缺省与空数组是同一个意思**：老卡这一项是 `undefined`，新服务端对老卡回的是 `[]`，
  两者在客户端 `types.viewsOf()` 里都归一成 `[{ kind: "body", url: cover }]`（卡面即全身参考）。
  判据是**数组里有没有内容**，不是"这个键在不在"。
  ★ 系统里**没有**"这张卡明确地不要任何参考图"这个状态，这是有意的：删掉附加参考图
  ≠ 让这张卡失去自己的长相，卡面本来就是它的形象。想加这个状态就得先改 `viewsOf`，
  而那会让新服务端返回的**每一张老卡**（回的都是 `[]`）一夜之间失去卡面兜底 ——
  改之前先想清楚这一点。
- **归一只在客户端做一次**：服务端**不要**替老卡补 `cover`。补了就是第二处实现，
  两边一旦分叉，"详情页看到的参考图"和"喂给 Seedream 的参考图"会不是同一批，且看不出来。
- **五处一起加，漏一处就是"发得出、存不下、读回来是空的，零报错"**（`deck` 当年就这么丢的）：
  `schemas/branchAsset.schemas.js` 的 `cardItem`（`z.object` 默认 strip 未声明字段）、
  `models/BranchCard.js`、`models/BranchDeck.js` 的 `snapshotCardSchema`、
  controller 的 `toCardPayload`，以及 app 的 `api/branch.ts` `ApiCard`。
  ⚠ 还有**第六、第七处**：作品自带的卡组快照是另一套 schema —— `models/BranchVideo.js`
  的 `deckCardSchema` 与 `branchVideo.controller` 里那份字段白名单（见下面「随作品发布的
  卡组」）。第一版就是只改了 `BranchDeck` 那份，作品里的卡组照样把 `views` 丢了。

#### `views[].kind` —— 枚举没变，但**同一个值在不同卡种下读作不同的图位**

枚举**冻结**在 `face | body | detail` 三个值（`schemas/branchAsset.schemas.js` 的
`CARD_VIEW_KINDS` + `models/cardView.schema.js` 的 mongoose enum 各钉一道）。
2026-08 铸卡分档时**没有**扩这个枚举，改的只是"这三个值分别读作什么"。

| `card.type` | 第 1 格（= 卡面） | 第 2 格 | 第 3 格 |
|---|---|---|---|
| `character` 人物 | `body` 全身立绘 | `face` 面部特写 | `detail` 标志性细节 |
| `scene` 场景 | `body` 全景主视图 | `detail` 局部特征 | — |
| `background` 背景 | `body` 色光基调 | `detail` 质感特写 | — |
| `prop` 道具 | `body` 净底主视图 | `detail` 局部细节 | — |
| `style` 画风 | `body` 画风样张 | `detail` 笔触特写 | — |

- **不许往枚举里加值。** 老服务端的 `z.enum` 会把带新 kind 的请求整批 400，而全 app
  **没有任何地方监听 `emitApiError`** —— 表现就是"炼完的卡一张都没同步上去，且一句提示
  都没有"（铁律八）。要表达新图位，加的是**读法**（哪个 type 下第几格叫什么），不是新值。
- **顺序是重要性降序，`[0]` 必须是能当卡面的那张** —— 所以人物卡是 `body` 打头而不是
  `face`：一张大头照当卡面既看不出服装配色，也没法直接喂给出片管线当形象参考。
- **非人物卡只有 2 格是有意的，不是漏写。** 出片管线对场景/背景/道具/画风卡只读
  `viewsOf()[0]` 一张（`app/src/ai/real.ts` 的 `prepareMaterialRefs` 规则二），
  第 3 张画了也喂不进模型 —— 那是"收了钱、画面一个像素不变、零报错"。
  顶档（3 张）对这四类就是真的少画一张、也真的少收一次钱，报价与结算都读同一次
  `economy.slotsFor()` 的结果（全仓唯一实现）。
- **归一只在客户端做一次，服务端一律不归一。** 客户端的唯一出处是 `app/src/types.ts`：
  `CARD_SLOTS`（表）/ `primarySlotOf` / `normalizeSlot`（脏值 → 合法 kind）/ `slotLabel`
  （kind + type → 中文图位名）/ `viewsOf`（老卡用 `cover` 兜底成一张 `body`）。
  服务端**只存 kind 的原值**：不按 `type` 校验、不改写、不补默认。
  ★ 理由与 `views` 的 cover 兜底同一条：卡的 `type` 是可以改的（同一个 `body` 换个 type
  就该读成另一个图位名），服务端跟着改写就是同一条规则的第二处实现；两边一旦分叉，
  "详情页看到的图位"和"喂给 Seedream 的那张"会不是同一张，而这种偏差在结果里看不出来。
  于是这里出现"服务端存着 `face`、而这张卡是场景卡"这种组合是**合法**的（改过 type 的
  老卡），客户端按 `normalizeSlot` 读，不报错也不改库。

#### `card.imageTier` —— 铸卡用的出图档位（**目前是纯客户端字段**）

值是 `app/src/data/economy.ts` `IMAGE_TIERS` 的 id：`"sketch" | "studio" | "master"`
（速写 / 定妆 / 精绘，分别对应 Seedream 4.0 / 4.5 / 5.0-pro，见下面「出图档位与计价」）。
它记的是"这张卡当初是用哪一档炼的"。

⚠ **截至 2026-08-11，服务端不存这个字段。** `schemas/branchAsset.schemas.js` 的 `cardItem`
里没有声明它，而 `z.object` 是 **strip** 语义 —— 客户端发上来会被**悄悄丢掉**：请求 201、
日志干净、读回来是空的，全程零报错（`deck` / `modelUrl` / `views` 都是这么丢的）。
所以在补齐下面那七处之前：

- **客户端不要发 `imageTier`**（发了等于假装存住了，比不发更糟）；
- **不要指望它跨设备存活**：`loadRemoteAssets()` 每次登录都用服务端那份**整体覆盖**
  本地卡库，本地存了也会被覆盖掉；
- **读侧必须容忍缺失**：`economy.imageTierOf(undefined)` 退回 `DEFAULT_IMAGE_TIER`
  （`"sketch"`），这是刻意的**降级不崩**。代价是卡片上的档位徽标、以及"照这一档补齐
  图位"的默认值会退成低档 —— 这是已知的、可接受的偏差，不是 bug。

要让它真正入库，**七处一起改**（漏一处就是"发得出、存不下、零报错"）：
`schemas/branchAsset.schemas.js` 的 `cardItem`、`models/BranchCard.js`、
`models/BranchDeck.js` 的 `snapshotCardSchema`、`models/BranchVideo.js` 的 `deckCardSchema`、
`branchAsset.controller` 的 `toCardPayload`、`branchVideo.controller` 的卡组字段白名单、
以及 app 的 `api/branch.ts`（`ApiCard` **和** `addCards` 的 payload —— 那里是逐字段手写的，
只加 interface 不加 payload 等于没加）。

#### `PATCH /api/branch/cards/:cardId`

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| PATCH | `/api/branch/cards/:cardId` | required | 改自己的一张卡，body `{ views }`（**必填**，其余字段一律 strip）。返回 `{ ok, card }`；卡不在（别人的 / 只存在于本地）→ 404 |

★ **为什么不能复用 `POST /cards`**：那条是**新增**语义，controller 用的是
`$setOnInsert`（"已存在的字段一个不动"）。拿它去改卡会 201 得漂漂亮亮、库里一个字节
都没变；而客户端 `loadRemoteAssets()` 每次登录都用服务端那份**整体覆盖**本地卡库 ——
于是用户加的参考图在下一次冷启动时**无声消失**。这是丢数据，不是"暂未同步"。
用例钉在 server 的 `branchAssetPublish.spec.js` A12c（先证明 POST 改不动，再证明 PATCH 改得动）。

★ `views` 必填而不是可选：可选的话，一个拼错字段名的调用会拿到 200 +「改好了」，
而库里什么都没发生。客户端必须 await 并把失败显示出来（`data/cardViews.ts` 不吞错）——
全 app 没有任何地方监听 `emitApiError`，fire-and-forget 在这里等于静默丢数据。

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
{ _id, video, author, text, parent?, likes,
  mentions?: [{ user, token, offset, length }], createdAt }
```
`offset` = 正文里那个 `@` 的下标，`length` = 名字长度（不含 `@`），即
`text.slice(offset, offset + 1 + length) === '@' + 当时打出来的名字`。
★ `offset`/`length` 是**后加**的，存量行没有 —— 判「有没有」，不要给默认值：
0 是合法 offset，给了默认值就分不出「老数据」和「@ 在正文开头」。

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
| POST | `/api/branch/videos/:id/comments` | required | 发评论 `{ text, parentId?, mentions? }`。带 `parentId` = 回复。`mentions` 见下「@提及」。限流 **20/分钟按账号**（`branch:comment` 桶，与弹幕分开） |
| POST | `/api/branch/videos/:id/comments/:commentId/like` | required | 评论点赞 → `{ ok, likes, liked: true }` |
| DELETE | `/api/branch/videos/:id/comments/:commentId/like` | required | 取消 → `{ ok, likes, liked: false }` |
| DELETE | `/api/branch/videos/:id/comments/:commentId` | required | 删评论。**评论作者本人 或 作品作者**。连带删：回复、评论赞、指向它的通知；重算 `commentCount`。→ `{ ok, removed, commentCount }`。限流 30/分钟按账号 |
| DELETE | `/api/branch/videos/:id/danmaku/:danmakuId` | required | 删弹幕。**弹幕作者本人 或 作品作者**。→ `{ ok: true }`。限流 30/分钟按账号。★ 无权时回**裸 403**，回包与文案里**绝不能出现作者信息** —— 否则对每条弹幕试删一次，就等于给整面匿名弹幕墙开了一个逐条查作者的接口 |
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

## @提及（`@显示名`）

**@ 的是显示名**（`@我是王桑`），不是注册名。用户在界面上从头到尾看到的就是 `displayName`，
`username` 一处都不露脸 —— 只能 `@tianbinliu` 等于这个功能对普通用户不存在。

### 身份与显示是**两件事**，分开存

- **身份 = `userId`**。落库、发通知、跳主页，全都只认它。
- **显示 = 当下的 `displayName`**。渲染时按 `userId` 现查 —— 所以**作者改名之后，
  已经发出去的那些 @ 会跟着显示新名字**，不需要回填历史数据。
- 正文里那段名字只是"当时打出来的字面"，**不承担身份**。它会过时，这没关系。

这样就绕开了「拿可变字段当身份」那个老坑（`data/videos.ts` 的 `renameMyVideos` 收拾过一次）：
可变的只有显示，身份那一半仍然钉在 id 上。

### 中文没有词边界 —— 不靠正则猜，靠**客户端报范围、服务端核对**

`@我是王桑你看看` 用正则切不出「我是王桑」（贪婪会吃掉整句；试前缀等于一句话查 N 次库）。
所以选人由**补全面板**完成，客户端把「哪一段是谁」一起发上来：

```
POST /videos/:id/comments  { text, parentId?, mentions?: [{ userId, offset, length }] }   // ≤20 条
```

服务端**不盲信**这份名单（盲信 = 谁都能给任意人发通知），而是逐条核对，
**任何一条不过就丢掉那一条**（不是整条评论 400）：

1. `userId` 存在
2. `text[offset] === '@'`
3. `text.slice(offset+1, offset+1+length)` 等于该用户**当下**的 `displayName` 或 `username`
   （只折 ASCII 大小写；不能用 `toLowerCase()`，`'İ'` 折完会变成两个码位，长度一变校验先错且不报错）
4. 按 `userId` 去重 → 丢掉相互重叠的 span → 封顶 10 条

第 3 条是全部安全性所在：它保证「客户端声称 @ 了谁」与「正文里真的写着那个人的名字」一致，
所以伪造不出一个正文里根本没出现的提及。**上限必须作用在合并之后**，否则多报 span 就是
绕过收件箱封顶的口子。

### 仍然保留 ASCII `@username` 自动解析

手打 `@tianbinliu`（不经补全面板）、以及**老客户端**（不发 `mentions`）都靠它。
正则 `/(?<![\w@])@([A-Za-z0-9_-]{1,32})/g`，前置断言是为了让 `someone@example.com` 里的
`@example` **不**算提及（否则粘个邮箱就给陌生人发通知 —— ideas 那条线上表现为凭空发出一封邀请）。
两条路的结果合并去重。

### 回包与渲染

`toCommentPayload().mentions[] = { token, userId, username, displayName, offset, length }`，
`displayName` 是**现查**值。渲染端把 `[offset, offset+1+length)` 这一段**替换**成
`'@' + 当前 displayName` —— 这就是改名同步的落地方式。

- `offset`/`length` 是**后加**的键，老服务端不返回 → 客户端退回按 `token` 子串匹配。
- 服务端保证返回的 span **两两不重叠、按 offset 升序**。
- 存量评论行没有 span，服务端用 `token` 反查补一个 —— 反查**必须带与正则同样的前后边界判断**，
  否则 `bob@alice.com` 里那截 `@alice` 会被反查命中，客户端照 span 一替换，
  用户写的邮箱地址就被当面改写成别人的昵称、还变成一个链接。
- 客户端**不许**自己再解析一遍正文来补链接：那样会把服务端没认下来的 @ 也画成链接，
  用户就看不出自己那一 @ 到底有没有生效。没解析上的 `@xxx` 保持纯文本，**这是故意的**。

★ App 侧必须有 @ 自动补全（`components/MentionInput.tsx`），补全用的就是下面这条搜索接口。
没有补全，用户不知道该打什么，每一次 @ 都会静悄悄地谁也通知不到。

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
`POST|DELETE /:id/like`、`GET|POST /:id/comments`、`DELETE /:id/comments/:commentId`、
`POST|DELETE /:id/comments/:commentId/like`、`GET|POST /:id/danmaku`、
`DELETE /:id/danmaku/:danmakuId` **全部**按同一条规则挡，非作者一律 404。
只挡详情等于给私密作品留了个探测旁路 —— 新加任何一条子端点都要进这张表。
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

## 举报

能举报**三种对象**：作品（`video`）、评论（`comment`）、弹幕（`danmaku`）。
三者共用一张 `Report` 表与同一条处理流程（待处理 → 下架 / 删除 / 驳回）——
管理端要的是"一个按时间排的待处理队列"，拆三张表那个队列就得三查一合再排序。

### 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/branch/reports` | required | 提交举报 `{ targetType, targetId, reason, detail? }` → 201 `{ ok, report }`。重复举报 **409**。限流见下 |
| GET | `/api/admin/branch/reports` | **admin** | 举报队列。query `status`(默认 `pending`，`all` 看全部)、`targetType?`、`page`(默认 1)、`limit`(默认 20，上限 50) → `{ ok, items, total, page, limit, status, targetType? }` |
| PATCH | `/api/admin/branch/reports/:id` | **admin** | 处理一条 `{ action, note? }` → `{ ok, report, applied, alsoResolved }` |
| POST | `/api/admin/branch/videos/:id/takedown` | **admin** | 下架一条作品 `{ reason }`（**必填**）→ `{ ok, video }`。可撤销 |
| DELETE | `/api/admin/branch/videos/:id/takedown` | **admin** | 撤销下架 → `{ ok, video }`。**幂等**（对没下架的作品调也 200，后台重复点不该报错） |
| GET | `/api/admin/branch/takedowns` | **admin** | 已下架列表。没有它，"撤销"就是个找不到入口的功能 |
| GET | `/api/admin/branch/stats` | **admin** | `{ users, videos, takenDown, comments, danmaku, pendingReports }`，全部 `countDocuments` |

★ `reason` 必填不是形式：作品消失了还不告诉作者为什么，比不下架更糟（见 BranchVideo 的「平台下架」）。

★ `stats.pendingReports` 有**两种空**，客户端必须分开显示：
`null` = 这台服务端没有举报功能（老服务端），后台画 `—`；
`0` = 有举报功能、当前没有待处理的。把 null 当 0 显示就是在说"没有活要干"，而实情是"问不到"。

★ **硬删除没有另开管理路径**：`DELETE /api/branch/videos/:id` 已经放行管理员
（权限判据只有一处：`assertCanDelete`）。再开一条 `/api/admin/...` 的删除端点
就是同一条规则的第二处实现。

服务端实现：`models/Report.js` + `controllers/report.controller.js` +
`routes/report.routes.js`（**导出两个 router**，在 `app.js` 里挂两个前缀）。
★ 管理端那两条挂在既有的 `/api/admin` 门后面（与管 Idea/Leaderboard 那 8 条同一道门），
但**实现仍在 report.routes.js 一处** —— 举报的读写共用同一套序列化与同一份状态机，
拆进 `admin.routes.js` 就变成"加一个动作要改两个文件"（铁律六）。
★ 「谁是管理员」的判据只有一处：`utils/roles.js` 的 `ADMIN_ROLE` / `isAdmin`。

非管理员打后两条是 **403**，不是 404。★ 与作品可见性那边"一律 404"是两回事：
那边要藏的是"这条作品在不在"，这里路径本身就写在契约上、藏不住，而队列内容根本没返回，
403 一个字节的新信息都没多给。

⚠ 路径改动必须**两仓同时改**（app 侧只有 `src/api/admin.ts` 的 `PATHS` 一张表）。
真机上改错了**不会 404**：Capacitor 对未命中路径回 **200 + index.html**，
于是"服务端根本没这个端点"会伪装成"一条举报都没有" —— 所以客户端一律**判回包形状**，
不判状态码（`readPage` / `submitReport` 已经这么做了）。

### 一条举报（响应形状）

```
{
  _id, targetType, targetId,
  reason, detail,                      // detail 可空串
  status,                              // 见下「状态机」
  reporter: { _id, username, displayName, avatarUrl },
  handler: {…} | null, handledAt: ISO | null, handleNote: "",
  createdAt,
  // ↓ 只有管理端列表才有
  target: { exists, … },               // 见下「target 是现查的」
  reportCount, pendingCount            // 这个**对象**一共被举报几次 / 还剩几条没处理
}
```

`reportCount` 是管理员最需要的信号：**30 个人举报同一条 ≠ 1 个人举报 30 条**。
（后者不可能发生 —— 见下「去重」。）

★ 处理信息用 `handler` / `handledAt` / `handleNote`，**没有** `resolution` 字段：
"做了什么"已经写在 `status` 里了（`taken_down` / `deleted` / `dismissed`），
再开一列就是同一件事存两遍，早晚对不上。

### 理由枚举（`reason`）

| key | 中文文案（客户端渲染） |
|---|---|
| `porn` | 色情低俗 |
| `violence` | 血腥暴力 |
| `abuse` | 人身攻击 / 辱骂 |
| `spam` | 垃圾营销 / 刷屏 |
| `infringe` | 侵权 / 冒用他人作品 |
| `other` | 其他（配合 `detail` 用） |

★ 落库的是**英文 key**，中文只在客户端。存中文的话改一版文案就得写数据迁移——
与 @提及那边「身份存 userId、名字现查」同一条道理：key 是身份，文案是显示。
★ 这六个 id 在 server `models/Report.js` 的 `REASONS` 与 app `src/api/admin.ts` 的
`REPORT_REASONS` 里**逐字相等**。两仓不在一个 CI 里，对不上的表现是用户选了「人身攻击」
而服务端 400，或者管理员看到一个认不出来的 key —— 而那恰恰是他判断要不要下架的主要依据。
★ 客户端遇到**不认识的 key 原样显示**，不要退成"其他"：那会把一条真实的举报理由
悄悄改写成另一个意思（铁律七/八）。
★ `other` 不是凑数：分类枚举永远盖不全，没有兜底项时用户只会随便挑一个不对的，
管理员看到的分类反而更脏。`detail` trim 后 **≤ 500 字**，客户端输入框上限必须与它相等。

### 状态机

```
                 ┌─ action=takedown ─▶ taken_down   内容还在，但谁都看不到
pending ─────────┼─ action=delete   ─▶ deleted      连内容一起删，不可撤销
                 └─ action=dismiss  ─▶ dismissed    举报不成立，内容照旧
```

动作 → 状态的映射**只有一处实现**：server `models/Report.js` 的 `ACTION_STATUS`。

- 只能**从 `pending` 出发**。已处理的再 PATCH 一次回 **409**（两个管理员同时点，
  不判这一下就会走两遍下架、写两遍处理人，后写的把先写的悄悄盖掉）。
- 离开 `pending` 时 `handler` / `handledAt` / `handleNote` 三样**一起**写入。
- 请求体只收 `action`，**不收目标状态**（比如 `status: "taken_down"`）——
  收了的话客户端就能把一条举报标成"已下架"而没有任何内容被下架。
- `takedown` 与 `delete` 是**两件事**，状态必须分得开：事后追责时"下架了"和"删没了"
  完全不同。两者调**同一个**服务，差别只有一个 `hard` 标志（见下）。

★★ **`status` 是跨仓字符串，新增取值必须两仓同步**（铁律九：server 的
`models/Report.js` 的 `ACTION_STATUS` + app 的渲染分支 + 本节）。
**老客户端读到不认识的取值时，判据一律是 `status !== "pending"` 即已处理**——
判否定，不判等值（与 `visibility !== "private"` 同源）。写成
`status === "dismissed" || status === "taken_down"` 的话，将来加一个 `duplicate`
之类的取值，老包会把它显示成"还没人管"，用户于是反复重新举报（而重新举报会被 409
挡住，他只会觉得 App 坏了）—— 这一个字的错不会有任何报错。

### 去重：同一个人对同一个对象只能举报一次

`{ reporter, targetType, targetId }` **唯一索引**。第二次（哪怕换个理由）回
**409 `DUPLICATE`**，`details` 里带 `{ reportId, status }`，客户端据此显示
"你已经举报过这一条了，当前状态：…"。**不许把 409 吞成成功**：用户以为自己第一次
没点上，就会反复点，每一次都撞同一个 409。

★ 没有这条索引，一个人写个循环就能把待处理队列刷成一万条同一个视频，真正需要人看的
被埋在下面 —— 不需要任何漏洞，只要一个合法账号。服务端那次预检 `findOne` 只是为了给一句
人话；**并发下真正兜住的是索引**（两个请求同时到达时预检会双双扑空），两处缺一不可。

### 限流：两个窗口，都按【账号】

| 桶 | 窗口 | 上限 |
|---|---|---|
| `report:create` | 60s | 10 |
| `report:daily` | 24h | 50 |

超限回 **429**（客户端文案："举报太频繁了，过一会儿再试"）。

★ 按账号（`userRateLimit`）不按 IP：这条在 `requireAuth` 后面，按 IP 计等于"换个出口就重开
一桶"，同时又会让同一个 NAT 后面的真人互相抢额度（理由与发评论那条逐字相同）。
★ 两个窗口缺一不可：只有短窗的话，一天 1440 分钟 × 10 = 一万四千条照样能把队列埋掉；
长窗才是硬顶。唯一索引只保证"同一个人对同一个对象一次"，**挡不住**"一个人举报一千个不同对象"
—— 那正是这两个桶存在的理由。

### ★★ 提交端点**不校验对象存在 / 可见**

举报一个根本不存在的 id 也会 **201**。这是刻意的：任何"存在就 201、不存在就 404"的写法，
都会把这条端点变成一个**探测私密作品的旁路**——拿一串 id 挨个试，凭状态码就能把库里
有哪些作品、哪条评论属于哪条作品数出来（与 `assertVisible` 挡的是同一类，那边为此
把 403 全改成了 404）。而举报天然是"我刚才看到了这个东西"：看不见就没有举报入口，
校验换不来什么，却要在举报这边抄第三份可见性规则（铁律六）。

垃圾举报由三样兜住：① 唯一索引；② 上面两个限流桶；③ 管理端**现查**对象，
查不到就如实标 `target.exists = false`，一眼能筛掉。

★ 同理，请求体里**不收 `videoId`**（发了会被 zod strip 掉）。那是外部输入，伪造一个
别的作品 id 就能让管理员点去看错误的现场；评论/弹幕属于哪条作品由服务端按 `targetId`
**现查**，那份才是权威的（结果在 `target.videoId` 里回给管理端）。

### `target` 是**现查**的，不是快照

管理端列表里每条举报会把被举报对象**当场查出来**（按 `targetType` 分三批查，不是逐条）：

| targetType | `target` 字段 |
|---|---|
| `video` | `{ exists, videoId, title, cover, visibility, takedown, author, createdAt }` |
| `comment` | `{ exists, videoId, text, author, createdAt }` |
| `danmaku` | `{ exists, videoId, text, at, author, createdAt }` |

- 查不到一律给 `{ exists: false }`。★ 用**必给的布尔** `exists`，不用"缺省即正常"的
  `missing?`：后者一旦服务端漏给这一项，客户端读到 `undefined` → falsy → 显示成
  "内容还在"，管理员会对着一条早就没了的内容按下"下架"。缺省必须是**未知**，
  而未知在这里不该存在 —— 所以这一项永远显式给（铁律八）。
- `takedown` **原样带出**那一列（没下架就是 `null`），管理端据 `takedown.at` 存不存在
  显示"已处于下架状态"。★ 这里刻意不算一个 `takenDown` 布尔：怎么判一条作品下没下架
  由 server `branchVideo.controller` 的 `isTakenDown` 一处说了算，在举报这边再写一遍
  就是第三份判断（铁律六）。⚠ 队列里出现"已下架但还有待处理举报"是正常的 ——
  管理员也可以走 `POST /api/admin/branch/videos/:id/takedown` 直接下架，那条路不碰举报队列。
- **不存快照**。快照只能来自举报者的请求体（外部输入，伪造一段脏话栽赃谁都做得到），
  而管理员要看的本来就是**现在**的内容。
- `Report.targetId` 上**没有 `ref`**：一列同时装三张表的 `_id`，写死任意一个都会让
  populate 在另外两种类型上**静默返回 null**（不报错，对象凭空消失）。解引用按类型分派。

★★ **弹幕这一项会带出 `author`** —— 弹幕的作者是**存了的**（`BranchDanmaku.author`），
只是对普通用户从不透出（见上「弹幕」：对外只有一个 `mine` 布尔）。
这里是全系统**唯一**一处把它露出来的地方，成立的前提是**整个列表端点挂在
`requireRole(ADMIN_ROLE)` 后面**。哪天把它放开给普通用户（比如做「我的举报」），
**必须先把这个字段摘掉**，否则举报一次就能查出某条弹幕是谁发的，整面弹幕墙都被去匿名化了。

### 「下架 / 删除」调另一条线的服务，举报侧**不写一行清理逻辑**

下架要连带清理的东西一长串（评论树、点赞行、弹幕、指向它的通知、计数回写……），
抄一份必然漏掉一两样，而漏了不报错，只是库里留下一堆谁也查不到也删不掉的行（铁律六）。
所以举报处理只**调用**：

```js
// server/src/services/takedown.service.js —— 它自己也不写清理逻辑，
// 全部转调 branchVideo.controller 的 applyTakedown / purgeVideo / purgeComments
exports.takedownTarget = async ({ targetType, targetId, operatorId, reason, hard }) => { … }
//   hard=false → 下架（可撤销，内容还在但谁都看不到）    hard=true → 硬删除（不可撤销）
//   失败 throw；返回值原样放进响应的 `takedown` 字段
```

对应关系：`action=takedown` → `hard=false`，`action=delete` → `hard=true`。
成功时响应里 `applied: true`，并且**同一个对象上其余待处理的举报被一并收尾**
（内容都没了，剩下那些谁也处理不了），条数在 `alsoResolved` 里。
`dismiss` 既不调服务也**不**级联：不同人举报的理由可能不同，驳回"垃圾营销"
不代表"色情"也不成立。

⚠ **评论与弹幕没有可撤销的下架**（那两张表没有隐藏位），对它们用 `action=takedown`
会得到 **400**「请改用 action=delete」。★ 这是**故意不降级**的：悄悄替管理员把"下架"
办成"删除"，会让举报记录上写着 `taken_down`（可撤销、内容还在）而内容其实已经没了 ——
事后申诉时谁也说不清发生过什么，且一个错都不报。

★★ **任何一种失败（服务抛错、400、以及服务整个不存在时的 501）都不写状态**：
举报原地留在 `pending`，管理员可以重来。把状态标成 `taken_down` 而内容还挂在首页上，
是这一整块里最坏的一种失败 —— 管理员以为处理完了、举报者以为被受理了，
而那条内容一直在线且全程零报错（铁律八）。客户端必须把这几种失败都当成"没处理成"
来显示，不能吞掉、更不能把那一行从列表里摘掉。

服务文件缺失时（部署漏了文件之类）回：

```
501  { ok:false, code:"TAKEDOWN_UNAVAILABLE", details:{ reportId, status:"pending", action, applied:false } }
```

回归测试 `server/tests/report.spec.js`（R1–R12，13 条）。★ R11 / R11b 一律**看内容**
（作品是不是真的 404 了、评论是不是真的从列表里没了），不看状态字段 ——
"状态对、内容没动"正是这块最需要防的失败。

## 随作品发布的卡组（`deck`）

`{ name, cards: [{ cardId, type, name, summary, cover, tags, views? }] }`，**内嵌快照**，
不是对 `BranchCard` 的引用——作者事后删掉自己库里的卡，已发布作品里的卡组不能跟着少张。

- 客户端 `Card.id` 落库统一叫 `cardId`（与 `BranchCard` 对齐），两个名字服务端都收
- `cards[].cover` 与帧字段走同一套转存（dataURL → Cloudinary）
- `cards[].views` 已经是永久 URL（客户端在加图那一刻就转存过了），**不需要**再转存一遍。
  ⚠ 这份快照是**作品**的，不是 `BranchDeck` 的那份 —— 两套 schema 各存各的，
  要声明的是 `models/BranchVideo.js` 的 `deckCardSchema` **加上** controller
  `transferDraftAssets` 里那份**字段白名单**（`deckCardBody` 是 `.loose()`，zod 放行，
  真正丢字段的是这两处）。漏掉的表现：观众把这套卡组装走之后卡还在、形象参考没了，
  炼出来的人物不是同一个人，而且一点错都不报。用例：`branchVideoVisibility.spec.js` V3b
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
`app/src/data/economy.ts` 的 `VIDEO_TIERS` / `IMAGE_TIERS`）。**App 新增视频档位 =
服务端要补一行** —— 每加一个模型都是一笔新单价，应该有人明确点头。
★ **出图那几行是从价目表自动带出的**（`ALLOWED_MODELS` 里摊开 `tokens.IMAGE_MODELS`）：
出图的「在册」与「有价」必须是同一件事。分成两张手写的表有两种漏法，而且都不报错 ——
在册了没定价 = 落到兜底按最贵档收（用户被多扣）；定价了没在册 = 这一档永远 400
（用户只会觉得"这档坏了"）。回归测试见 `server/tests/arkProxy.spec.js`。

### 视频档位与模型能力（写死在两边的表里，不靠运行时探测）

| 档位 id | label | 模型 | 系数 mult | 首尾帧 | 参考图 | 最短时长 | 套餐门槛 |
|---|---|---|---|---|---|---|---|
| `fast` | 极速 | `doubao-seedance-1-0-pro-fast-251015` | 0.3 | ✗ | ✗ | 3s | — |
| `std` | 标准 | `doubao-seedance-1-0-pro-250528` | 1 | ✓ | ✗ | 3s | — |
| `hd` | 高清 | `doubao-seedance-2-0-mini-260615` | 1.6 | ✓ | ✓ | 3s | — |
| `ultra` | 电影级 | `doubao-seedance-2-5-260628` | 4.7 | ✓ | ✓ | **4s** | **仅付费套餐** |

- **参考图（全模态参考生视频）只有 2.5 与 2.0 系列有**；1.0/1.5 完全不支持。没人验证过
  1.0 收到 `reference_image` 是 400 还是**静默忽略** —— 若是忽略，用户就"加了图、多付了钱、
  画面一点没变、零报错"。所以 App 侧按 `VideoTier.refImg` 做硬白名单，不满足**降级回
  首尾帧模式并把原因说出来**，不指望方舟报错。
- **首帧 / 首尾帧 / 参考生视频是三种互斥场景**（方舟文档原文），不可混用：给了
  `reference_image` 就一张首尾帧都不能带。
- **2.5 在首帧/首尾帧任务上只接受 `ratio: "adaptive"`**（2.0 系列没有这条限制）；参考生
  视频任务上才能给具体宽高比。规则收在 `app/src/ai/arkClient.ts` 的 `ratioFor()` 一处。
- **2.5 的参考任务必须显式传 `omni_reference_task_type: "reference"`**：不传就是 `auto`，
  而 auto 判错是**异步失败** —— 任务已受理、钱已经扣了，几十秒后才 failed（受理后失败不退，
  见下）。显式传则在提交时同步 400，一分钱不花。
- **2.5 的时长区间是 [4,30]**，给 3 秒同步 400。App 的时长下限写在 `VideoTier.minSec`，
  报价（`segTokens`）与出片（`composeSegments`）用同一个 `clampDuration`。
- **`ultra` 仅付费套餐可用**：App 侧免费版**看得见但点不动，并写出原因**（藏起来用户
  不知道有这回事），判断只有 `app/src/data/account.ts` 的 `tierBlockReason` 一处。
  ⚠ 客户端禁用只是提示，**不是安全边界** —— 服务端必须按当前用户的套餐再挡一次，
  免费版调 2.5 直接拒并给出可读原因。

### 出图档位与计价（**按 `model` 查表，不是一口价**）

| 档位 id | label | 模型 | 单价 | token/张 | 图位数 K |
|---|---|---|---|---|---|
| `sketch` | 速写 | `doubao-seedream-4-0-250828` | 0.20 元/张 | **13,333** | 1 |
| `studio` | 定妆 | `doubao-seedream-4-5-251128` | 0.25 元/张 | **16,667** | 2 |
| `master` | 精绘 | `doubao-seedream-5-0-pro-260628` | 0.60 元/张 | **40,000** | 3 |

折算口径与视频同一把尺子：**元/张 ÷ 15 元/百万 token**（15 = Seedance 1.0-pro 标准档）。
实际张数 = `min(K, 该卡种的图位数)`，见上面「`views[].kind`」——非人物卡只有 2 格，
顶档对它们真的少画一张、也真的少收一次钱（`economy.slotsFor()` 一处实现，报价与结算共用）。

★ **2026-08-11 之前这里是个致命缺口**：服务端 `priceOf` 拿到了请求体却**不读 `model`**，
一律按 13,300 收 —— 也就是**顶档按最低档收费**，每张顶档图白送 0.4 元。这种错没有任何
症状（用户无感、界面无错、测试全绿），只有火山账单知道。现在 `config/tokens.js` 按模型
查表，`arkProxy.spec.js` 与 `tokenWallet.spec.js` 各钉了一份。

★ **认不出的出图模型按已知最贵的一档收，并打 `console.error`**，既不按最便宜的收
（等于白送且永远没人发现），也不 throw（`billedForward` 会把它变成 500，**出图整条全挂**；
出图端点是用户可控 `model` 的转发口，老客户端随时可能发一个没登记的 id）。
方向是刻意选的：**少收是隐形的，多收当天就会被投诉**。这条兜底在路由上其实够不着
（在册 = 有价），是第二道保险。

⚠ **老客户端那个出图模型不能从在册名单里删。** 新版 app 已经把
`arkClient.MODELS.image` 改成跟着默认档走（`imageTierOf(DEFAULT_IMAGE_TIER).model` = 4.0），
新包不再发 `doubao-seedream-5-0-260128`；但**已装机的 APK 改不了** —— 它们补设定帧、
推三套方案的首尾帧、出 AI 封面全都还在发这个 id。删掉的表现不是"降级"，是那批用户
**出图整条 400**（而客户端把 400 当敏感词处理，连重试都不做）。
它的单价在方舟公开价目里**查不到**，所以服务端不去猜，直接沿用**老包自己报的那个价
13,300**（老版 `economy.IMAGE_TOKENS` 的常量）—— 老用户的「报价 = 实收」逐分不变，
这次改价对他们是**零影响**。若 5.0 实际更贵，差价我们自己吃：多收才是骗人，少收只是
我们亏钱，而且这批调用会随老版本淘汰而归零。
★ 这条兼容项的寿命 = 老版本的寿命；确认线上没有旧包在发它之后，连同白名单一起删。

各模型的像素区间是 2026-08-11 拿真 key 探出来的（发必然 400 的尺寸、读报错文案，零成本）：

| 模型 | 最小像素 | 最大像素 |
|---|---|---|
| `doubao-seedream-4-0-250828` | 921,600 | 16,777,216 |
| `doubao-seedream-4-5-251128` | 3,686,400 | 16,777,216 |
| `doubao-seedream-5-0-260128` ⚠仅老客户端 | 3,686,400 | —（未探） |
| `doubao-seedream-5-0-pro-260628` | 921,600 | 4,624,220 |

★ 那条 3,686,400 是 **4.5 / 5.0 专属**，不是 Seedream 通则 —— 别照抄成全家桶下限。
★ 卡面画布 `CARD_SIZE = 1728×2304 = 3,981,312` 像素：过得了 4.5 的下限，在 pro 上落在
**0.60 元那一档**（pro 按输出像素分档：≤236 万 0.30、>236 万 0.60）。这是有意的 ——
压到 236 万以下单价减半，但顶档出的图会**比中档还小**，一个"更贵却更糊"的顶档迟早被
当成 bug。哪天真要换成半价版，`ImageTier.size` 与两仓的价目表要**一起**改。
★ pro 实测出一张 1296×1728 要 **73.6 秒**（5.0 是 21-25s），所以客户端出图超时必须
大于服务端 `T_CREATE`。

⚠ 以上单价取自方舟公开价目（2026-08-11 核对），**尚未与控制台账单对过**。
**真实结算一律以控制台账单为准**；发现偏差改两仓的价目表（下面那条测试会红）。

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
| `POST /images/generations` | **按 `body.model` 查表**：13,333 / 16,667 / 40,000（见上「出图档位与计价」）。认不出的按最贵档 |
| `POST /chat/completions` | 400（一次豆包往返） |
| `POST /contents/generations/tasks`（Seedance） | `时长×1280×720×24/1024 × 档位系数`（极速 0.3 / 标准 1 / 高清 1.6 / 电影级 4.7） |
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
两张表的 **key 集合与数值必须逐条相等**，服务端有测试钉着（加档位漏一边就会红）：

| 内容 | app（报价） | server（结算） | 钉住它的测试 |
|---|---|---|---|
| 视频档位系数 | `VIDEO_TIERS[].mult` | `VIDEO_MULT` | `arkProxy.spec.js`「跨仓档位系数一致性」 |
| 出图单价 | `IMAGE_TOKENS_BY_MODEL` | `IMAGE_TOKENS_BY_MODEL` | `arkProxy.spec.js`「跨仓出图价目一致性」 |
| 套餐 / 直充包 | `PLANS` / `RECHARGE_PACKS` | `PLANS` / `order.service.RECHARGE_PACKS` | `payOrder.spec.js`「跨仓价目一致性」 |

出图那组除了逐条比数，还额外钉了三件事：**三个价互不相同**（证明"真的读了 `model`"，
而不是碰巧等于某一档的常量）、**档位越高越贵**（顺序倒挂 = 用户为更好的图付更少）、
**兜底不静默**（认不出的模型必须打日志）。

⚠ `电影级` 的 4.7 = **70 元/百万 token ÷ 15**（标准档 1.0-pro 15 元/M = 1）。这个 70
**不是从方舟官方价目表页读到的**（那页抓不到内容），是两个独立来源互相印证：另一来源
报「720P 每秒约 1.51 元」，而 1 秒 720p24 = 21,600 token ⇒ 1.51/0.0216 ≈ 69.9 元/M。
上线前必须照**控制台实际账单**校一次。

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
