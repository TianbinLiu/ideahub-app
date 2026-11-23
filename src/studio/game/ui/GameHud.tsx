// 对局 HUD：舞台顶部一条常驻（施工单第 1 条）。
//
// ★ 一条里只放"这一局现在怎么样"：金币（含本回合利息）、血量、连胜/连败、模型等级 + 档位名、
//   回合与存活人数。**一个数都不在这里算** —— 全部来自 view.hud（它去问 rules，见 game/view.ts）。
// ★ 位置：贴在浮动顶栏**下面**（返回键与右边那组圆键占着最上面 48px）。用 `env(safe-area-inset-top)`
//   把它顶到安全区以下：横屏真机顶部还有状态栏（G1 施工单量过，见 SceneRails 的 safe-top 注释），
//   写死 top-14 会被状态栏压住。pointer-events-none：HUD 是读数，不该挡住桌面上的卡。
import { Trans, useLingui } from "@lingui/react/macro";
import { START_HP } from "../rules";
import { modelTierName } from "../labels";
import type { HudModel } from "../view";

/** HUD 里的小分隔点（装饰，别让读屏念它） */
function Sep() {
  return (
    <span aria-hidden className="text-slate-500">
      ·
    </span>
  );
}

export default function GameHud({ hud }: { hud: HudModel }) {
  const { t } = useLingui();
  // 连胜 / 连败是**两个计数里只会有一个非 0**（rules.settleRound 一处维护），这里只决定说哪句
  const streak =
    hud.winStreak > 0 ? (
      <Trans>{hud.winStreak} 连胜</Trans>
    ) : hud.loseStreak > 0 ? (
      <Trans>{hud.loseStreak} 连败</Trans>
    ) : (
      <Trans>暂无连胜</Trans>
    );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+4rem)] flex justify-center px-2">
      <div className="flex max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full bg-panel/85 px-3 py-1 text-[11px] text-slate-200 ring-1 ring-white/10 backdrop-blur">
        <span className="font-semibold text-slate-100">
          <Trans>第 {hud.round} 回合</Trans>
        </span>
        <Sep />
        <span className="font-semibold text-gold-200" title={t`金币：买卡与刷新都要花它`}>
          🪙 {hud.gold}
        </span>
        {/* 「本回合利息 X」是施工单点名要的：利息按**现在的金币**算（rules.incomeFor），
            下一回合发钱时一并结，所以这里说的是"会发生多少"，不是"已经给了多少" */}
        <span className="text-slate-400" title={t`每 10 金 +1，上限 5；下一回合发钱时结算`}>
          <Trans>本回合利息 +{hud.income.interest}</Trans>
        </span>
        <Sep />
        <span className="font-semibold text-danger-200" title={t`${START_HP} 血起跑，扣到 0 淘汰`}>
          ❤ {hud.hp}
        </span>
        <Sep />
        <span
          className={
            hud.winStreak > 0 ? "text-warn-200" : hud.loseStreak > 0 ? "text-info-200" : "text-slate-400"
          }
          title={t`连胜 / 连败影响每回合收入（2 连起 +1，5 连 +3）`}
        >
          {streak}
        </span>
        <Sep />
        {/* 模型等级 + 档位名：L1 草稿 480p / L2 高清 720p / L3 电影级 1080p（rules.MODEL_LEVEL_TIERS） */}
        <span className="text-slate-200" title={t`游戏内的出片档位（G4 才真的按它出片）`}>
          L{hud.modelLevel} · {modelTierName(hud.tier.tier)} {hud.tier.resolution}
        </span>
        <Sep />
        <span className="text-slate-400">
          <Trans>存活 {hud.alive} 人</Trans>
        </span>
      </div>
    </div>
  );
}
