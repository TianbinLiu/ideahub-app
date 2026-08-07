// 创意工坊页：管理自己的卡片与卡组——搜索添加市场卡片、建组、增删卡。
// 与 3D 卡片工坊（/studio）分工：这里是资产管理，那里是创作现场。
import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { Link } from "react-router";
import {
  addCards,
  browseSharedDecks,
  createDeck,
  deleteDeck,
  installSharedDeck,
  isRemoteMode,
  myCards,
  myDecks,
  removeCard,
  shareDeck,
  updateDeck,
} from "../data/account";
import type { ApiSharedDeck } from "../api/branch";
import { useAccountVersion, useCurrentUser } from "../hooks/useAccount";
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
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

export default function WorkshopPage() {
  useAccountVersion(); // 账号库变更时重算列表
  // 一级 Tab 不做硬登录墙：未登录就地给软提示，而不是被路由弹去登录页出不来。
  // ★ 这个判断必须放在下面所有 hook 之后再 return，否则登录前后 hook 数量不一致会直接崩。
  const me = useCurrentUser();
  const cards = myCards();
  const decks = myDecks();
  const [tab, setTab] = useState<"cards" | "decks">("cards");
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // 市场：卡片 / 卡组两个来源
  const [source, setSource] = useState<"cards" | "decks">("cards");
  const [shared, setShared] = useState<ApiSharedDeck[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [busyDeck, setBusyDeck] = useState<string | null>(null);
  const [deckErr, setDeckErr] = useState("");
  const remote = isRemoteMode();

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

  // 广场卡组：只在切到「卡组」来源时拉，跟着搜索词走
  useEffect(() => {
    if (source !== "decks") return;
    let alive = true;
    setSharedLoading(true);
    void browseSharedDecks(q).then((list) => {
      if (alive) {
        setShared(list);
        setSharedLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [source, q]);

  const ownedIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const byType = useMemo(() => {
    const m: Partial<Record<CardType, number>> = {};
    for (const c of cards) m[c.type] = (m[c.type] ?? 0) + 1;
    return m;
  }, [cards]);

  if (!me) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6">
        <Icon name="cards" size={44} className="text-slate-600" />
        <p className="text-center text-sm text-slate-400">登录后可以收藏卡片、组建卡组</p>
        <Link to="/login?next=/workshop" className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-ink">
          登录 / 注册
        </Link>
      </div>
    );
  }

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

          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-300">从市场添加</h2>
            <div className="ml-auto flex gap-1 rounded-full bg-panel p-0.5">
              {(["cards", "decks"] as const).map((sc) => (
                <button
                  key={sc}
                  onClick={() => setSource(sc)}
                  className={`rounded-full px-3 py-1 text-[11px] transition ${
                    source === sc ? "bg-brand font-semibold text-ink" : "text-slate-400"
                  }`}
                >
                  {sc === "cards" ? "卡片" : "卡组"}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-700 bg-panel px-4 py-2">
            <Icon name="search" size={17} className="text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={source === "cards" ? "搜索卡片名 / 标签" : "搜索别人分享的卡组"}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>

          {source === "cards" ? (
            loading ? (
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
            )
          ) : !remote ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              登录服务器后可以浏览别人分享的卡组
            </div>
          ) : sharedLoading ? (
            <div className="py-8 text-center text-xs text-slate-500">加载中…</div>
          ) : shared.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              {q ? "没有匹配的卡组" : "还没有人分享卡组——你可以第一个"}
            </div>
          ) : (
            <div className="space-y-2.5 pb-4">
              {shared.map((d) => (
                <div key={d._id} className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-panel p-2.5">
                  {/* 前四张卡面拼一个缩略 */}
                  <div className="grid h-14 w-14 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-lg bg-slate-800">
                    {(d.covers.length ? d.covers : [""]).slice(0, 4).map((cv, i) =>
                      cv ? (
                        <img key={i} src={cv} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div key={i} className="bg-slate-700/60" />
                      ),
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">{d.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {d.author?.displayName || d.author?.username || "匿名"} · {d.cardCount} 张
                      {d.installs > 0 ? ` · ${d.installs} 人装过` : ""}
                      {d.remixOf ? ` · 改自 @${d.remixOf.displayName || d.remixOf.username}` : ""}
                    </div>
                    {d.description && <div className="mt-0.5 truncate text-[11px] text-slate-400">{d.description}</div>}
                  </div>
                  <button
                    disabled={d.installed || d.isOwner || busyDeck === d._id}
                    onClick={async () => {
                      setDeckErr("");
                      setBusyDeck(d._id);
                      try {
                        await installSharedDeck(d._id);
                        setShared((list) => list.map((x) => (x._id === d._id ? { ...x, installed: true } : x)));
                      } catch (e) {
                        setDeckErr(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusyDeck(null);
                      }
                    }}
                    className="min-h-[32px] shrink-0 rounded-full bg-brand px-3 text-[11px] font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {d.isOwner ? "我发的" : d.installed ? "已添加" : busyDeck === d._id ? "添加中…" : "＋ 添加"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {deckErr && <div className="pb-4 text-xs text-rose-400">{deckErr}</div>}
        </>
      ) : (
        <>
          {deckErr && <div className="mb-2 text-xs text-rose-400">{deckErr}</div>}
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
                      // 编辑中允许空串（否则清空输入框会立刻跳字），失焦时补默认名——
                      // 服务端的 name 是 min(1)，两边都兜一次才不会出现"本地空 / 远端未命名"的分叉
                      onBlur={(e) => {
                        if (!e.target.value.trim()) updateDeck(d.id, { name: "未命名卡组" });
                      }}
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

                  {/* 分享到创意工坊：分享出去后别人能在「从市场添加 · 卡组」里装走整套 */}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      disabled={busyDeck === d.id || !remote || d.cardIds.length === 0}
                      onClick={async () => {
                        setDeckErr("");
                        setBusyDeck(d.id);
                        try {
                          await shareDeck(d.id, !d.published);
                        } catch (e) {
                          setDeckErr(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusyDeck(null);
                        }
                      }}
                      className={`inline-flex min-h-[28px] items-center gap-1 rounded-full px-3 text-[11px] font-medium transition disabled:opacity-40 ${
                        d.published ? "bg-gold/20 text-gold" : "bg-brand/15 text-brand"
                      }`}
                    >
                      <Icon name="share" size={13} />
                      {busyDeck === d.id ? "处理中…" : d.published ? "已分享 · 取消" : "分享到工坊"}
                    </button>
                    {d.published && (d.installs ?? 0) > 0 && (
                      <span className="text-[11px] text-slate-500">{d.installs} 人装过</span>
                    )}
                    {!remote && <span className="text-[11px] text-slate-600">分享需要登录服务器</span>}
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
