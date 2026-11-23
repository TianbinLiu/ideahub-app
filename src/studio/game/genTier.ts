/**
 * 对局的 L1 / L2 / L3 → 出片档位表的 **tierId** —— 唯一的翻译处（G4 收尾，2026-11-23）。
 *
 * 规则层（./rules，零依赖、Node 直接 import 跑 `scripts/check-game-rules.mjs`）只回答**语义**：
 * 「这一局按什么档位」= `{ level: 1|2|3, tier: "draft" | "hd" | "cinema", resolution }`（`MODEL_LEVEL_TIERS`）。
 * 它不认识档位表、不了解地区、读不到能力位（`tierOffered` / `tierOfPreferred` 在 data/account，会拉 lingui 与本地库）。
 * tierId 的翻译因此落在这一层 —— 与快速模式（pages/QuickModePage.previewTierId）同一个写法。
 *
 * ★★ 三个落点（依据 docs/g2-game-ui.md「工坊默认档与真人卡」§4，2026-11-19 真机实测）：
 *
 *   | 规则层语义 | 档位表基准行 | 首选（这台机器给得出 MiniMax 时） | 回落 |
 *   |---|---|---|---|
 *   | L1 `draft`   | `draft`  | **`draft-mm`**  (MiniMax H3-Lite · 480P) | `draft`（Seedance 2.0 mini · 480p） |
 *   | L2 `hd`      | `hd`     | **`hd-mm`**     (MiniMax H3-Highspeed · 768P) | `hd` |
 *   | L3 `cinema`  | `ultra`  | **`ultra-mm`**  (MiniMax H3 · 768P) | `ultra`（Seedance 2.5 · 720p） |
 *
 *   · **L1 为什么落到 `draft-mm`**：对局要挂 4 张角色卡 + 1 张场景卡，而"挂得上写实 / 真人角色卡"这件事
 *     今天是靠 MiniMax 那一行做到的 —— 同一张写实人像首帧 Seedance 侧整发拒、H3-Lite 收（2026-11-19），
 *     而且更便宜（5 秒 56,000 vs 77,004）。`draft` 回落时界面上照实说"这台机器只有 Seedance，写实卡可能被拒"
 *     （话不写在这儿：判据只有 `tierOffered`）。
 *   · **L2 / L3 必须一起对齐**：不然玩家一升档就撞回写实人脸审核（g2-game-ui.md §4 最后一条）。
 *     ⚠ `hd-mm` / `ultra-mm` 收不收写实人像**没验过** —— 这里只说"这台机器给得出"，不说"写实卡一定行"。
 *   · **L3 不是字面上的 `ultra`**（★★ 这条最容易写错）：规则层写的 `resolution: "1080p"` 在档位表里**没有这一行**
 *     —— 1080p 只存在于 `ultra` 的「样片 → 定稿」第二步（`economy.draftFinalTokens`）。照字面实现 = 一条 5 秒片
 *     发两发（480p 样片 + 1080p 定稿 ≈ **147 万 token**，L1 的 26 倍），而那一发在方舟上会被同一条写实人脸审核拒
 *     （2026-11-19 快模式定稿那一发就是这个事故）。所以 L3 接 `ultra-mm`（768P，179,000 / 5 秒）；
 *     `ultra` 只是**回落**（这台机器给不出 MiniMax 时），界面上别再写"1080p"。
 *
 * ★ 为什么"首选 MiniMax"不写死 id 而走 `tierOfPreferred` + `tierOffered`：
 *   写死 `"draft-mm"` 的后果是"没接 MiniMax 的服务器 / 不给 MiniMax 的地区"第一回合就发不出去，
 *   而回落得在规则层 / 翻译层 / 界面三处各写一份 —— 正是铁律六要治的形状。
 * ★ 这一层**不读** pad 价目 / 不收钱：报价与真扣都从 `node.videoTier` 这一个 id 出发（flowStore.nodeCost / genNode 同一把尺）。
 */
import { payingNow, preferredTierIdOf } from "../../data/account";
import { MODEL_LEVEL_TIERS, type ModelGate } from "./rules";
import type { GameGenerationTier, GamePlayer, ModelLevel } from "./types";

/**
 * 规则层语义 → 档位表里**基准行**的 id（另一家的对标行与它同一个 `family`）。
 * ★ `cinema` → `"ultra"` 这一格就是 gen.ts 原来那张 TIER_FAMILY 表的结论（搬来，只此一处）：
 *   规则层说的"电影级"在档位表里叫 `ultra`，而这一局真正要的是它的 MiniMax 对标行。
 */
const BASE_TIER_ID: Readonly<Record<GameGenerationTier["tier"], string>> = {
  draft: "draft",
  hd: "hd",
  cinema: "ultra",
};

/**
 * 规则层语义 → 这一发真正发出去的 tierId（**唯一出口**）。
 * ★ 两行式收在 data/account.preferredTierIdOf 一处（快速模式与对局共用）：写死 `"draft-mm"` 的后果是
 *   "没接 MiniMax 的服务端 / 不给 MiniMax 的地区"第一回合就发不出去，而回落得在三处各写一份 —— 正是铁律六要治的形状。
 */
export function genTierIdOfTier(tier: GameGenerationTier["tier"]): string {
  return preferredTierIdOf(BASE_TIER_ID[tier], "minimax");
}

/**
 * 等级（L1 / L2 / L3）→ tierId。**给测试与排查用**；出片那一发走 genTierIdOf(player)（语义从 rules 来）。
 * ★ 「L2 = hd、L3 = cinema」这一格不在这里重写：读 rules.MODEL_LEVEL_TIERS（规则层唯一的那张表）。
 */
export function genTierIdOfLevel(level: ModelLevel): string {
  return genTierIdOfTier(MODEL_LEVEL_TIERS[level].tier);
}

/**
 * 「这台设备上的这个账号能不能升档」——**唯一判据**（任务 A，2026-11-23 主人拍板：免费账号只能停在 L1）。
 *
 * ★ 只问 `account.payingNow()`（套餐价 > 0 **或**钱包回包顶层的 `paid`；管理员在里面豁免），
 *   与 `tierBlockReason` 共用同一个"付没付过钱"的判据 —— 但**不能**直接拿 `tierBlockReason(hd)` 当会员判据：
 *   它把"模型停用 / 这个地区给不出这一档 / 服务端不支持"也一并算进返回值里，而那些与套餐无关。
 *   只给 MiniMax 的地区里 `hd`（Seedance）本来就不摆，靠它会**把付过钱的人锁死在 L1**。
 * ★ 「还不知道」（`payingNow()` 回 null：远端钱包镜像没回来 / 未登录）**按能升放行**，
 *   与 `tierBlockReason` / `canAfford` 同一个乐观口径（不能因为镜像慢半拍就把付费用户的升级线摘掉）；
 *   真是免费用户的话服务端在出片那一发之前就拒（403 `PLAN_REQUIRED`，不扣视频的钱）。
 * ★ 这个函数被三处读、都读同一份：`view.eventViewOf`（摆哪些选项）、`store.chooseEvent`（真扣钱）、
 *   `genTierIdOf`（这一发真发出去的档位）。三处各写一遍就会出现"界面上摆着 15 金的 L3、
 *   点了才说不行"，或者"界面写着 L2、发出去是 L1"——两个方向都是钱上的假话。
 */
export function modelUpgradeGate(): ModelGate {
  return { upgrade: payingNow() !== false };
}

/**
 * 这一局**真正生效**的等级（免费账号停在 L1）。
 * ★ 为什么还要夹一道：玩家可能"付费时升到 L3、这局之前套餐过期了"（或者开发夹具直接塞了个 L3）——
 *   界面上写 L3、发出去 L1 一样是假话，所以出片读的档位与 rules.generationTierOf 同一个 gate。
 */
export function effectiveModelLevel(level: ModelLevel): ModelLevel {
  return modelUpgradeGate().upgrade ? level : MODEL_LEVEL_TIERS[1].level;
}

/**
 * 这个玩家这一局出片落在哪个 tierId（L1 → `draft-mm` / L2 → `hd-mm` / L3 → `ultra-mm`，给不出时各自回落）。
 * ★ 语义从 rules 来 —— 这里**不另判一次等级**（原来 gen.gameTierOf 抄了一份
 *   `modelLevel === 3 ? … : …`，规则层改口径时那份不会跟着变）。
 * ★ 免费账号在这里落到 L1（`draft-mm`）：见 modelUpgradeGate。
 */
export function genTierIdOf(player: Pick<GamePlayer, "modelLevel">): string {
  return genTierIdOfLevel(effectiveModelLevel(player.modelLevel));
}
