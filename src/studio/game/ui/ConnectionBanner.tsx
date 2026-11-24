// 对局内顶部那条**连接横幅**（2026-11-24，对局内 P0-2 = docs/game-lobby-ui-benchmark.md §2.1 #10）。
//
// ★★ 为什么从"底栏一行小字"改成"顶部横幅"：
//   那行字原来常驻在底栏最下面（「实时连接中」/「实时连接断了，正在用轮询」），两个问题：
//   ① 正常的时候它只是噪音（底栏最该留给阶段条与背包条）；
//   ② 断线的时候它**太安静** —— 玩家以为游戏卡了，其实只是退回轮询。
//   所以：正常不摆；断了 → 顶部细黄条（含旋转图标）；恢复 → 绿条 2 秒自己消失；
//   房间不可用 / 被踢 / 房没了 → 红条 + 一颗「回大厅」。
//
// ★★ 三态与错误码**一个都不在这里判**：判据在 `studio/game/connection.ts`
//   （`bannerOf` / `isRoomGone` / `recoveredOf`，零依赖纯函数，构建门禁直接跑正反例）；
//   话在 `studio/game/roundsReasons.ts`（roundStreamText / roundStreamRecoveredText / roundsNoteText）。
//   这一层只做三件事：数一下"上一拍是什么"（绿条要靠转变）、挂 2 秒定时器、画。
//
// ★ 信息不靠动效：黄条上「正在用轮询」是静态文字，旋转图标只是强调（prefers-reduced-motion 下停转，
//   那句话照样在 —— index.css 末尾登记）。红条给的是一颗真键（回大厅 = quitGameToLobby，
//   与「✕ 结束对局」/ 设置页「退出游戏」同一条路，铁律六）。
//
// ★ 位置：安全区下沿那一条（`top = safe-top + 4px`），**靠左**、撑到 30rem 为止 ——
//   右边那一列是 StudioPage 顶栏的三颗圆键（✕ 结束对局 / ⚙ / 🧩），横幅不许盖住它们。
//   800 上横幅最宽 480px（+左 6px = 486），三颗键从 ~x 590 开始 —— 中间留 100px。
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { bannerOf, RECOVERED_MS, recoveredOf, type BannerKind } from "../connection";
import { roundsNoteText, roundStreamRecoveredText, roundStreamText } from "../roundsReasons";
import { useRounds } from "../roundsStore";
import { quitGameToLobby } from "./quitGame";

export default function ConnectionBanner() {
  const { t } = useLingui();
  const stream = useRounds((s) => s.stream);
  const note = useRounds((s) => s.note);
  const kind = bannerOf({ stream, note });

  /**
   * 绿条：只在「上一拍还是黄条、这一拍恢复正常」时补一条，2 秒后自己消失。
   * ★ prev 用 ref 记（不是 state）：它只是判"有没有恢复"的上一帧，重渲它没有意义。
   * ★ 定时器在卸载 / 下一次变化时收掉（切屏、结束对局不该再冒一条绿条）。
   */
  const prevKind = useRef<BannerKind | null>(null);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    const prev = prevKind.current;
    prevKind.current = kind;
    if (!recoveredOf(prev, kind)) return;
    setRecovered(true);
    const timer = window.setTimeout(() => setRecovered(false), RECOVERED_MS);
    return () => window.clearTimeout(timer);
  }, [kind]);

  // 正常时不打扰：没有横幅、也没有刚恢复的那一下 → 一个像素都不摆
  if (!kind && !recovered) return null;

  const tone = kind === "lost" ? "danger" : kind === "polling" ? "warn" : "ok";
  const toneClass =
    tone === "danger"
      ? "bg-danger-500/95 text-white"
      : tone === "warn"
        ? "bg-warn-400/95 text-ink"
        : "bg-ok-400/95 text-ink";

  // 红条的文案就是 store 里那条原因（roundsReasons 唯一一处说人话）；黄 / 绿各一句
  const text =
    kind === "lost"
      ? note
        ? roundsNoteText(note)
        : t`这一局的联机房间已经结束`
      : kind === "polling"
        ? (roundStreamText(stream) ?? t`实时连接断了，正在用轮询`)
        : roundStreamRecoveredText();

  return (
    <div
      data-game-banner={tone}
      // 红条是"这一局已经不属于你了"，用 alert 抢一次读屏；黄 / 绿是状态（status）。
      role={tone === "danger" ? "alert" : "status"}
      className={`pointer-events-auto absolute left-0 top-[calc(env(safe-area-inset-top,0px)+0.25rem)] z-20 flex h-[clamp(1.1rem,4.6vh,1.6rem)] max-w-[min(100%,30rem)] items-center gap-1.5 rounded-r-xl px-2 text-[10px] leading-none shadow-lg ingame-rise ${toneClass}`}
    >
      {kind === "polling" ? (
        /* 旋转小图标：只动 transform（合成层）；reduce 时停成静态圈，文字照样在 */
        <span aria-hidden className="ingame-spin inline-block h-2 w-2 rounded-full border-[1.5px] border-ink/30 border-t-ink/90" />
      ) : (
        <span aria-hidden className="font-bold">
          {tone === "danger" ? "!" : "✓"}
        </span>
      )}
      <span className="min-w-0 truncate font-semibold">{text}</span>
      {tone === "danger" && (
        <>
          <button
            type="button"
            onClick={() => quitGameToLobby()}
            className="ml-1 flex-none rounded bg-ink/25 px-1.5 py-0.5 text-[10px] font-bold text-white active:bg-ink/40"
          >
            {t`回大厅`}
          </button>
          <button
            type="button"
            onClick={() => useRounds.getState().clearNote()}
            aria-label={t`关掉这条横幅`}
            className="flex-none rounded px-1 text-white/80 active:bg-ink/30"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}
