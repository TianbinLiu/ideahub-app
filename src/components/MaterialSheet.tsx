// 工作流页的「素材库」：从屏幕上方落下的一块卡库，把卡组或单卡拖到屏幕中间
// 交给看板娘，就成为**这一段**的素材（见 flowStore.addMaterials）。
//
// ★ 为什么是拖拽而不是"点一下勾选"：
//   卡组是这个产品的核心语言，"把牌递给铸卡师"本身就是它的隐喻。点选更省事，
//   但也把卡片降格成了一个复选框列表。拖拽还顺带解决了"整组还是单张"的歧义——
//   拖哪个就是哪个，不用再设计一个"全选"按钮。
//
// ★ 拖拽必须用 pointer 事件，不能用 HTML5 draggable：
//   Android WebView 里 dragstart 在触摸下根本不触发（桌面鼠标才有），
//   整个功能在真机上会是死的。
//
// ★ 列表一律【横向】滚动，纵向留给拖拽。
//   这不是排版偏好而是手势约束：改成纵向滚动的栅格后，"往下拖"与"往下滚"
//   变成同一个手势，浏览器一旦接管滚动就直接给我们发 pointercancel，
//   拖拽在真机上会时灵时不灵。所以每个页签里都是一条 `touch-action: pan-x` 的横轨，
//   卡多了排成两行继续往右接，而不是换行往下堆。
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { CloseButton } from "./IconTapButton";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import MascotStage from "./MascotStage";
import TarotCard from "./TarotCard";
import DeckCard from "./DeckCard";
import { deckCoverOf, myCards, myDecks } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { CARD_TYPE_LABELS, type Card } from "../types";

/** 落点判定区：素材窗口【下方】那一块，拖拽开始时按面板实际高度量出来。
 *
 *  ★ 不能写死"屏幕 46%"。量过：812 高的屏上素材窗口底沿在 389，而 46%±190 的带子是
 *    184–564 —— 第二排素材卡（258–372）整排落在判定区里，手指刚把卡拎起来就已经是
 *    「松手·交给她」了。既没有"拖过去"的过程，列表上一次误滑也会被当成投放。
 *    面板高度还随内容/安全区变（最高 56vh），任何固定比例都躲不开这个重叠。
 *  ★ 判定区比看板娘本人大一圈是刻意的——手指在小屏上遮住的正是落点，
 *    判定框贴着画走，用户会觉得"明明放上去了却没加进去"。
 *  一处真源：判定、画圈、摆人都读同一个 zone，不会画一个判一个。 */
const ZONE_GAP_TOP = 20; // 与面板底沿留的空隙，让"离开了素材区"这件事看得见
const ZONE_GAP_BOTTOM = 104; // 给底部操作栏 + 安全区让位
const ZONE_MIN_H = 190;

interface DropZone {
  cy: number;
  halfW: number;
  halfH: number;
  /** 看板娘在这块地方能画多大：矮屏 / 高面板时要跟着缩，否则她会顶穿面板 */
  artW: number;
}

function measureZone(panelBottom: number): DropZone {
  const top = panelBottom + ZONE_GAP_TOP;
  const bottom = Math.max(top + ZONE_MIN_H, window.innerHeight - ZONE_GAP_BOTTOM);
  const h = bottom - top;
  return {
    cy: (top + bottom) / 2,
    halfW: 170,
    halfH: h / 2,
    // 精灵图接近正方（420×407），高度够不够直接看宽度；0.78 留给下面那条提示胶囊
    artW: Math.max(176, Math.min(262, Math.round(h * 0.78))),
  };
}

function inDropZone(x: number, y: number, z: DropZone): boolean {
  return Math.abs(x - window.innerWidth / 2) < z.halfW && Math.abs(y - z.cy) < z.halfH;
}

interface DragState {
  cards: Card[];
  label: string;
  cover: string | null;
  x: number;
  y: number;
  over: boolean;
  zone: DropZone;
}

type Tab = "decks" | "cards";

export default function MaterialSheet({
  materials,
  onAdd,
  onClose,
}: {
  /** 本段已挂的素材，用来把已加过的置灰 */
  materials: Card[];
  /** 返回**真正新增**的张数：0 张时调用方不该抖按钮（见 FlowPage） */
  onAdd: (cards: Card[]) => number;
  onClose: () => void;
}) {
  useAccountVersion();
  const allCards = myCards();
  const allDecks = myDecks();
  const [tab, setTab] = useState<Tab>("cards");
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState("");
  /** 松手后的「收下」演出；非空 = 正在播 receive 那一段。
   *  连 zone 一起存：这时 drag 已经置 null，光靠文案摆不出人在哪儿多大 */
  const [recv, setRecv] = useState<{ text: string; zone: DropZone } | null>(null);
  const start = useRef<{ x: number; y: number; id: number; active: boolean; cards: Card[]; label: string; cover: string | null; zone: DropZone } | null>(null);
  /** 素材面板本体，拖拽开始时量它的底沿来定落点区（面板高度随内容/安全区变） */
  const panelRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards]);
  const have = new Set(materials.map((c) => c.id));
  const key = q.trim().toLowerCase();
  const hit = (...fields: Array<string | undefined>) =>
    !key || fields.some((f) => (f ?? "").toLowerCase().includes(key));

  // 卡片按「名字 / 简介 / 类型」搜；卡组还能按组里任意一张卡的名字搜——
  // 用户记得住"那组里有凛"，未必记得住卡组自己叫什么
  const cards = allCards.filter((c) => hit(c.name, c.summary, CARD_TYPE_LABELS[c.type]));
  const decks = allDecks.filter((d) =>
    hit(d.name, d.intro, ...d.cardIds.map((id) => byId.get(id)?.name)),
  );

  function begin(cards: Card[], label: string, cover: string | null) {
    return {
      onPointerDown: (e: RPointerEvent) => {
        // 落点区在按下这一刻就量好并锁住：拖到一半面板若因滚动/键盘改了高度，
        // 判定框跟着跳会让"我明明没动"的手指突然掉出圈外
        const zone = measureZone(panelRef.current?.getBoundingClientRect().bottom ?? window.innerHeight * 0.4);
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false, cards, label, cover, zone };
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.active) {
          // 横向优先让给列表滚动：判据是"哪个方向走得多"，不是"有没有横向位移"
          // ——手指下滑时总会带一点横向抖动
          if (Math.abs(dx) > Math.abs(dy)) {
            start.current = null;
            return;
          }
          if (dy < 12) return; // 只认【向下】拖：落点在下方，向上划没有语义
          s.active = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件/已失效指针没有可捕获的 pointerId——拖拽本身不受影响 */
          }
        }
        setDrag({
          cards: s.cards,
          label: s.label,
          cover: s.cover,
          x: e.clientX,
          y: e.clientY,
          over: inDropZone(e.clientX, e.clientY, s.zone),
          zone: s.zone,
        });
      },
      onPointerUp: (e: RPointerEvent) => {
        const s = start.current;
        start.current = null;
        if (!s?.active) return;
        setDrag(null);
        if (!inDropZone(e.clientX, e.clientY, s.zone)) return;
        const n = onAdd(s.cards);
        // 收下这一段单独演一次：双手收回、把牌捧在胸前。它的 A 帧同样是 handover 的 B 帧，
        // 所以从"伸手等着"到"接住了"是连续的一个动作，不会跳帧
        setRecv({ text: n > 0 ? `收下了 ${n} 张` : "这些卡本段已经有了", zone: s.zone });
        setToast("");
      },
      onPointerCancel: () => {
        start.current = null;
        setDrag(null);
      },
    };
  }

  /** 横轨：超过 4 个就排成两行继续往右接，把 52vh 的高度用满 */
  const rail = (n: number) =>
    `grid ${n > 4 ? "grid-rows-2" : "grid-rows-1"} grid-flow-col justify-start gap-2.5 overflow-x-auto pb-1 pr-1`;

  const empty = (text: string, cta: string) => (
    <div className="flex flex-col items-center gap-2 py-7">
      <p className="text-xs text-slate-500">{text}</p>
      <a href="#/workshop" className="rounded-full bg-panel px-3.5 py-1.5 text-[11px] text-slate-300">
        {cta}
      </a>
    </div>
  );

  return (
    <>
      {/* ── 顶部素材窗口 ────────────────────────────────────────────── */}
      <div
        ref={panelRef}
        className="sheet-down safe-top absolute inset-x-0 top-0 z-30 max-h-[56vh] overflow-y-auto rounded-b-2xl border-b border-slate-700 bg-ink/97 px-3 pb-3 shadow-2xl backdrop-blur"
      >
        <div className="flex items-center gap-2 py-2">
          <Icon name="card" size={17} className="flex-none text-brand" />
          <span className="flex-none text-sm font-bold text-slate-100">素材库</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">往下拖出窗口，交给她</span>
          <CloseButton chip="md" size={16} align="end" label="关闭素材库" onClick={onClose} />
        </div>

        {/* 卡组 / 卡片分成两个页签：两者的拖拽语义完全不同（整组 vs 单张），
            混在一屏里滚，用户很容易把"拖了一组"当成"拖了一张" */}
        <div className="mb-2 flex gap-1 rounded-xl bg-black/30 p-1">
          {([
            ["cards", "卡片", allCards.length],
            ["decks", "卡组", allDecks.length],
          ] as const).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                tab === k ? "bg-panel text-slate-100 shadow" : "text-slate-500"
              }`}
            >
              {label}
              {n > 0 && <span className="ml-1 text-[10px] font-normal opacity-70">{n}</span>}
            </button>
          ))}
        </div>

        <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-700 bg-black/25 px-2.5 py-1.5">
          <Icon name="search" size={14} className="flex-none text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === "cards" ? "搜卡名 / 简介 / 类型" : "搜卡组名，或组里的卡名"}
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="清空搜索" className="flex-none text-slate-500">
              <Icon name="close" size={13} />
            </button>
          )}
        </div>

        {tab === "decks" ? (
          allDecks.length === 0 ? (
            empty("还没有卡组", "去创意工坊建一组")
          ) : decks.length === 0 ? (
            <p className="py-7 text-center text-xs text-slate-600">没有匹配的卡组</p>
          ) : (
            <>
              <div className="mb-1.5 text-[11px] text-slate-500">拖一整组 = 组里的卡全加进来</div>
              <div className={`${rail(decks.length)} no-scrollbar`} style={{ touchAction: "pan-x" }}>
                {decks.map((d) => {
                  const list = d.cardIds.map((id) => byId.get(id)).filter((c): c is Card => !!c);
                  // 封面 = 卡组封面卡的真实卡面（未指定时取组内第一张，见 deckCoverOf）
                  const cover = deckCoverOf(d)?.cover ?? null;
                  return (
                    <div
                      key={d.id}
                      {...begin(list, d.name, cover)}
                      className="w-[86px] cursor-grab touch-none select-none active:scale-95"
                    >
                      <DeckCard name={d.name} count={list.length} cover={cover} />
                    </div>
                  );
                })}
              </div>
            </>
          )
        ) : allCards.length === 0 ? (
          empty("还没有素材卡", "去创意工坊铸几张")
        ) : cards.length === 0 ? (
          <p className="py-7 text-center text-xs text-slate-600">没有匹配的卡片</p>
        ) : (
          <div className={`${rail(cards.length)} no-scrollbar`} style={{ touchAction: "pan-x" }}>
            {cards.map((c) => (
              <div
                key={c.id}
                {...begin([c], c.name, c.cover || null)}
                className={`relative w-[76px] cursor-grab touch-none select-none active:scale-95 ${
                  have.has(c.id) ? "opacity-45" : ""
                }`}
              >
                {/* 不传 sub：TarotCard 的题名与副题挤在同一行，这个宽度下
                    「人物卡」三个字会把名字截成「赛…」。类型由左上角那枚宝石徽记交代 */}
                <TarotCard cover={c.cover || null} title={c.name} type={c.type} />
                {have.has(c.id) && (
                  <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-bold text-emerald-300">
                    已加入
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 拖拽层：落点舞台 + 跟手的卡影 ──────────────────────────────
          ★ portal 到 body：素材窗口自己带 backdrop-blur，而 backdrop-filter 会给
            position:fixed 的后代造包含块——留在里面的话 inset-0 只铺满这块窗口，
            落点圈会被窗口边缘裁掉，也压不住底下的节点条。 */}
      {drag &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/45" />
            <div
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: "50%", top: drag.zone.cy }}
            >
              {/* 落地光圈画在她身后偏下，读成"把牌放到桌上" */}
              <span
                className={`drop-ring absolute bottom-8 h-24 w-56 rounded-[50%] border-2 ${
                  drag.over ? "border-brand bg-brand/25" : "border-white/35 bg-white/5"
                }`}
              />
              {/* ★ 姿势停住、人不僵：伸手那一下播完就定在摊开态（loop=false + forwards），
                  起伏交给 CSS 的 breathe 做 60fps。此前是循环播——手不停地伸出又收回，
                  用户根本等不到一个稳定的落点。
                  进落点圈后换成 handover-glad：手一动不动，只有表情转成开心鼓励
                  （它的 A 帧就是 handover 的 B 帧，所以两段接得严丝合缝）。 */}
              <MascotStage
                key={drag.over ? "glad" : "wait"}
                pose={drag.over ? "handover-glad" : "handover"}
                width={drag.over ? Math.round(drag.zone.artW * 1.07) : drag.zone.artW}
                loop={false}
                breathe
                className="relative transition-all"
              />
              <span
                className={`relative -mt-1 rounded-full px-3 py-1 text-xs font-bold ${
                  drag.over ? "bg-brand text-ink" : "bg-black/70 text-white/90"
                }`}
              >
                {drag.over ? `松手 · 交给她` : "拖到这里交给她"}
              </span>
            </div>

            {/* 卡影【全程跟手】。★ 之前进圈会把它吸附定死在桌面上——那一下手感很怪：
                手指还在动，画面里的卡却不动了，像是拖拽被中断了。
                现在改成：进圈的反馈全部由【她的表情】承担（换成 handover-glad），
                卡片始终跟着手指走，只是缩小一点、让开她的脸。 */}
            <div
              className={`absolute -translate-x-1/2 -translate-y-1/2 drop-shadow-2xl transition-[width,opacity,transform] ${
                drag.over ? "w-12 rotate-[2deg] opacity-80" : "w-16 rotate-[-6deg] opacity-90"
              }`}
              style={{ left: drag.x, top: drag.y }}
            >
              {drag.cover ? (
                <img src={drag.cover} alt="" className="aspect-[2/3] w-full rounded-lg object-cover" />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-panel text-xl">🎴</div>
              )}
              {drag.cards.length > 1 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-ink">
                  {drag.cards.length}
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* 收下：她把牌收回捧在胸前，很高兴。
          ★ 与拖拽层分开渲染：pointerup 时 drag 已经置 null、那一层整个卸载了，
            这段演出必须由自己的状态撑住，否则松手瞬间画面直接消失。
          ★ 仍然带 breathe：动作停在"捧着牌"这一帧，但人还在呼吸。 */}
      {recv &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/45" />
            <div
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: "50%", top: recv.zone.cy }}
            >
              <MascotStage
                pose="receive"
                width={Math.round(recv.zone.artW * 1.07)}
                loop={false}
                breathe
                onDone={() => setTimeout(() => setRecv(null), 560)}
              />
              <span className="-mt-1 rounded-full bg-brand px-3 py-1 text-xs font-bold text-ink">{recv.text}</span>
            </div>
          </div>,
          document.body,
        )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-[56%] z-40 flex justify-center">
          <span className="rounded-full bg-black/80 px-4 py-2 text-xs text-white">{toast}</span>
        </div>
      )}
    </>
  );
}

/**
 * 本段已挂素材的卡条（素材窗口打开时顶替底部的节点条）。
 *
 * ★ 用真卡面的塔罗卡而不是小方块缩略图：它与上面素材库、与工坊桌面上的卡
 *   是同一套视觉，用户一眼认得出"我刚交出去的就是这张"。缩略方块看着像文件列表。
 */
export function MaterialStrip({ materials, onRemove }: { materials: Card[]; onRemove: (id: string) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-300">本段素材</span>
        <span className="text-[11px] text-slate-500">{materials.length} 张</span>
        {materials.length > 0 && <span className="text-[10px] text-slate-600">· 点 ✕ 移出本段</span>}
      </div>
      {materials.length === 0 ? (
        <div className="flex h-[104px] items-center justify-center rounded-xl border border-dashed border-slate-700 text-[11px] text-slate-500">
          从上面的素材库往屏幕中间拖一张下来
        </div>
      ) : (
        <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-0.5">
          {materials.map((c) => (
            <div key={c.id} className="relative w-[70px] flex-none">
              <TarotCard cover={c.cover || null} title={c.name} type={c.type} />
              <button
                onClick={() => onRemove(c.id)}
                aria-label={`移除 ${c.name}`}
                /* 热区给到 24px：卡只有 70px 宽，×号再小就点不中了 */
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-ink text-[11px] text-slate-300 shadow"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
