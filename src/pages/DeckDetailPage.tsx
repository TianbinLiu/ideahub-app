// 卡组详情页：标题/简介/封面卡 + 卡片网格（点卡进卡片详情）。
// 内置编辑模式：改标题、写简介、设封面卡、增删卡——工坊列表里的"编辑"也跳这里。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { Link, useNavigate, useParams } from "react-router";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import { deckCoverOf, isRemoteMode, myCards, myDecks, shareDeck, updateDeck } from "../data/account";
import { deckFitOf } from "../data/cardFit";
import { formatHeat, heatOf } from "../data/social";
import { useAccountVersion } from "../hooks/useAccount";
import { CARD_TYPE_LABELS, SHARE_NOTE_MAX, type Card } from "../types";

/**
 * 卡组的「按模型适配」摘要（2026-10-02 主人点名：出片涉及的各个组件对出片模型的口径要统一 —— 卡片有「按模型适配」，
 * 模板有「出片模型」，卡组夹在中间也该说一句）。
 *
 * ★ 一条判据都没新写：每张卡的状态出自 data/cardFit.cardFitOf（卡片页那一格读的是同一份），这里只数张数。
 * ★ 只数不改：哪张卡缺什么，点进那张卡的「按模型适配」里补 —— 这里不摆第二套勾选框（那会是同一个开关的第二处入口）。
 * ★ 背景卡不计（它在所有档位都只以文字参与）；全是背景卡 / 空卡组时整块不画。
 * ★ 三行的行首与卡片页那一格用同一组占位名（line2x / line10 / lineReal），目录里是同一条译文。
 */
function DeckModelFit({ cards }: { cards: Card[] }) {
  const { t } = useLingui();
  const fit = deckFitOf(cards);
  if (fit.total === 0) return null;
  const join = (parts: (string | false)[]) => parts.filter(Boolean).join(" · ");
  const n2 = fit.ref;
  const n1 = fit.frames;
  const nr = fit.start;
  const line2x = join([
    n2.image > 0 && t`${n2.image} 张的形象图直接进模型`,
    n2.asset > 0 && t`${n2.asset} 张真人卡以火山引擎认证素材进模型`,
    n2.needAsset > 0 && t`${n2.needAsset} 张真人卡要先勾「火山引擎适用」`,
  ]);
  const line10 = join([
    n1.text > 0 && t`${n1.text} 张有文字版形象描述`,
    n1.frameOnly > 0 && t`${n1.frameOnly} 张只经由设定帧起作用`,
    n1.noRealFace > 0 && t`${n1.noRealFace} 张真人卡用不上（这两档不收真人照片）`,
  ]);
  const lineReal = join([
    nr.photo > 0 && t`${nr.photo} 张真人卡以照片起拍`,
    nr.startFrames > 0 && t`${nr.startFrames} 张有专门画好的起拍画面`,
    nr.ownImage > 0 && t`${nr.ownImage} 张人物卡用卡上的图起拍`,
    nr.onlyAsStart > 0 && t`${nr.onlyAsStart} 张只有当起拍画面时才用得上形象图`,
    nr.textOnly > 0 && t`${nr.textOnly} 张只用文字`,
  ]);
  return (
    <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>🎛 按模型适配</Trans></div>
      <ul className="space-y-0.5 text-[10px] leading-relaxed text-slate-400">
        <li><Trans>高清 / 电影级：{line2x}</Trans></li>
        <li><Trans>标准 / 极速：{line10}</Trans></li>
        <li><Trans>真人档：{lineReal}</Trans></li>
      </ul>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        <Trans>真人档一段只用一张起拍画面。哪张没适配，点进那张卡的「按模型适配」里补。</Trans>
      </p>
    </div>
  );
}

export default function DeckDetailPage() {
  useAccountVersion();
  useSocialVersion(); // 热度到货后重渲染（服务端计数是懒加载的）
  const { id } = useParams();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  useCountView("deck", id);
  const { t } = useLingui();
  const deck = myDecks().find((d) => d.id === id) ?? null;
  const cards = myCards();
  const heat = heatOf("deck", deck?.id ?? "");

  if (!deck) {
    return (
      <EmptyState full icon="cards" text={t`卡组不存在或不属于你`} cta={{ label: t`去创意工坊`, to: "/workshop", primary: true }} />
    );
  }

  const inDeck = cards.filter((c) => deck.cardIds.includes(c.id));
  const cover = deckCoverOf(deck);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset
        onBack={() => nav(-1)}
        title={t`卡组详情`}
        right={
          <button
            onClick={() => setEditing((v) => !v)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-xs font-semibold ${editing ? "bg-brand text-ink" : "bg-panel text-slate-200"}`}
          >
            {editing ? t`完成` : t`✏️ 编辑`}
          </button>
        }
      />

      {/* 头部：封面卡 + 标题/简介 */}
      <div className="mb-4 flex gap-3">
        <div className="w-24 flex-none">
          {cover ? (
            <TarotCard cover={cover.cover} title={cover.name} sub={t`封面卡`} type={cover.type} />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center rounded-xl bg-panel text-2xl">🎴</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <input
                value={deck.name}
                onChange={(e) => updateDeck(deck.id, { name: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) updateDeck(deck.id, { name: t`未命名卡组` });
                }}
                maxLength={24}
                className="mb-2 w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-base font-bold text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                placeholder={t`卡组标题`}
              />
              <textarea
                value={deck.intro ?? ""}
                onChange={(e) => updateDeck(deck.id, { intro: e.target.value })}
                maxLength={SHARE_NOTE_MAX}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand leading-relaxed"
                placeholder={t`写一段卡组简介：这套卡适合生成什么样的视频？`}
              />
            </>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-bold text-slate-100">{deck.name}</h2>
              <p className="text-xs leading-relaxed text-slate-400">
                {deck.intro?.trim() || t`还没有简介——点右上角「编辑」写一段。`}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span><Trans>{deck.cardIds.length} 张卡</Trans></span>
                {/* 热度：远端模式是服务端算的全局值，离线/老服务端退回本机计数并说明 */}
                <span className="text-gold">🔥 {formatHeat(heat.heat)}</span>
                {heat.source === "local" && <span className="text-slate-600"><Trans>本机计数</Trans></span>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 分享到创意工坊。★ 原来这里只有一句被动的「· 已分享」文字 ——
          看得到状态却改不了，用户得回工坊列表里找那个按钮 */}
      <WorkshopShareBar
        kind="deck"
        className="mb-4"
        published={!!deck.published}
        installs={deck.installs ?? 0}
        disabledReason={shareBlockReason({ remote: isRemoteMode(), published: !!deck.published, cardCount: deck.cardIds.length })}
        onToggle={(next) => shareDeck(deck.id, next)}
      />

      <DeckModelFit cards={inDeck} />

      {/* 卡片网格：查看态点卡进详情；编辑态点卡加入/移出、可设封面 */}
      {editing ? (
        <>
          <div className="mb-1.5 text-[11px] text-slate-400"><Trans>点击卡片加入/移出 · 组内卡片左上角可设为封面</Trans></div>
          <div className="grid grid-cols-3 gap-2.5">
            {cards.map((c) => {
              const on = deck.cardIds.includes(c.id);
              const isCover = on && cover?.id === c.id;
              return (
                <div key={c.id} className="relative">
                  <button
                    onClick={() =>
                      updateDeck(deck.id, {
                        cardIds: on ? deck.cardIds.filter((x) => x !== c.id) : [...deck.cardIds, c.id],
                      })
                    }
                    className={`block w-full ${on ? "rounded-xl ring-2 ring-brand" : "opacity-55"}`}
                  >
                    <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
                  </button>
                  {on && (
                    <button
                      onClick={() => updateDeck(deck.id, { coverCardId: c.id })}
                      className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                        isCover ? "bg-gold text-ink" : "bg-black/65 text-slate-200"
                      }`}
                    >
                      {isCover ? t`★ 封面` : t`设封面`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : inDeck.length > 0 ? (
        <div className="grid grid-cols-3 gap-2.5">
          {inDeck.map((c) => (
            <Link key={c.id} to={`/card/${c.id}`}>
              <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState emoji="🃏" text={t`空卡组`} hint={t`点右上角「编辑」挑几张卡进来`} />
      )}

      <SocialPanel kind="deck" id={deck.id} />
    </div>
  );
}
