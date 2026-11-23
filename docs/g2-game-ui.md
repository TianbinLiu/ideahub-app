# 工坊对局界面（G2 第二块：把规则引擎接到工坊界面上）

> 2026-11-22。只做 **2D 覆盖层**：HUD / 商店 / 背包 / 点选式装备 / 风格卡三选一。
> **不做** 3D 拖拽、不接生成、不换工坊的铸卡 / 市场 / 卡组流程、不动 `src/studio/scene/`。
> 规则只有一份实现：`src/studio/game/rules.ts`（G2 第一块，见 `docs/game-rules-engine.md`）。

## 入口

工坊（`/studio`）横屏时舞台右上角那一组：没开局是 **「▶ 开局」**，开局后是 **「✕ 结束对局」**。
G4 第 1 步之前它在右栏最上面（`src/studio/ui/SceneRails.tsx` 的 `MarketRail`）。那两条常驻栏
已按 `docs/g4-ui-revamp-spec.md` §2 删掉，入口搬进顶栏；竖屏不挂对局 UI —— G1 的竖屏逐字不变。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/store.ts` | 对局状态（zustand）：一局的 `GameState` + 点选装备 / 替换流程 / 失败原因 / 轻提示。**动作全部委托 rules** |
| `src/studio/game/view.ts` | 界面读的视图模型（HUD / 商店 / 背包的数），全部问 rules 派生 |
| `src/studio/game/labels.ts` | 卡名 / 类型 / 品质 / 风格卡中文名与一行说明 / 档位名（规则层只有英文占位） |
| `src/studio/game/art.ts` | 卡面与风格样张的图从哪来（卡面借市场卡图占位；**风格样张是真图**，路径从 `rules.STYLE_POOL.sample` 取） |
| `src/studio/game/reasons.ts` | `RuleFailure` → 那一句人话（**唯一一处**） |
| `src/studio/game/ui/GameLayer.tsx` | 覆盖层外壳：状态栏（失败 / 替换 / 选中道具 / 刚做完）、商店与背包的摆放 |
| `src/studio/game/ui/GameHud.tsx` | 顶部常驻（G4 第 1 步起）：8 回合进度条 + 当前生命值。金币在背包条上、利息在商店键里，HUD 不再念回合/阶段/连胜/档位/存活 |
| `src/studio/game/ui/ShopPanel.tsx` | 5 张卡 + 买 / 刷新（2 金 / 免费券）/ 锁定（免费，状态可见）/ 收起。G4 起标题「商店 / 第 N 回合」撤掉 |
| `src/studio/game/ui/BagBar.tsx` | 底部 9 格（含已装备道具）、金币、类型上限、卖 +1、替换模式、点选装备；**右边是商店键**（G4：利息图标 + 数字，点它开/收商店） |
| `src/studio/game/ui/StylePick.tsx` | 进对局前的三选一：技法 + 题材 + 预览图 + 一行说明，选定锁死 |
| `src/studio/game/ui/GameCardTile.tsx` | 对局里一张小卡（塔罗卡面 + 品质角标），塔罗卡复用 `components/TarotCard` |
| `src/studio/game/ui/GameBtn.tsx` | 对局面板里的键（HUD/商店/背包同一套形状） |

## 动作 → rules

| 界面动作 | store 动作 | rules 函数 |
|---|---|---|
| 选风格卡 | `pickStyle`（+ AI 选完、开第一回合） | `pickStyleCard` → `beginRound` |
| 买卡 | `buy(slot)` | `buyShopCard` |
| 装不下 → 点一张旧卡替换 | `replaceAndBuy(outCardId)` | `buyShopCard(…, replaceCardId)` → `replaceCardInBag` |
| 刷新 / 锁定 | `refresh` / `toggleLock` | `refreshShop` / `toggleShopLock` |
| 卖卡 | `sell(cardId)`（回执里的钱数问 `cardSellValue`） | `sellCard` → `sellCardFromBag` |
| 点道具 → 点角色 | `pickItem` / `equipOn` | `equipItem` → `equipItemOnRole`（卸下走 `unequipItem` / `unequipItemFromRole`） |
| 派生读数 | `view.gameViewOf` | `incomeFor` / `bagUsage` / `styleCardOf` / `tableSlotsOf`（G4 桌面 5 个卡位） |

## 失败原因怎么透出

界面不写句子：store 把 rules 的 `RuleFailure`（`reason` + `need`/`have`/`count`/`cap`/`cardType`）原样留着，
`GameLayer` 上方那条状态栏用 `reasons.ruleFailureText` 说一句，例如：

- 金币不够：`not-enough-gold` →「金币不够：要 2 金，现在只有 0 金」
- 类型上限满：`type-cap` →「场景卡已经 1 / 1 张，到上限了——先卖一张，或者替换掉一张场景卡」
- 角色还挂着道具不能替换：`role-equipped` →「这张角色身上还挂着道具——先点它卸下道具，再替换」

两条规则：**买不成不设 disabled**（灰着点不动在手机上等于没反应），失败原因带 ✕ 可关；换一张再试仍
留在替换流程里（`pendingBuySlot` 不清），取消才算退出。

## 替换流程

1. 买卡失败原因是 `bag-full` / `type-cap` → `pendingBuySlot` = 那一格；
2. 商店那一格描边并写「等替换」，状态栏说「点背包里要被顶掉的那张卡（替换不返金币，想要钱先卖）」；
3. 背包条整条切进替换模式（每格「换这张」）→ 点一张 → 再走 `rules.buyShopCard(…, replaceCardId)`；
4. 还不成（`role-equipped` 等）原因照说，流程不退出；「取消」= `cancelReplace`，不扣钱不动卡。

## 风格样张（G2-c，2026-11-23）

三选一那一屏的图是**真样张**：`public/styles/<id>.webp`，八套各一张，八张合计约 350KB。

- **同一句话、只换风格**（§2.2）：八张共用一个场景句（雨夜里一个年轻女性在霓虹街头回头、半身构图），
  差别只有技法与题材那一段。换了内容就没法比较了 —— 玩家要比的是"这套风格长什么样"。
- **离线批量生成、打进包**：`design/gen-style-samples.mjs`（一次性工具，`design/` 不进 App 构建），
  方舟 Seedream `doubao-seedream-4-0-20260415`、1536×1152（4:3）出图，ffmpeg 转 512px webp 入包。
  重跑：`node design/gen-style-samples.mjs`（只补缺的）、`--force`（全重出）、`--only=<id>`（点名）。
- 单张 ≤ 80KB、八张合计 ≤ 600KB —— 由 `scripts/check-game-rules.mjs` 逐个核（连同"id 就是文件名"：
  `public/styles/<id>.webp`；缺文件、多出池子外的图、超体积，`npm run build` 当场红）。
- 池子是 8 套：§2.2 点名的六套（赛璐璐+赛博朋克、胶片颗粒+九十年代香港霓虹、湿壁画+文艺复兴奇幻、
  3D 动画+末日废土、水墨+武侠、绘本+童话森林）＋ 硬派黑白、水粉柔粉。
- 新增一套风格要走三处：`rules.STYLE_POOL` 加一条（id = 文件名）、`design/gen-style-samples.mjs` 的
  STYLES 加一条 `look` 并跑一次、`labels.ts` 的 `styleMeta` 补中文（en.po 同 PR 补英文）。

## G4 第 1 步（2026-11-23）：清理与布局骨架

施工单 `docs/g4-ui-revamp-spec.md` §2 的第 1 步，只动"长什么样、从哪拿数"：

- **删掉**：3D 桌面左上退出键；右上「重命名 / 问号 / 存草稿」；左右两条常驻栏（`src/studio/ui/SceneRails.tsx` 整个文件）；HUD 上的「第 N 回合 / 阶段名 / 本回合利息 / 连胜 / L1 草稿 480p / 存活 N 人」；商店面板标题「商店 / 第 N 回合」。
- **顶栏**：只剩「▶ 开局 / ✕ 结束对局」（横屏）、工作流画布与演示模式牌。
- **HUD**：8 回合进度条 + 当前生命值（只读 `view.hud.round/hp`，一个数都不在组件里算）。
- **利息**：搬进背包条右侧那颗商店键（利息图标 + 数字；「商店」只在 `aria-label` / `title` 里）。金币跟着背包条走。
- **3D 桌面**：视频节点链撤掉，换成 `layout.TABLE_SLOTS` / `TABLE_SLOTS_LAND` 的 **4 个角色位 + 1 个场景位**（场景位在角色排左上方、桌面中线玩家这一侧）。位子上是谁由 `rules.tableSlotsOf` 从玩家背包**只读派生**（角色按背包顺序、场景最多一张），3D 层（`TableScene.GameTableSlots`）只画"空 / 已放 + 卡名"。
- **还没做（第 2/3 步）**：拖卡入位、每角色最多 3 张道具 + 右侧道具栏与拆除工具、相机拉近与商店栏上移、工作流面板改纯预览、生成小窗（卡名进提示词）。
- 对话的出口：删掉顶栏返回键之后，NPC 气泡里补了一颗 28px 的「✕ 收起对话」（对话机位下看不到铸卡师本人，点不到她）。

## 还没做的（下一块）

- **3D 拖拽装备**：现在是点选式（点道具 → 点角色 / 再点角色卸下）。拖拽要在 3D 场景里做，这一块不碰 `scene/`。
- **样张进 i2i 链路**：§2.2 说选中的样张同时当风格参考图用，那是 G4 把「风格 + 卡 + 提示词」翻成
  `GenSpec` 时的事；这一块只把图摆出来。
- **回合循环**：G3 接上了（商店 → 创作 → 展映 / 点赞 → 投票 → 结算 → 事件 → 下一回合），
  见 `docs/g3-round-loop.md`；创作 / 展映 / 投票 / 结算 / 事件五个面板也在那一份里列了。
- **生成**：G4 才把「风格 + 卡 + 提示词」翻译成 `GenSpec`；G3 每一期是一条 5 秒占位片
  （色块 + 卡面 + 提示词，时长与是否锁住都问 rules），HUD 的档位现在只是 rules 的读数。

## 工坊默认档与真人卡（G4 前置结论，2026-11-23）

> 问题（G4 施工单 §1）：**最便宜的一档，能不能挂写实 / 真人角色卡，且不要求"火山引擎适用"那类认证素材？**
>
> 三句结论：
> 1. **能，用 `draft-mm`（MiniMax H3 Lite · 480P，免费档）**。它在真机上收写实人像首帧（2026-11-19），
>    而方舟那一侧同一张图**整发拒**（⚠ 免费账号在它上面只能纯文字出片，见 §6 末条）；
> 2. **`Card.realPerson === true` 的真人卡进不了对局**：全表唯一收真人照片的 `real` 档只认**一张**起拍画面
>    （`startOnly`），4 角色位 + 1 场景位挂不上去 —— 施工单里"那种卡永远不进游戏"不是取舍，是唯一解；
> 3. **`rules.generationTierOf` 的 L1 落到 tierId `draft-mm`**（回落 `draft`），档位表**一位都不改**，
>    改的是 G4 的翻译层。

### 1. 三位能力位各管一件事

| 位 | 说的是什么 | 谁读它 | 组合起来的意思 |
|---|---|---|---|
| `refImg` | 这一档**收参考图**（卡当参考图直发，不先画设定帧） | `data/cardFit.cardInputOf`、`segmentGen` 挑路径 | 真 = 参考图路；假 + 非 `startOnly` = 只经由帧（卡本身只以文字进提示词，画面靠设定帧 / 起拍画面）；`startOnly` = 只认**一张**起拍画面 |
| `realFace` | 这一档**直接收真人照片**（不认证也能用） | 只有 `account.realFaceIssue`（出片门禁）与 `cardFit` | 真 = 真人卡 `realPhoto`；假 = 真人卡 `noRealFace`（**意思是"没验过"**，见下） |
| `assetRef` | 这一档收**方舟可信素材** `asset://`（已授权的真人） | 同上两处 + `segmentGen` 的 `prepRefImage` 分流 | 对真人卡等价于"**必须先认证**"：没绑 asset 就是 `needAsset`，卡在那儿进不去 |

- ★★ **写实卡不看 `realFace` / `assetRef`**。判据只在 `data/cardFit.cardFitOn`：不是 `realPerson` 的人物卡，
  参考图路直接是 `image`、只经由帧的路是 `text` / `frameOnly`、起拍画面路是 `ownImage` / `onlyAsStart`。
  也就是说"写实"这两个字**在能力位上根本不存在** —— 它只在上游的输入图审核那里存在（见 §3）。
- ★ `realFace: false` 在 MiniMax H3 那三行上的意思是「**还没验过**」，不是「验过、不行」（`videoTierTable` 那三行的
  注释原话：2026-10-26 付费小验手上没有授权照片 ⇒ 一律按不收报）。别拿它当"验过的结论"用，也别顺手翻成 true。
- ★ `assetRef: true` 与 `realFace` 是两件事（档位表头那条 ★）：`draft` / `hd` / `ultra` 收 `asset://`，于是**真人卡**
  在那三档上的唯一出路是去做认证；**写实卡**在那三档上不过这道门，拦它的是另一件事。

### 2. 逐档结论（9 行全列）

价格按 **5 秒、9:16**（480p 横竖同像素，720p 一律 21,600/秒；真人档只卖 6 / 10 两整档）。写实卡一列是
**真机实测**，不是能力位推的。

| tierId | 芯片 | 模型 · 上游分辨率 | `refImg` | `realFace` | `assetRef` | 真人卡（`realPerson`）怎么进 | 写实卡（非真人）实测 | 5 秒价 |
|---|---|---|---|---|---|---|---|---|
| `fast` | 极速 | Seedance 1.0 pro fast · 720p | ✗ | ✗ | ✗ | 不收（只经由帧的档一律 `noRealFace`） | 没验过（参考图路没有；卡只能当文字 / 一张起拍画面） | 30,240（**11-24 13:00 停用**） |
| `draft` | 草稿 | Seedance 2.0 mini · 480p | ✓ | ✗ | ✓ | **要认证素材**（没绑 asset 就拒） | **拒**（2026-11-19，同一张写实人像首帧整发拒） | 77,004 |
| `draft-mm` | 草稿 | **MiniMax H3-Lite · 480P** | ✓ | ✗（未验） | ✗ | 位说不收（未验）；服务端另有一道（见 §6） | **收**（2026-11-19 同一条走通，还更便宜） | **56,000** |
| `std` | 标准 | Seedance 1.0 pro · 720p | ✗ | ✗ | ✗ | 不收（只经由帧的档一律 `noRealFace`） | 没验过（同上） | 108,000（**11-24 停用**） |
| `hd` | 高清 | Seedance 2.0 mini · 720p | ✓ | ✗ | ✓ | 要认证素材 | 拒（同方舟视频侧审核） | 165,600 |
| `hd-mm` | 高清 | MiniMax H3-Highspeed · 768P | ✓ | ✗（未验） | ✗ | 位说不收（未验） | **没验过** | 134,500 |
| `ultra` | 电影级 | Seedance 2.5 · 720p | ✓ | ✗ | ✓ | 要认证素材 | 拒 | 507,600 |
| `ultra-mm` | 电影级 | MiniMax H3 · 768P | ✓ | ✗（未验） | ✗ | 位说不收（未验） | **没验过** | 179,000 |
| `real` | 真人 | MiniMax Hailuo 2.3 Fast · 768P | ✗（`startOnly`） | ✓ | ✗ | **免认证，但只收一张起拍画面** | 收（2026-08-24 三发探针；写实 / 真人通吃） | **6 秒** 85,000（10 秒 143,200；没有 5 秒档） |

四种组合的读法，一句话一档：
- **`refImg ✓ + assetRef ✗ + realFace ✗`（`draft-mm` / `hd-mm` / `ultra-mm`）**：收参考图、**不要求任何认证**，
  真人卡按"不收"报（没验过）—— 写实卡的落点。
- **`refImg ✓ + assetRef ✓ + realFace ✗`（`draft` / `hd` / `ultra`）**：收参考图，但真人卡**必须**先认证素材；
  写实卡不走认证也被上游拦（两套探测器对**任何非 asset 的写实人脸图**都拦，`docs/backlog.md` §1 的 2026-08-28 实测）。
- **`refImg ✗ + startOnly + realFace ✓`（`real`）**：真人卡唯一免认证的路，代价是**只收一张**、6 / 10 秒整档、
  会员档（`freeOk: false`）、不出声（`audio: false`，没实测过）。
- **`refImg ✗ + assetRef ✗`（`fast` / `std`）**：只经由帧 —— 卡本身只能以文字进提示词，画面靠一张起拍画面（`i2v`
  收首帧，`flf: false` 只是不能首尾帧），4 张角色卡挂不上去；真人卡一律 `noRealFace`。这两档 11-24 13:00 停用。

### 3. 最便宜的那一档 = `draft-mm`（为什么不是 `draft`）

1. **先排除 `fast`**：最便宜（30,240/5 秒），但只经由帧 —— 卡只能当文字或**一张**起拍画面，
   4 角色位 + 1 场景位挂不上；而且它明天（11-24 13:00）就停用，不能拿来定对局的默认档。
2. **`draft` vs `draft-mm`：同一个 480p 级，差的正是这条**。5 秒价 56,000 < 77,004；写实人像那一发
   2026-11-19 真机同条件对比过：同一张 Seedream 画出来的写实人像首帧，Seedance 视频侧按"参考图 = 真人照片"
   整发拒，H3-Lite 同一条走通了（5 秒竖屏整段报价 82.7k vs 103.7k，两者差额 21,004 = 77,004 − 56,000，
   也就是两档视频价差的全部）。这条实测已经进了代码：`pages/QuickModePage.tsx` 的 `previewTierId()`
   就是"预览优先 MiniMax 草稿"。
3. **写实卡到底卡在哪**：不在 `assetRef`（那一道只对 `realPerson` 生效），而在**方舟视频侧的输入图审核** ——
   它对任何非 `asset://` 的写实人脸图整发拒，连 Seedream 画的也算（2026-08-28 认证实测 + 2026-11-19 快模式）。
   ⚠ **这一条今天没有任何能力位能表达**（表里没有"收不收写实人脸"这一位），所以界面也不能靠读表说清 ——
   只能靠"默认档 = MiniMax 那一行"把这件事绕过去，回落 Seedance 时**必须**当场说一句。
4. **如果"真人卡"按字面（`realPerson: true`）**：唯一免认证的是 `real`，但它是 `startOnly` ——
   4 角色位 + 1 场景位只能上 **1** 张首帧，其余卡只能报名字（`segmentGen` 的真人档那一支本来就只发一张图）。
   再加上会员档、6 秒起、不出声 —— 对局接它等于把"摆卡"这个玩法砍掉。**所以对局不接 `realPerson` 卡**。

### 4. 落点：L1 = `draft-mm`

- **规则层现状**：`rules.generationTierOf` 只回答「哪颗芯片 + 多长」（`tier: "draft" | "hd" | "cinema"` +
  `resolution`），**没有 tierId，也不认识 data**（`studio/game/types.ts` 的 ★：两边用 id 对齐是 G4 翻译层的事，
  规则层零依赖 —— `scripts/check-game-rules.mjs` 用 Node 直接 import 它）。
- 所以"L1 返回哪个 tierId"落在**翻译层**（G4 新建，建议 `src/studio/game/genTier.ts`），写法与快模式同一份：

  ```ts
  // 草稿那一颗芯片 → 同一颗芯片的另一家（2026-11-19 真机之后定的那一条）
  const base = tierOf("draft");
  const mm = tierOfPreferred(base, "minimax");
  return tierOffered(mm) ? mm.id : base.id;   // → "draft-mm" / 回落 "draft"
  ```

  → 这台机器给得出 MiniMax 时 **L1 = `draft-mm`**；给不出时回落 `draft`，并在那一格照实说
  「这台机器只有 Seedance，写实卡可能被拒」（话别写死在那儿：判据只有 `tierOffered`）。
- **为什么不把 id 塞进 `MODEL_LEVEL_TIERS`**：`tierOffered` / `tierBlockReason` 在 `data/account`（它拉
  lingui / 本地库），规则层引不了；写死 `"draft-mm"` 的后果是"没接 MiniMax 的服务器 / 不给 MiniMax 的地区"
  **第一回合就发不出去**，而回落得在规则层 / 翻译层 / 界面三处各写一份 —— 正是铁律六要治的形状。
- 若一定要规则层直接吐 id：最小改动是 `MODEL_LEVEL_TIERS[1].tier` 改 `"draft-mm"` + 放宽
  `GameGenerationTier.tier` 的类型 + 改 `scripts/check-game-rules.mjs` 那三行断言（217~219 行）。
  代价就是上一条，**不推荐**。
- **L2 / L3 必须一起对齐**（不然后面玩家一升档就撞回写实人脸审核）：
  - L2 `hd` → `hd-mm`（134,500 / 5 秒）优先，回落 `hd`（165,600）。⚠ **`hd-mm` 的写实人像没验过**，只说"这台机器给得出"，
    不说"写实卡一定行"。
  - L3 的 `"1080p"` **在档位表里没有这一行**：表里最贵只到 720p，1080p 只是 `ultra` 的「样片 → 定稿」第二步
    （`economy.draftFinalTokens`）。照字面实现 = 一条 5 秒片花两发：480p 样片 ≈ 225,776 + 1080p 定稿 ≈ 1,247,400，
    合计 ≈ **147 万 token（L1 的 26 倍）**，而定稿那一步在方舟上会被同一条写实人脸审核拒（2026-11-19 快模式
    定稿那一发就是这个事故）。→ 建议 L3 = `ultra-mm`（768P，179,000 / 5 秒），界面上别再写"1080p"。

### 5. 档位表要不要改能力位

**不改（推荐）**。三条理由：
1. 写实卡根本不经 `realFace` / `assetRef`（只认 `refImg`），而 `draft-mm.refImg` 本来就是 true ——
   "对局能挂写实卡"这件事，表上一个字都不用动；
2. H3 三行的 `realFace: false` 是"**没验过**"（§1 第二条 ★），翻成 true 等于替一次没做过的实测签字；
3. 翻了还会同时放开 `realPerson` 卡的**免费**出片 —— 与服务端 `MINIMAX_V2_FREE_TEXT_ONLY`（免费版在 H3 上
   只准纯文字，理由正是"H3 收不收真人照片没验过"）方向正好相反，也绕开"真人档只给会员"这条线。

若某天一定要让 `realPerson` 卡进对局，按代价从小到大三个选项：
- **A（推荐）入池处挡掉**：`realPerson === true` 的卡不进商店、也拖不进卡位，一句话用 `cardFit` 现成的
  `noRealFace` 语义说。零表改动，与施工单 §1 同一句。**今天还不用写** —— `rules.CARD_LIBRARY` 是内置占位目录
  （只有 `type` / `quality` / `name`，没有 `realPerson`、没有图），G4 把玩家自己的卡库接进卡池那天才需要这道闸。
- **B 改表**：`draft-mm.realFace: true`。风险四条：① 真人照片在 H3 上**没验过**（服务端 `tokens.js` 那条 ★ 就是
  "等主人拍板的第 9 条"）；② 免费账号在 H3 上仍只能纯文字（见 §6），改了位还是出不了带图的片；
  ③ 真人照片**出境**（MiniMax 国际站，2026-09-26 的合规口径），H3 放开等于把这条线拆了；④ `real` 档被架空。
- **C 加一位** `photoFace`（"收照片级写实人脸"）：表 + `check-video-tiers` + 服务端镜像 + `cardFit` + 卡片页文案
  五处一起动；而且今天只有 `draft-mm` 敢标 true（`hd-mm` / `ultra-mm` 没验）。**这一位应当由实测驱动，
  不是由对局需要驱动。**

### 6. 免费套餐 / 管理员：走的是 token 钱包，不是游戏券

（只读服务端 `server/src/routes/`、`services/`、`config/tokens.js` 的结论，一行未改）

- **出片的三条链路**都走同一段"钱"的序列：
  `POST /api/ark/contents/generations/tasks`（Seedance，样片定稿也是它）／`POST /api/minimax/video`（真人档 V1）／
  `POST /api/minimax/v2/video`（H3）→ `requireAuth` →（方舟那两条经 `billedForward`，MiniMax 两条直接调）
  `arkGateway.chargedArkCall` → `billing.chargedCall` → `tokenWallet.debitSplit`（`plan` 桶 + `addon` 桶）。
  **没有任何一处按"游戏"分支**：对局接上以后出片就是普通出片。
- **免费套餐**（`config/tokens.js` 的 `PLANS[0]`）：`monthlyTokens: 0`、`welcomeTokens: 170,000`（一次性）、
  `dailyTokens: 2,000 / UTC 日`、`dailyCapTokens: 14,000`（最多攒 7 天）。免费版**没有**月度刷新
  （`tokenWallet.service.accrueDaily`，2026-10-07 改的，理由是月度刷新会把攒了几天的那点额度一把清零）。
- **管理员**：`billing.preAuthorize` 的 `free = isAdmin(user)` → 跳过冻结 / 日限 / 套餐门禁，**也不扣两桶**；
  上游受理之后 `noteFreeCall` 落一笔 `TokenLedger` 的 `admin_free`（`delta 0` + `costTokens = 报价`）——
  **免单但记账**（月底对账要能对上上游账单）。免费档门禁与 H3 的"只准纯文字"都只是经 `denyReason` 交给
  `preAuthorize`，而它对免单不生效 ⇒ 管理员**带图照常**（`tokens.js` 那条 ★ 也这么写）。
  ⚠ **地区门禁不豁免管理员**（`arkGateway.regionGate` 的 ★：那是地区政策，不是计费）。
- **"游戏券"在代码里不存在**：`GameTicket` / `gameTicket` 两仓零命中；`ticket` 只命中客服工单（`SupportTicket`）
  与上传直传票（`DirectTicket` / `uploadWithTicket`）—— 没有一个是出片用的代币。设计稿里写的"游戏券"
  （`docs/workshop-game-design.md` §四 的建议、G4 施工单 §0 的"每月 6 张"）今天一行实现都没有。
  所以"免费套餐 / 管理员在游戏内出片走什么"的答案是：**token 钱包**（免费 = 每日额度；管理员 = 免单 + `admin_free` 账），
  不是券。券那一套要新做（§7）。
- ★ **一个必须先解决的冲突**：`draft-mm` 是免费档，但服务端 `MINIMAX_V2_FREE_TEXT_ONLY = true` ——
  **免费账号在 H3 上只能纯文字出片**（带首帧 / 尾帧 / 参考图一律 403 `PLAN_REQUIRED` + `freeTextOnly`，扣费之前）。
  ⇒ 免费用户想在游戏里挂卡出片，两条路同时堵：`draft-mm` 不让带图，`draft` 收图但方舟拒写实人脸。
  免费用户今天只有"二次元卡走 `draft`"这一条通。这也决定了"券"必须顺带解决门禁口径（§7 第 5 条）。

### 7. 「每月 6 张券 + 任务加券」：改造建议清单（不实现）

按「表 → 服务 → 路由 → 门禁 → 退款 → 契约 / 健康端点 → App → 事件源」列九条。
**没有一条能省**，省了的那条都是"券花出去了、账对不上"。

| # | 改哪儿 | 怎么改 | 为什么不能省 |
|---|---|---|---|
| 1 | 表 | 新集合 `GameTicket`（`@collection gametickets`）：`{ userId, cycle: "YYYY-MM", granted, used, earned }`，唯一索引 `(userId, cycle)`；月刷 6 张照 `tokenWallet.currentCycle` 同一个写法（UTC 月） | **别塞进 `User.tokenWallet`**：那张子文档的刷新是 `ensureWallet` 一条原子管道，两种币挤同一条条件更新，改一处两边都抖 |
| 2 | 表 | `GameTicketGrant`：`{ userId, source: "share" \| "invite", refId, day, count }`，唯一索引 `(userId, source, refId)` | 任务加券必须幂等 —— 没有唯一键，"点两次分享领两次"就是白送出一条片 |
| 3 | 服务 | `services/gameTicket.service.js`（**唯一实现**）：`ensureTickets`（照 `ensureWallet` 的 `$exists` / 条件抢占）/ `spendTicket`（先扣再转发）/ `refundTicket`（原样退回）/ `grantTicket`（带日上限 + 全站熔断 + 告警信） | 照 `templateReward.service` 的形状（`config/gameTicket.js` 规则表 + 服务 + 两端点 + 两道防刷 + 熔断信）。**这是"平台印钱"，不是用户之间转账**（`config/remixReward.js` 的 ★★） |
| 4 | 路由 | `GET /api/game/tickets` → `{ cycle, granted, used, left }`（形状照 `/api/me/wallet`）；出片仍用现有三条，请求体加 `billing: "ticket"`（或统一的头，走 `api/client.withAppVersion` 那类注入） | App 只显示服务端下发的数，不在本机算（同 `templateReward` 那条纪律：价目表两仓各写一份就散） |
| 5 | 门禁 | `billing.preAuthorize` 加**显式币种分支**（`currency: "ticket"`）；带券的那一发在 `videoPlanDenial` 里算 `paid` | ① 不能用 `cost = 0` 表示免单：0 成本会绕过冻结 / 日限 / 套餐判定的语义，账本上还会与 `admin_free` 混成一条；② 不把持券算 `paid` 的话，H3-Lite 403 `freeTextOnly`，券**一张也花不出去**在带卡的片上；③ 但**不能**写成"有券 = 付费用户"（那会让玩家白拿全部会员档）→ 只加一个 `ticket` 入参影响这一条判定，并在 `tests/arkProxy.spec.js` 与契约里钉住 |
| 6 | 退款 | `GenTaskCharge` 加 `currency: "token" \| "ticket"`；`services/taskRefund.settleTask` / `billing.refundUnaccepted` 按它退 | 今天只按两桶 token 退，券走这条路会被当成 token 记 —— 上游失败一次，玩家的券就变成他钱包里的 token，零报错 |
| 7 | 契约 / 健康端点 | `/api/ark/health` 加 `gameTicket: true` 能力位；`docs/api-contract.md` 补三节（券余额 / 带券出片 / 失败退券） | 老服务端没有这一位时 App 不摆"用券出片"（与 `serverCaps` 那一套同形） |
| 8 | App | `data/account` 的 `canAfford` 与各处余额门认券（报价照旧显示 token 数，键上写"用 1 张券"）；`view.ts` 的 HUD 加一格券数；规则读数只读 `GET /api/game/tickets` | 券是本机没有的东西，镜像没下来之前一律按"不知道"处理（`canAfford` 的既有口径），别先放行再吃 403 |
| 9 | 事件源 | "分享 App / 邀请新用户"今天**没有**服务端落点（邀请只有群邀请 `GroupInvite`，分享只有客户端壳） | 所以"任务加券"不是加一个字段：要先把这两个事件落成服务端可判的一件事（谁、哪天、指向谁），否则券的来源无法防刷 |

⚠ 券与 token **不可互换**（不做汇率、不可购买、不可转让）：照 `remixReward` / `templateReward` 的"平台印钱"口径，
只是印的是券。当月有效还是能滚存，要主人拍板。

### 8. 还没验的（别当成结论）

- `hd-mm` / `ultra-mm` 收不收**写实人像首帧**：没验过（只有 `draft-mm` 那一发，2026-11-19）。
- H3 的**参考图**路（≤ 5 张，不是首帧）上写实人像行不行：没验过。2026-11-19 验的是**首帧**；
  2026-10-26 那次"三张参考图实测收"的素材没有记录是不是写实人像 —— **不能当证据**。
  ★ G4 如果走"卡面直发参考图"，正好是 4 角色位 + 1 场景位 = `MINIMAX_V2_MAX_IMAGES`（5 张）—— 这条今天**没有实测背书**，
  要么先补一发（一张写实卡 + 一句话，约 ¥1），要么走验过的"先画定场帧、再首帧出片"那条（每段多一张 Seedream 13,333）。
- H3 收不收**真人照片**（`realPerson`）：没验过 —— 服务端 `tokens.js` 那条 ★ 里是待主人做的"第 9 条"小验。
- **券与免费档门禁的最终口径**（"持券算不算 paid"）要主人拍板：它决定免费用户能不能用券出带卡的片，
  也决定 §6 那个冲突要不要一并解。

## 真机（3C15CJ00C8V00000）

横屏的 **CSS 视口只有 800×363**（2800×1272 / DPR 3.5，`wm density 560`），比桌面浏览器窗口矮一半多。
第一版把商店卡写成固定 `3.8rem`、风格卡固定 `12rem`，真机上第三张风格卡被裁掉、商店面板把 HUD 顶出屏幕 ——
所以对局 UI 的宽度/高度全部走 `clamp(最小值, vw, 桌面值)`：

- 商店卡 `clamp(2.6rem, 5.4vw, 3.8rem)`、背包格 `clamp(2rem, 4.1vw, 3.2rem)`、风格卡 `clamp(7.5rem, 18vw, 12rem)`；
- 锁定时那行字只写「已锁定」（带「下回合不自动刷新」时折成两行，面板就长高到盖住 HUD —— 解释放在锁定键的
  `title` 与按下时的提示条里）；
- 真机上验过：进工坊 → 右栏「开局」→ 风格三选一 → HUD / 商店 / 背包 → 买卡、卖卡、刷新（成功与金币不够的
  原因）、锁定 / 解锁（描边 + 金色键 + 已锁定）、点道具再点角色装备 / 再点角色卸下。
  **替换流程没法在真机上走到**：初始 4 金买不满 9 格，而这一块还没有回合循环（没有收入）——
  它是在浏览器里注入金币当测试夹具验的（`store.buy` 走的是同一条 `buyShopCard` → `replaceCardInBag`）。
