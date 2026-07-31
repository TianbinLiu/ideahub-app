// 工坊各弹窗：市场卡详情 / 节点素材编辑 / 方案详情 / 合成进度
import { useEffect, useState } from "react";
import { CARD_TYPES, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../../types";
import { activePath, chosenProposal, useStudio } from "../studioStore";
import { MARKET } from "../scene/layout";

// ── 市场卡详情：左预览图，右信息 + 加入卡组 ───────────────────
export function CardDetailModal() {
  const card = useStudio((s) => s.marketDetail);
  const items = useStudio((s) => s.market.items);
  const deck = useStudio((s) => s.deck);
  if (!card) return null;
  const i = items.findIndex((c) => c.id === card.id);
  const off = i - (items.length - 1) / 2;
  const from: [number, number, number] = [off * MARKET.dx, 0.1, MARKET.z + Math.abs(off) * 0.07];
  const inDeck = deck.some((c) => c.id === card.id);
  return (
    <div className="absolute right-[360px] top-1/2 z-20 w-[520px] max-w-[calc(100vw-400px)] -translate-y-1/2 rounded-2xl border border-slate-600/70 bg-panel/95 p-5 shadow-2xl backdrop-blur">
      <div className="flex gap-5">
        <img src={card.cover} alt={card.name} className="h-64 w-44 flex-none rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-xl font-bold text-slate-100">{card.name}</h3>
            <span
              className="flex-none rounded-full border px-2 py-0.5 text-xs"
              style={{ color: CARD_TYPE_COLORS[card.type], borderColor: CARD_TYPE_COLORS[card.type] }}
            >
              {CARD_TYPE_LABELS[card.type]}
            </span>
          </div>
          {card.hot != null && (
            <div className="mt-1 text-sm text-gold">🔥 社区热度 {card.hot >= 10000 ? (card.hot / 10000).toFixed(1) + "万" : card.hot}</div>
          )}
          {card.tags && card.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.tags.map((t) => (
                <span key={t} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-xs text-slate-300">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{card.summary}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button
          onClick={() => useStudio.getState().closeMarketDetail()}
          className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
        >
          关闭
        </button>
        <button
          onClick={() => useStudio.getState().addMarketToDeck(from)}
          disabled={inDeck}
          className="rounded-xl bg-gold/90 px-4 py-2 text-sm font-semibold text-ink hover:bg-gold disabled:opacity-40"
        >
          {inDeck ? "已在卡组" : "加入我的卡组"}
        </button>
      </div>
    </div>
  );
}

// ── 节点编辑：预览图 / 素材 / 视频要求 / 视频时长 + 生成 ───────
export function NodeEditorModal() {
  const editor = useStudio((s) => s.editor);
  const deck = useStudio((s) => s.deck);
  const root = useStudio((s) => s.root);
  const [pickerType, setPickerType] = useState<CardType | null>(null);
  if (!editor) return null;

  const path = activePath(root);
  const prev = path.length > 0 ? chosenProposal(path[path.length - 1]) : null;
  const segIndex = root ? path.length : 0;

  return (
    <div className="absolute left-1/2 top-1/2 z-20 max-h-[88vh] w-[620px] max-w-[calc(100vw-380px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-600/70 bg-panel/95 p-5 shadow-2xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-100">铸造节点卡 · 第 {segIndex + 1} 段</h3>
        <button
          onClick={() => useStudio.getState().closeEditor()}
          disabled={editor.generating}
          className="text-slate-400 hover:text-white disabled:opacity-30"
        >
          ✕
        </button>
      </div>

      {/* ① 预览图（生成前为空白） */}
      <div className="mb-4">
        <div className="mb-1.5 text-sm font-semibold text-slate-300">预览图</div>
        <div className="flex gap-3">
          <div className="flex aspect-video flex-1 items-center justify-center rounded-xl border-2 border-dashed border-slate-600 text-sm text-slate-500">
            生成后展示三种走向的首尾帧
          </div>
          {prev && (
            <div className="w-36 flex-none">
              <img src={prev.lastFrame} alt="上一段尾帧" className="aspect-video w-full rounded-lg object-cover" />
              <div className="mt-1 text-center text-xs text-slate-500">承接上一段尾帧</div>
            </div>
          )}
        </div>
      </div>

      {/* ② 素材槽（按卡片类型） */}
      <div className="mb-4">
        <div className="mb-1.5 text-sm font-semibold text-slate-300">素材</div>
        <div className="grid grid-cols-5 gap-2">
          {CARD_TYPES.map((type) => {
            const cardId = editor.slots[type];
            const card = deck.find((c) => c.id === cardId);
            const color = CARD_TYPE_COLORS[type];
            return (
              <div key={type} className="relative">
                {card ? (
                  <div className="overflow-hidden rounded-lg border" style={{ borderColor: color }}>
                    <img src={card.cover} alt={card.name} className="aspect-[2/3] w-full object-cover" />
                    <div className="truncate bg-ink/80 px-1 py-0.5 text-center text-xs" style={{ color }}>
                      {card.name}
                    </div>
                    <button
                      onClick={() => useStudio.getState().clearSlot(type)}
                      className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/70 text-xs text-slate-300 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setPickerType(pickerType === type ? null : type)}
                    className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs hover:bg-slate-700/30"
                    style={{ borderColor: color + "88", color }}
                  >
                    <span className="text-lg">＋</span>
                    {CARD_TYPE_LABELS[type]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {pickerType && (
          <div className="mt-2 rounded-xl border border-slate-600/70 bg-ink/60 p-2">
            <div className="mb-1.5 text-xs text-slate-400">从卡组选择{CARD_TYPE_LABELS[pickerType]}（也可直接拖拽桌面卡组的卡片到虚线卡位）</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {deck.filter((c) => c.type === pickerType).length === 0 && (
                <div className="py-3 text-xs text-slate-500">卡组暂无此类型——找铸卡师炼一张，或去市场收一张</div>
              )}
              {deck
                .filter((c) => c.type === pickerType)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      useStudio.getState().pickDeckCard(c.id);
                      setPickerType(null);
                    }}
                    className="w-20 flex-none overflow-hidden rounded-lg border border-slate-600 hover:border-brand"
                  >
                    <img src={c.cover} alt={c.name} className="aspect-[2/3] w-full object-cover" />
                    <div className="truncate bg-ink/80 px-1 py-0.5 text-center text-[10px] text-slate-300">{c.name}</div>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* ③ 视频要求 */}
      <div className="mb-4">
        <div className="mb-1.5 text-sm font-semibold text-slate-300">视频要求（剧情补充）</div>
        <textarea
          value={editor.requirement}
          onChange={(e) => useStudio.getState().setRequirement(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="例：主角在雨里发现了那封信的真正收件人，情绪从怀疑转为释然……"
          className="w-full rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
      </div>

      {/* ④ 视频时长 */}
      <div className="mb-5">
        <div className="mb-1.5 text-sm font-semibold text-slate-300">视频时长</div>
        <div className="flex items-center gap-4 text-sm text-slate-300">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={editor.durationMode === "ai"}
              onChange={() => useStudio.getState().setDurationMode("ai")}
            />
            交给 AI 决定
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={editor.durationMode === "manual"}
              onChange={() => useStudio.getState().setDurationMode("manual")}
            />
            自定义
          </label>
          {editor.durationMode === "manual" && (
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={2}
                max={15}
                value={editor.durationSec}
                onChange={(e) =>
                  useStudio.getState().setDurationSec(Math.min(15, Math.max(2, Number(e.target.value) || 2)))
                }
                className="w-16 rounded-lg border border-slate-600 bg-ink/70 px-2 py-1 text-center text-slate-100 outline-none focus:border-brand"
              />
              秒
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={() => useStudio.getState().closeEditor()}
          disabled={editor.generating}
          className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:opacity-40"
        >
          取消
        </button>
        <button
          onClick={() => void useStudio.getState().generateNode()}
          disabled={editor.generating}
          className="rounded-xl bg-brand/90 px-5 py-2 text-sm font-bold text-ink hover:bg-brand disabled:opacity-50"
        >
          {editor.generating ? "AI 正在推演三种走向…" : "生成"}
        </button>
      </div>
    </div>
  );
}

// ── 方案详情：左首尾帧，右小说式剧情 + 选定 ───────────────────
export function ProposalModal() {
  const view = useStudio((s) => s.proposalView);
  const root = useStudio((s) => s.root);
  if (!view) return null;
  const node = activePath(root).find((n) => n.id === view.nodeId);
  const p = node?.proposals.find((pp) => pp.id === view.proposalId);
  if (!node || !p) return null;
  const isChosen = node.chosenId === p.id;
  const switching = node.chosenId != null && !isChosen && node.children[node.chosenId] != null;

  return (
    <div className="absolute left-1/2 top-1/2 z-20 flex max-h-[86vh] w-[760px] max-w-[calc(100vw-380px)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-2xl border border-slate-600/70 bg-panel/95 p-5 shadow-2xl backdrop-blur">
      <div className="w-72 flex-none space-y-3">
        <div>
          <img src={p.firstFrame} alt="首帧" className="aspect-video w-full rounded-xl object-cover" />
          <div className="mt-1 text-center text-xs text-slate-400">首帧</div>
        </div>
        <div>
          <img src={p.lastFrame} alt="尾帧" className="aspect-video w-full rounded-xl object-cover" />
          <div className="mt-1 text-center text-xs text-slate-400">尾帧</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-100">{p.title}</h3>
          <span className="rounded-full bg-slate-700/70 px-2.5 py-0.5 text-xs text-slate-300">{p.durationSec} 秒</span>
        </div>
        <p className="novel-text mt-3 flex-1 text-[15px] text-slate-200">{p.plot}</p>
        {switching && (
          <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            ⚠ 更换方案后，原方案已延展的后续节点将被收起（再次切回可恢复）
          </div>
        )}
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => useStudio.getState().closeProposal()}
            className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
          >
            关闭
          </button>
          {isChosen ? (
            <button
              onClick={() => useStudio.getState().closeProposal()}
              className="rounded-xl bg-emerald-500/80 px-5 py-2 text-sm font-bold text-ink"
            >
              ✓ 当前选定
            </button>
          ) : (
            <button
              onClick={() => useStudio.getState().chooseProposal(node.id, p.id)}
              className="rounded-xl bg-gold/90 px-5 py-2 text-sm font-bold text-ink hover:bg-gold"
            >
              选定此方案
            </button>
          )}
        </div>
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
      <div className="h-1.5 w-72 overflow-hidden rounded-full bg-slate-700">
        <div className="shimmer h-full w-full" />
      </div>
      <div className="mt-5 text-lg font-semibold text-slate-100">正在合成完整视频</div>
      <div className="mt-1.5 text-sm text-slate-400">{COMPOSE_STEPS[step]}</div>
    </div>
  );
}
