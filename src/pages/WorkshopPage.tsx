// 创意工坊页：管理自己的卡片与卡组——搜索添加市场卡片、建组、增删卡。
// 与 3D 卡片工坊（/studio）分工：这里是资产管理，那里是创作现场。
import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { Link } from "react-router";
import {
  addCards,
  browseSharedCards,
  browseSharedDecks,
  createDeck,
  deckCoverOf,
  deleteDeck,
  installSharedCard,
  installSharedDeck,
  isRemoteMode,
  myCards,
  myDecks,
  removeCard,
  shareDeck,
  updateDeck,
} from "../data/account";
import type { ApiSharedCard, ApiSharedDeck } from "../api/branch";
import { useAccountVersion, useCurrentUser } from "../hooks/useAccount";
import { searchMarket } from "../ai";
import TarotCard from "../components/TarotCard";
import VideoCardExtractor from "../components/VideoCardExtractor";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import { Card, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../types";

/**
 * 广场（卡片 / 卡组两处）的取数：加载中 / 出错 / 结果，**一份实现**。
 *
 * ★ 卡片广场原来什么状态都没有：拉失败 → data 层吞掉错误返回 [] → 这一整块
 *   直接不渲染。用户看到的是"社区分享的卡"凭空消失，没有原因也没得重试（铁律八）。
 *   卡组广场当时只有个"加载中…"。既然两边要的是同一件事，就别写两遍（铁律六）。
 * ★ `enabled` 为 false 时不发请求也不显示任何状态（例：离线、或没切到这个来源）。
 */
function usePlaza<T>(enabled: boolean, load: () => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    void load()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // load 每次渲染都是新函数，依赖只认调用方声明的那几个 + 重试计数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, ...deps]);
  return { items, setItems, loading, error, reload: () => setTick((n) => n + 1) };
}

/** 广场取数失败时的那一行：说清楚 + 能重试。两个广场共用 */
function PlazaError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-rose-300">没取到：{error}</span>
      <button onClick={onRetry} className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-200">
        重试
      </button>
    </div>
  );
}

function CardTile({ card, onRemove, to }: { card: Card; onRemove?: () => void; to?: string }) {
  const face = (
    <TarotCard cover={card.cover || null} title={card.name} sub={CARD_TYPE_LABELS[card.type]} type={card.type} />
  );
  return (
    <div className="group relative">
      {to ? <Link to={to}>{face}</Link> : face}
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

/** 广场里的一条分享卡 → 本地 Card 形状。只为渲染卡面与跳详情页，**不落库**
 *  （真正落库的映射在 data/account.ts 的 toLocalCard，那才是唯一一处） */
function toLocalShape(c: ApiSharedCard): Card {
  return {
    id: c.cardId,
    type: c.type,
    name: c.name,
    summary: c.summary,
    cover: c.cover,
    tags: c.tags,
    modelUrl: c.modelUrl || undefined,
    genPrompt: c.genPrompt || undefined,
  };
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
  const [busyDeck, setBusyDeck] = useState<string | null>(null);
  const [deckErr, setDeckErr] = useState("");
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState("");
  // 上传本地视频提卡的抽屉
  const [extractOpen, setExtractOpen] = useState(false);
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

  // 社区分享的卡片：只有真连着服务器才有（离线库里没有「别人」），跟着搜索词走
  const cardPlaza = usePlaza<ApiSharedCard>(source === "cards" && remote, () => browseSharedCards(q), [q]);
  const sharedCards = cardPlaza.items;
  const setSharedCards = cardPlaza.setItems;
  // 广场卡组：只在切到「卡组」来源时拉，跟着搜索词走（离线时 data 层给种子卡组）
  const deckPlaza = usePlaza<ApiSharedDeck>(source === "decks", () => browseSharedDecks(q), [q]);
  const shared = deckPlaza.items;
  const setShared = deckPlaza.setItems;

  const ownedIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const byType = useMemo(() => {
    const m: Partial<Record<CardType, number>> = {};
    for (const c of cards) m[c.type] = (m[c.type] ?? 0) + 1;
    return m;
  }, [cards]);

  // ★★ 必须在下面那个登录墙 `if (!me) return` **之前**（hook 不能写在条件返回之后），
  //   而 enabled 又必须是 `!!me` —— 未登录时整页是登录墙，那时弹一份讲卡片卡组的引导
  //   等于对着一个不存在的界面说话，而且走完就记成"看过了"，用户真登录后再也不会自动看到。
  useAutoGuide("workshop", !!me);

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
        <HelpButton tour="workshop" className="ml-auto mr-2" />
        <Link data-guide="workshop-studio-entry" to="/studio" className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink">
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
      <div data-guide="workshop-tabs" className="mb-3 flex gap-2">
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
                <CardTile key={c.id} card={c} to={`/card/${c.id}`} onRemove={() => removeCard(c.id)} />
              ))}
            </div>
          )}
          {cards.length === 0 && (
            <div className="mb-3 rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              还没有卡片——去 3D 工坊让 AI 炼一张、从视频提取、自己传图做一张，或从下面的市场添加
            </div>
          )}

          {/* 从本地视频提卡：手里已经有片子的人不必从零铸卡，抽帧让 AI 认人认景直接出卡 */}
          <button
            data-guide="workshop-extract-card"
            onClick={() => setExtractOpen(true)}
            className="mb-5 flex w-full items-center gap-3 rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-400/15 to-transparent px-3.5 py-3 text-left"
          >
            <span className="text-2xl">🎬</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-100">从视频提取卡片</span>
              <span className="block text-[11px] text-slate-400">上传本地视频，AI 认出里面的角色/场景/画风，直接铸成卡</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>

          {/* 自己传图做卡片：**另一条**路，不是默认路径 —— 默认铸卡（3D 工坊里的铸卡师）
              已经是 AI 全自动出图，一张图都不用传。所以这行说明必须点出区别，
              否则用户会以为"铸卡原来还得自己找图"，等于把全自动那条藏起来了。
              ★ 「不消耗 token」是它相对 AI 铸卡唯一真实的优势，值得写在入口上。 */}
          <Link
            to="/custom-card"
            className="mb-5 flex w-full items-center gap-3 rounded-xl border border-amber-400/35 bg-gradient-to-r from-amber-400/15 to-transparent px-3.5 py-3 text-left"
          >
            <span className="text-2xl">🖼</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-100">自己传图做卡片</span>
              <span className="block text-[11px] text-slate-400">
                用你自己的图当卡面与形象参考，不经过 AI 出图 · 不消耗 token
              </span>
            </span>
            <Icon name="chevron" size={18} />
          </Link>

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
              <>
                {/* 社区分享的卡：别人在卡片详情页按下「分享到创意工坊」之后落在这里。
                    ★ 没有这一段的话"分享卡片"就是个死路 —— 发得出去，谁都看不到。
                    与下面那批是两种东西：这批是真人分享的，下面那批是本地种子市场。 */}
                {/* 只有"这块现在空着"时才画状态：换搜索词重拉时上一批还在，
                    再画一遍标题就成了两个「社区分享的卡」 */}
                {remote && sharedCards.length === 0 && (cardPlaza.loading || cardPlaza.error) && (
                  <>
                    <div className="mb-1.5 text-[11px] text-slate-400">社区分享的卡</div>
                    {cardPlaza.error ? (
                      <PlazaError error={cardPlaza.error} onRetry={cardPlaza.reload} />
                    ) : (
                      <div className="mb-3 py-4 text-center text-xs text-slate-500">加载中…</div>
                    )}
                  </>
                )}
                {remote && sharedCards.length > 0 && (
                  <>
                    <div className="mb-1.5 text-[11px] text-slate-400">社区分享的卡</div>
                    <div className="mb-4 grid grid-cols-3 gap-2.5">
                      {sharedCards.map((c) => {
                        const owned = ownedIds.has(c.cardId) || c.installed || c.isOwner;
                        return (
                          <div key={c.cardId}>
                            <Link
                              to={`/card/${c.cardId}`}
                              state={{ card: toLocalShape(c) }}
                              className={`block ${owned ? "opacity-40" : ""}`}
                            >
                              <CardTile card={toLocalShape(c)} />
                            </Link>
                            <button
                              onClick={async () => {
                                setCardErr("");
                                setBusyCard(c.cardId);
                                try {
                                  await installSharedCard(c.cardId);
                                  setSharedCards((list) =>
                                    list.map((x) => (x.cardId === c.cardId ? { ...x, installed: true } : x)),
                                  );
                                } catch (e) {
                                  setCardErr(e instanceof Error ? e.message : String(e));
                                } finally {
                                  setBusyCard(null);
                                }
                              }}
                              disabled={owned || busyCard === c.cardId}
                              className="mt-1 w-full text-center text-[10px] text-slate-400 disabled:text-slate-600"
                            >
                              {c.isOwner ? "我发的" : owned ? "已拥有" : busyCard === c.cardId ? "添加中…" : "＋ 添加"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {cardErr && <div className="mb-3 text-xs text-rose-400">{cardErr}</div>}
                  </>
                )}
              <div className="grid grid-cols-3 gap-2.5 pb-4">
                {market.map((c) => {
                  const owned = ownedIds.has(c.id);
                  return (
                    <div key={c.id}>
                      {/* 卡面点进详情（看简介/生成蓝图/点赞收藏评论），下面那行才是"添加"。
                          此前整块都是添加按钮，市场卡根本没有可看详情的入口 */}
                      <Link to={`/card/${c.id}`} state={{ card: c }} className={`block ${owned ? "opacity-40" : ""}`}>
                        <CardTile card={c} />
                      </Link>
                      <button
                        onClick={() => !owned && addCards([c])}
                        disabled={owned}
                        className="mt-1 w-full text-center text-[10px] text-slate-400 disabled:text-slate-600"
                      >
                        {owned ? "已拥有" : "＋ 添加"}
                      </button>
                    </div>
                  );
                })}
              </div>
              </>
            )
          ) : !remote ? (
            <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              登录服务器后可以浏览别人分享的卡组
            </div>
          ) : deckPlaza.error ? (
            <PlazaError error={deckPlaza.error} onRetry={deckPlaza.reload} />
          ) : deckPlaza.loading ? (
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
            data-guide="workshop-deck-new"
            onClick={() => createDeck(`卡组 ${decks.length + 1}`)}
            className="mb-3 w-full rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-300"
          >
            ＋ 新建卡组
          </button>
          <div className="space-y-3 pb-4">
            {decks.map((d) => {
              const inDeck = cards.filter((c) => d.cardIds.includes(c.id));
              const open = editing === d.id;
              const cover = deckCoverOf(d);
              return (
                <div key={d.id} className="rounded-xl border border-slate-700/60 bg-panel p-3">
                  <div className="flex items-center gap-2">
                    {/* 封面卡缩略：点它进卡组详情页（标题/简介/卡片全览） */}
                    <Link to={`/deck/${d.id}`} className="flex-none">
                      {cover ? (
                        <img src={cover.cover} alt={cover.name} className="h-11 w-8 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-11 w-8 items-center justify-center rounded-md bg-slate-800 text-sm">🎴</div>
                      )}
                    </Link>
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

                  {/* 分享到创意工坊：分享出去后别人能在「从市场添加 · 卡组」里装走整套。
                      ★ 三处调用点（这里、卡组详情页、卡片详情页）共用同一个组件，
                        禁用规则与错误显示只有一份实现 */}
                  <WorkshopShareBar
                    kind="deck"
                    className="mt-2"
                    published={!!d.published}
                    installs={d.installs ?? 0}
                    disabledReason={shareBlockReason({ remote, cardCount: d.cardIds.length })}
                    onToggle={(next) => shareDeck(d.id, next)}
                  />
                  {inDeck.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-4 gap-2">
                      {inDeck.map((c) => (
                        <CardTile key={c.id} card={c} />
                      ))}
                    </div>
                  )}
                  {open && (
                    <div className="mt-3 border-t border-slate-700/60 pt-2.5">
                      {/* ★ 只留"点它就是加/减"这半句：卡长得就是卡、没有按钮相，全页只有这一句
                          在**事前**说明；而设封面那颗按钮自己就写着「设封面」，说明放在按钮上比
                          放在这行小字里更近 —— 而这一行每展开一个卡组就重印一遍。 */}
                      <div className="mb-1.5 text-[11px] text-slate-400">点卡片加入 / 移出</div>
                      <div className="grid grid-cols-4 gap-2">
                        {cards.map((c) => {
                          const on = d.cardIds.includes(c.id);
                          const isCover = on && cover?.id === c.id;
                          return (
                            <div key={c.id} className="relative">
                              <button
                                onClick={() =>
                                  updateDeck(d.id, {
                                    cardIds: on ? d.cardIds.filter((x) => x !== c.id) : [...d.cardIds, c.id],
                                  })
                                }
                                className={`block w-full ${on ? "ring-2 ring-brand rounded-xl" : "opacity-60"}`}
                              >
                                <CardTile card={c} />
                              </button>
                              {on && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateDeck(d.id, { coverCardId: c.id });
                                  }}
                                  title={isCover ? "当前封面卡" : "设为卡组封面"}
                                  className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                    isCover ? "bg-gold text-ink" : "bg-black/65 text-slate-200 hover:bg-black/85"
                                  }`}
                                >
                                  {isCover ? "★ 封面" : "设封面"}
                                </button>
                              )}
                            </div>
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
      {extractOpen && <VideoCardExtractor onClose={() => setExtractOpen(false)} />}
    </div>
  );
}
