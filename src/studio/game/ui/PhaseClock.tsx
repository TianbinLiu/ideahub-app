// 回合「已进行时间」（2026-11-24，对局内 P0-3 = docs/game-lobby-ui-benchmark.md §2.1 #6 的前半）。
//
// ★★ 这是**本地计时，不是服务端给的截止时间**：服务端的回合契约里没有 `phaseEndsAt`
//   （api/game/rounds.ts 的 RemoteRound 只有 round / phase / entries / allSubmitted /
//   likesPending / votesPending），所以：
//   · 只显示「本回合 0:42」——**已进行**多久；
//   · **不做倒计时**（不写"还剩 xx 秒"，哪怕估一个也不行：那是拿本机时钟冒充服务端时间，
//     两台设备的数必然不同，等于给玩家一个不会到点的承诺）；
//   · 起点 = 本机看到这一阶段的第一帧；**阶段一切换就归零**（判据在 phaseClock.clockKeyOf 一处）。
//
// ★ 为什么单开一个组件（而不是塞进 PhaseBar 的 state）：
//   它每一秒 setState 一次。挂在阶段条内部的话，整条阶段条（含那颗推进键与所有文案）
//   会跟着每秒重渲一次；单开一个叶子组件，React 只重渲这一行字。
// ★ 卸载 / 换阶段时把定时器收掉：阶段条在事件屏 / 结算屏会被别的屏替掉，留着的话
//   定时器会对着一个已经卸掉的组件每秒 setState 一次。
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { clockKeyOf, elapsedMsOf, formatElapsed } from "../phaseClock";

/**
 * @param timeOnly 只画那个时间（顶栏 A 案的「计时」那一格：标签由外层给，这里只放数字）。
 *   ★ 2026-11-28（feat/ui-game-hud-a）：计时从底部阶段条搬到顶栏，阶段条那一行不再摆它 ——
 *     一屏里只有一处时钟（两处各摆一个就会有两种"本阶段从哪算起"的猜法）。
 *   ★ 读屏那两句（title / aria）两条路都保留：数字本身不说明"这是已进行多久"。
 */
export default function PhaseClock({
  round,
  phase,
  timeOnly = false,
}: {
  round: number;
  phase: string;
  timeOnly?: boolean;
}) {
  const { t } = useLingui();
  const key = clockKeyOf(round, phase);
  /**
   * 这一段的起点。★ 用 ref 而不是 state：换阶段那一刻要**立刻**归零，走 state 会多一帧
   * （那一帧显示的是上一阶段秒数，看起来像没清零）。渲染期改 ref 只在 key 变了时发生。
   */
  const start = useRef<{ key: string; at: number }>({ key, at: Date.now() });
  if (start.current.key !== key) start.current = { key, at: Date.now() };

  /** 每秒重渲一次（`now` 只是"让我再算一遍"的触发器，不参与格式化） */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [key]);

  const elapsed = formatElapsed(elapsedMsOf(now, start.current.at));

  return (
    <span
      data-game-clock="1"
      // 读屏读全：屏幕上那三个字（本回合）在计时口径上是"这一阶段"，说明写在 title 里
      title={t`本地计时：从进入这个阶段算起，阶段一换就归零。服务器没给截止时间，所以这不是倒计时。`}
      className={`flex-none tabular-nums ${timeOnly ? "text-[12px] leading-none text-[#cbbfa8]" : "rounded px-1 text-[10px] leading-none text-slate-400"}`}
    >
      {timeOnly ? elapsed : t`本回合 ${elapsed}`}
    </span>
  );
}
