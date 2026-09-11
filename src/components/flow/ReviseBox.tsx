// 「返修这一段」（2026-09-06 对标 LibTV 片段重拍 / updream 问题视频返修）：对已出片的一段说一句改法，
// 本段成片当参考视频走 edit，其余画面 / 人物 / 运镜 / 时长不变。投影窗与画布**共用一份**；动作在 flowStore.genNode(opts.revise)。
// ★ 三句话必须说在按钮旁边（铁律八）：按 r2v 计价（输入 = 成片时长）；产物无声（edit 不出声，合并时可外挂音轨）；只留最近一版可还原。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AI_REAL } from "../../ai";
import { fmtTokens, r2vPriceIssue, r2vTokens } from "../../data/economy";
import { FlowNode, chosenOf, realVideoOfNode, reviseSecOf, useFlow } from "../../studio/flowStore";

export default function ReviseBox({
  node,
  disabled,
  onRun,
}: {
  node: FlowNode;
  disabled?: boolean;
  /** 真跑：宿主决定走 flowStore.genNode 还是 studioStore.genNodeVideo（工坊那面要顺带收窗） */
  onRun: (instruction: string) => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState("");
  const prop = chosenOf(node);
  const video = realVideoOfNode(node);
  if (!video) return null;
  const priceIssue = r2vPriceIssue(node.videoTier);
  const sec = reviseSecOf(prop);
  const cost = r2vTokens(sec, node.videoTier);
  const canRun = !priceIssue && cost !== null && text.trim().length > 0 && !disabled;
  const price = AI_REAL && cost !== null ? fmtTokens(cost) : t`演示`;
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
      <p className="text-xs font-semibold text-slate-300"><Trans>✎ 返修这一段</Trans></p>
      {priceIssue ? (
        <p className="text-[11px] leading-relaxed text-amber-200">{priceIssue}</p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={120}
            disabled={disabled}
            placeholder={t`改哪里？例：把背景换成雨夜 / 去掉右上角的台标 / 主角衣服换成红色`}
            className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>拿这一段成片当参考视频重拍，只改你写的地方；时长跟随成片（{sec}s），产物<b>无声</b>（合并时可外挂音轨）；上一版会留一份可还原</Trans>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => canRun && onRun(text.trim())}
              disabled={!canRun}
              className="flex-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
            >
              <Trans>✎ 返修（{price}）</Trans>
            </button>
            {prop.prevVideoUrl && (
              <button
                onClick={() => useFlow.getState().restoreProposalVideo(node.id)}
                disabled={disabled}
                className="flex-none rounded-full border border-slate-600 px-3 py-1.5 text-[11px] text-slate-300 disabled:opacity-40"
              >
                <Trans>还原上一版</Trans>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
