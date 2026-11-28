// 加载页（B · 卡片桌游）—— 2026-11-27，design/ui-mockups/match-ui-variants 的 B 案（loading）。
//
// 「正在铺桌」：三张发牌顺序的厚卡（AI 补位 → 选风格 → 锁定）+ 窗外一圈黄铜进度环 + 取消开局。
//
// ★ 这一屏是**开局前的过场**（Lobby 在 startFromLobby 之前播 ~1.5 s）：
//   · 进度环的百分比 = 这段过场自己的计时，不是服务端 / 规则层的进度（别把它当事实读）；
//   · 01 AI 补位：过场走完才真的调 startFromLobby（那时 AI 补位发生），所以它写成"准备补 N 个空座"；
//   · 02 选风格 / 03 锁定：接下来在游戏里发生的事（StylePick 先选、选完锁死），这里只提示顺序；
//   · 取消 = 过场取消，什么都没发出去（startFromLobby 还没调）—— 回大厅首屏。
// ★ 黄铜进度环与匹配中（C）的光环共用 `moonAlign.useMoonRect`：同一个屏幕圆，
//   有 3D 窗时套在月亮外面；没窗（从房间开局）时它就是一块居中的铜环徽记。
// ★ 热区：取消开局 h-11（44）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useMoonRect } from "./moonAlign";

export interface DealingBProps {
  /** 座位数（4 / 8，或自定义房间 2~8） */
  size: number;
  /** 0..1：这段过场走了多少（见文件头的 ★：不是服务端进度） */
  progress: number;
  /** 3D 的窗与月亮在屏上（匹配中 → 加载页时在；从房间开局时不在） */
  windowVisible: boolean;
  onCancel: () => void;
}

/** 发牌三步：01 AI 补位 → 02 选风格 → 03 锁定（与设计稿同名）。 */
const STAGE_KEYS = ["ai", "style", "lock"] as const;

export default function DealingB({ size, progress, windowVisible, onCancel }: DealingBProps) {
  const { t } = useLingui();
  const { ref, rect: moon } = useMoonRect<HTMLDivElement>();
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const aiSeats = Math.max(1, size - 1);
  // 01 完成 → 02 进行 → 03 等待。过场只有一次"当前"，不给 03 假装进行中（60 秒内就进游戏了）。
  const stepNow = progress < 0.34 ? 0 : 1;

  return (
    <div ref={ref} className="absolute inset-0 z-[3]" data-lobby-screen="dealing-b">
      {/* 黄铜进度环：与 3D 月亮同心（windowVisible 时套在月亮外；否则是居中的徽记） */}
      {moon && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
          <div
            data-lobby-moon-emblem
            data-moon-cx={Math.round(moon.cx * 10) / 10}
            data-moon-cy={Math.round(moon.cy * 10) / 10}
            data-moon-r={Math.round(moon.r * 10) / 10}
            className="lobby-load-emblem absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: moon.cx,
              top: moon.cy,
              width: windowVisible ? moon.r * 2 : Math.min(190, moon.r * 1.8),
              height: windowVisible ? moon.r * 2 : Math.min(190, moon.r * 1.8),
            }}
          >
            <span
              className="lobby-brass-ring"
              style={{
                // conic-gradient 的填充比例（--p 只在这里读；mask 在 index.css 一处）
                ["--p" as string]: `${Math.max(0, Math.min(1, progress)) * 100}%`,
                inset: windowVisible ? -18 : -10,
              }}
            />
          </div>
        </div>
      )}

      {/* 顶部：LOADING · 第 1 回合 · 开局准备 / 正在铺桌 / 第 2 / 3 步 */}
      <header
        className="absolute inset-x-0 top-0 z-[3] flex items-start justify-between gap-3 px-4"
        style={{ paddingTop: "var(--safe-float-top)" }}
      >
        <div className="min-w-0">
          <span className="lobby-eyebrow">
            <Trans>LOADING · 第 1 回合 · 开局准备</Trans>
          </span>
          <h1 className="lobby-serif mt-1 text-[19px] font-semibold leading-none tracking-[0.08em] text-[#f8efdd] drop-shadow-[0_1px_0_rgba(0,0,0,0.55)]">
            <Trans>正在铺桌</Trans>
          </h1>
        </div>
        <div className="lobby-eyebrow flex flex-none items-center gap-1.5 pt-1">
          <i aria-hidden className="lobby-dot is-ok" />
          <Trans>第 {stepNow + 1} / 3 步</Trans>
        </div>
      </header>

      {/* 左列：发牌顺序（三张厚卡） */}
      <section className="absolute bottom-4 left-4 z-[2] w-[min(18.25rem,34vw)]" aria-label={t`发牌顺序`}>
        <span className="lobby-eyebrow block">
          <Trans>发牌顺序</Trans>
        </span>
        <ol className="mt-2 flex flex-col gap-1.5">
          {STAGE_KEYS.map((key, i) => {
            const done = i < stepNow;
            const now = i === stepNow;
            return (
              <li key={key} className={`lobby-stage-card ${done ? "is-done" : ""} ${now ? "is-now" : ""}`}>
                <span aria-hidden className="lobby-seal">
                  {`0${i + 1}`}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">
                    {key === "ai" ? (
                      <Trans>AI 补位</Trans>
                    ) : key === "style" ? (
                      <Trans>选风格</Trans>
                    ) : (
                      <Trans>锁定</Trans>
                    )}
                  </b>
                  <em className="block truncate">
                    {key === "ai" ? (
                      done ? (
                        <Trans>{aiSeats} 个空座已补齐</Trans>
                      ) : (
                        <Trans>{aiSeats} 个空座 · 正在补</Trans>
                      )
                    ) : key === "style" ? (
                      <Trans>整局风格由你选一张风格卡</Trans>
                    ) : (
                      <Trans>锁定后这一局不可更改</Trans>
                    )}
                  </em>
                </span>
                <i className="lobby-stage-state">
                  {done ? (
                    <Trans>完成 ✓</Trans>
                  ) : now ? (
                    <Trans>进行中 {pct}%</Trans>
                  ) : (
                    <Trans>等待</Trans>
                  )}
                </i>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 右列：大号手写百分比 + 一句在做什么 + 取消 */}
      <aside className="absolute bottom-4 right-4 z-[2] flex w-[min(17.5rem,32vw)] flex-col items-end gap-1.5 text-right">
        <span className="lobby-hand text-[52px] leading-none">
          {pct}
          <small className="text-[0.4em]">%</small>
        </span>
        <p className="lobby-note">
          <Trans>正在铺这一局</Trans>
        </p>
        <button type="button" onClick={onCancel} className="lobby-ticket-join mt-1 h-11 px-4">
          <Trans>取消开局</Trans>
        </button>
        <p className="lobby-note max-w-[16rem] leading-relaxed">
          <Trans>AI 正在补满座位并统一这一局的视觉风格；锁定后本局不可更改。</Trans>
        </p>
      </aside>
    </div>
  );
}
