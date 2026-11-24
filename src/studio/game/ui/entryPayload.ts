/**
 * 一期作品 → 联机交片请求体的**唯一一处翻译**（2026-11-24）。
 *
 * ★ 单机版的交片写的是本机 `rules.submitRoundEntry`；联机版还要把同一份事实发给服务端
 *   （`POST /rounds/entries`）。两处各拼一遍「卡名怎么取、档位写哪个」就是两份会漂的真相 ——
 *   服务端收到的卡名与屏幕上摆的对不上时，零报错，只有展映那一条看着不像自己交的。
 * ★ 卡名 = **桌面上的卡 + 挂在角色身上的道具**（`rules.castCardsOf`），与单机交片同一个来源。
 *   名字用界面语言（`gameCardName`）—— 服务端只存字符串，展映屏直接显示（跨语言玩家会看到对方语言的卡名，
 *   这是这一版接受的取舍：服务端没有卡目录，只有交片人当时看到的名字）。
 * ★ `modelTier` 用规则层那一档的**语义名**（draft / hd / cinema），不是出片档位表里的 id
 *   （`draft-mm` 这种是这台机器 / 这个地区才定得下来的，服务端不需要也不该知道）。
 */
import { ROUND_CARD_NAMES_MAX, type RemoteRoundEntryInput } from "../../../api/game/rounds";
import { effectiveModelLevel } from "../genTier";
import { gameCardName } from "../labels";
import { castCardsOf, MODEL_LEVEL_TIERS } from "../rules";
import type { GameView } from "../view";

/**
 * 拼这一发交片。
 * @param video 真出片的那一条（地址 + 首帧当封面）；不传 = 占位片（placeholder: true）
 */
export function entryPayloadOf(
  view: GameView,
  prompt: string,
  video?: { videoUrl: string; posterUrl?: string },
): RemoteRoundEntryInput {
  const cardNames = castCardsOf(view.player)
    .map((card) => gameCardName(card))
    // 服务端 CARD_NAMES_MAX = 20：满配（4 角色 + 4×4 道具 + 1 场景 = 21，事件给过道具上限加成时）会超一格。
    // 超了服务端整发拒（BAD_CARD_NAMES），那比少一个卡名更糟 —— 截到上限，卡片本体还在桌面上。
    .slice(0, ROUND_CARD_NAMES_MAX);
  return {
    prompt: prompt.trim(),
    cardNames,
    ...(video ? { videoUrl: video.videoUrl, ...(video.posterUrl ? { posterUrl: video.posterUrl } : {}) } : {}),
    placeholder: !video,
    modelTier: MODEL_LEVEL_TIERS[effectiveModelLevel(view.player.modelLevel)].tier,
  };
}
