// 卡组详情页：标题/简介/封面卡 + 卡片网格（点卡进卡片详情）。
// 内置编辑模式：改标题、写简介、设封面卡、增删卡——工坊列表里的"编辑"也跳这里。
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView } from "../components/SocialPanel";
import { deckCoverOf, myCards, myDecks, updateDeck } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { CARD_TYPE_LABELS } from "../types";

export default function DeckDetailPage() {
  useAccountVersion();
  const { id } = useParams();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  useCountView("deck", id);
  const deck = myDecks().find((d) => d.id === id) ?? null;
  const cards = myCards();

  if (!deck) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">卡组不存在或不属于你</p>
        <Link to="/workshop" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去创意工坊
        </Link>
      </div>
    );
  }

  const inDeck = cards.filter((c) => deck.cardIds.includes(c.id));
  const cover = deckCoverOf(deck);

  return (
    <div className="safe-top min-h-full px-4 pb-8 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold text-slate-100">卡组详情</h1>
        <button
          onClick={() => setEditing((v) => !v)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${editing ? "bg-brand text-ink" : "bg-panel text-slate-200"}`}
        >
          {editing ? "完成" : "✏️ 编辑"}
        </button>
      </div>

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
                className="mb-2 w-full rounded-lg border border-slate-600 bg-panel px-2.5 py-1.5 text-base font-bold text-slate-100 outline-none focus:border-brand"
                placeholder="卡组标题"
              />
              <textarea
                value={deck.intro ?? ""}
                onChange={(e) => updateDeck(deck.id, { intro: e.target.value })}
                maxLength={120}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-600 bg-panel px-2.5 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-brand"
                placeholder="写一段卡组简介：这套卡适合生成什么样的视频？"
              />
            </>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-bold text-slate-100">{deck.name}</h2>
              <p className="text-xs leading-relaxed text-slate-400">
                {deck.intro?.trim() || "还没有简介——点右上角「编辑」写一段。"}
              </p>
              <div className="mt-2 text-[11px] text-slate-500">
                {deck.cardIds.length} 张卡
                {deck.published ? ` · 已分享${(deck.installs ?? 0) > 0 ? ` · ${deck.installs} 人装过` : ""}` : ""}
              </div>
            </>
          )}
        </div>
      </div>

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
