# 模板作者奖励（2026-10-30 拍板，设计正本）

> 出处：`docs/decisions-2026-10-30.md` 第二节第 2 条。同类做法：CapCut 模板创作者 / TikTok Effect House / 抖音像塑 / PixVerse 都**按使用量**给、有门槛与封顶；
> 我们已有的「同款奖励」（模板体系 P3b，server `services/remixReward.service.js`）就是这个形状 —— 模板奖励**照抄它**，只换触发源与几个数。
> 钱的红线不变：平台印 token、**不许**用户之间流转、不做现金。

## 一、规则（服务端判，App 只复述服务端下发的那一句）

- **触发**：一条**公开**作品，发布体里带着它套用过的模板 id（`templateIds`，见契约），发布满 **24 小时**那一刻还公开着、没下架、作者与模板作者之间没有拉黑 → 给**模板作者**发 token。
- **一条作品 × 一个模板 = 最多一次**；一条作品用了几个不同模板就各判一次（各自占位，R1 恰好一次）。作者自己套自己的模板不发。
- **数**（`config/templateReward.js`，与 remixReward 同形）：每次 **10,000** token（同款是 30k：套模板比照着流程做同款轻得多、频次高得多）；
  每位模板作者 24 小时最多 **20** 次；每个模板一共最多 **200** 次；每个**使用者**24 小时最多给别人带来 **3** 次（防互刷，与同款的 PER_REMIXER_PER_DAY 同一个理由）；
  全站保险丝每 24 小时 **200** 次（环境变量 `TEMPLATE_REWARD_GLOBAL_PER_DAY`），断了发信；总开关 `TEMPLATE_REWARD_ENABLED`。
- **上限不顺延、判定只做一次、不追回**（R2 / R3 原文照搬）。
- 文字模板（2.71 起的「只用文字 + 封面」，P1 只存本机、没登记服务端）**没有服务端 id，不在此列**；上市场（P2）之后自然进来。

## 二、契约（与 server 同步改）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/branch/videos` | 发布体多一格 **`templateIds?: string[]`**（≤ 20、去重、每个是 BranchTemplate 的 ObjectId）。zod 要声明（不声明会被 strip，零报错）。服务端只收**存在的**模板 id、丢掉不存在的，落 `BranchVideo.templateIds` + `templateReward.pending: true`（有 id 才落） |
| PATCH | `/api/branch/videos/:id` | 回炉换内容时同样可带 `templateIds`（覆盖）；已经判过的 (作品, 模板) 不再判 |
| GET | `/api/branch/template-reward` | 规则下发 `{ ok, reward: { enabled, tokens, perAuthorPerDay, perTemplate, perUserPerDay, holdMs }, mine? }`（外壳与 `GET /api/branch/remix-reward` 逐字同形：App 判「有没有 `reward` 对象」不判状态码；server#145 实现时多给了 `mine`，App 第一版不读）—— App 的那一句话只读它（`data/templateReward`） |
| 通知 | `BRANCH_TEMPLATE_REWARD` | `payload: { tokens, templateId, templateTitle, videoId }`；点进去落到自己的模板详情页 |
| 健康端点 | `templateReward: true` | App 见不到就不说那一句、不发 `templateIds`（老服务端会 strip，发了也无害） |

账本类别 `template_reward`（不在 REPAY / SPEND 名单里，同 `remix_reward`）；memo 逐字 `模板奖励 video:<作品 id> tpl:<模板 id>`（R1 的证据）。

## 三、服务端怎么做（server PR，要「合」）

1. `models/BranchVideo.js`：`templateIds: [ObjectId ref BranchTemplate]`（默认不给、判否定）、`templateReward: { pending: Boolean, at: Date }`。
2. `schemas/branchVideo.schemas.js`：`templateIds` 进 publishBody 与 updateBody。
3. `models/TemplateReward.js`：照 `RemixReward.js`，唯一索引 `{ video, template }`，`status: claimed | paid | skipped`、`reason`、`open`。
4. `services/templateReward.service.js`：**复制** remixReward.service，把「同款 → 原作者」换成「作品 → 模板作者」（模板作者 = `BranchTemplate.ownerId`），
   使用者上限数 `BranchVideo.author`；其余 R1~R4 原样。清扫器挂进 `index.js` 那同一轮（只在 0 号实例）。
5. `config/templateReward.js`：第一节的数；`routes/branchTemplate.routes.js` 加 `GET /template-reward`；通知类型进 `notification.service` 的白名单；健康端点加位。
6. 测试照 `tests/remixReward.spec.js` 复制一份（恰好一次、三道上限、保险丝、拉黑、自己套自己不发、老发布体不带字段照常）。

## 四、App 怎么做（随后一个 App PR）

1. **发布时带 `templateIds`**：组稿那一拍抓下的画布（`data/projects.captureCanvas` / `PendingCanvas`）里每段的 `tpl` 经 `recipe.ts` 同一个 `tplResolver`（本机 id → 服务端 id）得到 id 列表，去重后进发布体；
   `videos.pushPublish` / `flushPending` 两条路都要带（与 `shareRecipe` 盖进 `PendingCanvas` 同一条理由：发布可能离线排队）。服务端 `templateReward` 能力位为假时不带。
2. **那一句话**：`components/recipe/RemixRewardNote` 旁边加同形的 `TemplateRewardNote`，数全读 `data/templateReward`（服务端下发），没到就不说；摆在模板详情页（只给模板作者看，在「发布到模板市场」那一行下面）与模板货架「我的模板」页签顶上 —— **不摆发布页**：发片的人不是拿奖励的那一方（app#453 落地时定）。
3. **通知页**认 `BRANCH_TEMPLATE_REWARD`（礼物头像，点进自己的模板页）。
4. 知识库：§3.9 / §4.4 各一句；禁止承诺 31b 改口（现在写的是「不说套用模板有奖励」）。

## 五、先后

服务端先上（老 App 不发 `templateIds`，什么都不会发生）→ App 发版带字段 → 第一笔奖励要等有人用新版发布并满 24 小时。
