// 卡片详情页：大卡面 + 类型/标签 + 简介 + 生成蓝图（具体到可复刻卡面的完整提示词）
// + 3D 建模全息预览（有 modelUrl 的角色卡）。创意工坊/我的/卡组详情点卡进来。
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView } from "../components/SocialPanel";
import CardHologram, { CARD_MODELS } from "../studio/ui/CardHologram";
import { myCards, myDecks } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS, Card } from "../types";

/** 老卡/素材卡没存生成蓝图时，按派生管线同款格式现场拼一份——照着它就能复刻同风格卡面 */
function blueprintOf(card: Card): string {
  if (card.genPrompt) return card.genPrompt;
  const label: Record<Card["type"], string> = {
    character: "人物立绘卡面",
    scene: "场景概念图卡面",
    background: "氛围底色卡面",
    prop: "道具特写卡面",
    style: "画风示意卡面",
  };
  const tags = card.tags?.length ? `关键词：${card.tags.join("、")}。` : "";
  return `${label[card.type]}：${card.name}。${card.summary}${tags}二次元厚涂插画风，高细节，电影感构图，氛围光，无文字无水印。竖版 3:4 卡面。`;
}

export default function CardDetailPage() {
  useAccountVersion();
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [copied, setCopied] = useState(false);
  useCountView("card", id);
  // 优先账号库；不在库里（比如看别人作品的卡组）用路由 state 里带来的卡
  const card = useMemo<Card | null>(() => {
    const mine = myCards().find((c) => c.id === id);
    if (mine) return mine;
    const passed = (loc.state as { card?: Card } | null)?.card;
    return passed && passed.id === id ? passed : (passed ?? null);
  }, [id, loc.state]);

  if (!card) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">这张卡不在你的收藏里</p>
        <Link to="/workshop" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去创意工坊
        </Link>
      </div>
    );
  }

  const color = CARD_TYPE_COLORS[card.type];
  const modelUrl = card.modelUrl ?? CARD_MODELS[card.name];
  const inDecks = myDecks().filter((d) => d.cardIds.includes(card.id));
  const blueprint = blueprintOf(card);

  return (
    <div className="safe-top min-h-full px-4 pb-8 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">卡片详情</h1>
      </div>

      {/* 大卡面 / 全息建模 双栏 */}
      <div className="mb-4 flex justify-center gap-3">
        <div className="w-44">
          <TarotCard cover={card.cover || null} title={card.name} sub={CARD_TYPE_LABELS[card.type]} type={card.type} />
        </div>
        {modelUrl && (
          <div className="relative w-44 overflow-hidden rounded-2xl bg-ink/85">
            <CardHologram url={modelUrl} />
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10px] tracking-wide text-cyan-300/90">
              ✦ 全息实体 3D 建模
            </span>
          </div>
        )}
      </div>

      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-100">{card.name}</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs" style={{ color, borderColor: color }}>
          {CARD_TYPE_LABELS[card.type]}
        </span>
        {card.hot != null && <span className="text-xs text-gold">🔥 {card.hot >= 10000 ? (card.hot / 10000).toFixed(1) + "万" : card.hot}</span>}
      </div>
      {card.tags && card.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">
              #{t}
            </span>
          ))}
        </div>
      )}
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{card.summary}</p>

      {/* 生成蓝图：铸卡时的完整提示词——照着它 AI 就能复刻出与卡面一致的画面/建模 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">🧬 生成蓝图</span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(blueprint).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
          >
            {copied ? "已复制 ✓" : "复制"}
          </button>
        </div>
        <p className="whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-400">{blueprint}</p>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          这是铸造这张卡时使用的完整生成提示词。把它交给 AI（或在工坊中使用本卡），即可生成与卡面一致的
          {card.type === "character" ? "角色画面 / 3D 建模" : "画面"}。
        </p>
      </div>

      {inDecks.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">所属卡组</div>
          <div className="flex flex-wrap gap-2">
            {inDecks.map((d) => (
              <Link key={d.id} to={`/deck/${d.id}`} className="rounded-full bg-panel px-3 py-1.5 text-xs text-slate-200">
                🎴 {d.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link
        to="/studio"
        className="block w-full rounded-xl bg-brand/90 py-2.5 text-center text-sm font-bold text-ink"
      >
        🎬 去 3D 工坊用这张卡创作
      </Link>

      <SocialPanel kind="card" id={card.id} />
    </div>
  );
}
