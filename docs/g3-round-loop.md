# 工坊对局：单机回合循环（G3-a）

> 2026-11-23。把「一局」真的跑起来：1 名真人 + 3 个 AI 陪玩，**不接生成**（每期一条 5 秒占位视频），
> 走完 商店 → 创作 → 展映（点赞）→ 投票 → 结算（扣血 / 淘汰）→ 事件（三选一）→ 下一回合，
> 8 回合或剩 ≤2 人时由 `rules.winnersOf` 出胜者。
> 规则正本仍是 `src/studio/game/rules.ts`（见 `docs/game-rules-engine.md`），界面那一块见 `docs/g2-game-ui.md`。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/rules.ts` | **规则只在这里**：作品（`submitRoundEntry`）、展映顺序（`screeningOrderOf`）、点赞（`likeEntry`）、投票（`voteEntry` / `abstainVote`）、两个榜与综合名次（`tallyRound`）、从票数结算（`settleRoundFromVotes`）、事件跳过（`skipEventChoice`）、阶段闸（`enterScreening` 要求全员交片） |
| `src/studio/game/types.ts` | 新形状：`RoundEntry` / `EntryTally` / `RoundTally`；`GameState` 加 `entries` / `abstained` / `lastRanking` |
| `src/studio/game/bots.ts` | **AI 的启发式**（纯函数、随机源注入）：买卡一步（`aiShopMove`）、交片计划（`aiEntryPlan`）、点赞（`aiLikes`）、投票（`aiVote`）、事件候选（`aiEventOptions`） |
| `src/studio/game/phases.ts` | **一局怎么走**（纯函数、零界面）：开局（`startMatch`）、开回合（`openRound`）、进创作 / 展映 / 投票（`toCreation` / `toScreening` / `toVoting`）、AI 选事件（`aiEventChoices`）、真人被淘汰后跑完剩下的回合（`playOutAiOnly`） |
| `src/studio/game/store.ts` | 只做编排：每个动作递给 `rules` / `phases` → 写回 → 失败原因原样留着（`report` 存最近一次的摘要 + 两个榜） |
| `src/studio/game/view.ts` | 界面读数：`roundViewOf`（排片 / 我投了谁 / 还差几个人）、`entryViewById`、`damagesViewOf`、`boardsOf`、`opponentsOf`、`eventViewOf` |
| `src/studio/game/ui/PhaseBar.tsx` | 阶段条：这一阶段该干嘛 + 「开始创作 / 开始展映 / 去投票 / 结算 / 下一回合 / 再来一局」 |
| `src/studio/game/ui/CreatePanel.tsx` | 创作面板：三个虚框 + 一句提示词 + 从背包点选放卡 |
| `src/studio/game/ui/ScreeningPanel.tsx` | 展映播放器：占位色块 + 标题 + 进度（5 秒）+ 点赞 |
| `src/studio/game/ui/VotingPanel.tsx` | 投票：除自己外的三条 + 弃权 |
| `src/studio/game/ui/EventPanel.tsx` | 事件三选一 + 跳过 |
| `src/studio/game/ui/RoundResultPanel.tsx` | 结算（扣血 / 淘汰 / 两个榜）与对局结束（胜者） |
| `src/studio/game/ui/OpponentStrip.tsx` | 三个 AI 的血量 / 卡数 / 出局状态（HUD 下面一行） |
| `scripts/check-game-rules.mjs` | 规则断言 **851** 条（原 704 条 + G3 新增 147 条：交片 / 排片 / 点赞 / 投票 / 榜单 / 从票数结算） |
| `scripts/check-game-bots.mjs` | **整局实跑** 626 条断言：AI 启发式 + 一局 8 回合跑完（扣血 / 淘汰 / 事件 / 胜者 / 同 seed 同结果） |

★ 为什么 `bots.ts` / `phases.ts` 是纯函数而不是写在 store 里：`scripts/check-game-bots.mjs` 用 Node 直接
import 它们**整局跑一遍**（不点一次界面）。回合循环坏掉的方式（有人没交片、AI 那一步被静默跳过、
名次与扣血不一致）在界面上只是"按钮点了没反应"，只有整局跑才看得见。
为此 `tsconfig.json` 开了 `allowImportingTsExtensions`：Node 的 ESM 不补扩展名，`phases.ts` 里
`import … from "./rules.ts"` 才 import 得动（不引第三方 loader、也不在脚本里另抄一份编排）。

## 一回合走一遍（界面 → store → rules / phases）

| 阶段 | 界面 | store 动作 | 递给谁 |
|---|---|---|---|
| 商店 | 商店面板 + 背包条（G2 原样） | `buy` / `sell` / `equipOn` / `refresh` / `toggleLock` | `rules.buyShopCard` … |
| → 创作 | 「🎬 开始创作」 | `enterCreate` | `phases.toCreation`（AI 在这里交片） |
| 创作 | 三个虚框 + 提示词 + 背包点选 | `saveEntry` | `rules.submitRoundEntry` |
| → 展映 | 「▶ 开始展映」 | `enterScreening` | `phases.toScreening`（AI 在这里点赞） |
| 展映 | 占位播放器 4 条 + 点赞 | `like` | `rules.likeEntry` |
| → 投票 | 「🗳 去投票」 | `enterVoting` | `phases.toVoting`（AI 在这里投票） |
| 投票 | 三条候选 + 弃权 | `vote` / `abstain` | `rules.voteEntry` / `abstainVote` |
| → 结算 | 「📊 结算」 | `settle` | `rules.settleRoundFromVotes`（榜单 + 扣血一次算完） |
| 结算 | 扣血表 + 两个榜 + 淘汰横幅 | — | `report`（rules 的回执） |
| → 事件 | 三选一 + 跳过 | `chooseEvent` / `skipEvent` | `rules.applyEventChoice` / `skipEventChoice` |
| → 下一回合 | 「➡ 下一回合」 | `nextRound` | `phases.openRound`（发收入 + 刷商店 + AI 买卡） |
| 结束 | 胜者 + 血量 | 「🔁 再来一局」 | `rules.winnersOf` / `startGame` |

**AI 买卡不在真人买卡的时候跟着买**：`phases.openRound` 在进商店那一刻就把三个 AI 的商店买完了
（单机版没有"等另一个玩家操作"这件事，让真人盯着空桌子没有意义）。

## AI 的启发式（`bots.ts`）

- **买卡**：买得起里**最贵**的那张（品质 = 买价 = 强弱）；装不下时用**同类型、更便宜**的旧卡顶掉
  （同价不换 —— `replaceCardInBag` 不返钱，同价换卡纯亏）；带装备的角色不选来顶（规则会拒 `role-equipped`）。
  不存钱吃利息、不刷新 —— 那是"AI 变强"那一步的事。
- **交片**：三个槽位各放自己**品质最高**的那张卡（没有就是空镜）；提示词从界面递进来的池子里随机抽一条。
- **点赞**：按排片顺序每条 55% 概率点（随机，不看品质 —— §2.5 的点赞是"讨喜"，与投票分开）。
- **投票**：在"除自己外"的片子里按 **1 + 卡品质之和** 加权随机（空镜权重 1，三张金卡 16）。
  完全随机的话这一局的经济在结算上没有任何反馈。
- **事件**：买得起的选项里随机挑（有一次 rng 扰动，同一 seed 永远同一批选择）。

## 一局实际跑出来的数（`node scripts/check-game-bots.mjs`，seed 20261123）

```
整局（seed=20261123）：7 回合 · 事件 3 次 →
R1 [ai-1 −5/95 · ai-3 −10/90 · me −15/85 · ai-2 −20/80]
R2 [ai-2 −5/75 · me −10/75 · ai-3 −15/75 · ai-1 −20/75]   ← 事件 #1
R3 [ai-1 −5/70 · ai-2 −10/65 · ai-3 −15/60 · me −20/55]
R4 [ai-1 −5/65 · ai-2 −10/55 · me −15/40 · ai-3 −20/40]   ← 事件 #2
R5 [ai-3 −5/35 · ai-1 −10/55 · me −15/25 · ai-2 −20/35]
R6 [ai-2 −5/30 · ai-1 −10/45 · ai-3 −15/20 · me −20/5]    ← 事件 #3
R7 [ai-3 −5/15 · ai-2 −10/20 · me −15/0 · ai-1 −20/25]    ← me 在第 7 回合淘汰（3 人剩）
后台跑完第 8 回合 → 剩 2 人（ai-1 / ai-2）→ 胜者 ai-1, ai-2
```

对照规则：4 人局每期扣血 5 / 10 / 15 / 20（`rules.damageForRank(4, …)`），3 人局缩放成 5 / 10 / 15；
`hpAfter = max(0, hpBefore − damage)`，只有归零才淘汰；第 2/4/6 回合结算之后各出一次事件，池子不重样；
打满 8 回合或剩 ≤2 人时由 `winnersOf` 给胜者。同一 seed 再跑一遍逐字段一致（脚本里钉着）。

## 与设计稿不一致 / 设计稿没写清、G3 拍了的地方

1. **点赞可以点自己那条**：§2.5 只说"任何人可点赞"，"不能投自己"是投票那一句才写的。
   四条各给自己 +1 在名次上是等价的，所以不另外加闸。
2. **提示词上限 80 字**（事件「灵感爆发」+50% = 120）：§2.4 只说"写一句提示词"，没给上限。
   横屏真机 800×363 的视口里，输入框只放得下一行半。
3. **空镜也能交片**（一张卡都不放，只要有提示词）：开局 0 张卡 + 钱花光时玩家会没有卡，
   而展映要求全员交片 —— 不给空镜这条路，玩家会卡在创作阶段出不去。代价落在投票权重上（权重 1）。
4. **事件可以「跳过」**（`rules.skipEventChoice`，三选一之外的下属出口）：灵感爆发的免费项是
   "随机一张蓝卡"，满背包时 `applyEventEffects` 会整项拒（铁律八：不静默丢卡），而另外两项要 3 / 6 金 ——
   一个满背包又没钱的人**一个选项都选不了**，事件要求全员各选一次才能进下一回合，这一局就永远停在那里。
   跳过 = 记一笔表态、什么都不改（设计稿本来就说免费项"相当于跳过"）。
5. **AI 全部交片 / 点赞 / 投票都在"进阶段的那一拍"完成**：单机版没有真人的"看片时间"，
   AI 也没有"等别人投"这件事；顺序不影响榜，只影响玩家看到的数是否已经落好。
6. **真人被淘汰之后剩下的回合自动跑完**（`phases.playOutAiOnly`）：§2.5 的胜负是"最后两人胜出"，
   提前收局就永远没有胜者。玩家在结束屏看到的是"你在第 N 回合被淘汰 + 最终胜者"。
7. **综合名次不并列**：两个榜的名次相加相同、投票榜也相同、票数与点赞都相同时，按 `playerId` 定序。
   扣血需要一个确定的"最后一名"，而并列会让 -20 没有唯一解。
8. **模型的升档线（L2/L3）本身不在这里**：§2.4「卡的品质影响出片分辨率」与 §2.3b 的升级效果都还是
   G4 的事；G3 只让事件把 `modelLevel` 改掉（HUD 上看得到 L2/L3），出片仍是占位片。

## 真机（3C15CJ00C8V00000）验出来的一个坑：面板宽度别按视口算

横屏的 CSS 视口是 **800×363**（2800×1272 / DPR 3.5），两条常驻条各占 `clamp(8.5rem, 15vw, 13rem)`
≈ 136px，所以对局覆盖层的定位父级（StudioPage 的舞台那一列）**只有 520px 宽**。

G2 那一版所有面板宽度都写成 `w-[min(46rem, 96vw)]` —— `96vw` 是**视口的 96%**（=768px），比舞台还宽，
于是面板右边伸进右栏底下。桌面上看不出来（窗口更宽、按钮更靠中间），真机上表现为：

- 创作面板右边的「🎬 拍好了」有 40% 落在右栏下面，**点上去什么也不会发生**（不报错、不提交）；
- 事件屏的第三张选项卡、结算屏的两个榜也是同样的形状。

改法：**面板一律 `w-full max-w-[…]`**（按舞台宽度封顶），宽度不再出现 `vw`。真机复验：
创作面板 160~640 CSS（舞台 136~656），「拍好了」整颗都在舞台上，点右半边能提交了。

★ 这条也解释了 G2 为什么没暴露：商店面板是 `w-fit`（窄）、背包条也是 `w-fit`，只有第一个"宽面板"
（创作）才会撞上这条线。以后加面板照 `w-full max-w-[…]` 写，别写 `vw`。

## 怎么验的（2026-11-23）

1. `node scripts/check-game-rules.mjs`（851 条）与 `node scripts/check-game-bots.mjs`（626 条）——
   后者把一局 8 回合在 Node 里整跑（含事件 / 扣血 / 淘汰 / 胜者 / 同 seed 同结果）。
2. 浏览器（`npm run dev` 的同一份构建，无头驱动 store 的公开动作）连跑两整局：第 1 局 7 回合、
   第 2 局 8 回合，群里报的数都是 rules 的回执（见上面那张表）。
3. 真机 `npm run apk:release` → `adb install -r` → 从「工坊 → 我的仓库 → 3D 工坊 → 开局」一路点到
   事件屏：风格三选一 / 商店买卡 / 创作面板填卡写词交片 / 展映播放与点赞 / 投票 / 结算（扣血 + 两个榜）/
   第 2 回合后的「灵感爆发」三选一 + 跳过 —— 每一屏的元素都落在 800×363 视口内（用 `uiautomator dump`
   逐屏量过 bounds）。上面那条「面板宽度」的坑就是这么量出来的。


