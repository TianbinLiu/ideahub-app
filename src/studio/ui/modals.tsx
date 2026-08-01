// 市场卡详情（竖屏底部详情单）与合成进度遮罩
import { useEffect, useState } from "react";
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS } from "../../types";
import { useStudio } from "../studioStore";
import { MARKET } from "../scene/layout";
import CardHologram, { CARD_MODELS } from "./CardHologram";

// ── 市场卡详情：底部滑出单，左预览图右信息 + 加入卡组 ──────────
export function CardDetailModal() {
  const card = useStudio((s) => s.marketDetail);
  const items = useStudio((s) => s.market.items);
  const deck = useStudio((s) => s.deck);
  if (!card) return null;
  const i = items.findIndex((c) => c.id === card.id);
  // 不在市场摊开区的卡（如 NPC 手中的推荐卡）：飞行起点用 NPC 手边
  let from: [number, number, number] = [-0.5, 1.1, -3.3];
  if (i >= 0) {
    const row = Math.floor(i / MARKET.perRow);
    const col = i % MARKET.perRow;
    const rowCount = Math.min(MARKET.perRow, items.length - row * MARKET.perRow);
    from = [(col - (rowCount - 1) / 2) * MARKET.dx, 0.1, MARKET.rowsZ[Math.min(row, MARKET.rowsZ.length - 1)]];
  }
  const inDeck = deck.some((c) => c.id === card.id);
  const modelUrl = CARD_MODELS[card.name];
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-slate-600/70 bg-panel/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex gap-3.5">
        {modelUrl ? (
          <div className="relative h-44 w-[7.5rem] flex-none overflow-hidden rounded-xl bg-ink/85">
            <CardHologram url={modelUrl} />
            <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[9px] tracking-wide text-cyan-300/90">
              ✦ 全息实体 3D
            </span>
          </div>
        ) : (
          <img src={card.cover} alt={card.name} className="h-44 w-[7.5rem] flex-none rounded-xl object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold text-slate-100">{card.name}</h3>
            <span
              className="flex-none rounded-full border px-2 py-0.5 text-xs"
              style={{ color: CARD_TYPE_COLORS[card.type], borderColor: CARD_TYPE_COLORS[card.type] }}
            >
              {CARD_TYPE_LABELS[card.type]}
            </span>
          </div>
          {card.hot != null && (
            <div className="mt-0.5 text-xs text-gold">
              🔥 社区热度 {card.hot >= 10000 ? (card.hot / 10000).toFixed(1) + "万" : card.hot}
            </div>
          )}
          {card.tags && card.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.tags.map((t) => (
                <span key={t} className="rounded-full bg-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-300">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-slate-300">{card.summary}</p>
        </div>
      </div>
      <div className="mt-3.5 flex gap-2">
        <button
          onClick={() => useStudio.getState().closeMarketDetail()}
          className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200"
        >
          关闭
        </button>
        <button
          onClick={() => useStudio.getState().addMarketToDeck(from)}
          disabled={inDeck}
          className="flex-1 rounded-xl bg-gold/90 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
        >
          {inDeck ? "已在卡组" : "加入我的卡组"}
        </button>
      </div>
    </div>
  );
}

// ── 合成进度遮罩 ─────────────────────────────────────────────
const COMPOSE_STEPS = ["对齐各段首尾帧…", "渲染分镜与转场…", "拼接时间线…", "混录声画节奏…"];

export function ComposeOverlay() {
  const composing = useStudio((s) => s.composing);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!composing) return;
    setStep(0);
    const t = setInterval(() => setStep((v) => (v + 1) % COMPOSE_STEPS.length), 750);
    return () => clearInterval(t);
  }, [composing]);
  if (!composing) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-ink/85 backdrop-blur">
      <div className="h-1.5 w-64 overflow-hidden rounded-full bg-slate-700">
        <div className="shimmer h-full w-full" />
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-100">正在合成完整视频</div>
      <div className="mt-1.5 text-sm text-slate-400">{COMPOSE_STEPS[step]}</div>
    </div>
  );
}
