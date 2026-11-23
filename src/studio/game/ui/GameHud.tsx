// 对局 HUD：屏幕最上方一条（G4 施工单 docs/g4-ui-revamp-spec.md §2「对局进度条 + 当前生命值」）。
//
// ★ 这一条只有两样东西：**8 回合进度条**（打过的段亮、当前段高亮）与**当前生命值**（数 + 一小条血条）。
//   施工单点名删掉的那几句（第 1 回合 / 商店 / 本回合利息 / 连胜 / L1 草稿 480p / 存活 N 人）全在这条上，
//   它们随 G2 那版 HUD 一起退场：利息搬进背包栏右侧的商店键（ui/BagBar），金币也在那一栏；
//   回合数由进度条读，阶段该干嘛由底部阶段条说（ui/PhaseBar），玩家不用再从这一行里猜。
// ★ 一个数都不在这里算：回合与血量来自 view.hud（它去问 rules），8 回合的上限与 100 血是 rules 的常量。
// ★ 位置：安全区以下、顶栏那排圆键下面（`+4rem`，与 G2 那版同一个数）。真机的状态栏
//   inset 实测 41px（src/index.css 的 .safe-top 注释），顶栏按钮占 51~93px —— HUD 落在
//   它们下面那一行才不会在 800 CSS 宽的横屏上跟「✕ 结束对局」叠到一起。
//   `pointer-events-none`：HUD 是读数，不许挡桌面上的卡。
import { useLingui } from "@lingui/react/macro";
import { MAX_ROUNDS, START_HP } from "../rules";
import type { HudModel } from "../view";

export default function GameHud({ hud }: { hud: HudModel }) {
  const { t } = useLingui();
  // 血条宽度按 rules.START_HP 归一；血量在规则层已被夹在 0~100（settleRound），这里只防越界
  const hpPct = Math.max(0, Math.min(100, (hud.hp / START_HP) * 100));
  const round = Math.max(1, Math.min(MAX_ROUNDS, hud.round));

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+4rem)] flex justify-center px-2">
      <div className="flex w-[min(100%,30rem)] items-center gap-2.5 rounded-full bg-panel/85 px-3 py-1 ring-1 ring-white/10 backdrop-blur">
        {/* 8 段 = MAX_ROUNDS：打过的段实心、当前段高亮一圈、没到的段淡着。
            进度条本身不带字（第 N 回合那句是施工单点名删掉的），回合数看亮到第几段。 */}
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={MAX_ROUNDS}
          aria-valuenow={round}
          aria-label={t`对局进度`}
          className="flex flex-1 items-center gap-1"
        >
          {Array.from({ length: MAX_ROUNDS }, (_, i) => {
            const passed = i + 1 < round;
            const current = i + 1 === round;
            return (
              <span
                key={i}
                className={`h-2 flex-1 rounded-full ${
                  current
                    ? "bg-brand-300 ring-1 ring-brand-100/80"
                    : passed
                      ? "bg-brand-400/70"
                      : "bg-white/15"
                }`}
              />
            );
          })}
        </div>
        <div className="flex flex-none items-center gap-1.5" role="img" aria-label={t`当前生命值`}>
          <span aria-hidden className="text-[13px] leading-none text-danger-300">
            ❤
          </span>
          <span className="text-[12px] font-semibold tabular-nums text-slate-100">{hud.hp}</span>
          <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-white/15">
            <span className="block h-full rounded-full bg-danger-400" style={{ width: `${hpPct}%` }} />
          </span>
        </div>
      </div>
    </div>
  );
}
