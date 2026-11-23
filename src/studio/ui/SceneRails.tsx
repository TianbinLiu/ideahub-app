// 横屏宽布局的两条常驻条（G1 施工单 docs/g1-scene-plan.md §2 A：左 = 背包/卡组，中 = 桌面，右 = 市场这类常驻条）。
//
// ★ 这里**只搭壳、不造玩法**：每个键都只是在调桌面上已经有的那个动作（点卡组堆 / 摊开排 / 逛市场），
//   一个交互都不新加。为什么还要搬一份到屏幕两侧：横屏之后桌面被两条常驻条挤窄，桌面上的卡组堆 /
//   市场卡的**屏幕位置跟着机位与窗口比例漂**（见 scene/layout.LAND_CAM 里量出来的 x 范围），
//   而常驻条的位置不依赖 3D 取景 —— 这是给玩家一个稳定的入口，不是第二套玩法。
// ★ 只在**横屏**挂（StudioPage 里由 hooks/useIsLandscape 判）：竖屏时桌面本来就一屏看全，
//   多两条边栏只会把 3D 画布挤成细长条。
// ★ 道具栏还没做（它的内容是 G2 的单机规则：买卡 / 装备 / 背包上限），这里不摆一个点不动的占位块 ——
//   本仓那条「永远点不动的选项」规矩同样适用于灰着的假面板。市场是真能点开的，所以先摆它。
import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { sceneLayout } from "../scene/layout";
import { useStudio } from "../studioStore";
import { MarketSearchField } from "./MarketSearch";

/** 两条常驻条的共用外框：宽度按窗口比例给（竖过来就没它了），窄屏也不低于 8.5rem 免得字折成两行 */
function Rail({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <aside
      // safe-area：横屏时刘海/挖孔跑到**左右两侧**，这两条正好压在边上
      className={`flex h-full w-[15vw] min-w-[8.5rem] max-w-[13rem] flex-none flex-col gap-2 overflow-y-auto rounded-xl bg-panel/55 px-2 py-2.5 ring-1 ring-white/10 backdrop-blur ${
        side === "left" ? "pl-[env(safe-area-inset-left,0px)]" : "pr-[env(safe-area-inset-right,0px)]"
      }`}
    >
      {children}
    </aside>
  );
}

function RailTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-slate-200">{children}</span>
      {count != null && (
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">{count}</span>
      )}
    </div>
  );
}

/** 常驻条里的键：与顶栏那几颗同一套形状（圆角、按下变亮），排成竖列 */
function RailBtn({
  onClick,
  children,
  tone = "normal",
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "normal" | "primary";
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg px-2 py-2 text-left text-[11px] leading-tight transition-colors ${
        tone === "primary"
          ? "bg-brand/15 text-brand-200 ring-1 ring-brand/40"
          : "bg-white/[0.06] text-slate-200 active:bg-white/[0.12]"
      }`}
    >
      {children}
    </button>
  );
}

/** 左：卡组（背包）。张数是桌面那个卡组堆上刻的同一个数（studioStore.deck） */
export function DeckRail() {
  const deckLen = useStudio((s) => s.deck.length);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  return (
    <Rail side="left">
      <RailTitle count={deckLen}>
        <Trans>卡组</Trans>
      </RailTitle>
      {/* 与点桌面上那叠卡组堆是**同一个**动作（openDeckView，唯一入口原本只有 3D 那一处）：
          它自己会在"一张卡都没有"时说清楚为什么打不开，这里不另判一遍 */}
      <RailBtn onClick={() => useStudio.getState().openDeckView()} tone="primary">
        <Trans>翻开卡组</Trans>
      </RailBtn>
      {/* 摊开排开着时这颗键变成收起来 —— 与桌面那排卡的存在状态是同一个值（spreadOpen） */}
      <RailBtn onClick={() => useStudio.getState().toggleSpread()}>
        {spreadOpen ? <Trans>收起摊开排</Trans> : <Trans>摊开在桌上</Trans>}
      </RailBtn>
      {deckLen === 0 && (
        <p className="px-1 text-[10px] leading-relaxed text-slate-400">
          <Trans>卡组还空着——把素材交给铸卡师，或者去右边逛市场。</Trans>
        </p>
      )}
    </Rail>
  );
}

/** 右：市场。开/收与桌面上那张市场平摊是同一个状态（studioStore.market.open） */
export function MarketRail() {
  const marketOpen = useStudio((s) => s.market.open);
  const count = useStudio((s) => s.market.items.length);
  const page = useStudio((s) => s.market.page);
  // 右栏只在横屏挂，所以这里读到的就是横屏那套分页（一页 8 张）
  const M = sceneLayout(true).market;
  return (
    <Rail side="right">
      <RailTitle count={marketOpen ? count : undefined}>
        <Trans>市场</Trans>
      </RailTitle>
      {marketOpen ? (
        <>
          {/* ★ 市场搜索条在这里而不是屏幕上沿（G1 第 3 步）：宽布局里市场就在右栏，
              搜索跟着进来；竖屏那一份仍在 NpcDialog 的屏幕上方（同一份 MarketSearchField） */}
          <div className="flex items-center gap-1.5 rounded-lg bg-raised/90 px-2 py-1.5 ring-1 ring-white/10">
            <MarketSearchField compact />
          </div>
          <RailBtn onClick={() => useStudio.getState().closeMarket()}>
            <Trans>‹ 收起市场</Trans>
          </RailBtn>
          <p className="px-1 text-[10px] leading-relaxed text-slate-400">
            {count > M.perPage ? (
              <Trans>
                第 {page + 1} / {Math.ceil(count / M.perPage)} 页 · 翻页用桌面两侧的箭头
              </Trans>
            ) : (
              <Trans>点桌上的市场卡放大查看，喜欢就收进卡组</Trans>
            )}
          </p>
        </>
      ) : (
        <RailBtn onClick={() => void useStudio.getState().openMarket()} tone="primary">
          <Trans>🛒 逛市场</Trans>
        </RailBtn>
      )}
    </Rail>
  );
}
