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
- **还没做（第 2/3 步）**：拖卡入位、每角色最多 3 张道具 + 右侧道具栏与拆除工具、工作流面板改纯预览、生成小窗（卡名进提示词）。（商店那一块已在第 2 步做完，见下一节。）
- 对话的出口：删掉顶栏返回键之后，NPC 气泡里补了一颗 28px 的「✕ 收起对话」（对话机位下看不到铸卡师本人，点不到她）。

## G4 第 2 步（2026-11-23）：商店流程（相机拉近 + 商店栏上移 + 正面 180° + 点外收起）

施工单 §2 的第 2 步。规则层一个字都没动（买 / 刷新 / 锁定 / 金币不足的原因照旧走 `rules` + `reasons`）。

- **相机**：`studioStore.enterShopCam` / `exitShopCam` 两件事。进店时把 `camera` 换成
  `layout.SHOP_CAM`（**相对 NPC 头**的偏移：后 3.15 / 高 0.17 / 视线抬 0.32，头每帧由
  `TripoNpc` 写进 `cameraOrbit.NPC_HEAD`），`orbit` 换成 `{ target: "npc", lift, yawLimit }` ——
  **复用的就是"点 NPC → 相机拉近 + 滑动绕模型"那一套球面轨道**（`openNpcDialog` 用的同一个
  `orbit.target === "npc"`），没有第二套轨道控制。出店时把**进店前那个 camera 对象与原 orbit
  原样放回**（存在模块级 `shopCamBack`，不进 state），过渡由 `CameraRig` 原有的
  `1 − e^(−4.5·dt)` 缓动负责 —— 不瞬移。机位与视线同高不同点会让第一次拖拽先"跳"一下，
  所以镜头的 look 就是轨道圆心（头 + lift）。
- **正面 180°**：`cameraOrbit.clampOrbitYaw()`，半角常量是 `layout.SHOP_ORBIT_YAW = π/2`。
  θ=0 = 正面（`orbitToPosition` 的 +z 一侧正是 SHOP_CAM / NPC_CAM 站的那一侧），±90° 就是
  左/右侧面，合计 180°，再过去是后背。夹在两处：拖拽的每一帧之后（拖到边上就停住，不会先
  转过去再弹回）+ 轨道分支每帧（接管的第一帧、`syncOrbitFromCamera` 反解出的 θ 也夹）。
  **与对话共用轨道但不共用限制**：`yawLimit = 0` 时这个函数是空操作，`openNpcDialog` 不传它，
  对话照旧能绕到背后（真机/dev 实测 θ 拖到 4.8 rad 也没被夹）。
- **商店栏上移**：`ShopPanel` 从底部那列搬到 `GameLayer` 顶部那一条（`top-[safe+0.5rem]`），
  卡缩到 `clamp(1.8rem,3.9vw,2.85rem)` 宽（2:3 卡面 ⇒ 800 宽真机上整块约 79px 高）、右列三颗键
  按单行排、价钱并成一行（品质在卡面角标上，不再单排一列）。**商店开着时 HUD 与对手条让位**：
  真机横屏只有 363 CSS px 高，HUD 占 29~36%、商店栏占 13~35%，两样叠着摆字都读不清；
  商店一收它们原样回来。铸卡师的脸落在 39%~63% 那条缝里（商店栏下沿 35%、背包条上沿 66%）。
- **不挡 5 个空位**：两条一起成立 —— ① 商店一开相机就贴到她面前，桌面那 5 个空位全在镜头
  背后（开发用的舞台临时缩成 800×363 验过：屏幕里只剩她和身后的书架）；② 商店栏只占顶部
  那一条，收起来时底部那列（状态栏 / 背包条 / 阶段条）与桌面一个像素都没动。
- **点外面收起**：`GameLayer` 的 effect 里一对 window `pointerdown/pointerup` 监听（捕获阶段）：
  位移 < 8px（拖动绕镜头不算点）+ 落点不在这一层 DOM 里 ⇒ `toggleShop(false)`。再点商店键
  与「▾ 收起商店」是另外两条路，三条都走同一个 `shopVisible` 变化 —— effect 的 cleanup
  负责 `exitShopCam`，所以换阶段 / 转竖屏 / 结束对局 / 离开工坊也都会把相机放回去。
- 竖屏不受影响：`GameLayer` 本来就只在横屏挂（`StudioPage` 的 `{isLand && <GameLayer />}`），
  竖屏一个字节都没动。

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

## G4 第 3 步：摆卡与出片（2026-11-23）

> 施工单 [g4-ui-revamp-spec.md](g4-ui-revamp-spec.md) §2 / §3 / §4 里与卡有关的那几条。
> 前两步（UI 清理与布局骨架、商店流程）已在 main；这一步把"桌面 5 个空位"变成真的摆卡台，
> 并把「视频生成」接回现有出片契约（`flowStore.genNode` / `segmentGen`）。

### 做了什么

- **拖卡入位**：背包条（下方，只放**角色 / 场景**卡）按下即开拖，落点是桌面上的 5 个卡位。
  拖错类型 / 卡位满了都由 **rules** 回原因（`wrong-slot-type` / `type-cap`），状态栏用
  `reasons.ruleFailureText` 说那句人话 —— 界面一句都不自己编。
- **道具栏搬到屏幕右侧**（施工单 §3 第三条）：`ui/ItemRail.tsx`，一列道具卡 + 顶上一颗**拆除工具**。
  道具从这一列拖到某张**摆在桌上**的角色卡上 = 装备；拆除工具拖上去 = 一次卸下它身上的**所有**道具。
- **规则改造**（施工单 §3 前两条，只在 `rules.ts`）：
  - 删掉背包的 9 格与"按种类计数"（角色 ≤4 / 场景 ≤1 / 道具 ≤4）——上限改由**桌面卡位**管；
  - 道具上限改成**每个角色最多 3 张**（`ITEMS_PER_ROLE` + `itemLimitOf`，事件「补给站」的 +1 从
    "某类卡上限"改挂在这一格上：旧的那一类已经没有上限可加了）；
  - `type-cap` 这个原因码**只保留桌面卡位这一层**（`placeCardOnTable` 找空位时抛）。
- **生成小窗**（`ui/GenSheet.tsx`）：点「🎬 视频生成」→ 输入提示词（面板上那个框，同一份 `store.createPrompt`）
  → **① 先画首帧**（`flowStore.regenProposal`）→ 看一眼 → **② 出片**（`flowStore.genNode`）
  → 「用这一条交片」（`rules.submitRoundEntry` 收下 `videoUrl` / `seconds`）。
  两步就是快速模式（QuickModePage，2026-11-22 阶段 A）那一条，没有第二份实现。
- **提示词里带卡名**：素材卡由 `game/gen.gameMaterialOf` 把对局的卡转成 `types.Card`（只有名字——
  对局的卡没有形象图、也没有 idLine），走 `segmentGen.materialText` 现有的那句
  「本段固定素材设定……人物卡「名字」」进视频提示词。**没有另造一套点名句**。
- **工作流按钮**：对局里打开的是**纯预览**（`ui/GenPreview.tsx`）：本局每段的回合数 / 状态 / 首帧或成片 /
  那句提示词 / 用了哪些卡 / 档位；**没有任何"改 / 重新生成"的键**。不在对局里仍然是画布
  （它是新建流水线唯一的门，G4 第 1 步把桌面节点卡撤了 —— 改成只读会让工坊再也做不出自己的片）。

### 拖拽复用了什么（没有新写一套手势）

- 手势状态住在 `game/store` 的 `drag`（`kind: place / equip / remove / return` + `hover`）：
  2D 起点（背包条 / 右侧栏 / 拆除工具）与 3D 起点（桌面卡位上按下 = `kind:"return"`）喂同一个状态。
- **落点判定把 3D 卡位投影回屏幕**（`scene/slotScreen.ts`，与 `cameraOrbit.NPC_SCREEN` /
  `PLAYER_SCREEN` 同一套 `project` 做法），在 `GameTableSlots` 的 `useFrame` 里每帧重算五格矩形。
  没有从屏幕往场景里射线反解世界坐标，也没有另起一套 3D 拾取。
- 3D 那一侧只做两件事：按 `drag.hover` 高亮"现在悬在哪一格"（`SlotPlate` 的 `hot`），
  以及"在卡位上按下 = 把这张卡从桌上拖走"（跑 `beginDrag`）。
- `ui/GameDragLayer.tsx` 是那一层的 DOM 半边：跟手的 ghost + 提示条 + 松手落地。

### 生成为什么只走现有契约

- 铺段 = `flowStore.appendNode(gameSegmentSpec(...))`（`AppendSpec` 与工坊铸段窗 / 跟着做 / 快速模式同一批），
  画帧 = `regenProposal`，出片 = `genNode`。档位由 `game/gen.gameTierIdOf` 把 rules 的档位名翻成档位表 id
  （写法与快速模式 `previewTierId` 同一份：能给出 MiniMax 就用它）。
- 新加的一位：`FlowNode.gameRound`（+ `AppendSpec.gameRound`）标记"这一段是本局出的"，
  工作流预览按它过滤 —— 不清空玩家原来的流水线，也不给对局的段另存一份数据。
- **钱照实说**：G4 第 3 步落下来时服务端的券机制还没接，小窗上直接写"这一发按 token 结算（游戏券还没接）"；
  **2026-11-23 收尾已接上**（见下一节「G4 收尾：App 侧接游戏券 + 档位落点」）：有券时照实写「这一发用游戏券（剩余 N）」，
  没券 / 没读到余额时照实写「这一发按 token 结算」。价签问 `redrawCost` / `nodeCost`（与真扣同一份），远端模式以服务器结算为准。

### 与之前不同的地方（读代码的人会碰到的）

- `buyShopCard` 不再收 `replaceCardId`：背包不限量 ⇒ 没有"装不下 → 替换"这条路了（`replaceCardInBag` 已删）。
  想换卡就先卖（+1 金）再买。
- 摆卡 / 装备在两阶段都允许（`rules.PLACE_PHASES = ["shop", "create"]`）：出片按钮在创作阶段，
  进那一阶段才发现没摆就永远补不上；卖卡仍只在商店阶段（钱的事）。
- 一期作品的卡**不再由调用方递进来**：`submitRoundEntry` 从 `rules.castCardsOf(我)` 派生
  （桌面上的卡 + 挂在角色身上的道具），`RoundEntry.videoUrl` 记真出片那一发的地址（展映屏直接放它）。
- 事件「补给站」的 5 金选项名不变（id 仍是 `bag-expand`），效果改成"每张角色能挂的道具 +1"。
- 三条检查脚本同步改了：`check-game-rules.mjs`（摆卡 / 卡位满了 / 拖错类型 / 拖回背包 / 替换 /
  每角色 3 张 / 拆除工具 / 阶段闸）、`check-game-bots.mjs`（AI 摆卡计划、不再有"替换更便宜的旧卡"）、
  `check-i18n.mjs`（en 缺译 0）。

### 验证

- `npm run build` 绿（tsc + 全部 check 脚本 + vite build）、`check-game-rules` 883 条断言、
  `check-game-bots` 538 条断言（含一局 6 回合跑完）。
- 真机这一拍**没连上**（`adb devices` 空），改用 `npm run dev`（1384×797 横屏舞台）走了一遍：
  开局 → 选风格 → 商店买 3 张角色 + 1 场景 + 1 道具（测试时注入了金币）→ 角色摆进 0/1 号位、场景进场景位
  （走 store 的 `placeCard` / `equipOn`，与拖拽落点同一条规则）→ 进创作 → 生成小窗报价约 26.7k（首帧）+
  103.7k（出片），照实写「这一发按 token 结算（游戏券还没接）」→ 工作流面板只读预览（空态一句「这一局还没有
  出过片」；注入一段之后能看第 1 回合 / 还没出片 / 5 秒 / 首帧 / 那句提示词 / 用了哪些卡，一个改键都没有）→
  右侧道具栏拖到角色卡装备成功、拖到空格子回 `table-slot-empty`、拆除工具一次卸光（`unequipped`）。
  **没有点「① 先画首帧」**：这台机器的 `.env.local` 配了真 ARK key，点一下就是真花钱。

## G4 收尾：App 侧接游戏券 + 档位落点（2026-11-23）

> 施工单 [g4-ui-revamp-spec.md](g4-ui-revamp-spec.md) §0 的结算（免费套餐每月 6 张券、任务加券、券只用于出片、不扣 token），
> 服务端那一半已经上线（server#155：`GET /api/game/tickets` + 三条出片路由认 `X-Game-Ticket: 1`，
> 契约 `server/docs/api-contract.md`「工坊游戏券」）。这一块只改 App：**档位落点 + 券的读/带/报错 + canAfford 认券**。
> **服务端一行没改**（App 只读它的回包与错误码）。

### 1. 三个档位的 tierId 与回落（`src/studio/game/genTier.ts`，唯一翻译处）

规则层（`rules.MODEL_LEVEL_TIERS` / `generationTierOf`，零依赖）只给**语义**（`level` + `draft / hd / cinema` + 分辨率），
tierId 的翻译在 `genTier`，写法与快速模式同源（`account.preferredTierIdOf` = `tierOfPreferred` + `tierOffered` 那两行，
**2026-11-23 收成一处**，快速模式与对局都读它）：

| 规则层 | 首选（这台机器给得出 MiniMax 时） | 回落（给不出：没接 MiniMax 的服务端 / 地区不给 / V2 没开） |
|---|---|---|
| L1 `draft` | **`draft-mm`**（MiniMax H3-Lite · 480P，5 秒 56,000） | `draft`（Seedance 2.0 mini · 480p，77,004） |
| L2 `hd` | **`hd-mm`**（MiniMax H3-Highspeed · 768P，134,500） | `hd`（165,600） |
| L3 `cinema` | **`ultra-mm`**（MiniMax H3 · 768P，179,000） | `ultra`（Seedance 2.5 · 720p，507,600） |

- **L3 不是字面上的 `ultra`**：规则层写的 `1080p` 在档位表里没有这一行（1080p 只是 `ultra` 的「样片 → 定稿」第二步），
  照字面实现 = 5 秒片发两发 ≈147 万 token，而定稿那一发在方舟上会被写实人脸审核整段拒（2026-11-19）。
  `ultra` 只是**回落**那一格。
- ⚠ `hd-mm` / `ultra-mm` 收不收写实人像**没验过**（只有 `draft-mm` 那一发，2026-11-19）：这里只说"这台机器给得出"，不说"写实卡一定行"。
- `gen.gameTierOf` / `gameTierIdOf` 已删（原来另判了一次等级、另抄了一份 family 表）；`gen.ts` 现在只调 `genTierIdOf(player)`。

### 2. 券怎么读、怎么显示（`data/gameTickets` + `data/gameTicketRules` + `hooks/useGameTickets`）

- **问不问只看能力位**：`GET /api/ark/health` 的 `gameTickets`（服务端 `GAME_TICKETS=off` 时它自己就是 false）。
  没有这一位（老服务端 / `npm run dev` 直连方舟 / 离线包）⇒ **一个请求都不发、界面一格 🎟 都不摆**；
  dev 的 `/api/ark` 由 vite 代理直连方舟、不经服务端计费，也没有 `/api/game/tickets`（`serverCaps.ALL` 里是 false）。
- **读一次 = 当月懒发**：`GET /api/game/tickets` 回 `{ cycle, limit, granted, earned, spent, refunded, used, left, perGeneration, nextResetAt, enabled }`，
  App **只显示不计算**（上限、几号刷新、一发几张都由服务端说）。20 秒内不重复问，出片前后强制各读一次。
- **三种状态三种说法**（判据只在 `gameTicketRules.gameTicketModeOf`，界面语言随渲染走）：

  | 状态 | 界面（背包条 / 生成小窗） | 出片 |
  |---|---|---|
  | 有券（`ticket`） | 🎟 4（金币旁边）；「这一发用游戏券（剩余 4）：出片扣 1 张券、不扣 token；画首帧照旧按 token 结算（约 X）」；按钮「② 出片（用 1 张游戏券）」 | 带 `X-Game-Ticket: 1` |
  | 券用完了（`empty`） | 🎟 0；「这一发按 token 结算：本月的游戏券用完了（1 号刷新，做任务也能领券）；画首帧约 X、出片约 Y」 | 不带券头，走 token |
  | 接口不可用（`off`：老服务端 / `GAME_TICKETS=off`） | **不摆 🎟**；「这一发按 token 结算（这台服务器没有开通游戏券）」 | 不带券头 |
  | 还没读到（`unknown`：有能力位但没读到余额 / 断网） | 不摆 🎟；「这一发按 token 结算（游戏券的余额还没读到）」 | 不带券头 |

  ★ **不知道 ≠ 有券**：券是"扣钱"的币种，界面写着「用券」而服务端扣了 token 是钱上最不能接受的一种错
  （与 `serverCaps` 那几位「不知道 = 放行」的口径相反，理由钉在 `gameTicketRules.gameTicketModeOf` 上）。
  ★ 券**买不到**（服务端 T1，与 token 不可互换）：券用完那一句指去"几号刷新 / 做任务"，绝不指去充值页。

### 3. 出片怎么带券（从生成小窗到底层请求的一条线）

`GenSheet`（`payWithTicket` = 有券）→ `flowStore.genNode`（**再核一次** `canPayWithTicket()`）→ `segmentGen.generateSegment`
→ `real.composeSegments`（第 4 参 `{ payWithTicket }`）→ `arkClient.generateVideo` / `minimaxVideo.minimaxV2Video` /
`minimaxVideo.minimaxVideo` 的**创建任务那一发**带 `X-Game-Ticket: 1`。

- **只有视频那一发带**：补画的首帧 / 圈选改帧 / 转存 / 对话都不带 —— 服务端 `currencyOf` 对"带券却不是出片"回 400 `TICKET_NOT_APPLICABLE`。
- 带券那一发**不扣 token**：`genNode` 成功后**不** `spendTokens(cost)`（券不进 token 钱包），余额门禁走 `canAfford(cost, { ticket })`。
- 券在服务端扣 / 退：`genNode` 的 `finally` 强制重读一次余额（成 / 败 / 没接到都读），背包条的 🎟 与下一发"用不用券"都跟着它走。
- 首帧那一笔照旧是 token（免费账号每天 2,000），所以**绝不写"免费"**。

### 4. 四个错误码（`studio/game/reasons.gameRejectText` 一处；认码不认文案）

| code | 什么时候 | App 说 |
|---|---|---|
| `NO_GAME_TICKET` (403) | 券不够（镜像过时 / 并发） | 「这一发的游戏券不够了：本月的券已经用光，**N 号刷新**（做任务也能领券）——也可以改成按 token 出片。这一次没有受理，也没有扣费。」（N 读回包的 `nextResetAt`） |
| `GAME_TICKETS_OFF` (403) | 这台服务器 `GAME_TICKETS=off` | 「这台服务器暂时关掉了游戏券出片——这一发没有受理、也没有扣费；改成按 token 出片再试。」 |
| `TICKET_NOT_APPLICABLE` (400) | 带券却不是出片 | 「游戏券只能用在出片上：这一发不是出片（出图 / 对话 / 建模），所以没有受理、也没有扣费。」 |
| `PLAN_REQUIRED` (403) | 带券点了会员档（券 ≠ 会员） | 「这一档要会员套餐（或充值过任意一笔）才给用——游戏券只顶出片那笔钱，不能把会员档打开；换回「草稿」档再出片。这次没有扣券。」 |

- 通路：`flowStore.genNode` 的 catch 在**这一发真带了券**时先问宿主传进来的 `opts.rejectText`（对局传 `gameRejectText`），
  回 null 才照旧按错误类型说 —— 这张 store 不认识"游戏券"这个词，四句话只在 `reasons.ts` 一处。
- 为什么不能把服务端那句原样摆出来：服务端没有 i18n（写死中文），英文界面会显示中文；而且两种界面语言会说出两种说法（D7 a：服务端给码、App 说话）。

### 5. 钱上的话：券不是 token（`ai/failCharge`）

带券的那一发失败时，`chargeOnFail(e, { ticket: true })` 记下这一位，`chargeNote` 的视频那一半改走
`ticketVideoChargeNote`：**按"券 / 张"说**（"这一发按游戏券出片，没出成——扣的那张券已经退回"），
一个 token 金额都不带；出片前画好的画面照旧按张（那几笔是真的 token）—— 两笔分开说。
★ 不这么做的后果：受理之后失败的那一发会照 token 那套说"扣的 X token 已经退回 / 已计费 X token"，
而钱包一分没动（券买不到、没有汇率）—— 钱上的一句假话。

### 6. 只此一处（收掉了哪些散算）

- 档位翻译：`genTier.genTierIdOf(player)`（`rules.MODEL_LEVEL_TIERS` 给语义）；"优先另一家 + 给不出就回落"收进 `account.preferredTierIdOf`，
  快速模式 `previewTierId` / `finalTierId` 也改成读它（原来两处各一份）。
- 券的规则：`data/gameTicketRules`（零依赖，`scripts/check-game-tickets.mjs` 57 条断言实跑：回包解析 / 三态真值表 /
  `left >= perGeneration` / 请求头 / 刷新日 / "档位落点只此一处"的源文件棘轮 / **券头从生成小窗到底层请求的整条接线**）。
  最后那一段是替代真机验券的：真验一次就烧一张券，所以 `GenSheet → genNode → segmentGen → composeSegments → arkClient/minimaxVideo`
  每一环的调用点都按源码钉住（改拼法会红，提醒重新数一遍）。
- 构建：`check-game-tickets.mjs` 已接进 `npm run build`（`check:all` 也会跑它，漏接会红）；`gameTicketRules.ts` 进了
  `check-import-direction` 的零依赖表。

### 7. 验证（这一块）

- `npm run build` 绿（tsc + 全部 check 脚本 + vite build），`check-game-tickets` 57 条断言；
  造违规试红五条（`caps === null` 当有券 / `left > 0` / `resetDayOf` 写死 / `genTier` 的 `cinema` 改成 `1080p` /
  带券那发改回 `spendTokens`）各自变红。
- **线上服务端真连**（只读，不出片、不烧券）：`GET https://api.ideahubs.org/api/ark/health` 回
  `gameTickets: true`、`gameTicketMonthly: 6`、`gameTicketPerGeneration: 1`、`gameTicketUnlocksMedia: true` ——
  App 的能力位与"一月 6 张、一发 1 张"今天就是从这里读的。
- 真机没连上（`adb devices` 空），浏览器（`npm run dev`）里 **dev 没有券那一路**（`serverCaps.ALL.gameTickets = false`，
  见 §2 第一条），所以界面走的是「这台服务器没有开通游戏券」那一支：背包条不摆 🎟、生成小窗写「这一发按 token 结算」。
  有券 / 用完那两句话的判定由 `check-game-tickets` 的真值表与券头接线钉住（57 条），**没有**在真机上走到真实扣券那一发。

## G4 收尾任务 A：免费账号的升级线只到 L1（2026-11-23，主人拍板 A）

> 施工单 `docs/g4-ui-revamp-spec.md` 之外的一条：**没付过钱的账号在游戏内只能停在 L1（`draft-mm`）**。
> 一句话：模型军备那一屏对免费账号**不出现 L2 / L3 的升级项**，真发出去的档位也被夹回 L1 ——
> 不允许"界面上写着高清、点了升级、到出片才 403"。

### 1. 判据收在哪儿（一处）

| 层 | 是什么 | 判据 |
|---|---|---|
| `rules.ModelGate`（零依赖） | `{ upgrade: boolean }` —— "这个账号能升到 L2/L3 吗" | **只收这一个布尔**，不自己判 |
| `genTier.modelUpgradeGate()`（**唯一判据**） | 问 `account.payingNow()`：`!== false` 就能升 | 套餐价 > 0 **或**钱包回包顶层 `paid`；管理员在 `payingNow` 里豁免 |
| 读它的三处 | `view.eventViewOf`（摆哪些选项）/ `store.chooseEvent`（真扣钱）/ `genTier.genTierIdOf`（这一发真发出去的档位） | 三处读同一个 gate |

三条**为什么**：

1. **为什么不用 `account.tierBlockReason(hd)` 当会员判据**：它把"模型停用 / 这个地区给不出这一档 /
   服务端不支持"也一并算进返回值里，而那些与套餐无关 —— 只给 MiniMax 的地区里 `hd`（Seedance）
   本来就不摆，拿它判会把**付过钱的人锁死在 L1**；
2. **为什么"还不知道"按能升放行**（`payingNow() === null`）：与 `tierBlockReason` / `canAfford` 同一个
   乐观口径 —— 不能因为钱包镜像慢半拍就把付费用户的升级线摘掉；真是免费用户的话服务端在视频那一发
   之前就拒（403 `PLAN_REQUIRED`，不扣视频的钱）；
3. **为什么规则层要一个显式入参而不是"界面藏起来"**：L2 / L3 在档位表里都是会员档，升上去之后
   第一发真出片就是 403，而**出片前补画的设定帧已经各自结算过了** —— 玩家花 8 / 15 金买到一个点了
   必失败的档位。所以选项**整条不出现**（不是灰着），真发出去的档位也一起夹回 L1。

### 2. 界面上的样子

- 「模型军备」对免费账号只剩后两条（半价 / 免费 +4 金）；`EventPanel` 画的本来就是
  `rules.eventOptionsFor` 给的那份（"界面上看到几条就是几条"），所以**一个组件都不用改**；
- 已经因为付费升到 L2/L3 的人套餐过期后再开一局：选项不出现、出片仍落 L1（`genTier.effectiveModelLevel`）；
- **AI 陪玩不传 gate**（`phases.aiEventChoices` / `bots`）：它们的等级只影响几行字、从不真出片，
  把人类的套餐限制套在 AI 身上会让人以为"全桌都不许升"。

### 3. 断言（`scripts/check-game-rules.mjs`：883 → **911** 条，新增 28 条）

- 免费 gate：`optionsForPlayer` 只剩 `["half-next","free-gold"]`、L2+3 连胜也看不到 L3、
  `modelUpgradeOffer` 两条都回 `null`；
- 付费 gate（= 今天的形状）：选项与 `{ level: 2, cost: 8 }` 照旧；
- 绕过界面直接 `applyEventChoice(...FREE)` → `option-unavailable` 且 state 原样；
- 档位：免费账号 `generationTierOf({ modelLevel: 3 }, FREE)` = L1 480p，付费账号 = L3 1080p；
  不传 gate 时照旧能升（AI 陪玩那一支，钉住"缺省没变"）；
- **源码棘轮**：`view.ts` 的 `eventOptionsFor(…, modelUpgradeGate())`、`store.ts` 的
  `applyEventChoice(…, modelUpgradeGate())`、`genTier.ts` 的 `modelUpgradeGate().upgrade` 逐条正则钉住
  （漏传不会红在类型上 —— 有缺省值），外加"对局层不许自己拼 `plan.monthly` / `paid`"。

试红两处（都当场变红）：① 复制一份 rules.ts 去掉 `if (!gate.upgrade) return null;` → 6 条红；
② 把 `view.ts` 的 gate 参数去掉 → "view.ts 的 eventOptionsFor 带了 gate" 变红。

## G4 收尾任务 C：真机整链（2026-11-23，3C15CJ00C8V00000）

> 装的是本分支的 release 包（`npm run apk:release` → `adb install -r`，versionCode 93 未涨）。
> 整条链在一局里真跑：工坊 → 我的仓库 → 3D 工坊 → 开局，逐屏用 `screencap` 核对（截图只落本机、不入库）。

### 1. 走完了什么

| 步 | 结果 |
|---|---|
| 进 3D 工坊 | 横屏、新机位落定（桌面远边 27%、近边 95%），铸卡师头顶在状态栏下面 |
| 选风格卡 | 三张**真样张**（3D 动画+体积光 / 硬派明暗对照 / 胶片颗粒+50mm），选定后锁死 |
| 商店 | 相机贴近 NPC ✓；向右连甩三次后**画面像素差 0.153（≈不动）**= 180° 夹住了；点商店外 → 收起 + 相机复位 ✓ |
| 摆卡 | 拖卡入位：角色位 4/4、场景位 1/1（第 1 回合只有 4 金，只买到 1 张；后面几回合补齐）；拖错类型当场说「这个位子放的是场景卡」/「角色卡」 |
| 装备道具 | 右侧道具栏拖到角色卡 → 「装备好了」，角色卡上显示「道具 1/3」 |
| 生成小窗 | 「4 角色 / 1 场景 / 1 道具」；标题写「用桌面上的卡（N 角色 / N 场景）+ 这句提示词」 |
| ① 先画首帧 | 真出图（约 26.7k 报价），出完给「换一张 / ② 出片」 |
| ② 出片 | 「这一发用游戏券（剩余 6）：出片扣 1 张券、不扣 token」→ 真出片（约 60 秒），展映里标「真出片的那一条（5 秒）」并能播放 |
| 交片 → 展映点赞 → 投票 → 结算 | 6 个回合全部走通：点赞榜 / 投票榜 / 扣血（-5/-10/-15/-20 按名次）/ 淘汰判定 |
| 事件三选一 | 3 次：灵感爆发（选免费蓝卡）、补给站（选免费刷新券 ×2，商店键随即写「刷新（免费券 ×2）」）、模型军备（选免费 +4 金） |
| 进到第 2 回合 | 第 2 回合起每回合开商店 + 发收入 + AI 买卡；一路打到第 7 回合（剩 10 血） |

### 2. 钱：这一局**实际没花钱**（照实记）

- **这台设备的账号是管理员**：「我的」页明写 `token 管理员 · AI 生成免扣费，无需充值；用量服务端照记` ——
  首帧与出片走的是 `billing.preAuthorize` 的 admin 免单口径（账记 `admin_free`，钱包一分没动）；
- **游戏券仍显示 6 张**（没减）：管理员免单，服务端没扣券；
- 所以「免费账号只能到 L1」这一条**没能在真机上复验** —— 管理员/付费档的 `modelUpgradeGate().upgrade`
  是 true，模型军备照旧摆出 3 条（8 金升高清 / 5 金半价 / 免费 +4 金），这正是设计里"付费与管理员放行"那一支。
  免费账号的 2 条（只剩半价 / 免费 +4 金）由 `check-game-rules.mjs` 的 28 条断言 + 源码棘轮钉住；
- 真机没验到的另外两件：`NO_GAME_TICKET` / `GAME_TICKETS_OFF` 那两句券的报错（这一局券一次都没用完）。

### 3. 相机/桌子的新观感（真机截图对照参照图）

- 桌面从窗口 ~28% 铺到 ~95%（参照图 13.5%~83.3%）：**都占住画面下 2/3**；
- 4 个角色位底沿 ~53.4%，底部栏上沿 ~56.5%（背包里有卡时）—— **中间留出 ~11 CSS px**，
  空位一个都没被压住；
- 铸卡师发顶 ~12.6%（模型算 13.0%），在系统状态栏（11.3%）下面一点，顶部栏按键只在最右边、压不到她；
- 和参照图不一样的地方（如实）：参照图没有 3D 角色，我们桌对面坐着一个；底部栏比参照图高一倍
  （56.5% vs 83.3%），所以"自己那一排"只能比参照图更往上挤一点。

## G4 第 5 步：事件屏按参照图重排（2026-11-23）

> 施工单 [g4-ui-revamp-spec.md](g4-ui-revamp-spec.md) §5：一整块面板、三张卡横排、每张带
> 图标 / 标题 / 一行收益 / 花费，选中态明显，确认键在面板底部居中，免费那一项与另外两张同样排版。
> 参照图是本机那张（`f5b676…jpg`，崩铁·货币战争的"请选择投资策略"），**不入库**。
> 规则层一个字都没动：点卡只记本地选中态，扣钱仍走 `store.chooseEvent` → `rules.applyEventChoice`，
> 跳过仍走 `store.skipEvent` → `rules.skipEventChoice`。

### 1. 长什么样

- **一整块面板**（`w-full max-w-[52rem] rounded-2xl bg-panel/95`）：标题行 / 三张卡 / 底部一行；
- **每张卡四层**：图标位（clip-path 切出来的发光六边形 + 徽记）、标题、一行收益、花费；
  - 标题在 `labels.eventOptionName`（10 个 id → 短名，如「金币大使」「双机位」「刷新补贴」），
    收益那句是现成的 `labels.eventOptionText`（数字全部来自 `rules` 的 effects，界面不另抄）；
  - 徽记在 `labels.eventOptionGlyph`（**不是文案**、不进 Lingui 目录）：包里没有事件插画
    （`rules.GAME_EVENTS[].art` 指向的 `public/events/<id>.webp` 至今没落过文件），所以先拿字形占位；
    补了图之后换成插画位即可，卡的结构不用动；
  - 花费那一格：免费项写「免费」（绿），付得起写 N 金（金），付不起标红（**不藏选项**，
    点了由状态栏说「金币不够：要 N 金，现在只有 M 金」）。
- **选中态**：金描边（`ring-2 ring-gold-300`）+ 右上角那颗勾 + 卡面柔光转金；没选时确认键是灰的，
  左边那句写「先点一张卡，再按确认」（同 StylePick 的"先点一张风格卡，再锁定"）。
- **两步才扣钱**：点卡只改选中态，**真扣钱在底部那颗「确认」**（误触一张 6 金的卡就当场扣钱的代价太大）。
- **确认键在面板底部正中**：底部那一行是 `grid grid-cols-[1fr_auto_1fr]` —— 左格念"确认后剩 N 金 /
  还差 N 金 / 这张不要金"，中间确认，右格是「这次不要（跳过）」。左右两格等宽，确认键才真的居中。
- **免费 / 跳过那一项与另外两张同一排版**：免费项是 rules 数据里 cost 0 的那一条（每个事件恰好一条），
  它照样是一张完整的卡，只是花费写「免费」；「跳过」仍是一颗真键（不是一行小字），排在确认键右边。

### 2. 横屏 800×363 的实测（`npm run dev` 套一个真 800×363 的 iframe 量的）

| 元素 | 尺寸 / 位置（CSS px，视口 800×363） |
|---|---|
| 面板 | 776 × 216~257（有"上期扣血"那行时 257），底边贴 323 |
| 一张卡 | 232 × 160（`w-[clamp(9.5rem,29vw,15rem)]` / `min-h-[clamp(7.5rem,44vh,12rem)]`） |
| 卡内文字 | 标题 12.8px、收益 10.8px、花费 11.2px（全部 clamp，最小 8.8px） |
| 六边形图标 | 49.6px |
| 确认键 | 93 × 34.6，中心 x=400（舞台正中） |
| 跳过键 | 94 × 27.8，面板右下 |
| 三张卡 | 43 / 284 / 525 起，716 宽居中（29vw×3 + 两道 10px 缝） |

- 三张卡并排放得下、字不糊（真机 DPR 3.5，10.8 CSS px ≈ 38 设备 px）、按钮点得到
  （确认键 34.6px 高；真实点击用 `adb`/浏览器的坐标点验过：点卡 → 选中态出现，点确认 → 扣钱进 round-end）。
- **这一阶段 HUD / 对手条 / 右侧道具栏 / 背包条让位**（`ui/GameLayer` 的 `inEvent`）：800×363 上
  "背包条 67 + 阶段条 22 + 三张卡"叠起来只剩 ~115px 给卡，图标与收益都被挤没；
  让位之后卡从 140px 起。血量 / 金币 / 第几回合由面板自己念（数仍从 `view` 来，不在组件里算），
  阶段条留着（它写的是"三选一，拿不准可以跳过 · AI 已经选好了"）。
  让位不拿走任何能用的操作：卖卡 / 买卡 / 摆卡 / 拖道具在事件阶段全是 `wrong-phase`。

### 3. 免费账号只剩 2 条时

`view.eventViewOf` 画的本来就是 `rules.eventOptionsFor` 给的那份，**组件一条规则都不判**：
模型军备在免费账号上只剩「下一回合半价」「免费 +4 金」两条（`ModelGate`），
2 条时两张卡还是同一个宽度、行是 `justify-center`，居中摆着 —— 不会一张被拉宽成窄条、也不会留一块歪着的空。
（量法：同一份代码把当前事件设成 `model-arms-race` 且让玩家没有升级项可得，两张卡各 232 宽、居中。）

### 4. 结算屏（顺手，只修遮挡）

真机 800×363 上结算面板是**满宽**的（776px），它一立起来就把右侧道具栏吃掉一半 —— 表现为「🧹 拆除」
那颗键被面板上沿切掉，看着像坏了，而且那半截还被面板压着点不到。道具栏在这一阶段本来没有一个能用的动作
（装备 / 卸下只在商店与创作两个阶段），所以 `round-end` / `over` 两阶段收起来（`GameLayer` 的 `inResult`），
下一个阶段原样回来。**结算屏的排版一个像素都没动**：扣血表、两个榜、淘汰横幅、背包条、阶段条都照原样，没有溢出。

### 5. 怎么验的

- `npm run build` 绿（tsc + 全部 check 脚本 + vite build），`check-game-rules` 911 条、`check-game-bots` 538 条、
  `check-i18n` en 缺译 0（新文案 18 条已同 PR 补进 `src/locales/en.po`）；
- 浏览器里套一个真 800×363 的 iframe（临时量尺，不入库），把一局推到第 2 回合的事件屏，逐项量上表那几个尺寸；
  再验：点卡出选中态 → 点确认真扣钱（9 金买 3 金的项 → 6 金，进 round-end）；钱不够时点卡 + 确认会由状态栏
  说「金币不够：要 5 金，现在只有 2 金」；2 条选项时两张卡居中；选过之后是虚框 +「选好了：X」+ 确认键变灰；
- 结算屏 / 对局结束屏在同一个 800×363 视口里过了一眼（遮挡只剩道具栏那一下，已按上面第 4 条修掉）。




