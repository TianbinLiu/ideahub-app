// 电影级「样片」那一栏（2026-10-07 主人拍板）—— 投影窗与画布**共用一份**，摆在「修这一段」旁边。
//
// 样片 = 方舟 2.5 的 draft 模式：先花小钱出一段 480p 预览看效果（场景、镜头、动作、提示词意图对不对），满意再把**同一份样片**
// 升成 1080p 成片（不重新抽卡：画面、动作、声音都照样片）；不满意就改了重出样片，省下成片的钱。两步各是一单。
// 三种样子：
//   ① 还没出样片（或这一段现在放的不是样片）：「先出样片」开关 + 两步各多少钱；用不了的说为什么（会员档 / 服务端不支持）并给「去升级」；
//   ② 现在放的是样片：倒计时（方舟样片 7 天有效，我们放到差 1 小时）+「定稿成 1080p」；
//   ③ 现在放的是定稿出来的成片：一句「已定稿」，上一版（样片）在「修这一段」的「还原上一版」里。
// ★ 判据全在 flowStore（nodeDraftOn / draftStageOf / draftFinalIssue / draftFinalQuote）与 account（draftModeOffered / draftModeIssue）：
//   这里只把答案画出来。开关只写 setDraftFirst；定稿由宿主决定走 flowStore.genNode 还是 studioStore.genNodeVideo（工坊那面要顺带收窗）。
// ★ 1080p 成片是 10 bit 的 H.265（方舟官方：2.5 的 1080p 一律 10 bit / HEVC）：个别旧手机放不出来。播放兼容另验（主人 10-07），
//   不转码 —— 但要在按钮旁边说出来（铁律八）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AI_REAL } from "../../ai";
import { draftModeIssue, draftModeOffered } from "../../data/account";
import { draftFinalTokens, draftStepTokens, fmtTokens, tierOf } from "../../data/economy";
import { aspectOf } from "../../types";
import {
  chosenOf,
  draftFinalIssue,
  draftFinalQuote,
  draftStageOf,
  draftValidLeft,
  nodeDraftEligible,
  useFlow,
  type FlowNode,
} from "../../studio/flowStore";
import UpgradeLink from "../UpgradeLink";

export default function DraftModeBox({
  node,
  disabled,
  onFinalize,
}: {
  node: FlowNode;
  disabled?: boolean;
  /** 定稿真跑：宿主决定走 flowStore.genNode 还是 studioStore.genNodeVideo（opts.finalizeDraft） */
  onFinalize: () => void;
}) {
  const { t } = useLingui();
  // 倒计时要真的在走（一条永远停在「还剩 3 天」的提示比不显示更坏）：一分钟重算一次
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const prop = chosenOf(node);
  const stage = draftStageOf(prop);
  const tier = tierOf(node.videoTier);
  const offered = draftModeOffered(tier) && nodeDraftEligible(node);
  if (!stage && !offered) return null;

  // 「先出样片」开关（三种样子都摆：样片 / 成片在屏幕上时，它管的是下一次「重新生成」出不出样片）
  const ratio = aspectOf(node.aspect).ratio;
  const blocked = draftModeIssue(tier);
  const toggle = offered ? (
    <>
      <label className="flex items-center gap-1.5 text-[11px] text-slate-200">
        <input
          type="checkbox"
          className="accent-brand"
          checked={!!node.draftFirst && !blocked}
          disabled={!!blocked || disabled || node.status === "generating"}
          onChange={(e) => useFlow.getState().setDraftFirst(node.id, e.target.checked)}
        />
        {stage ? <Trans>📼 重新生成时也先出样片</Trans> : <Trans>📼 先出样片（480p 预览，满意再定稿成 1080p）</Trans>}
      </label>
      {blocked && (
        <p className="text-[10px] leading-relaxed text-amber-200">
          {blocked} <UpgradeLink />
        </p>
      )}
    </>
  ) : null;

  // ③ 已定稿
  if (stage === "final") {
    return (
      <div className="space-y-1 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
        <p className="text-[11px] leading-relaxed text-emerald-300">
          <Trans>✓ 已定稿成 1080p。上一版（480p 样片）在「修这一段」的「还原上一版」里。</Trans>
        </p>
        {toggle}
      </div>
    );
  }

  // ② 现在放的是样片：倒计时 + 定稿
  if (stage === "draft") {
    const left = draftValidLeft(prop);
    const issue = draftFinalIssue(node);
    const price = AI_REAL ? fmtTokens(draftFinalQuote(prop)) : t`演示`;
    const days = Math.floor(left / 86_400_000);
    const hours = Math.floor((left % 86_400_000) / 3_600_000);
    const mins = Math.max(1, Math.floor((left % 3_600_000) / 60_000));
    return (
      <div className="space-y-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-2">
        <p className="text-xs font-semibold text-sky-200">
          <Trans>📼 这是 480p 样片</Trans>
        </p>
        <p className="text-[11px] leading-relaxed text-sky-200/90">
          {left <= 0 ? (
            <Trans>样片已经过了 7 天有效期，不能再定稿了——要成片就重新生成（会重新计费）。</Trans>
          ) : days > 0 ? (
            <Trans>看着满意就定稿：把这同一份样片升成 1080p 成片（画面、动作、声音都照样片，不重新抽卡）。还剩 {days} 天 {hours} 小时可以定稿。</Trans>
          ) : hours > 0 ? (
            <Trans>看着满意就定稿：把这同一份样片升成 1080p 成片（画面、动作、声音都照样片，不重新抽卡）。还剩 {hours} 小时可以定稿。</Trans>
          ) : (
            <Trans>看着满意就定稿：把这同一份样片升成 1080p 成片（画面、动作、声音都照样片，不重新抽卡）。还剩 {mins} 分钟可以定稿。</Trans>
          )}
        </p>
        {issue && left > 0 && (
          <p className="text-[11px] leading-relaxed text-amber-200">
            {issue} <UpgradeLink />
          </p>
        )}
        {left > 0 && (
          <button
            onClick={() => !issue && !disabled && onFinalize()}
            disabled={!!issue || disabled}
            className="w-full rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
          >
            <Trans>⬆ 定稿成 1080p（{price}）</Trans>
          </button>
        )}
        <p className="text-[10px] leading-relaxed text-slate-500">
          <Trans>不满意就改了重新出样片（每次按样片的价）。1080p 成片是 H.265（10 位色深）编码，个别旧手机可能放不出来。</Trans>
        </p>
        {toggle}
      </div>
    );
  }

  // ① 还没出样片：开关 + 两步各多少钱
  const step1 = AI_REAL ? fmtTokens(draftStepTokens(prop.durationSec, ratio)) : t`演示`;
  const step2 = AI_REAL ? fmtTokens(draftFinalTokens(prop.durationSec, ratio)) : t`演示`;
  return (
    <div className="space-y-1 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
      {toggle}
      {!blocked && (
        <p className="text-[10px] leading-relaxed text-slate-500">
          <Trans>
            样片 {step1}（视频那一半，出片前补画的画面另算），看效果对不对；满意再花 {step2} 把同一份样片升成 1080p。不满意就改了重出样片，省下成片的钱。样片 7 天内可以定稿。
          </Trans>
        </p>
      )}
    </div>
  );
}
