// 创意工坊页：管理自己的卡片与卡组——搜索添加市场卡片、建组、增删卡。
// 与 3D 卡片工坊（/studio）分工：这里是资产管理，那里是创作现场。
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addCards, createDeck, deleteDeck, myCards, myDecks, removeCard, updateDeck } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { searchMarket } from "../ai";
import { Card, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../types";

function CardTile({ card, onRemove }: { card: Card; onRemove?: () => void }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-700/60 bg-panel">
      {card.cover ? (
        <img src={card.cover} alt={card.name} className="aspect-[3/4] w-full object-cover" />
      ) : (
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-slate-800 text-3xl">🎴</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
        <div className="truncate text-xs font-medium text-slate-100">{card.name}</div>
        <span
          className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px]"
          style={{ color: CARD_TYPE_COLORS[card.type], background: CARD_TYPE_COLORS[card.type] + "22" }}
        >
          {CARD_TYPE_LABELS[card.type]}
        </span>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-slate-200 group-hover:flex"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function WorkshopPage() {
  useAccountVersion(); // 账号库变更时重算列表
  const cards = myCards();
  const decks = myDecks();
  const [tab, setTab] = useState<"cards" | "decks">("cards");
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  // 搜索市场卡片（空词=热门）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void searchMarket(q).then((list) => {
      if (alive) {
        setMarket(list);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [q]);

  const ownedIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const byType = useMemo(() => {
    const m: Partial<Record<CardType, number>> = {};
    for (const c of cards) m[c.type] = (m[c.type] ?? 0) + 1;
    return m;
  }, [cards]);

  return (
    <div className="safe-top min-h-full px-4 pt-3">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-100">创意工坊</h1>
        <Link to="/studio" className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink">
          🎴 进入 3D 工坊
        </Link>
      </div>

      {/* 统计条 */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 text-[11px]">
        <span className="flex-none rounded-full bg-panel px-2.5 py-1 text-slate-300">共 {cards.length} 张卡</span>
        {Object.entries(byType).map(([t, n]) => (
          <span
            key={t}
            className="flex-none rounded-full px-2.5 py-1"
            style={{ color: CARD_TYPE_COLORS[t as CardType], background: CARD_TYPE_COLORS[t as CardType] + "1f" }}
          >
            {CARD_TYPE_LABELS[t as CardType]} {n}
          </span>
        ))}
        <span className="flex-none rounded-full bg-panel px-2.5 py-1 text-slate-300">{decks.length} 个卡组</span>
      </div>

      {/* 页签 */}
      <div className="mb-3 flex gap-2">
        {(["cards", "decks"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${
              tab === t ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
            }`}
          >
            {t === "cards" ? "我的卡片" : "我的卡组"}
          </button>
        ))}
      </div>

      {tab === "cards" ? (
        <>
          {cards.length > 0 && (
            <div className="mb-5 grid grid-cols-3 gap-2.5">
              {cards.map((c) => (
                <CardTile key={c.id} card={c} onRemove={() => removeCard(c.id)} />
              ))}
            </div>
          )}
          {cards.length === 0 && (
            <div className="mb-5 rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              还没有卡片——去 3D 工坊炼卡，或从下面的市场添加
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-slate-300">从市场添加</h2>
          <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-700 bg-panel px-4 py-2">
            <span className="text-slate-500">🔍</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索卡片名 / 标签"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-500">搜索中…</div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 pb-4">
              {market.map((c) => {
                const owned = ownedIds.has(c.id);
                return (
                  <button key={c.id} onClick={() => !owned && addCards([c])} disabled={owned} className="text-left">
                    <div className={owned ? "opacity-40" : ""}>
                      <CardTile card={c} />
                    </div>
                    <div className="mt-1 text-center text-[10px] text-slate-400">{owned ? "已拥有" : "＋ 添加"}</div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => createDeck(`卡组 ${decks.length + 1}`)}
            className="mb-3 w-full rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-300"
          >
            ＋ 新建卡组
          </button>
          <div className="space-y-3 pb-4">
            {decks.map((d) => {
              const inDeck = cards.filter((c) => d.cardIds.includes(c.id));
              const open = editing === d.id;
              return (
                <div key={d.id} className="rounded-xl border border-slate-700/60 bg-panel p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={d.name}
                      onChange={(e) => updateDeck(d.id, { name: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none"
                    />
                    <span className="text-[11px] text-slate-500">{d.cardIds.length} 张</span>
                    <button onClick={() => setEditing(open ? null : d.id)} className="text-xs text-brand">
                      {open ? "完成" : "编辑"}
                    </button>
                    <button onClick={() => deleteDeck(d.id)} className="text-xs text-rose-400">
                      删除
                    </button>
                  </div>
                  {inDeck.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-4 gap-2">
                      {inDeck.map((c) => (
                        <CardTile key={c.id} card={c} />
                      ))}
                    </div>
                  )}
                  {open && (
                    <div className="mt-3 border-t border-slate-700/60 pt-2.5">
                      <div className="mb-1.5 text-[11px] text-slate-400">点击卡片加入/移出</div>
                      <div className="grid grid-cols-4 gap-2">
                        {cards.map((c) => {
                          const on = d.cardIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              onClick={() =>
                                updateDeck(d.id, {
                                  cardIds: on ? d.cardIds.filter((x) => x !== c.id) : [...d.cardIds, c.id],
                                })
                              }
                              className={on ? "ring-2 ring-brand rounded-xl" : "opacity-60"}
                            >
                              <CardTile card={c} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {decks.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
                还没有卡组——建一个把常用素材归到一起
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
