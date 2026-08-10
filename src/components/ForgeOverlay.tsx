// 出片时压住整屏的「炼卡」浮层：中央看板娘在炼，下方是这一段的步骤日志。
//
// ★ 为什么要压住整屏：一段视频要跑好几步、慢的时候好几分钟。此前这段时间里
//   页面看上去和平时一模一样（只有按钮上一行小字在变），用户会去点别的东西，
//   而那些操作要么被 busy 闸拦掉、要么改的是正在被生成引用的状态。
//   把这几分钟明确划成「她在忙」，比加十个 disabled 更省事也更好懂。
//
// ★ 失败不自动关：日志里卡在哪一步、报了什么，是用户唯一能拿去判断
//   「重试还是改提示词」的依据。自动收走等于把错误咽掉（铁律八）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import GenTrace from "./GenTrace";
import Icon from "./Icon";
import MascotStage from "./MascotStage";
import type { GenStep } from "../studio/genLog";

export type ForgePhase = "forging" | "done" | "failed";

export default function ForgeOverlay({
  phase,
  steps,
  error,
  onClose,
}: {
  phase: ForgePhase;
  steps: GenStep[];
  error?: string;
  onClose: () => void;
}) {
  // 成功：等她把"举牌大笑"这套动作演完，再多留一拍才收场。
  // 立刻收会让人只看到一道闪光，根本没看清发生了什么
  const [animDone, setAnimDone] = useState(false);
  useEffect(() => {
    if (phase !== "done" || !animDone) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
    // onClose 每次渲染都是新函数，放进依赖会让定时器不断重建、永远不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, animDone]);

  const title = phase === "done" ? "本段炼成" : phase === "failed" ? "这一炉没成" : "炼制中…";

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 px-6 backdrop-blur-sm">
      {phase === "done" ? (
        <MascotStage pose="forged" width={250} loop={false} onDone={() => setAnimDone(true)} />
      ) : (
        <MascotStage pose="forge" width={250} loop={phase === "forging"} />
      )}

      <div
        className={`mt-1 text-sm font-bold ${
          phase === "done" ? "text-emerald-300" : phase === "failed" ? "text-rose-300" : "text-slate-100"
        }`}
      >
        {title}
      </div>

      {/* 步骤日志：与节点卡上那份同源（node.steps），所以浮层关掉之后还能回看 */}
      <div className="mt-3 max-h-[34vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white/[0.04] px-3 py-2">
        <GenTrace steps={steps} running={phase === "forging"} expanded />
        {steps.length === 0 && <div className="py-2 text-center text-[11px] text-slate-500">准备中…</div>}
      </div>

      {phase === "failed" && (
        <>
          {error && <p className="mt-2.5 max-w-sm text-center text-[11px] leading-relaxed text-rose-300">{error}</p>}
          <button
            onClick={onClose}
            className="mt-3 flex items-center gap-1.5 rounded-full bg-slate-700/80 px-4 py-2 text-xs text-slate-100"
          >
            <Icon name="close" size={14} />
            知道了
          </button>
        </>
      )}

      {phase === "forging" && (
        <p className="mt-2.5 text-[11px] text-slate-500">整段一炉出，中途离开这一页会中断</p>
      )}
    </div>,
    document.body,
  );
}
