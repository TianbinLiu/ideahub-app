// 创意工坊第二层「我的仓库」（/workshop/mine）：自己的卡片 / 卡组 / 模板，以及做卡片的三个入口。
//
// ★ 2026-10-20 工坊改版（主人点名「参考市面上创意工坊的 ui 构造：第一层以市场搜索为主，次级页面才是『我的』」）：
//   原来 /workshop 一进来就是「我的卡片」，市场（「从市场添加」）排在三个创作入口**下面**，模板市场还套在「我的模板」页签里。
//   调研过的十几家（Steam 创意工坊、Unity / Roblox 素材商店、Figma 社区、Google Play、RunningHub…）都是反过来：
//   第一屏是一直展开的搜索框 + 种类切换，「我拥有的」在单独一层，创作 / 上传入口不和浏览混在一起。
//   于是 /workshop = 市场（pages/WorkshopPage），这一页 = 我的东西 + 做东西的入口。
// ★ 页内的建卡组、编辑、设封面、分享、删除整块从老 WorkshopPage 搬过来，逻辑一行没改。
// ★ 页签进地址（`?tab=`，hooks/useQueryTab）：去卡片 / 卡组 / 模板详情再返回，这一页整个重挂，state 归零就会把人扔回第一个页签
//   （2026-09-05 主人真机点名过一次）。
// ★ 3D 工坊入口挪到这一页（原来在市场那一层的顶栏）：它是创作现场，不是浏览入口。
import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import DeleteCardDialog from "../components/DeleteCardDialog";
import DeleteDeckDialog from "../components/DeleteDeckDialog";
import AuthPending from "../components/AuthPending";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import CardTile from "../components/workshop/CardTile";
import Icon from "../components/Icon";
import TemplateShelf, { useTemplatesVersion } from "../components/TemplateShelf";
import VideoCardAnnotator from "../components/VideoCardAnnotator";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import {
  cardsLoadIssue,
  type Deck,
  createDeck,
  deckCoverOf,
  deleteDeck,
  isRemoteMode,
  myCards,
  myDecks,
  removeCard,
  shareDeck,
  updateDeck,
} from "../data/account";
import { groupRows, myTemplates } from "../data/templates";
import { subscribeVoices, voicesVersion } from "../data/cardVoice";
import { useAccountVersion, useAuthState, useCurrentUser } from "../hooks/useAccount";
import { useBackOr } from "../hooks/useBackOr";
import { useQueryTab } from "../hooks/useQueryTab";
import { Card, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../types";

const MINE_TABS = ["cards", "decks", "templates"] as const;

export default function WorkshopMinePage() {
  useAccountVersion(); // 账号库变更时重算列表
  useTemplatesVersion(); // 模板库到货 / 变更时「模板 N」那个数跟着变
  // ★ 下面所有 hook 都在登录墙的早退**之前**（hook 不能写在条件返回之后，登录前后 hook 数不一致会整棵树崩）
  const me = useCurrentUser();
  const auth = useAuthState();
  const { t } = useLingui();
  // 深链冷启动没有上一页时退回市场那一层（hooks/useBackOr 的 ★★），别退出 App
  const back = useBackOr("/workshop");
  const cards = myCards();
  const decks = myDecks();
  const tplCount = groupRows(myTemplates()).length;
  const [tab, setTab] = useQueryTab("tab", MINE_TABS, "cards");
  /** 待确认删除的卡（删卡确认与详情页共用 DeleteCardDialog 一份） */
  const [askCard, setAskCard] = useState<Card | null>(null);
  /** 待确认删除的卡组。★ 删卡组**不删卡**（deleteDeck 只摘卡组本身）——这件事必须说，
   *  否则用户会以为"删卡组 = 把里面的卡也删了"而不敢删，或者删了之后到处找卡 */
  const [askDeck, setAskDeck] = useState<Deck | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** 圈选提取抽屉。null = 没开；"deck"/"single" = 提取卡组 / 单张卡片（V2 圈选式） */
  const [extractOpen, setExtractOpen] = useState<null | "deck" | "single">(null);
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const remote = isRemoteMode();

  const byType = useMemo(() => {
    const m: Partial<Record<CardType, number>> = {};
    for (const c of cards) m[c.type] = (m[c.type] ?? 0) + 1;
    return m;
  }, [cards]);

  // ★★ 必须在下面那个登录墙 `if (!me) return` **之前**，而 enabled 又必须是 `!!me` —— 未登录时整页是登录墙，
  //   那时弹一份讲卡片卡组的引导等于对着一个不存在的界面说话，而且走完就记成"看过了"。
  useAutoGuide("workshopMine", !!me);

  // ★ 与「我的」同一条：pending 时给加载态，别把"你没登录"当结论说出去
  if (auth === "pending") {
    return <AuthPending className="safe-top min-h-[70vh]" />;
  }
  if (!me) {
    return (
      <EmptyState
        full
        icon="cards"
        text={t`登录后可以收藏卡片、组建卡组`}
        cta={{ label: t`登录 / 注册`, to: "/login?next=/workshop/mine", primary: true }}
      />
    );
  }

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        onBack={back}
        title={t`我的仓库`}
        right={
          <>
            <HelpButton tour="workshopMine" className="mr-2" />
            <Link data-guide="workshop-studio-entry" to="/studio" className="flex-none rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink">
              {/* 比市场那一层原来那颗（「进入 3D 工坊」）短：这一行还要放返回键与「我的仓库」，英文界面下标题会被挤成「My Lib…」（2026-10-20 量过） */}
              <Trans>🎴 3D 工坊</Trans>
            </Link>
          </>
        }
      />

      {/* 做卡片的三个入口（主人点名放在「我的」这一层）。
          ★ 从本地视频圈选提卡（V2，2026-08-24 换代）：旧路是"AI 看抽帧自动认"，又贵又不可控；新路是用户拖到某一帧亲手圈出要的人和物 ——
            不上传、不花 token、指哪张是哪张。提取卡组（连圈多张打包）/ 提取卡片（圈一张就走）。
          ★ 自己传图做卡片是**另一条**路，不是默认路径 —— 默认铸卡（3D 工坊里的铸卡师）已经是 AI 全自动出图，一张图都不用传。
            所以那一格的小字要点出区别；「不经过 AI 出图 · 不花 token」是它相对 AI 铸卡唯一真实的优势，值得写在入口上。 */}
      {/* ★ 三格的标题用 11px（2026-10-20 真机量过）：CPH2771（视口 363 宽）上每格内容区 82px，「从视频提取卡组」7 个字在 12px 下要 84px，
          折成「从视频提取卡 / 组」—— 第二行孤零零一个字；11px 是 77px，360 宽的机器上也还有余量 */}
      <div data-guide="workshop-extract-card" className="mb-4 grid grid-cols-3 gap-2.5">
        {(
          [
            ["deck", "cards", t`从视频提取卡组`, t`连圈多张，打包成一组`],
            ["single", "card", t`从视频提取卡片`, t`圈一张就走`],
          ] as const
        ).map(([mode, icon, title, sub]) => (
          <button
            key={mode}
            onClick={() => setExtractOpen(mode)}
            className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-cyan-400/35 bg-gradient-to-b from-cyan-400/15 to-transparent p-2.5 text-left active:opacity-60"
          >
            {/* 图标随这一格的色调（2026-10-21 换掉 🎴🎯 emoji：emoji 走各家系统彩色字体，三台手机三个样，也跟不了 currentColor） */}
            <Icon name={icon} size={22} className="text-cyan-300" />
            <span className="text-[11px] font-semibold leading-snug text-slate-100">{title}</span>
            <span className="line-clamp-3 text-[10px] leading-relaxed text-slate-400">{sub}</span>
          </button>
        ))}
        <Link
          to="/custom-card"
          className="flex min-w-0 flex-col items-start gap-1 rounded-xl border border-amber-400/35 bg-gradient-to-b from-amber-400/15 to-transparent p-2.5 text-left active:opacity-60"
        >
          <Icon name="upload" size={22} className="text-amber-300" />
          <span className="text-[11px] font-semibold leading-snug text-slate-100">
            <Trans>自己传图做卡片</Trans>
          </span>
          <span className="line-clamp-3 text-[10px] leading-relaxed text-slate-400">
            <Trans>不经过 AI 出图 · 不花 token</Trans>
          </span>
        </Link>
      </div>

      {/* 页签：卡片 / 卡组 / 模板，数字跟在名字后面（这一页标题已经是「我的仓库」，页签不再重复「我的」） */}
      <div data-guide="workshop-tabs" className="mb-3 flex gap-2">
        {MINE_TABS.map((tb) => {
          const n = tb === "cards" ? cards.length : tb === "decks" ? decks.length : tplCount;
          return (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              aria-pressed={tab === tb}
              className={`rounded-full px-3.5 py-1.5 text-xs ${tab === tb ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
            >
              {tb === "cards" ? t`卡片` : tb === "decks" ? t`卡组` : t`模板`}
              {n > 0 && <span className="ml-1 tabular-nums opacity-70">{n}</span>}
            </button>
          );
        })}
      </div>

      {/* ★★ 两张删除确认摆在**页签分支之外**（2026-08-30 复核抓到）：删卡组那颗按钮在「卡组」分支，而确认卡一度写在「卡片」分支里 ——
          两分支互斥，于是卡组按钮点了纹丝不动。删除类浮层与触发它的按钮不该分属不同的条件分支。 */}
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
          {/* 只摆「我的模板」（第一层市场那边只摆模板市场 / 工作流）；货架自带「传一段视频做白模模板」那个入口 */}
          <TemplateShelf tabs={["mine"]} />
        </div>
      ) : tab === "cards" ? (
        <>
          {/* 统计条（原来在工坊第一屏顶上）：按卡种数一数，挑卡时一眼看出缺哪一类 */}
          {cards.length > 0 && (
            <div className="mb-3 flex gap-2 no-scrollbar overflow-x-auto pb-1 text-[11px]">
              <span className="flex-none rounded-full bg-panel px-2.5 py-1 text-slate-300">
                <Trans>共 {cards.length} 张卡</Trans>
              </span>
              {Object.entries(byType).map(([kind, n]) => (
                <span
                  key={kind}
                  className="flex-none rounded-full px-2.5 py-1"
                  style={{ color: CARD_TYPE_COLORS[kind as CardType], background: CARD_TYPE_COLORS[kind as CardType] + "1f" }}
                >
                  {CARD_TYPE_LABELS[kind as CardType]} {n}
                </span>
              ))}
            </div>
          )}
          {cards.length > 0 && (
            <div className="mb-5 grid grid-cols-3 gap-2.5">
              {cards.map((c) => (
                /* ★ 删卡走确认（2026-08-30）：卡可能正挂在卡组里、已分享到工坊、还带着声音样本与肖像授权 —— 全是删了找不回的东西。
                   确认卡与详情页共用同一份（DeleteCardDialog），它按事实说清后果 */
                <CardTile key={c.id} card={c} to={`/card/${c.id}`} onRemove={() => setAskCard(c)} />
              ))}
            </div>
          )}
          {cards.length === 0 &&
            /* ★ 「没问到」不许说成「没有」：卡是真花过 token 铸的，说错这一句用户读到的是「我付钱铸的卡全没了」（同 ProfilePage 的 worksKnown） */
            (cardsLoadIssue() ? (
              <EmptyState error emoji="🃏" text={t`这会儿没能取到你的卡片（${cardsLoadIssue()}）`} hint={t`它们还在，联网后重开一次`} />
            ) : (
              <EmptyState
                mascot="nap"
                text={t`还没有卡片`}
                hint={t`用上面几种方式做第一张，或者去市场挑几张`}
                cta={{ label: t`去市场看看`, to: "/workshop" }}
              />
            ))}
        </>
      ) : (
        <>
          <button
            data-guide="workshop-deck-new"
            onClick={() => createDeck(t`卡组 ${decks.length + 1}`)}
            className="mb-3 w-full rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-300"
          >
            <Trans>＋ 新建卡组</Trans>
          </button>
          <div className="space-y-3 pb-4">
            {decks.map((d) => {
              const inDeck = cards.filter((c) => d.cardIds.includes(c.id));
              const open = editing === d.id;
              const cover = deckCoverOf(d);
              return (
                <div key={d.id} className="rounded-xl border border-slate-700/70 bg-panel p-3">
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
                        if (!e.target.value.trim()) updateDeck(d.id, { name: t`未命名卡组` });
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none"
                    />
                    <span className="text-[11px] text-slate-500">
                      <Trans>{d.cardIds.length} 张</Trans>
                    </span>
                    {/* 两颗做成胶囊（原来是两段 16px 高的裸文字并排，手指点不准、也分不出哪个是键） */}
                    <button
                      onClick={() => setEditing(open ? null : d.id)}
                      className="rounded-full bg-panel px-3 py-1.5 text-xs text-brand ring-1 ring-slate-700 active:opacity-60"
                    >
                      {open ? t`完成` : t`编辑`}
                    </button>
                    <button
                      onClick={() => setAskDeck(d)}
                      className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 active:opacity-60"
                    >
                      <Trans>删除</Trans>
                    </button>
                  </div>

                  {/* 分享到创意工坊：分享出去后别人能在第一层市场的「卡组」里装走整套。
                      ★ 三处调用点（这里、卡组详情页、卡片详情页）共用同一个组件，禁用规则与错误显示只有一份实现 */}
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
                      {/* ★ 只留"点它就是加/减"这半句：卡长得就是卡、没有按钮相，全页只有这一句在**事前**说明 */}
                      <div className="mb-1.5 text-[11px] text-slate-400">
                        <Trans>点卡片加入 / 移出</Trans>
                      </div>
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
                                  title={isCover ? t`当前封面卡` : t`设为卡组封面`}
                                  className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                    isCover ? "bg-gold text-ink" : "bg-black/65 text-slate-200 hover:bg-black/85"
                                  }`}
                                >
                                  {isCover ? t`★ 封面` : t`设封面`}
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
              <EmptyState
                mascot="nap"
                text={t`还没有卡组`}
                hint={t`建一个把常用素材归到一起，或者去市场装一套别人分享的`}
                cta={{ label: t`去市场看看`, to: "/workshop?kind=decks" }}
              />
            )}
          </div>
        </>
      )}
      {extractOpen && <VideoCardAnnotator deckMode={extractOpen === "deck"} onClose={() => setExtractOpen(null)} />}
    </div>
  );
}
