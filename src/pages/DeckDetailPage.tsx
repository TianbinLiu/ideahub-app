// 卡组详情页：标题/简介/封面卡 + 卡片网格（点卡进卡片详情）。
// 内置编辑模式：改标题、写简介、设封面卡、增删卡——工坊列表里的"编辑"也跳这里。
import { useState } from "react";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { Link, useNavigate, useParams } from "react-router";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import { deckCoverOf, isRemoteMode, myCards, myDecks, shareDeck, updateDeck } from "../data/account";
import { formatHeat, heatOf } from "../data/social";
import { useAccountVersion } from "../hooks/useAccount";
import { CARD_TYPE_LABELS, SHARE_NOTE_MAX } from "../types";

export default function DeckDetailPage() {
  useAccountVersion();
  useSocialVersion(); // 热度到货后重渲染（服务端计数是懒加载的）
  const { id } = useParams();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  useCountView("deck", id);
  const deck = myDecks().find((d) => d.id === id) ?? null;
  const cards = myCards();
  const heat = heatOf("deck", deck?.id ?? "");

  if (!deck) {
    return (
      <EmptyState full icon="cards" text="卡组不存在或不属于你" cta={{ label: "去创意工坊", to: "/workshop", primary: true }} />
    );
  }

  const inDeck = cards.filter((c) => deck.cardIds.includes(c.id));
  const cover = deckCoverOf(deck);

  return (
    <div className="min-h-full px-4 pb-8">
      <PageHeader
        onBack={() => nav(-1)}
        title="卡组详情"
        right={
          <button
            onClick={() => setEditing((v) => !v)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-xs font-semibold ${editing ? "bg-brand text-ink" : "bg-panel text-slate-200"}`}
          >
            {editing ? "完成" : "✏️ 编辑"}
          </button>
        }
      />

      {/* 头部：封面卡 + 标题/简介 */}
      <div className="mb-4 flex gap-3">
        <div className="w-24 flex-none">
          {cover ? (
            <TarotCard cover={cover.cover} title={cover.name} sub="封面卡" type={cover.type} />
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
                  if (!e.target.value.trim()) updateDeck(deck.id, { name: "未命名卡组" });
                }}
                maxLength={24}
                className="mb-2 w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-base font-bold text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                placeholder="卡组标题"
              />
              <textarea
                value={deck.intro ?? ""}
                onChange={(e) => updateDeck(deck.id, { intro: e.target.value })}
                maxLength={SHARE_NOTE_MAX}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand leading-relaxed"
                placeholder="写一段卡组简介：这套卡适合生成什么样的视频？"
              />
            </>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-bold text-slate-100">{deck.name}</h2>
              <p className="text-xs leading-relaxed text-slate-400">
                {deck.intro?.trim() || "还没有简介——点右上角「编辑」写一段。"}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{deck.cardIds.length} 张卡</span>
                {/* 热度：远端模式是服务端算的全局值，离线/老服务端退回本机计数并说明 */}
                <span className="text-gold">🔥 {formatHeat(heat.heat)}</span>
                {heat.source === "local" && <span className="text-slate-600">本机计数</span>}
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

      {/* 卡片网格：查看态点卡进详情；编辑态点卡加入/移出、可设封面 */}
      {editing ? (
        <>
          <div className="mb-1.5 text-[11px] text-slate-400">点击卡片加入/移出 · 组内卡片左上角可设为封面</div>
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
                      {isCover ? "★ 封面" : "设封面"}
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
        <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
          空卡组——点右上角「编辑」挑几张卡进来
        </div>
      )}

      <SocialPanel kind="deck" id={deck.id} />
    </div>
  );
}
