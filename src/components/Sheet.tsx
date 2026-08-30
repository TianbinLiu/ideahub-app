// 底部抽屉壳。2026-08-29 从 ProfilePage 抽出来共享（草稿箱整页也要用 DraftSheet）。
//
// ★ 必须 createPortal 到 body（与 CommentSheet 同因）：TabBar 是 z-40，
//   而抽屉留在页面里时和它是【兄弟节点】——DOM 顺序上 TabBar 在后面，
//   同层级下后来者居上，抽屉底部那排按钮会被底栏盖住点不到。
//   钱包抽屉之前就压在底栏下面（"取消/删除"那一行要滑一下才够得着）。
import { type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        // pb-8 + safe-bottom 会打架（两条都是 padding-bottom，后写的赢）——直接算成一个值
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
