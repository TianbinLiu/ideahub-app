# 工坊对局规则引擎（G2 第一块）

> 纯规则层：类型 + 纯函数。**不接 UI、不接生成、不认识 store**。
> 设计正本 `docs/workshop-game-design.md`（§2.1 / §2.2 / §2.3 / §2.3b / §2.5，§5 的待拍板项取默认值）。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/types.ts` | 数据形状：`GameCard` / `GamePlayer` / `GameState` / `ShopState` / `StyleCard` / `GameEvent` / `RoundSettlement` / `RoundEntry` / `RoundTally` … |
| `src/studio/game/rules.ts` | 全部规则（纯函数、零运行时依赖、随机源从参数注入） |
| `scripts/check-game-rules.mjs` | 851 条断言（正例 770 / 反例 81），构建里实跑 |

★ 为什么 `rules.ts` 只 `import type`：`scripts/check-game-rules.mjs` 用 Node 直接 import 它跑正反例
（Node 只剥类型），这条与 `data/cutProject.ts` 等零依赖模块相同，已由 `scripts/check-import-direction.mjs`
的「零依赖规则模块」表钉住。规则只有一份实现，检查脚本里不重写。

## 规则 → 函数 → 出处

| 规则 | 函数 | 出处 |
|---|---|---|
| 一张卡（id / 角色·场景·道具 / 品质 1~5） | `GameCard`（types） | §2.1 |
| 100 血、初始金币、背包 / 装备 / 风格 / 模型档 / 淘汰 | `createGame` | §2.1 / §2.3 / §5-1 |
| 背包 9 格、角色 ≤4 / 场景 ≤1 / 道具 ≤4 | `bagUsage` / `canAddCard` / `TYPE_CAPS` / `capOf` | §2.1 |
| 装不下只能替换（原子、失败不丢卡） | `replaceCardInBag` / `buyShopCard` | §2.1 |
| 卖卡回收 1 金、已装备道具退回背包 | `sellCardFromBag` | §2.1 |
| 道具只能挂角色、一个角色 1 件、卸下 / 卖角色退回 | `equipItemOnRole` / `unequipItemFromRole` / `sellCardFromBag` | §2.1 |
| 风格卡 3 选 1、抽到即固定、选定锁死 | `rollStyleChoices` / `pickStyleCard` | §2.2 |
| 商店每回合 5 张、按回合品质权重 | `beginRound` / `rollShopCards` / `qualityWeightsForRound` | §2.3 |
| 刷新 2 金、锁定免费、免费刷新券 | `refreshShop` / `toggleShopLock` | §2.3 |
| 收入 = 5 + 利息 `min(5, floor(gold/10))` + 连胜 / 连败奖励 | `incomeFor` / `interestFor` / `streakBonusFor` | §2.3 |
| 模型 L1 草稿 480p / L2 720p / L3 1080p；8 金 / 15 金 + 3 连胜 | `generationTierOf` / `modelUpgradeOffer` / `optionsForPlayer` | §2.3b / §5-8 |
| 事件每 2 回合（2/4/6）三选一、池子不重样 | `settleRound` / `applyEventChoice` / `GAME_EVENTS` | §2.3b / §5-7 |
| 扣血 20/15/10/5、人少按比例缩放、hp≤0 淘汰 | `settleRound` / `damageForRank` / `streakOutcomeOf` | §2.5 |
| 剩 ≤2 人给胜者；打满 8 回合结束 | `winnersOf` / `isGameOver` / `MAX_ROUNDS` | §2.5 / §5-2 |
| 阶段机（商店 → 创作 → 展映 → 投票 → 结算 / 事件） | `enterCreation` / `enterScreening` / `enterVoting` | §2.0 |
| 一期作品（三张卡 + 一句提示词、固定 5 秒占位片） | `submitRoundEntry` / `roundEntryId` / `promptLimitOf`（G3） | §2.4 |
| 展映顺序 = 上一期综合名次倒序（第 1 回合按座位） | `screeningOrderOf` / `GameState.lastRanking`（G3） | §2.5 |
| 点赞：播放中每条一次（含自己那条） | `likeEntry`（G3） | §2.5 |
| 投票：不能投自己、一人一票、可弃权 | `voteEntry` / `abstainVote` / `votesPendingOf`（G3） | §2.5 |
| 两个榜（点赞 / 投票）+ 综合名次（名次相加、并列看投票） | `tallyRound`（G3） | §2.5 |
| 从本期真实的票结算（全员表态才放行） | `settleRoundFromVotes`（G3） | §2.0 ⑤ |
| 事件「跳过」兜底（三选一全落不了账时） | `skipEventChoice`（G3） | §2.3b |

## 约定

- 每个改法都返回**新对象**，成功 `{ ok: true, … }`、失败 `{ ok: false, reason }`（`reason` 是稳定的英文码，
  界面负责说人话）。铁律八：不静默失败。
- `createGame` 的参数错误（人数不对 / 重复 id）直接抛 —— 那是程序员的错，不是玩家操作被拒。
- 随机源 `Rng` 从参数注入（`createRng(seed)` 给一个 mulberry32）：同一 seed 能复盘一局，检查脚本才能写确定性用例。
- 卖卡 / 装备 / 卸下只在 `shop` 阶段允许：创作阶段开始后背包锁住，否则正在出片的一段会引用被卖掉的卡。
- **一局的"票"也在这层算**（G3）：点赞 / 投票存在 `RoundEntry.likedBy` / `votedBy` 里，两个榜与综合名次由
  `tallyRound` 一处产出，结算入口是 `settleRoundFromVotes`（它再调 `settleRound` 扣血）——
  界面与 store 都不许自己拼一个名次递进去。`lastRanking` 记上一期名次，下一期展映按它倒序播。
- 13 条 G3 与设计稿不一致的地方（空镜、点赞可自赞、事件跳过、综合名次不并列…）见
  `docs/g3-round-loop.md`「与设计稿不一致」；回合循环本身（AI 陪玩 / 阶段屏）也在那份。

## 与设计稿不一致 / 设计稿没写清、规则层拍了的地方（待主人复核）

1. **初始金币 4**：§2.0 只说「初始金币」没给数、§5 也没列；4 金 = 第一回合买得起 1~2 张低费卡。
2. **9 格按「背包 + 已装备道具」总数算**：否则「先装上再买」就绕开了 4 角色 + 1 场景 + 4 道具 = 9 的算术。
3. **一个角色最多挂 1 件道具**：设计稿没写死；出片时「角色带道具」是一张参考图位。
4. **替换 = 以旧换新、不返 1 金**：返钱会让「卖卡」与「替换」变成两条会双记的路；要钱先卖再买。
5. **带装备的角色不能直接替换**（回 `role-equipped`，先卸下）：道具退回背包可能撑破 9 格，硬换会静默丢卡。
6. **连胜口径**：四人局名次前 2 算胜、后 2 算负（照 TFT 前 4/8 按比例压）；3、4 连都是 +2（设计稿只钉了 2 连 +1、5 连 +3）。
7. **扣血缩放**：存活人数 / 4，向下取到 5 的整数倍、最低 5 ⇒ 4 人 20/15/10/5、3 人 15/10/5、2 人 10/5。
8. **事件一人选一次**：同一回合抽到的事件对全员相同，每人各选自己的选项；全员选完才进下一回合。
   模型军备数据里有 L2 / L3 两条升级线，任何时刻只出现符合当前档位与连胜的那条（所以仍是三选一；升到顶只有 2 条）。
9. **打满 8 回合的胜者**：设计稿只说「两名胜者」没说怎么挑；取存活者里血最多的两名（同血看金币）。
10. **商店每人一份**，不是 TFT 的共享卡池（§一的研究提到共享卡池，但 G2 不抢卡；G5 联机再谈）。
11. **`GameState.modelLevel` 只记开局档位**（全员 L1）；真实升降在 `GamePlayer.modelLevel`，G4 生成档读玩家。
12. **展示名先英文占位**（卡牌 / 风格 / 事件）：规则层不新增中文字面量（`check-i18n` 的棘轮），
    中文名与「一句话收益说明」属于 G2 界面层，随 Lingui 目录进来。
13. **§2.4「卡的品质影响出片分辨率」没做**：那属于 G4 的翻译层（卡 + 提示词 + 风格 → 生成契约），
    G2 只做「模型等级 → 游戏内生成档位」。
