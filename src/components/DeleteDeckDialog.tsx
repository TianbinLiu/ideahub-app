// 删卡组确认 —— 与 DeleteCardDialog 同形的**唯一一份**（工坊卡组列表 / 卡组详情页共用）。
//
// ★ 为什么与删卡分成两个组件而不是一个通用的：两者要说的**事实不同**，而"说对"正是
//   这类弹层存在的全部理由。删卡组最关键的一句是「里面的卡不会被删」——不说的话用户
//   要么不敢删，要么删完到处找卡；删卡最关键的是「挂着它的那几段不受影响」。
//   合成一个通用弹层的代价是这些话变成调用方传进来的字符串，那就等于没有唯一实现。
//
// ★ 抽成组件的直接原因（2026-08-30 复核抓到）：它原来是内联在工坊页某个页签分支里的
//   一段 JSX，而触发它的按钮在**另一个页签分支** —— 两分支互斥，卡组因此根本删不掉。
//   删除类浮层与触发它的按钮不该分属不同的条件分支；做成组件后挂在顶层，这类错就不会再犯。
import { createPortal } from "react-dom";
import type { Deck } from "../data/account";

export default function DeleteDeckDialog({
  deck,
  onConfirm,
  onCancel,
}: {
  deck: Deck;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6" onClick={onCancel}>
      <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-ink p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-100">删掉卡组「{deck.name}」？</h3>
        <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-400">
          <p>
            · 里面那 {deck.cardIds.length} 张卡<span className="text-slate-200">不会被删</span>，
            它们还在你的卡片库里，只是不再归到这一组。
          </p>
          {deck.published && (
            <p>
              · 这个卡组已分享到创意工坊：删掉会<span className="text-slate-200">同时下架</span>；
              别人已经装走的那份是发布时的快照，留在他们库里不受影响。
            </p>
          )}
          <p className="text-rose-300">卡组本身删了就找不回来。</p>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-slate-600 py-2.5 text-xs text-slate-300">
            先不删
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-xl bg-rose-500/90 py-2.5 text-xs font-bold text-white">
            删掉这个卡组
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
