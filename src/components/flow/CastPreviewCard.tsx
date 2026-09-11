// 白模段的「合成预览图」卡（2026-09-06 对标 LibTV "每镜先出图再出片"）：投影窗 TplSegBody 与画布白模面板**共用一份**。
// 动作在 flowStore.makeCastPreview（报价 = 实收 = 一张图），这里只画：有图显示图 + 说明；没图给一颗带价钱的按钮。
// ★ 预览只回答"站位与形象对不对"，不代表成片画质——文案里必须说，否则用户会拿它当成片挑毛病。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AI_REAL } from "../../ai";
import { ONE_IMAGE, fmtTokens } from "../../data/economy";
import { FlowNode, tplOfNode, useFlow } from "../../studio/flowStore";

export default function CastPreviewCard({
  node,
  cast,
  disabled,
}: {
  node: FlowNode;
  /** 当前段的实时挂卡缓冲（两面都传 store 的那份，理由见画布挂卡按钮上的 ★） */
  cast: Record<string, string>;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const tpl = tplOfNode(node);
  const roles = tpl?.roles ?? [];
  const mounted = roles.filter((r) => cast[r.label]).length;
  const [busy, setBusy] = useState(false);
  if (!tpl?.refVideo || roles.length === 0 || mounted === 0) return null;
  const price = AI_REAL ? fmtTokens(ONE_IMAGE) : t`演示`;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await useFlow.getState().makeCastPreview(node.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
      {node.castPreview ? (
        <>
          <img src={node.castPreview} alt={t`挂卡合成预览`} className="w-full rounded-md" />
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>合成预览：只看站位与形象对不对，不代表成片画质；改了挂法要重新合成</Trans>
          </p>
        </>
      ) : (
        <p className="text-[10px] leading-relaxed text-slate-500"><Trans>出片前先看一眼：把你挂的角色放进白模画面，站位不对这时候改还不花视频钱</Trans></p>
      )}
      <button
        onClick={() => void run()}
        disabled={disabled || busy}
        className="w-full rounded-full border border-slate-600 py-1.5 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
      >
        {busy ? t`合成中…` : node.castPreview ? t`重新合成预览（${price}）` : t`合成预览（${price}）`}
      </button>
    </div>
  );
}
