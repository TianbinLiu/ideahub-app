// 「给这个角色位挂哪张卡」的选卡浮层。
//
// ★ 必须 `createPortal` 到 body，不能就地渲染一个 `fixed inset-0`：
//   这一页祖先里有圆角 + overflow-hidden 的舞台、也可能被塞进带 backdrop-blur / transform
//   的面板里 —— 那些属性会给 `position: fixed` 后代造包含块，`inset-0` 于是相对那个盒子
//   而不是视口（评论抽屉与首尾帧放大层都在这条上栽过，各修过一次，见 CLAUDE.md）。
//
// ★ 这里是**点列表选卡**，不是"点画面里的人偶"（方案 B1 的有意降级）。理由见 RoleCastBoard。
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import { CARD_TYPE_LABELS, type Card } from "../../types";

export interface CardPickSheetProps {
  /** 挂给哪个角色位（原样显示服务端给的编号，不重新编号 —— F5：编号稳定但不连续） */
  label: string;
  desc: string;
  /** 可挂的卡。★ 由宿主给（组件不认识素材库），要不要只给人物卡也由宿主决定 */
  cards: Card[];
  /** 这个位子现在挂着谁（有值时多一枚「取下」） */
  currentId?: string;
  onPick: (card: Card) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function CardPickSheet({
  label,
  desc,
  cards,
  currentId,
  onPick,
  onClear,
  onClose,
}: CardPickSheetProps) {
  const [q, setQ] = useState("");
  const key = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      cards.filter(
        (c) => !key || [c.name, c.summary, CARD_TYPE_LABELS[c.type]].some((f) => (f ?? "").toLowerCase().includes(key)),
      ),
    [cards, key],
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70" onClick={onClose}>
      <div
        className="safe-bottom max-h-[76vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink px-3 pb-3 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 flex-none rounded-md bg-sky-500/20 px-2 py-0.5 text-[13px] font-bold tabular-nums text-sky-200">
            {label}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-100">给这个人偶挂一张卡</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{desc}</p>
          </div>
          <button onClick={onClose} className="flex-none text-slate-400" aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜卡名 / 简介"
          className="mb-2 w-full rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />

        {currentId && (
          <button
            onClick={onClear}
            className="mb-2 w-full rounded-lg border border-slate-600 py-2 text-[12px] text-slate-300"
          >
            取下这张卡（这个人偶保持白模原样）
          </button>
        )}

        {list.length === 0 ? (
          // 空列表也要说清为什么空、以及怎么办 —— 一片空白等于"点了没反应"
          <p className="py-6 text-center text-[11px] leading-relaxed text-slate-400">
            {cards.length === 0
              ? "你的素材库里还没有可挂的人物卡。先去创意工坊铸一张，再回来挂。"
              : "没有匹配的卡片，换个词试试。"}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {list.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="text-left">
                <div
                  className={`aspect-[2/3] w-full overflow-hidden rounded-lg border bg-slate-800 ${
                    c.id === currentId ? "border-gold" : "border-slate-700"
                  }`}
                >
                  {c.cover ? (
                    <img src={c.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl opacity-40">🔮</div>
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-200">{c.name}</p>
                <p className="truncate text-[10px] text-slate-500">{CARD_TYPE_LABELS[c.type]}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
