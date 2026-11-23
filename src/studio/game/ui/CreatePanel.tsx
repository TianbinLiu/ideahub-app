// 创作面板（G3，§2.4）：三个虚框 + 一句提示词 + 从背包点选卡。
//
// ★ 施工单说"卡可以从背包点选放进槽位"（这一块不做 3D 拖拽，那要碰 scene/）：
//   每个类型只有一个虚框（角色 / 场景 / 道具），点背包里的一张卡就放进它那一格；
//   点已经放进去的那一格 = 拿回来（不是"卖"，槽位只是这一期作品的取景框）。
// ★ 提示词上限问 rules.promptLimitOf（基础 80 字，事件「灵感爆发」+50%）—— 界面不自己乘；
//   输入框的 maxLength 也用它，但**真正拒的是 rules.submitRoundEntry**（粘贴 / 输入法可能绕过 maxLength）。
// ★ 提交后**可以重交**（改卡、改词都行，占位视频不花钱）：所以按钮写「拍好了」/「重拍」，
//   而"能不能进下一阶段"是 PhaseBar 那颗键 + rules.enterScreening 的闸，不在这里判。
import { useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { SLOT_TYPES, VIDEO_SECONDS, promptLimitOf } from "../rules";
import { cardTypeName, gameCardName } from "../labels";
import { useGame } from "../store";
import { roundViewOf, type GameView } from "../view";
import type { CardType, GameCard } from "../types";
import GameBtn from "./GameBtn";
import GameCardTile from "./GameCardTile";

export default function CreatePanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const meId = useGame((s) => s.meId);
  const state = useGame((s) => s.state);
  const roundView = state ? roundViewOf(state, meId) : null;

  // 已经交过的话，从作品里恢复槽位与提示词（重进这一屏 / 重交都接着原来的）
  const [slots, setSlots] = useState<Partial<Record<CardType, GameCard>>>(() => {
    const restored: Partial<Record<CardType, GameCard>> = {};
    for (const card of roundView?.mine?.entry.cards ?? []) restored[card.type] = card;
    return restored;
  });
  const [prompt, setPrompt] = useState(() => roundView?.mine?.entry.prompt ?? "");

  const limit = promptLimitOf(view.player);
  const length = Array.from(prompt.trim()).length;
  const everyCard = useMemo(
    () => [...view.bag.cards, ...view.bag.equipped.map((entry) => entry.item)],
    [view.bag.cards, view.bag.equipped],
  );
  const pickedCount = SLOT_TYPES.filter((type) => slots[type]).length;

  const setSlot = (card: GameCard) => {
    setSlots((previous) => {
      const next = { ...previous };
      // 点已经在格子里的那张 = 拿回来；点另一张同类型的 = 换掉它
      if (next[card.type]?.id === card.id) delete next[card.type];
      else next[card.type] = card;
      return next;
    });
  };

  const submit = () => {
    const cards = SLOT_TYPES.map((type) => slots[type]).filter((card): card is GameCard => Boolean(card));
    useGame.getState().saveEntry(cards, prompt);
  };

  return (
    <div className="pointer-events-auto w-full max-w-[46rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-start gap-2">
        {/* 三个虚框：角色 / 场景 / 道具各一个 */}
        <div className="flex flex-none gap-1.5">
          {SLOT_TYPES.map((type) => {
            const card = slots[type];
            const typeName = cardTypeName(type);
            return (
              <div key={type} className="w-[clamp(2.6rem,5.4vw,3.8rem)]">
                {card ? (
                  <button
                    type="button"
                    onClick={() => setSlot(card)}
                    aria-label={t`把「${gameCardName(card)}」从${typeName}槽里拿回来`}
                    className="block w-full text-left"
                  >
                    <GameCardTile card={card} highlight="gold" className="w-full" />
                  </button>
                ) : (
                  <div
                    className="flex h-[clamp(3.9rem,8.1vw,5.7rem)] w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/20 text-[9px] leading-tight text-slate-400"
                    title={t`${typeName}槽：点下面一张${typeName}卡放进来`}
                  >
                    <span className="text-[14px] leading-none text-slate-500" aria-hidden>
                      ＋
                    </span>
                    <span>{typeName}</span>
                  </div>
                )}
                <div className="mt-0.5 text-center text-[9px] leading-tight text-slate-500">{typeName}</div>
              </div>
            );
          })}
        </div>

        {/* 提示词 + 拍好了 */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={limit}
            placeholder={t`一句话：这一期拍什么？（例如：雨夜里一个女孩回头）`}
            aria-label={t`这一期的提示词`}
            className="w-full rounded-lg bg-ink/60 px-2 py-1 text-[11px] text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-brand/50"
          />
          <div className="flex items-center gap-2">
            <span className={`text-[10px] ${length > limit ? "text-danger-200" : "text-slate-500"}`}>
              <Trans>
                提示词 {length}/{limit} 字
              </Trans>
            </span>
            <span className="text-[10px] text-slate-500">
              <Trans>· {pickedCount} 张卡</Trans>
            </span>
            <GameBtn onClick={submit} tone="primary" className="ml-auto">
              {roundView?.mine ? (
                <Trans>🎬 重拍（{VIDEO_SECONDS} 秒占位片）</Trans>
              ) : (
                <Trans>🎬 拍好了（{VIDEO_SECONDS} 秒占位片）</Trans>
              )}
            </GameBtn>
          </div>
        </div>
      </div>

      {/* 背包里能放进虚框的卡（点一下就进它那一格） */}
      <div className="mt-1 flex items-center gap-1 overflow-x-auto">
        <span className="flex-none text-[10px] text-slate-400">
          <Trans>点一张卡放进虚框：</Trans>
        </span>
        {everyCard.map((card) => {
          const active = slots[card.type]?.id === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setSlot(card)}
              aria-label={t`把「${gameCardName(card)}」放进${cardTypeName(card.type)}槽`}
              className={`w-[clamp(2rem,4.1vw,2.9rem)] flex-none rounded-md ${
                active ? "ring-2 ring-gold-300" : "hover:ring-1 hover:ring-white/30"
              }`}
            >
              <GameCardTile card={card} />
            </button>
          );
        })}
        {everyCard.length === 0 && (
          <span className="text-[10px] text-slate-500">
            <Trans>背包里一张卡都没有——空镜也能交片，但没人会投给它（下回合商店阶段先买一张）</Trans>
          </span>
        )}
      </div>
    </div>
  );
}
