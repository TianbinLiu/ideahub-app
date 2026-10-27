// 作品详情页的吸底栏（2026-10-26 视频详情页 P0-5）：左边一个长得像输入框的「说点什么…」（点了开评论抽屉、直接聚焦），
// 右边是**全页唯一的实心主键**「做同款」（能做时才摆）。
// ★ portal 到 body：不能放进带 backdrop-blur 的 PageHeader 之内 —— 那会给 fixed 后代造包含块（CLAUDE.md 已知的坑那一格）。
// ★ 「做同款」不用 ⚡：⚡ 在全 app 是「要花钱」，做同款只是铺流水线、不花钱（首页那颗 2026-10-21 先改的）；
//   原来金色键上 20 多字的说明挪进了 RemakeCard 的参数行语境里，不再写在键上。
// ★ 评论抽屉、弹幕输入条、分享、下载面板都是 portal + z-50，盖得住它；沉浸 / 全屏态里由宿主不画它。
import { Trans } from "@lingui/react/macro";
import { createPortal } from "react-dom";
import Icon from "../Icon";

export default function VideoDock({ onComment, onRemake }: { onComment: () => void; onRemake: (() => void) | null }) {
  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-slate-700/60 bg-ink px-4 pt-2"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <button onClick={onComment} className="min-w-0 flex-1 rounded-full bg-panel px-4 py-2 text-left text-sm text-slate-400">
        <Trans>说点什么…</Trans>
      </button>
      {onRemake && (
        <button onClick={onRemake} className="inline-flex flex-none items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-bold text-ink active:scale-95">
          <Icon name="remix" size={16} />
          <Trans>做同款</Trans>
        </button>
      )}
    </div>,
    document.body,
  );
}
