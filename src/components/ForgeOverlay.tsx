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

/**
 * ★★ `"unknown"` 与 `"failed"` **必须是两个相**：前者是"我们没接到结果，任务多半还在
 *   方舟那边跑、钱已经花了、成片 24 小时内能取回"，后者是"这一发废了"。
 *   把前者画成后者，用户读到的是"没成"，于是去点「重新生成」—— 那是重新下一单、
 *   再花一次钱，而他要的那一段其实好好地存在着（2026-08-18 的 ¥27 就是这么丢的）。
 */
export type ForgePhase = "forging" | "done" | "failed" | "unknown";

export default function ForgeOverlay({
  phase,
  steps,
  error,
  recoverable,
  onClose,
}: {
  phase: ForgePhase;
  steps: GenStep[];
  error?: string;
  /** 这条路上的出片受理之后可以取回（工作流/简约模式都落凭据，见 flowStore.genNode）。
   *  ★ 只影响等待时那句话说不说"可以退出"——说错的代价是两个方向的：说没有的功能是骗人，
   *  不说有的功能等于把用户按在屏幕前二十几分钟 */
  recoverable?: boolean;
  onClose: () => void;
}) {
  // 成功：等她把"举牌大笑"这套动作演完，再多留一拍才收场。
  // 立刻收会让人只看到一道闪光，根本没看清发生了什么
  const [animDone, setAnimDone] = useState(false);
  useEffect(() => {
    if (phase !== "done" || !animDone) return;
    // 1200ms 而不是 900：演完之后接的是 forged-hold 循环（举着牌、光在涨落），
    // 收太快就等于没接。
    const t = setTimeout(onClose, 1200);
    return () => clearTimeout(t);
    // onClose 每次渲染都是新函数，放进依赖会让定时器不断重建、永远不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, animDone]);

  /**
   * ★ 演出是「入场演一次 → 原地循环」两段，不是一套动作无限重播。
   *   原来出片全程只播 forge 一套、`infinite alternate`：手臂张开→收回→再张开→…
   *   —— 把已经聚好的法术又扔回远处重来一遍，在剧情上讲不通。
   *   现在：forge-in 把手从远处收到胸前聚成球（一次）→ forge 停在胸前揉搓（循环）。
   *   炼成同理：forged 举牌（一次）→ forged-hold 举着不动只有光在涨落（循环）。
   *   两段的画面接得上，靠的是生成时后一段的 A 帧就是前一段的 B 帧（design 的 aFrom），
   *   不是靠这里做淡入淡出。
   *
   * ★ intro 要按 phase 重置：失败后重试会从 forging 再来一遍，不重置的话
   *   第二次就直接从循环段开始，"把手收过来"那一下永远看不到了。
   */
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => setIntroDone(false), [phase]);

  const title =
    phase === "done" ? "本段炼成" : phase === "failed" ? "这一炉没成" : phase === "unknown" ? "还没接到成片" : "炼制中…";
  /** 收场的两种相：真失败与"没接到"。画面上的差别只有颜色与措辞，但那正是全部重点 */
  const settled = phase === "failed" || phase === "unknown";
  // key 必须跟着 pose 走：只改 background-image 的话 CSS 动画不会重新起一次，
  // 换段时会停在上一段的进度上
  //
  // ★ 收场态（失败 / 没接到）**不循环**：她得停下来。让"揉搓"在炉子已经停了之后还转个
  //   不停，等于画面在说"还在炼"，而文案在说"没成/没接到"——两边打架。播一遍就定住。
  const stage =
    settled
      ? { pose: "forge" as const, loop: false, onDone: undefined }
      : phase === "done"
        ? introDone
          ? { pose: "forged-hold" as const, loop: true, onDone: undefined }
          : {
              pose: "forged" as const,
              loop: false,
              onDone: () => {
                setIntroDone(true);
                setAnimDone(true);
              },
            }
        : introDone
          ? { pose: "forge" as const, loop: true, onDone: undefined }
          : { pose: "forge-in" as const, loop: false, onDone: () => setIntroDone(true) };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 px-6 backdrop-blur-sm">
      <MascotStage key={stage.pose} pose={stage.pose} width={250} loop={stage.loop} onDone={stage.onDone} />

      <div
        className={`mt-1 text-sm font-bold ${
          phase === "done"
            ? "text-emerald-300"
            : phase === "failed"
              ? "text-rose-300"
              : phase === "unknown"
                ? "text-amber-300"
                : "text-slate-100"
        }`}
      >
        {title}
      </div>

      {/* 步骤日志：与节点卡上那份同源（node.steps），所以浮层关掉之后还能回看 */}
      <div className="mt-3 max-h-[34vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white/[0.04] px-3 py-2">
        <GenTrace steps={steps} running={phase === "forging"} expanded />
        {steps.length === 0 && <div className="py-2 text-center text-[11px] text-slate-500">准备中…</div>}
      </div>

      {settled && (
        <>
          {error && (
            <p
              className={`mt-2.5 max-w-sm text-center text-[11px] leading-relaxed ${
                phase === "unknown" ? "text-amber-200" : "text-rose-300"
              }`}
            >
              {error}
            </p>
          )}
          {/* ★ 「没接到」这一相要把人**领到取回入口去**，而那颗按钮就在浮层背后的动作栏上。
              所以这里的关门键写「去取回这一段」而不是「知道了」——「知道了」在这个语境里
              读起来就是"这事完了"，而它恰恰没完（铁律八：别让还能救的钱看起来已经没了）。 */}
          <button
            onClick={onClose}
            className={`mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs ${
              phase === "unknown" ? "bg-amber-500/90 font-bold text-ink" : "bg-slate-700/80 text-slate-100"
            }`}
          >
            <Icon name="close" size={14} />
            {phase === "unknown" ? "去取回这一段" : "知道了"}
          </button>
        </>
      )}

      {phase === "forging" && (
        <p className="mt-2.5 max-w-sm text-center text-[11px] leading-relaxed text-slate-500">
          {recoverable
            ? // ★ 只承诺**两条路都兑现得了**的那一半：退出这一页再回来一定取得回。
              //   "App 被系统清掉也不要紧"只在工作流成立（节点跟着草稿走），简约模式
              //   本来就不进草稿库 —— 写进这一句就成了对一半用户撒谎。
              "出片最长要等二十几分钟。任务一旦被方舟受理，中途退出这一页不要紧——回这一段点「取回」就能把成片领回来（24 小时内有效，取回不花钱）"
            : "整段一炉出，中途离开这一页会中断"}
        </p>
      )}
    </div>,
    document.body,
  );
}
