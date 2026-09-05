// 创意工坊页：管理自己的卡片与卡组——搜索添加市场卡片、建组、增删卡。
// 与 3D 卡片工坊（/studio）分工：这里是资产管理，那里是创作现场。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Icon from "../components/Icon";
import DeleteCardDialog from "../components/DeleteCardDialog";
import DeleteDeckDialog from "../components/DeleteDeckDialog";
import AuthPending from "../components/AuthPending";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { Link } from "react-router";
import { cardsLoadIssue,
  type Deck,
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
  sharedToCard,
  updateDeck,
} from "../data/account";
import type { ApiSharedCard, ApiSharedDeck } from "../api/branch";
import { useAccountVersion, useAuthState, useCurrentUser } from "../hooks/useAccount";
import { useQueryTab } from "../hooks/useQueryTab";
import TarotCard from "../components/TarotCard";
import TemplateShelf from "../components/TemplateShelf";
import VideoCardAnnotator from "../components/VideoCardAnnotator";
import { subscribeVoices, voiceOf, voicesVersion } from "../data/cardVoice";
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
  // ★ 初值跟着 enabled 走（复核抓到）：给 false 的话，enabled 为真的**第一帧**会是
  //   "不在加载、也没有数据" —— 空态当场闪一句「还没有人分享卡片」，而那会儿请求
  //   连发都还没发出去。空结果与"还没问"必须分得开。
  const [loading, setLoading] = useState(enabled);
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
      {/* 🔊 = 带声音样本（本机侧库，data/cardVoice）。用户按"有没有声音"挑卡就靠这一眼 */}
      {voiceOf(card.id) && (
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px]" title="带声音样本">
          🔊
        </span>
      )}
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
  const auth = useAuthState();
  const cards = myCards();
  const decks = myDecks();
  // ★ 2026-08-21 加第三个页签「我的模板」（用户点名：模板与卡片/卡组同住创意工坊，
  //   同一行页签）。内容整块复用 components/TemplateShelf —— 它自带「模板市场/我的模板」
  //   两个来源，所以模板市场也一并住进了本页；/templates 独立页照旧（深链在用）。
  // ★ 页签在地址里（`?tab=`）而不是组件 state：去模板详情/卡片详情再返回，这一页整个重挂，
  //   state 归零就把人从「我的模板」扔回「我的卡片」（2026-09-05 主人真机点名）。
  //   唯一实现 hooks/useQueryTab；TemplateShelf 内层的「模板市场/我的模板」用同一个 hook（`?shelf=`）。
  const [tab, setTab] = useQueryTab("tab", ["cards", "decks", "templates"] as const, "cards");
  /** 待确认删除的卡（删卡确认与详情页共用 DeleteCardDialog 一份） */
  const [askCard, setAskCard] = useState<Card | null>(null);
  /** 待确认删除的卡组。★ 删卡组**不删卡**（deleteDeck 只摘卡组本身）——这件事必须说，
   *  否则用户会以为"删卡组 = 把里面的卡也删了"而不敢删，或者删了之后到处找卡 */
  const [askDeck, setAskDeck] = useState<Deck | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  // 市场：卡片 / 卡组两个来源
  const [source, setSource] = useState<"cards" | "decks">("cards");
  const [busyDeck, setBusyDeck] = useState<string | null>(null);
  const [deckErr, setDeckErr] = useState("");
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState("");
  // 上传本地视频提卡的抽屉
  /** 圈选提取抽屉。null = 没开；"deck"/"single" = 提取卡组 / 单张卡片（V2 圈选式） */
  const [extractOpen, setExtractOpen] = useState<null | "deck" | "single">(null);
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const remote = isRemoteMode();

  // ★★ 这里原来还有一份**本地种子市场**（searchMarket）。2026-08-24 卡片系统 V2 清库时
  //   `ai/index.ts` 把它硬写成了 `async () => []`，于是这一整套 —— loading 态、
  //   「已拥有的 N 张没有列出」按钮、3 列网格 —— 全成了永不出货的死路径：每敲一个字
  //   还闪一次「搜索中…」。2026-08-30 整段删掉。现在这一格只有一个来源：服务端广场。
  //   ⚠ `ai/index.ts` 那个 stub **保留**：3D 工坊的桌面市场（studioStore.openMarket）
  //     还在读它，接它到 browseSharedCards 是另一条工单。

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

  // ★ 与「我的」同一条：pending 时给加载态，别把"你没登录"当结论说出去
  if (auth === "pending") {
    return <AuthPending className="safe-top min-h-[70vh]" />;
  }
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

      {/* 页签：卡片 / 卡组 / 模板同一行（模板那格连着模板市场，见 TemplateShelf） */}
      <div data-guide="workshop-tabs" className="mb-3 flex gap-2">
        {(["cards", "decks", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${
              tab === t ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
            }`}
          >
            {t === "cards" ? "我的卡片" : t === "decks" ? "我的卡组" : "我的模板"}
          </button>
        ))}
      </div>

      {/* ★★ 两张删除确认摆在**页签分支之外**（2026-08-30 复核抓到）：删卡组那颗按钮在
          「我的卡组」分支，而确认卡一度写在「我的卡片」分支里 —— 两分支互斥，
          于是卡组按钮点了纹丝不动，而 DeckDetailPage 没有第二个删除入口，
          等于卡组根本删不掉。删除类浮层与触发它的按钮不该分属不同的条件分支。 */}
      {askCard && (
        <DeleteCardDialog
          card={askCard}
          onCancel={() => setAskCard(null)}
          // ★ 成了才关：没删成时那句原因要留在卡上（见 DeleteConfirmShell 的 ★★）
          onConfirm={async () => {
            const why = await removeCard(askCard.id);
            if (!why) setAskCard(null);
            return why;
          }}
        />
      )}
      {askDeck && (
        <DeleteDeckDialog
          deck={askDeck}
          onCancel={() => setAskDeck(null)}
          onConfirm={async () => {
            const why = await deleteDeck(askDeck.id);
            if (!why) setAskDeck(null);
            return why;
          }}
        />
      )}
      {tab === "templates" ? (
        <div className="pb-4">
          <TemplateShelf initialTab="mine" queryKey="shelf" />
        </div>
      ) : tab === "cards" ? (
        <>
          {cards.length > 0 && (
            <div className="mb-5 grid grid-cols-3 gap-2.5">
              {cards.map((c) => (
                /* ★ 删卡走确认（2026-08-30）：此前这颗 ✕ 点下去当场就删，而卡可能正挂在
                   卡组里、已分享到工坊、还带着声音样本与肖像授权 —— 全是删了找不回的东西。
                   确认卡与详情页共用同一份（DeleteCardDialog），它按事实说清后果 */
                <CardTile key={c.id} card={c} to={`/card/${c.id}`} onRemove={() => setAskCard(c)} />
              ))}
            </div>
          )}
          {cards.length === 0 && (
            <div className="mb-3 rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
              {/* ★ 「没问到」不许说成「没有」：卡是真花过 token 铸的，说错这一句
                  用户读到的是「我付钱铸的卡全没了」（同 ProfilePage 的 worksKnown） */}
              {cardsLoadIssue() ? `这会儿没能取到你的卡片（${cardsLoadIssue()}）——它们还在，联网后重开一次` : "还没有卡片——用下面几种方式做第一张"}
            </div>
          )}

          {/* 从本地视频圈选提卡（V2，2026-08-24 换代）：旧路是"AI 看抽帧自动认"，又贵又不可控；
              新路是用户拖到某一帧亲手圈出要的人和物 —— 不上传、不花 token、指哪张是哪张。
              两颗入口并排：提取卡组（连圈多张打包）/ 提取卡片（圈一张就走）。 */}
          <div data-guide="workshop-extract-card" className="mb-5 flex gap-2">
            {(
              [
                ["deck", "🎴", "从视频提取卡组", "连圈多张，打包成一组"],
                ["single", "🎯", "从视频提取卡片", "圈一张就走"],
              ] as const
            ).map(([mode, icon, title, sub]) => (
              <button
                key={mode}
                onClick={() => setExtractOpen(mode)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-cyan-400/35 bg-gradient-to-r from-cyan-400/15 to-transparent px-3 py-3 text-left"
              >
                <span className="text-xl">{icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-100">{title}</span>
                  <span className="block truncate text-[10px] text-slate-400">{sub}</span>
                </span>
              </button>
            ))}
          </div>

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
            /* 卡片广场。★★ 四种状态**分开说**（2026-08-30）：这一格原来只有 loading / error
               两态，远端返回 0 条时整块静默消失，离线时更是一个像素不渲染也不说一句话
               —— 用户看到的是"社区分享的卡凭空没了"，既不知道为什么、也不知道该干什么
               （铁律八）。口径照 TemplateShelf 那份。 */
            !remote ? (
              <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm leading-relaxed text-slate-500">
                这次没连上服务器，看不到别人分享的卡。
                <br />
                <span className="text-xs">卡片广场在服务器上——离线库里没有「别人」。</span>
              </div>
            ) : cardPlaza.error ? (
              <PlazaError error={cardPlaza.error} onRetry={cardPlaza.reload} />
            ) : cardPlaza.loading && sharedCards.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">加载中…</div>
            ) : sharedCards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm leading-relaxed text-slate-500">
                {q.trim() ? (
                  <>
                    没有搜到「{q.trim()}」相关的卡。
                    <br />
                    <span className="text-xs">换个词试试，或者清空搜索框看看大家都分享了什么。</span>
                  </>
                ) : (
                  <>
                    还没有人分享卡片。
                    <br />
                    <span className="text-xs">你可以在自己的卡片详情页按「分享到创意工坊」，成为第一个。</span>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="mb-1.5 text-[11px] text-slate-400">社区分享的卡</div>
                <div className="mb-4 grid grid-cols-3 gap-2.5">
                    {sharedCards.map((c) => {
                      const owned = ownedIds.has(c.cardId) || c.installed || c.isOwner;
                      // ★ 一次映射两处用（调两遍会每帧造两个不同引用的对象，白费 memo、
                      //   也让路由 state 每次都变）。映射与 published 标记都在
                      //   data/account.sharedToCard 一处（3D 桌面市场用的是同一份）。
                      const local: Card = sharedToCard(c);
                      return (
                        <div key={c.cardId}>
                          <Link
                            to={`/card/${c.cardId}`}
                            state={{ card: local }}
                            className={`block ${owned ? "opacity-40" : ""}`}
                          >
                            <CardTile card={local} />
                          </Link>
                          {/* 作者写的一句话推荐。★ 这条链路的另外三段（api 收 description、
                              服务端存并发回、toLocalCard 解析成 shareNote）2026-08 就通了，
                              只差"没人写"和"没人画"两头 —— 于是它在库里存在、界面上零渲染。 */}
                          {local.shareNote && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-400" title={local.shareNote}>
                              {local.shareNote}
                            </p>
                          )}
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
                    <button onClick={() => setAskDeck(d)} className="text-xs text-rose-400">
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
                    disabledReason={shareBlockReason({ remote, published: !!d.published, cardCount: d.cardIds.length })}
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
      {extractOpen && <VideoCardAnnotator deckMode={extractOpen === "deck"} onClose={() => setExtractOpen(null)} />}
    </div>
  );
}
