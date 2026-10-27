// 文字模板段的横幅（2026-10-26 文字模板 P1）：这一段来自哪个文字模板、出片前还差什么、怎么摘掉出处。画布与工坊方案台各挂一份。
// ★ 一条规则都不判：差什么只问 flowStore.textTplIssue（与 genNode 出片前那道闸同一个函数），摘只调 detachTextTpl（被拒的原因写在 err，宿主都画它）。
// ★ 做法是固定的（flowStore.textTplLaneLocked）：画布那排「套模板 / 自选卡片 / 自定义 / 直出」页签对这一段不摆，想换做法只有这里那颗「摘掉模板出处」。
import { Trans, useLingui } from "@lingui/react/macro";
import { showToast } from "../../data/toast";
import { nodeDone, textTplIssue, useFlow } from "../../studio/flowStore";
import Warn from "../Warn";

export default function TextTplBanner({ nodeId, compact = false }: { nodeId: string; compact?: boolean }) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const busy = useFlow((s) => s.busy);
  const idx = nodes.findIndex((n) => n.id === nodeId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  if (!node?.textTpl) return null;
  const title = node.textTpl.title;
  const done = nodeDone(node);
  const generating = busy || nodes.some((n) => n.status === "generating");
  // 出过片的段不再说「出片前还差什么」：那一发已经按模板正文拍完了
  const issue = done ? null : textTplIssue(nodes, idx, mode);
  return (
    <div className={`rounded-lg border border-info-500/40 bg-info-500/10 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"} space-y-1.5`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-info-200">
          <Trans>这一段套用的是文字模板「{title}」：做法跟着模板走（参考图直出），正文与图位照模板写好的发。</Trans>
        </p>
        {!done && (
          <button
            type="button"
            onClick={() => {
              if (useFlow.getState().detachTextTpl(node.id)) showToast(t`已摘掉模板出处：现在是普通的参考图直出段，正文和图都留着`);
            }}
            disabled={generating}
            className="flex-none rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
          >
            <Trans>摘掉模板出处</Trans>
          </button>
        )}
      </div>
      {issue && <Warn compact={compact}>{issue}</Warn>}
    </div>
  );
}
