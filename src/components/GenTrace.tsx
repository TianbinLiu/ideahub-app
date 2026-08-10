// 出片过程日志的呈现：一条竖线串起各步，状态点 + 标题 + 耗时，正在跑的那步高亮。
//
// 为什么不是一个百分比进度条：方舟不返回真实完成度，硬编一个百分比只会骗人
// （见 ai/real.ts 的轮询——只有"排队中/生成中 + 已用秒数"）。把**做到哪一步**如实
// 列出来，用户就能自己判断是在正常推进还是真卡住了，也知道钱花在了哪几步上。
import { useEffect, useRef, useState } from "react";
import type { GenStep } from "../studio/genLog";

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function GenTrace({
  steps,
  running,
  className = "",
  expanded,
}: {
  steps: GenStep[];
  /** 整条流程还在跑：跑着时默认展开，跑完自动收起（不占地方，但还能点开回看） */
  running: boolean;
  className?: string;
  /** 给了就是受控常开，并且不渲染「生成过程 ▸」那一行。
   *  出片浮层用它——那一屏本来就只有这份日志，再摆一个折叠开关是多余的一次点击 */
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setOpen(false);
    if (!wasRunning.current && running) setOpen(true);
    wasRunning.current = running;
  }, [running]);

  // 正在跑的那步显示"已经跑了多久"——没有这个读秒，慢的步骤看起来和卡死一模一样
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (steps.length === 0) return null;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const controlled = expanded !== undefined;
  const show = controlled ? expanded : open;

  return (
    <div className={className}>
      {!controlled && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-slate-500"
        >
          <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          生成过程
          <span className="text-slate-600">
            {running ? `· ${doneCount}/${steps.length} 步` : `· 共 ${steps.length} 步`}
          </span>
        </button>
      )}

      {show && (
        <div className="relative mt-1.5 flex flex-col">
          {/* 竖线：垫在所有状态点后面，首尾各让开半个点 */}
          <div className="pointer-events-none absolute bottom-2.5 left-[3px] top-2.5 w-px bg-white/10" />
          {steps.map((s) => {
            const isRun = s.status === "running";
            const isErr = s.status === "error";
            return (
              <div key={s.id} className="relative flex items-start gap-2.5 py-[3px]">
                <span
                  className={`z-10 mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${
                    isRun
                      ? "bg-brand shadow-[0_0_6px_rgba(34,211,238,0.9)] animate-pulse"
                      : isErr
                        ? "bg-rose-500"
                        : "bg-slate-600"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[11.5px] leading-relaxed ${
                      isRun ? "text-slate-200" : isErr ? "text-rose-300" : "text-slate-500"
                    }`}
                  >
                    {s.title}
                    {s.ms != null && <span className="ml-1.5 text-[10px] text-slate-600">· {fmtMs(s.ms)}</span>}
                  </div>
                  {isRun && s.detail && (
                    <div className="text-[10.5px] leading-relaxed text-slate-500">{s.detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
