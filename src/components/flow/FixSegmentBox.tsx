// 「修这一段」—— 已出片的段上那一栏（2026-10-05 第一批：片段重拍 + 往后延长；方案 docs/canvas-platforms-ecosystem-research.md §五，
// 主人 10-05「按你的建议做第一批」：「修这一段」挂在已出片的段上、不进「加一段」的选法屏）。投影窗与画布**共用一份**。
//
// 两件事：
//   ✎ 片段重拍（原「返修这一段」，2026-09-06 对标 LibTV 片段重拍）：本段成片当参考视频走 edit，只改作者写的地方；可以只改其中几秒
//     （写法照官方 2.5 提示词指南「把视频 1 中 4-6 秒……」，segmentGen.revisePlotOf）。2026-10-05 起出声（arkClient.REVISE_TASK）。
//     动作在 flowStore.genNode(opts.revise)，宿主决定走 genNode 还是 studioStore.genNodeVideo（工坊那面要顺带收窗）。
//   ⏩ 往后延长：接着这一段的最后一帧往后拍几秒，新拍的那一截单独成一段（产物只有新的一截，官方示例量过）。
//     只给最后一段（判据 flowStore.extendIssue 一处）；落段在 flowStore.extendNode、价钱拿「真会落下的那一段」问 appendQuote。
// ★ 三件事必须说在按钮旁边（铁律八）：按 r2v 计价（重拍：输入 = 成片时长 × 2；延长：输入 + 输出）；只留最近一版可还原（重拍）；
//   声音与「只改几秒」各说到哪一步为止 —— 都是 2026-10-05 付费探测 U3（design/video-input-probe.mjs，电影级）看出来的：
//   ① 出声时原片的声音是**照着重做**的（同样位置的敲击声与纸声、纹理不完全一样、响度低约 1 LU），不是原样保留；
//   ② 写「只改第 2-3 秒换红手套」，红手套从手第 1 秒一入画就换上了、一直到第 3 秒 —— 同一个连续的动作模型会整段一起改，
//      不会在第 2 秒处硬切；开头的礼盒与结尾的特写没动。所以文案说「主要改」「尽量照原样」，不许诺只动那几秒。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AI_REAL } from "../../ai";
import { durationChoices, fmtTokens, r2vPriceIssue, r2vTokens, tierOf } from "../../data/economy";
import {
  appendQuote,
  chosenOf,
  extendIssue,
  extendSpec,
  realVideoOfNode,
  reviseSecOf,
  useFlow,
  type FlowNode,
} from "../../studio/flowStore";

/** 延长缺省拍几秒（按档位的窗口夹，economy.durationChoices 摆的那几个里选） */
const EXTEND_DEFAULT_SEC = 5;
/** 改法 / 接下来发生什么的长度：都只是一两句话（提示词总长由出片那一侧按档位兜底） */
const ASK_MAX = 120;

export default function FixSegmentBox({
  node,
  disabled,
  onRevise,
  onExtend,
}: {
  node: FlowNode;
  disabled?: boolean;
  /** 片段重拍真跑：宿主决定走 flowStore.genNode 还是 studioStore.genNodeVideo（工坊那面要顺带收窗） */
  onRevise: (instruction: string, range: { from: number; to: number } | null) => void;
  /** 往后延长：宿主调 flowStore.extendNode 落段，再接着出片（同上：两面各走各的出片入口） */
  onExtend: (text: string, durationSec: number) => void;
}) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  /** 展开哪一件（两件都收着时只摆一行小标题 + 两颗键，别让每一段已出片的卡下面都拖一大块） */
  const [open, setOpen] = useState<"revise" | "extend" | null>(null);
  const [text, setText] = useState("");
  const [ranged, setRanged] = useState(false);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(2);
  const [extText, setExtText] = useState("");
  const [extSec, setExtSec] = useState<number | null>(null);
  const prop = chosenOf(node);
  const video = realVideoOfNode(node);
  if (!video) return null;
  const tier = tierOf(node.videoTier);
  const index = nodes.findIndex((n) => n.id === node.id);
  const isLast = index >= 0 && index === nodes.length - 1;

  // ── 片段重拍 ──
  const priceIssue = r2vPriceIssue(node.videoTier);
  const sec = reviseSecOf(prop);
  const reviseCost = r2vTokens(sec, node.videoTier);
  const a = Math.max(0, Math.min(from, sec - 1));
  const b = Math.max(a + 1, Math.min(to, sec));
  const range = ranged ? { from: a, to: b } : null;
  const canRevise = !priceIssue && reviseCost !== null && text.trim().length > 0 && !disabled;
  const revisePrice = AI_REAL && reviseCost !== null ? fmtTokens(reviseCost) : t`演示`;

  // ── 往后延长 ──
  const extIssue = isLast ? extendIssue(nodes, index) : null;
  const choices = durationChoices(node.videoTier).filter((s) => s >= tier.minSec);
  const outSec = extSec ?? (choices.includes(EXTEND_DEFAULT_SEC) ? EXTEND_DEFAULT_SEC : (choices[0] ?? EXTEND_DEFAULT_SEC));
  const spec = isLast && !extIssue ? extendSpec(nodes, index, { text: extText || " ", durationSec: outSec }) : null;
  const extCost = spec ? appendQuote(nodes, mode, spec) : 0;
  const extPrice = AI_REAL ? fmtTokens(extCost) : t`演示`;
  /** 计价输入（被延长那一段的时长）：extendSpec 记下的那个数，落段之后 nodeCost / genNode 经 extendSourceOf 读到的也是它 */
  const inSec = spec?.extendFrom?.durationSec ?? sec;
  const canExtend = !!spec && extText.trim().length > 0 && !disabled;

  const chip = (k: "revise" | "extend", label: string) => (
    <button
      onClick={() => setOpen(open === k ? null : k)}
      className={`rounded-full px-3 py-1 text-[11px] ${open === k ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-slate-300">
          <Trans>修这一段</Trans>
        </span>
        {chip("revise", t`✎ 片段重拍`)}
        {isLast && chip("extend", t`⏩ 往后延长`)}
        {prop.prevVideoUrl && (
          <button
            onClick={() => useFlow.getState().restoreProposalVideo(node.id)}
            disabled={disabled}
            className="ml-auto rounded-full border border-slate-600 px-3 py-1 text-[11px] text-slate-300 disabled:opacity-40"
          >
            <Trans>还原上一版</Trans>
          </button>
        )}
      </div>

      {open === "revise" &&
        (priceIssue ? (
          <p className="text-[11px] leading-relaxed text-amber-200">{priceIssue}</p>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={ASK_MAX}
              disabled={disabled}
              placeholder={t`改哪里？例：把背景换成雨夜 / 去掉右上角的台标 / 主角衣服换成红色`}
              className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input type="checkbox" checked={ranged} onChange={(e) => setRanged(e.target.checked)} disabled={disabled} className="accent-brand" />
              <Trans>只改其中几秒</Trans>
            </label>
            {ranged && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                <Trans>从第</Trans>
                <input
                  type="number"
                  min={0}
                  max={sec - 1}
                  value={a}
                  onChange={(e) => setFrom(Math.floor(Number(e.target.value) || 0))}
                  disabled={disabled}
                  className="w-14 rounded-lg border border-slate-700 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand"
                />
                <Trans>秒到第</Trans>
                <input
                  type="number"
                  min={1}
                  max={sec}
                  value={b}
                  onChange={(e) => setTo(Math.floor(Number(e.target.value) || 0))}
                  disabled={disabled}
                  className="w-14 rounded-lg border border-slate-700 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand"
                />
                <Trans>秒（这一段共 {sec} 秒）</Trans>
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-slate-500">
              {ranged ? (
                <Trans>
                  拿这一段成片当参考视频重拍，主要改第 {a}~{b} 秒里你写的地方，其余几秒尽量照原样（同一个连续的动作常会整段一起改）；整段一起重新生成（时长跟随成片 {sec}s，按整段计价），出声（原片的声音会照着重做，接近但不完全一样）；上一版留一份可还原
                </Trans>
              ) : (
                <Trans>拿这一段成片当参考视频重拍，只改你写的地方；时长跟随成片（{sec}s），出声（原片的声音会照着重做，接近但不完全一样）；上一版留一份可还原</Trans>
              )}
            </p>
            <button
              onClick={() => canRevise && onRevise(text.trim(), range)}
              disabled={!canRevise}
              className="w-full rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
            >
              <Trans>✎ 重拍这一段（{revisePrice}）</Trans>
            </button>
          </>
        ))}

      {open === "extend" && isLast &&
        (extIssue ? (
          <p className="text-[11px] leading-relaxed text-amber-200">{extIssue}</p>
        ) : (
          <>
            <textarea
              value={extText}
              onChange={(e) => setExtText(e.target.value)}
              rows={2}
              maxLength={ASK_MAX}
              disabled={disabled}
              placeholder={t`接下来发生什么？例：她转身走向门口，推开门，外面在下雨`}
              className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <div className="flex flex-wrap gap-1.5">
              {choices.map((s) => (
                <button
                  key={s}
                  onClick={() => setExtSec(s)}
                  disabled={disabled}
                  className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${s === outSec ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {s}s
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>
                接着这一段的最后一帧往后拍 {outSec} 秒，画面和声音接上；新拍的这一截单独成一段，接在最后。挂的人物卡照样一起发，锁住长相。按输入 {inSec} 秒 + 输出 {outSec} 秒计价
              </Trans>
            </p>
            <button
              onClick={() => canExtend && onExtend(extText.trim(), outSec)}
              disabled={!canExtend}
              className="w-full rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
            >
              <Trans>⏩ 往后延长 {outSec} 秒（{extPrice}）</Trans>
            </button>
          </>
        ))}
    </div>
  );
}
