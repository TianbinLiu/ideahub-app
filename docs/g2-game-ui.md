# 工坊对局界面（G2 第二块：把规则引擎接到工坊界面上）

> 2026-11-22。只做 **2D 覆盖层**：HUD / 商店 / 背包 / 点选式装备 / 风格卡三选一。
> **不做** 3D 拖拽、不接生成、不换工坊的铸卡 / 市场 / 卡组流程、不动 `src/studio/scene/`。
> 规则只有一份实现：`src/studio/game/rules.ts`（G2 第一块，见 `docs/game-rules-engine.md`）。

## 入口

工坊（`/studio`）横屏时右栏最上面一组：没开局是 **「▶ 开局」**，开局后是 **「✕ 结束对局」**
（`src/studio/ui/SceneRails.tsx` 的 `MarketRail`）。竖屏不挂右栏，也不挂对局 UI —— G1 的竖屏逐字不变。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/store.ts` | 对局状态（zustand）：一局的 `GameState` + 点选装备 / 替换流程 / 失败原因 / 轻提示。**动作全部委托 rules** |
| `src/studio/game/view.ts` | 界面读的视图模型（HUD / 商店 / 背包的数），全部问 rules 派生 |
| `src/studio/game/labels.ts` | 卡名 / 类型 / 品质 / 风格卡中文名与一行说明 / 档位名（规则层只有英文占位） |
| `src/studio/game/art.ts` | 卡面与风格样张的图从哪来（现在都是仓库里现成素材占位） |
| `src/studio/game/reasons.ts` | `RuleFailure` → 那一句人话（**唯一一处**） |
| `src/studio/game/ui/GameLayer.tsx` | 覆盖层外壳：状态栏（失败 / 替换 / 选中道具 / 刚做完）、商店与背包的摆放 |
| `src/studio/game/ui/GameHud.tsx` | 顶部常驻：金币 + 本回合利息、血量、连胜/连败、模型等级 + 档位名、回合、存活 |
| `src/studio/game/ui/ShopPanel.tsx` | 5 张卡 + 买 / 刷新（2 金 / 免费券）/ 锁定（免费，状态可见）/ 收起 |
| `src/studio/game/ui/BagBar.tsx` | 底部 9 格（含已装备道具）、类型上限、卖 +1、替换模式、点选装备 |
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
| 派生读数 | `view.gameViewOf` | `incomeFor` / `generationTierOf` / `bagUsage` / `alivePlayers` / `styleCardOf` |

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

## 还没做的（下一块）

- **3D 拖拽装备**：现在是点选式（点道具 → 点角色 / 再点角色卸下）。拖拽要在 3D 场景里做，这一块不碰 `scene/`。
- **风格样张是真占位**：`public/create/*.jpg`、`public/cards/market/*.webp` 顶的；真实样张离线批量生成、
  打进包（`public/styles/<id>.webp`），代码里的 TODO 标在 `art.ts`（`TODO(G2-c)`）。
- **回合循环**：现在停在第一回合商店（不能进创作 / 展映 / 投票 / 结算），G3 接 `enterCreation` / `settleRound` 等。
- **生成**：G4 才把「风格 + 卡 + 提示词」翻译成 `GenSpec`；HUD 的档位现在只是 rules 的读数。

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
