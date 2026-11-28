// 匹配中（C · 沉浸全屏）—— 2026-11-27，design/ui-mockups/match-ui-variants 的 C 案（searching）。
//
// 这一屏只做一件事：把「在月亮底下等一桌人」演出来。
//   · 月亮是 3D 场景里那一枚（不是 DOM 画的）—— 相机在匹配页机位，月亮落在画面正中；
//     三圈呼吸光环按 `moonAlign.moonScreenRect` 投出来的屏幕圆对齐它（同心、同半径）。
//   · UI 全部收到屏幕边缘：顶部一条窄带（工坊返回 / 状态 / 已排队与池子人数）、
//     底部一条窄带（这一池人数与说明 / 大秒表 / 取消），中间只剩月亮和光环。
//   · 原有匹配状态一个不少：队列人数（queue.queued / need）、预计等待（etaSec）、
//     60 秒上限、超时退回 AI、AI 补位、取消 —— 只是换了皮，判定与数据都还在 store / 这里现算。
//
// ★ 与 3D 月对齐的容器：`data-lobby-moon-halo`，带 data-moon-cx / cy / r，
//   验收脚本可以直接读它与 `__lobbyMoonRect()` 的投影值对一遍（同一个函数算的）。
// ★ 取消 = 安全操作（不加确认）：底部一颗键，与顶部「‹ 工坊」走同一个 handler。
// ★ 热区：顶部返回与底部取消都是 h-11（44），其余是纯读数。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MatchSize } from "../lobby";
import { QUEUE_TIMEOUT_MS, type LobbyNote } from "../lobbyStore";
import { lobbyNoteText } from "../lobbyReasons";
import { useMoonRect } from "./moonAlign";

export interface SearchingCProps {
  size: MatchSize;
  online: boolean;
  queue: { queued: number; need: number; etaSec: number | null } | null;
  note: LobbyNote | null;
  busy: boolean;
  matchStartedAt: number;
  /** 3D 的窗与月亮在屏上（匹配页机位）。关着 / 老场景时没有月可对齐，光环不画。 */
  windowVisible: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/** mm:ss（00:23）。负数 / NaN 一律当 0。 */
function clockText(sec: number): string {
  const s = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function SearchingC({
  size,
  online,
  queue,
  note,
  busy,
  matchStartedAt,
  windowVisible,
  onStart,
  onCancel,
}: SearchingCProps) {
  const { t } = useLingui();
  const { ref, rect: moon } = useMoonRect<HTMLDivElement>();
  const timedOut = note?.kind === "queue-timeout";
  // 已排队的读秒：秒级重渲（只在联机等匹配时走；本机那一屏没有"排队"这回事）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [online]);
  const waitedSec = matchStartedAt > 0 ? Math.max(0, Math.floor((now - matchStartedAt) / 1_000)) : 0;
  // ★ 离线（没连上房间服务 / 超时退回）没有"排队"这回事：时钟写成 --:--、标签写「未排队」，
  //   不拿一个 00:00 冒充"排了 0 秒"。队列字段（queued / need / etaSec）只在 online 时念。
  const clock = online ? clockText(waitedSec) : "--:--";
  /**
   * 预计等待：`etaSec` 有就念（≥60 秒写成「x 分 xx 秒」）；没有就照 60 秒上限说"最多"。
   * ★ 不把 etaSec 与 60 秒上限取 min：服务端只是估算，客户端那个上限是兜底，两件事。
   */
  const etaText =
    typeof queue?.etaSec === "number"
      ? queue.etaSec >= 60
        ? t`预计 ${Math.floor(queue.etaSec / 60)} 分 ${String(queue.etaSec % 60).padStart(2, "0")} 秒`
        : t`预计 ${Math.max(1, Math.floor(queue.etaSec))} 秒`
      : t`预计最多 ${Math.floor(QUEUE_TIMEOUT_MS / 60_000)} 分 00 秒`;
  const pool = online && queue ? `${queue.queued}/${queue.need || size}` : "";
  const seatCount = size;
  const litSeats = online && queue ? Math.max(1, Math.min(seatCount, queue.queued)) : 1;

  return (
    <div ref={ref} className="absolute inset-0 z-[2] overflow-hidden" data-lobby-screen="searching-c">
      {/* 中间那一层：月亮的冷光晕 + 三圈呼吸光环 + 座位点。pointer-events-none，不挡任何点击。 */}
      {windowVisible && moon && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
          {/* 月外的大光晕（不参与对齐：它只是把月亮的亮度抹开一层） */}
          <span
            className="lobby-c-halo"
            style={{
              left: moon.cx,
              top: moon.cy,
              width: moon.r * 9.6,
              height: moon.r * 9.6,
            }}
          />
          <div
            data-lobby-moon-halo
            data-moon-cx={Math.round(moon.cx * 10) / 10}
            data-moon-cy={Math.round(moon.cy * 10) / 10}
            data-moon-r={Math.round(moon.r * 10) / 10}
            className="absolute"
            style={{ left: moon.cx, top: moon.cy, width: 0, height: 0 }}
          >
            {[1.22, 1.51, 1.85].map((k, i) => (
              <i
                key={k}
                className="lobby-moon-ring absolute left-0 top-0 rounded-full"
                style={{
                  width: moon.r * 2 * k,
                  height: moon.r * 2 * k,
                  marginLeft: -moon.r * k,
                  marginTop: -moon.r * k,
                  animationDelay: `${i * 0.6}s`,
                  opacity: 0.85 - i * 0.22,
                }}
              />
            ))}
            {/* 座位点：我 = 亮；已入池的真人 = 亮；其余 = 暗（AI 补位在超时后会亮起来） */}
            {Array.from({ length: seatCount }, (_, i) => {
              const angle = (-90 + (360 / seatCount) * i) * (Math.PI / 180);
              const radius = moon.r * 1.225;
              const lit = i < litSeats;
              return (
                <i
                  key={i}
                  className={`lobby-c-seat absolute rounded-full ${i === 0 ? "is-me" : ""} ${lit && i !== 0 ? "is-lit" : ""}`}
                  style={{
                    left: Math.cos(angle) * radius,
                    top: Math.sin(angle) * radius,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 顶部窄带：‹ 工坊 · 匹配中 / 已排队 · 池子人数 */}
      <div
        className="lobby-c-top absolute inset-x-0 top-0 z-[3] flex items-end justify-between gap-3 px-4 pb-2"
        style={{ paddingTop: "var(--safe-float-top)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            aria-label={t`取消匹配并返回工坊`}
            className="lobby-c-back h-11 min-w-[2.75rem] justify-center px-1"
          >
            <span aria-hidden>‹</span>
            <Trans>工坊</Trans>
          </button>
          <span className="lobby-c-status truncate">
            <i aria-hidden className={online ? "" : "is-off"} />
            {online ? <Trans>匹配中 · {size} 人局</Trans> : <Trans>AI 补位 · {size} 人局</Trans>}
          </span>
        </div>
        <div className="lobby-c-readout flex-none text-right">
          <div className="tabular-nums">{online ? <Trans>已排队 {clock}</Trans> : <Trans>未排队</Trans>}</div>
          <div className="lobby-c-sub tabular-nums">
            {online && queue ? (
              <Trans>
                这一池 {pool} 人
              </Trans>
            ) : (
              <Trans>AI 补位</Trans>
            )}
          </div>
        </div>
      </div>

      {/* 底部窄带：这一池 / 大秒表 / 取消（联机时只有一颗键；退回 AI 时多给一颗开局主键） */}
      <div className="lobby-c-bottom absolute inset-x-0 bottom-0 z-[3] flex items-center gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[11px] font-semibold">
            {online ? (
              <Trans>这一池 {pool} 人</Trans>
            ) : busy ? (
              <Trans>正在连接房间服务…</Trans>
            ) : timedOut ? (
              <Trans>没匹配到真人，先用 AI 开局。</Trans>
            ) : (
              <Trans>没连上房间服务：这一局 {size - 1} 个座位由 AI 陪玩补齐。</Trans>
            )}
          </b>
          <span className="lobby-c-sub block truncate">
            {online ? (
              <Trans>正在等真人；没等到就先用 AI 开局。</Trans>
            ) : note ? (
              lobbyNoteText(note)
            ) : (
              <span className="tabular-nums">
                <Trans>{size - 1} 个 AI 座位</Trans>
              </span>
            )}
          </span>
        </div>
        <div className="lobby-c-clock flex flex-none items-baseline gap-2">
          <b className="tabular-nums">{clock}</b>
          <span>{online ? <Trans>已排队</Trans> : <Trans>未排队</Trans>}</span>
          <em className="tabular-nums">{online ? etaText : <Trans>AI 陪玩补位</Trans>}</em>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {!online && (
            <button
              type="button"
              onClick={onStart}
              disabled={busy}
              className="lobby-c-cta h-11 px-4 disabled:opacity-40"
            >
              <Trans>用 AI 开局</Trans>
            </button>
          )}
          {online ? (
            <button type="button" onClick={onCancel} className="lobby-c-cancel h-11 px-4">
              <Trans>取消匹配</Trans>
            </button>
          ) : (
            <button type="button" onClick={onCancel} className="lobby-c-back h-11 min-w-[2.75rem] justify-center px-2">
              <Trans>取消</Trans>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
