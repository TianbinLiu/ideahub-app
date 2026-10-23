// 创意工坊第一层（/workshop）= 市场：一个搜索框 + 卡片 / 卡组 / 模板 / 工作流四类，搜别人分享的东西、装进自己的库。
// 自己的东西与做东西的入口在第二层「我的仓库」（/workshop/mine，pages/WorkshopMinePage）。
// 与 3D 卡片工坊（/studio）分工：这里是逛与拿，那里是创作现场。
//
// ★ 2026-10-20 改版（主人点名「参考市面上创意工坊的 ui 构造：第一层以市场搜索为主」）：原来一进来是「我的卡片」，
//   市场（「从市场添加」）排在三个创作入口下面、模板市场套在「我的模板」页签里。调研的十几家（Steam 创意工坊、Unity /
//   Roblox 素材商店、Figma 社区、Google Play…）第一屏都是一直展开的搜索框 + 种类切换，「我拥有的」在单独一层。
// ★ 搜索词与筛选全进地址（`?kind=&q=&type=&sort=`；模板那一类另有货架自己的 `?model=`）：去卡片详情 / 模板详情
//   再返回，这一页整个重挂，state 归零就把人正在看的东西弄丢（2026-09-05 主人真机点名过一次，hooks/useQueryTab）。
// ★ 服务端今天给得出的（2026-10-20 量过 origin/main）：卡片 / 卡组广场各给最近分享的 50 条、按词搜（服务端）；没有排序参数、
//   没有类型筛选、没有分页。所以「类型」与「热门」都是在拿到手的这一批里排 / 滤 —— 热门那颗旁边照实说一句。
//   模板市场的词是本机筛（data/templates.browseTemplates）；工作流货架服务端没有搜索参数，在拿到的那一批里按标题 / 作者筛（WorkflowShelf 的 q）。
// ★ 「工作流」是第一排的第四类（2026-10-20 主人在真机上看过之后选的）：第一版把它放在「模板」里面的第二排芯片（模板市场 / 工作流），
//   主人在手机上没找到它 —— 藏在第二层芯片里的东西等于没有。
// ★ 不登录也能逛（四个列表接口都是 optionalAuth）：点「＋ 添加」时才去登录，登录完回到这一页的这个地址。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import SearchField from "../components/SearchField";
import AuthPending from "../components/AuthPending";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import CardTile from "../components/workshop/CardTile";
import TemplateShelf, { useTemplatesVersion } from "../components/TemplateShelf";
import WorkflowShelf from "../components/WorkflowShelf";
import {
  browseSharedCards,
  browseSharedDecks,
  installSharedCard,
  installSharedDeck,
  isRemoteMode,
  myCards,
  myDecks,
  sharedToCard,
} from "../data/account";
import { groupRows, myTemplates } from "../data/templates";
import type { ApiSharedCard, ApiSharedDeck } from "../api/branch";
import { subscribeVoices, voicesVersion } from "../data/cardVoice";
import { useAccountVersion, useAuthState, useCurrentUser } from "../hooks/useAccount";
import { liveSearchParams, useQueryTab } from "../hooks/useQueryTab";
import { Card, CARD_TYPE_LABELS, CARD_TYPE_SHORT, CARD_TYPES, CardType } from "../types";

const KINDS = ["cards", "decks", "templates", "workflows"] as const;
const SORTS = ["new", "hot"] as const;
const TYPE_FILTERS: readonly ("" | CardType)[] = ["", ...CARD_TYPES];
/** 老地址 `/workshop?tab=` 的那三个值（改版前这一页的页签）：转到第二层或市场里对应的那一格 */
const LEGACY_TABS = ["cards", "decks", "templates"];
/** 搜索词停手多久才去问服务端（卡片 / 卡组的搜索在服务端；原来每敲一个字发一次） */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 广场（卡片 / 卡组两处）的取数：加载中 / 出错 / 结果，**一份实现**。
 *
 * ★ 卡片广场原来什么状态都没有：拉失败 → data 层吞掉错误返回 [] → 这一整块直接不渲染。
 *   用户看到的是"社区分享的卡"凭空消失，没有原因也没得重试（铁律八）。
 * ★ `enabled` 为 false 时不发请求也不显示任何状态（例：离线、或没切到这一类）。
 */
function usePlaza<T>(enabled: boolean, load: () => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  // ★ 初值跟着 enabled 走（复核抓到）：给 false 的话，enabled 为真的**第一帧**会是"不在加载、也没有数据" ——
  //   空态当场闪一句「还没有人分享卡片」，而那会儿请求连发都还没发出去。空结果与"还没问"必须分得开。
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

/** 广场拉挂了：列表反正是空的，就按空态那一份画（error 红字 + 重试键），别再另画一条行内报错 */
function PlazaError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useLingui();
  return <EmptyState error emoji="📡" text={t`没取到：${error}`} cta={{ label: t`重试`, onClick: onRetry }} />;
}

/** 右侧那颗小的「最新 / 热门」分段（紧凑分段控件那一档） */
function SortSwitch({ sort, onSort }: { sort: (typeof SORTS)[number]; onSort: (s: (typeof SORTS)[number]) => void }) {
  const { t } = useLingui();
  return (
    <div className="flex flex-none gap-1 rounded-full bg-panel p-0.5" role="group" aria-label={t`排序`}>
      {SORTS.map((s) => (
        <button
          key={s}
          onClick={() => onSort(s)}
          aria-pressed={sort === s}
          className={`rounded-full px-3 py-1 text-[11px] ${sort === s ? "bg-brand font-semibold text-ink" : "text-slate-400"}`}
        >
          {s === "new" ? t`最新` : t`热门`}
        </button>
      ))}
    </div>
  );
}

export default function WorkshopPage() {
  useAccountVersion(); // 账号库变更时重算「已拥有」与「我的仓库」那个数
  useTemplatesVersion();
  // ★ 下面所有 hook 都在 pending 的早退**之前**（hook 不能写在条件返回之后）
  const me = useCurrentUser();
  const auth = useAuthState();
  const { t } = useLingui();
  const nav = useNavigate();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useQueryTab("kind", KINDS, "cards");
  const [ctype, setCtype] = useQueryTab<"" | CardType>("type", TYPE_FILTERS, "");
  const [sort, setSort] = useQueryTab("sort", SORTS, "new");
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const remote = isRemoteMode();

  // ★ 老地址：改版前 `/workshop?tab=decks` 这类指的是自己的东西 → 第二层；`?tab=templates&shelf=market|workflows` 指的是模板市场 / 工作流 → 市场的那一类。
  //   replace：转跳不该在历史里留一层，否则按返回又被转回来。
  const legacyTab = params.get("tab");
  useEffect(() => {
    if (!legacyTab || !LEGACY_TABS.includes(legacyTab)) return;
    const shelf = params.get("shelf");
    if (legacyTab === "templates" && (shelf === "market" || shelf === "workflows")) {
      nav(`/workshop?kind=${shelf === "workflows" ? "workflows" : "templates"}`, { replace: true });
    } else {
      nav(`/workshop/mine${legacyTab === "cards" ? "" : `?tab=${legacyTab}`}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyTab]);

  // 搜索框：输入框自己的 state 立刻跟手，停手 SEARCH_DEBOUNCE_MS 之后才写进地址并拿去搜。
  // ★ 别让输入框直接读地址：地址每改一次就是一次导航，打字时光标与输入法候选会跟着跳
  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [qd, setQd] = useState(() => urlQ.trim());
  /** 上一次由这一页自己写进地址的词。地址里的词与它不同 = 别处改的（见下一个 effect） */
  const wroteQ = useRef(urlQ);
  // ★ 地址里的词被别处改了时，输入框跟着地址走（2026-10-20 浏览器里撞到）：同一路由内换 query 不会重挂这一页 ——
  //   搜着词时点底栏「工坊」（不带参数的 /workshop），地址里的词没了、输入框里还留着，列表照旧按那个词筛，看着像是没刷新。
  //   自己写进去的那一次不算（否则人还在往下打字时，上一拍写进去的词会把输入框倒回去）
  useEffect(() => {
    if (urlQ === wroteQ.current) return;
    wroteQ.current = urlQ;
    setText(urlQ);
    setQd(urlQ.trim());
  }, [urlQ]);
  useEffect(() => {
    const h = window.setTimeout(() => {
      const v = text.trim();
      setQd(v);
      wroteQ.current = v;
      // ★ 从地址栏此刻的样子出发（liveSearchParams 头上那段）：清空搜索框后 300 毫秒内点了别的种类，
      //   拿渲染时的参数去写就会把种类写回老的那一类（2026-10-20 浏览器里撞到）
      const next = liveSearchParams();
      if ((next.get("q") ?? "") === v) return; // 地址里已经是这个词（进页那一拍、或打了又删回原样）：不再导航一次
      if (v) next.set("q", v);
      else next.delete("q");
      setParams(next, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    // 卸载时一并撤掉：计时器在卸载之后才响的话，setParams 会改掉人已经去到的那一页的地址
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // 社区分享的卡片 / 卡组：只有真连着服务器才有（离线库里没有「别人」），跟着搜索词走。
  // ★ 也跟着「是谁在看」走：回包里的 installed / isOwner 是按看的人算的，换了账号（或退出）不重拉的话，
  //   上一个人装过的卡在这一页上还写着「已拥有」、点不动（2026-10-20 浏览器里撞到）
  const viewer = me?.id ?? "";
  const cardPlaza = usePlaza<ApiSharedCard>(kind === "cards" && remote, () => browseSharedCards(qd), [qd, viewer]);
  const deckPlaza = usePlaza<ApiSharedDeck>(kind === "decks" && remote, () => browseSharedDecks(qd), [qd, viewer]);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState("");
  const [busyDeck, setBusyDeck] = useState<string | null>(null);
  const [deckErr, setDeckErr] = useState("");

  const cards = myCards();
  const ownedIds = useMemo(() => new Set(cards.map((c) => c.id)), [cards]);
  const mineCount = me ? cards.length + myDecks().length + groupRows(myTemplates()).length : 0;

  /** 这一批里每个卡种各有几张（类型芯片上的数：0 张的那一类芯片照样摆，点进去由空态说清楚） */
  const typeCounts = useMemo(() => {
    const m = new Map<CardType, number>();
    for (const c of cardPlaza.items) m.set(c.type, (m.get(c.type) ?? 0) + 1);
    return m;
  }, [cardPlaza.items]);
  const shownCards = useMemo(() => {
    const list = ctype ? cardPlaza.items.filter((c) => c.type === ctype) : cardPlaza.items;
    // 热门 = 服务端算好的 stats.heat（utils/hotScore：点赞、收藏、浏览）；不带 stats 的老服务端当 0、排在后面，原顺序（最新在前）不变
    return sort === "hot" ? [...list].sort((a, b) => (b.stats?.heat ?? 0) - (a.stats?.heat ?? 0)) : list;
  }, [cardPlaza.items, ctype, sort]);
  const shownDecks = useMemo(
    () =>
      sort === "hot"
        ? // 卡组有真的「装过」计数，先按它，再按 heat
          [...deckPlaza.items].sort((a, b) => b.installs - a.installs || (b.stats?.heat ?? 0) - (a.stats?.heat ?? 0))
        : deckPlaza.items,
    [deckPlaza.items, sort],
  );

  // 第一次进这一屏放一遍引导；未登录时不弹（第 3 步讲的「我的仓库」要登录才有，走完又记成看过了）
  useAutoGuide("workshop", !!me);

  // ★ 与「我的」同一条：pending 时给加载态。这一页不登录也能逛，但「已拥有」与「＋ 添加」要等认出人才算得对 ——
  //   pending 的时候把「＋ 添加」当成没登录、把人送去登录页，正是 CLAUDE.md「拿 !currentUser() 当没登录」那一格
  if (auth === "pending") {
    return <AuthPending className="safe-top min-h-[70vh]" />;
  }
  /** 没登录时点「＋ 添加」：先去登录，回来还是这一页的这个地址（搜索词与筛选都在里面） */
  const loginFirst = () => nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);

  // 句子里的数与名字先取成有名字的变量：翻译目录里才是 {nCards} 而不是 {0}，译者好写复数
  const nCards = shownCards.length;
  const nDecks = shownDecks.length;
  /** 选中的卡种短名（「这一批里没有 X 卡」那句用；CARD_TYPE_LABELS 本身带「卡」，会说成「人物卡」卡） */
  const typeLabel = ctype ? CARD_TYPE_SHORT[ctype] : "";
  const placeholder =
    kind === "cards"
      ? t`搜索卡片名 / 标签`
      : kind === "decks"
        ? t`搜索别人分享的卡组`
        : kind === "templates"
          ? t`搜模板：特摄、治愈、赛博…`
          : t`搜工作流的标题或作者`;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        title={t`创意工坊`}
        right={
          <>
            <HelpButton tour="workshop" className="mr-2" />
            {/* 第二层入口：自己的卡片 / 卡组 / 模板 + 做卡片的入口。数字是三样加起来（让人知道里面有东西） */}
            <Link
              data-guide="workshop-mine-entry"
              to="/workshop/mine"
              className="flex flex-none items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink"
            >
              <Trans>我的仓库</Trans>
              {mineCount > 0 && <span className="tabular-nums opacity-70">{mineCount}</span>}
            </Link>
          </>
        }
      />

      {/* 搜索框：一直展开（不缩成放大镜），搜的是下面选中的那一类。页面级表单字段那一档规格 */}
      <SearchField shape="field" guide="workshop-search" className="mb-3" value={text} onChange={setText} placeholder={placeholder} />

      {/* 种类：卡片 / 卡组 / 模板 / 工作流（整宽分段控件）。换种类不清搜索词 —— 同一个词换一类再搜一遍是常见动作 */}
      <div data-guide="workshop-kinds" className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-panel p-1" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-lg py-2 text-sm ${kind === k ? "bg-brand font-semibold text-ink" : "text-slate-300"}`}
          >
            {k === "cards" ? t`卡片` : k === "decks" ? t`卡组` : k === "templates" ? t`模板` : t({ message: "工作流", context: "创意工坊市场第一排的种类名，与卡片 / 卡组 / 模板并列（英文用复数）" })}
          </button>
        ))}
      </div>

      {kind === "cards" && (
        <>
          {/* 卡种芯片（整行、横滑）。卡种在拿到的这一批里滤（服务端没有类型筛选）。
              ★ 排序不和芯片挤一行：375 宽的英文界面下芯片只露出两个半（2026-10-20 浏览器里量过）。没连上服务器 / 没拉到 / 广场是空的时整行不画：没有东西可筛
              （items 是整批、不是按卡种滤过的那份 —— 某个卡种筛空了芯片还在，否则换不回「全部」） */}
          {remote && !cardPlaza.error && cardPlaza.items.length > 0 && (
          <div className="-my-0.5 mb-2 flex gap-1.5 no-scrollbar overflow-x-auto py-0.5">
            {TYPE_FILTERS.map((tp) => {
              const n = tp ? typeCounts.get(tp) ?? 0 : cardPlaza.items.length;
              return (
                <button
                  key={tp || "all"}
                  onClick={() => setCtype(tp)}
                  aria-pressed={ctype === tp}
                  className={`flex-none rounded-full px-3 py-1 text-[11px] ${ctype === tp ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {tp ? CARD_TYPE_LABELS[tp] : t`全部`}
                  {n > 0 && <span className="ml-1 tabular-nums opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          )}
          {/* 张数 + 排序。左边那句照实说「这一批」：服务端只给最近分享的 50 张，热门是在这一批里重排，不是全站热榜 */}
          {remote && !cardPlaza.error && cardPlaza.items.length > 0 && (
            <div className="mb-2.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">
                {sort === "hot" ? t`最近分享的 ${nCards} 张，按点赞、收藏、浏览排` : t`最近分享的 ${nCards} 张`}
              </span>
              <SortSwitch sort={sort} onSort={setSort} />
            </div>
          )}

          {/* ★★ 四种状态**分开说**（2026-08-30）：没连上 / 拉挂了 / 加载中 / 真的没有（搜不到 vs 还没人分享），口径照 TemplateShelf 那份 */}
          {!remote ? (
            <EmptyState
              emoji="📡"
              text={t`这次没连上服务器，看不到别人分享的卡`}
              hint={t`卡片广场在服务器上，离线库里没有「别人」`}
              cta={me ? { label: t`去我的仓库`, to: "/workshop/mine" } : undefined}
            />
          ) : cardPlaza.error ? (
            <PlazaError error={cardPlaza.error} onRetry={cardPlaza.reload} />
          ) : cardPlaza.loading && cardPlaza.items.length === 0 ? (
            <EmptyState loading text={t`正在取卡片广场…`} />
          ) : cardPlaza.items.length === 0 ? (
            <EmptyState
              mascot={qd ? "wonder" : "nap"}
              text={qd ? t`没有搜到「${qd}」相关的卡` : t`还没有人分享卡片`}
              hint={qd ? t`换个词试试，或者清空搜索框看看大家都分享了什么` : t`你可以在自己的卡片详情页按「分享到创意工坊」，成为第一个`}
              cta={me ? { label: t`去我的仓库做一张`, to: "/workshop/mine" } : undefined}
            />
          ) : shownCards.length === 0 ? (
            <EmptyState
              mascot="wonder"
              text={t`这一批里没有「${typeLabel}」卡`}
              hint={t`换个卡种，或者搜一个词`}
              cta={{ label: t`看全部`, onClick: () => setCtype("") }}
            />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-3 gap-2.5">
                {shownCards.map((c) => {
                  const owned = ownedIds.has(c.cardId) || c.installed || c.isOwner;
                  // ★ 一次映射两处用（调两遍会每帧造两个不同引用的对象，也让路由 state 每次都变）。
                  //   映射与 published 标记都在 data/account.sharedToCard 一处（3D 桌面市场用的是同一份）。
                  const local: Card = sharedToCard(c);
                  return (
                    <div key={c.cardId}>
                      <Link to={`/card/${c.cardId}`} state={{ card: local }} className={`block ${owned ? "opacity-40" : ""}`}>
                        <CardTile card={local} />
                      </Link>
                      {/* 作者写的一句话推荐（api 收 description → 服务端存并发回 → toLocalCard 解析成 shareNote） */}
                      {local.shareNote && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-400" title={local.shareNote}>
                          {local.shareNote}
                        </p>
                      )}
                      <button
                        onClick={async () => {
                          if (auth === "out") return loginFirst();
                          setCardErr("");
                          setBusyCard(c.cardId);
                          try {
                            await installSharedCard(c.cardId);
                            cardPlaza.setItems((list) => list.map((x) => (x.cardId === c.cardId ? { ...x, installed: true } : x)));
                          } catch (e) {
                            setCardErr(e instanceof Error ? e.message : String(e));
                          } finally {
                            setBusyCard(null);
                          }
                        }}
                        disabled={owned || busyCard === c.cardId}
                        className="mt-1.5 w-full rounded-full bg-brand/15 py-1.5 text-center text-[11px] font-semibold text-brand active:opacity-60 disabled:bg-panel disabled:text-slate-500"
                      >
                        {c.isOwner ? t`我发的` : owned ? t`已拥有` : busyCard === c.cardId ? t`添加中…` : t`＋ 添加`}
                      </button>
                    </div>
                  );
                })}
              </div>
              {cardErr && <div className="mb-3 text-xs text-rose-300">{cardErr}</div>}
            </>
          )}
        </>
      )}

      {kind === "decks" && (
        <>
          {remote && !deckPlaza.error && deckPlaza.items.length > 0 && (
            <div className="mb-2.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">
                {sort === "hot" ? t`${nDecks} 套，装过的人多的在前` : t`${nDecks} 套，最新分享的在前`}
              </span>
              <SortSwitch sort={sort} onSort={setSort} />
            </div>
          )}
          {!remote ? (
            <EmptyState
              emoji="📡"
              text={t`登录服务器后可以浏览别人分享的卡组`}
              cta={me ? { label: t`去我的仓库`, to: "/workshop/mine?tab=decks" } : undefined}
            />
          ) : deckPlaza.error ? (
            <PlazaError error={deckPlaza.error} onRetry={deckPlaza.reload} />
          ) : deckPlaza.loading ? (
            <EmptyState loading text={t`正在取卡组广场…`} />
          ) : shownDecks.length === 0 ? (
            <EmptyState mascot={qd ? "wonder" : "nap"} text={qd ? t`没有匹配的卡组` : t`还没有人分享卡组`} hint={qd ? undefined : t`你可以第一个`} />
          ) : (
            <div className="space-y-2.5 pb-4">
              {shownDecks.map((d) => (
                <div key={d._id} className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                  {/* 前四张卡面拼一个缩略 */}
                  <div className="grid h-14 w-14 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-lg bg-slate-800">
                    {(d.covers.length ? d.covers : [""]).slice(0, 4).map((cv, i) =>
                      cv ? <img key={i} src={cv} alt="" className="h-full w-full object-cover" /> : <div key={i} className="bg-slate-700/60" />,
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">{d.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {d.author?.displayName || d.author?.username || t`匿名`}
                      {t` · ${d.cardCount} 张`}
                      {d.installs > 0 ? t` · ${d.installs} 人装过` : ""}
                      {d.remixOf ? t` · 改自 @${d.remixOf.displayName || d.remixOf.username}` : ""}
                    </div>
                    {d.description && <div className="mt-0.5 truncate text-[11px] text-slate-400">{d.description}</div>}
                  </div>
                  <button
                    disabled={d.installed || d.isOwner || busyDeck === d._id}
                    onClick={async () => {
                      if (auth === "out") return loginFirst();
                      setDeckErr("");
                      setBusyDeck(d._id);
                      try {
                        await installSharedDeck(d._id);
                        deckPlaza.setItems((list) => list.map((x) => (x._id === d._id ? { ...x, installed: true } : x)));
                      } catch (e) {
                        setDeckErr(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusyDeck(null);
                      }
                    }}
                    className="min-h-[32px] shrink-0 rounded-full bg-brand px-3 text-[11px] font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {d.isOwner ? t`我发的` : d.installed ? t`已添加` : busyDeck === d._id ? t`添加中…` : t`＋ 添加`}
                  </button>
                </div>
              ))}
            </div>
          )}
          {deckErr && <div className="pb-4 text-xs text-rose-300">{deckErr}</div>}
        </>
      )}

      {kind === "templates" && (
        <div className="pb-4">
          {/* 只摆模板市场（「工作流」是上面第四类、「我的模板」在第二层）；只剩一格，货架那排页签不画。搜索词用上面那一个搜索框的 */}
          <TemplateShelf tabs={["market"]} searchQ={qd} queryKey="shelf" />
        </div>
      )}

      {kind === "workflows" && (
        <div className="pb-4">
          <WorkflowShelf q={qd} />
        </div>
      )}
    </div>
  );
}
