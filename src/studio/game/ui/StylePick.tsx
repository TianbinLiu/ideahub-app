// 风格卡选择屏（施工单第 5 条）：进对局前弹一屏，3 张风格卡（技法名词 + 题材 + 样张 + 一行说明）。
//
// ★ "选定后锁死"这件事由 rules.pickStyleCard 保证（会回 style-locked）；这里只把 3 张画出来、
//   让玩家先点一张看中、再按「锁定这张风格」——不做成"点一下就锁"，误触一次整局风格就定了。
// ★ 预览图是**真实样张**（G2-c）：public/styles/<id>.webp，离线生成、打进包，路径经
//   art.stylePreviewUrl 从 rules.STYLE_POOL 取。选风格这一步绝不实时生成
//   （docs/workshop-game-design.md §2.2「每张风格卡必须带预览图」）。
// ★ 样张是 4:3 出的（design/gen-style-samples.mjs），卡的图位也是 aspect-[4/3] —— 两边必须一致：
//   换成 16:9 的图这里会 object-cover 裁掉人脸，而那正是玩家用来比较的那一部分。
// ★ img 的 alt 留空是刻意的：技法与题材就在下面两行字里念得到，再念一遍"某某风格样张"只是噪音。
// ★ 选完风格之后 AI 陪玩各自挑一张、rules 把阶段推到 ready、beginRound 开第一回合商店 —— 整串在
//   store.pickStyle / finishStyle 里（那是编排，不是规则；规则只管一人一次、选定锁死）。
//
// ★★ 退出入口（2026-11-28，真机验收 P0）：这一屏是 z-40 的整屏，把工坊顶栏那颗「✕ 结束对局」
//   盖住了 —— 玩家进来之后只剩"锁定"或系统返回键。右上角补一颗显式的「✕ 返回大厅」：
//     · 走 `ui/quitGame.quitGameToLobby`（退房 → 收局 → 开大厅），与「✕ 结束对局」「退出游戏」
//       同一条路（铁律六：一处实现）；联机局不会把账号留在服务端那间房里。
//     · **不消耗任何券 / token**：这一屏还在一局的最前面，一张片都没出（游戏券只在局内出片时扣，
//       见 data/gameTicketRules），退出只是把这一局收掉；这一点在 docs/game-lobby-ui-b-c.md §10 有验收记录。
//     · 安卓返回键同一条路（useBackLayer）：这一屏开着时先关它，而不是退回上一个页面。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useBackLayer } from "../../../hooks/useBackLayer";
import { setGsHudHidden } from "../../scene/gsHud";
import { playWaveReveal } from "../../ui/waveReveal";
import { stylePreviewUrl } from "../art";
import { styleLine, styleTechnique, styleTopic } from "../labels";
import { useGame } from "../store";
import type { GameView } from "../view";
import GameBtn from "./GameBtn";
import { quitGameToLobby } from "./quitGame";

export default function StylePick({ view }: { view: GameView }) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<string | null>(null);
  const lockedStyle = view.style;
  /** 波浪铺开的那一块（整屏浮层本体；圆心/时长在 ui/waveReveal，与工作流小窗同一份） */
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 安卓返回键：这一屏开着 = 先退这一屏（与右上角那颗「✕ 返回大厅」同一条路）。 */
  useBackLayer(true, quitGameToLobby, "game-style");
  /**
   * 入场 = 工作流小窗那一套**波浪**（2026-11-28，主人点名"复用工作流那套：波浪/淡入"）。
   * ★ 圆心固定右下角（`origin: null`）：这一屏是流程机在匹配完成那一拍自动进的，没有"点哪儿"。
   * ★ 3D 由 StudioPage 停帧、**不卸载**（`canvasCovered` 含 stylePick）—— 波浪铺开时底下是
   *   冻结的那一帧桌面，不是黑屏、也不是重新加载。
   * ★ reduced-motion 时自动退成 180 ms 淡入（判据与两条时长都只在 ui/waveReveal）。
   */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // 验收读数只在 DEV / 显式写 `gsAcceptDebug=1` 的包里挂（与 TableScene 的 __gsAccept 同一条约定）：
    // 生产里没人写这个键 = 这个 window 全局完全不存在。
    const debug =
      import.meta.env?.DEV === true ||
      (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
    const wave = playWaveReveal(el, {
      opening: true,
      origin: null,
      debugName: debug ? "__stylePickWave" : undefined,
    });
    return () => wave.cancel();
    // 锁定态（边界）与选择态是两块不同的整屏，换过去时重播一发波浪
  }, [lockedStyle]);

  /**
   * 开发者读数角标这一屏**整个藏起来**（2026-11-28）：三张风格卡的样张铺满整屏，
   * 读数（哪怕已经在可点 UI 之下）也不该透出来。`key="stylepick"` 与大厅那一格互不覆盖（见 gsHud 的 ★）。
   * ★ 只有调试信号（?gs=1 / gsAcceptDebug / 设置显式开）才有这个节点；生产默认本来就不存在。
   */
  useEffect(() => {
    setGsHudHidden(true, "stylepick");
    return () => setGsHudHidden(false, "stylepick");
  }, []);

  /** 右上角的显式出口。两段（已锁 / 正常）都摆：任何一个分支都不该把玩家关在整屏里。 */
  const backToLobby = (
    <button
      type="button"
      onClick={quitGameToLobby}
      style={{ top: "var(--safe-float-top)" }}
      className="absolute right-3 z-10 flex h-11 items-center rounded-full bg-panel/85 px-3 text-[11px] font-semibold text-slate-200 ring-1 ring-white/15 backdrop-blur"
    >
      <Trans>✕ 返回大厅</Trans>
    </button>
  );

  // 边界：本地玩家已经选过、但 AI 那几步没落完（比如上一拍报错）—— 不给重选，只给"接着开局"。
  // 正常路径看不到这一屏（store.pickStyle 会一口气把三步走完）。
  if (lockedStyle) {
    return (
      <div
        ref={panelRef}
        className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-ink/95 px-4 backdrop-blur"
      >
        {backToLobby}
        <p className="text-sm font-semibold text-slate-100">
          <Trans>风格已经锁定：{styleTechnique(lockedStyle)}</Trans>
        </p>
        <p className="text-[11px] text-slate-400">
          <Trans>整局都带这套风格，不能换。</Trans>
        </p>
        <GameBtn onClick={() => useGame.getState().finishStyle()} tone="primary">
          <Trans>开始第一回合</Trans>
        </GameBtn>
      </div>
    );
  }

  const choices = view.styleChoices;

  return (
    <div ref={panelRef} className="absolute inset-0 z-40 flex flex-col bg-ink/95 px-4 py-3 backdrop-blur">
      {backToLobby}
      <div className="text-center">
        <h2 className="text-sm font-semibold text-slate-100">
          <Trans>选一张风格卡</Trans>
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-400">
          <Trans>整局所有出片都带这套风格（技法 + 题材），选定后锁死。</Trans>
        </p>
      </div>
      <div className="mt-2 flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto">
        <div className="flex items-stretch justify-center gap-4">
          {choices.map((style) => {
            const active = selected === style.id;
            const technique = styleTechnique(style);
            const topic = styleTopic(style);
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => setSelected(style.id)}
                aria-label={t`选「${technique}」×「${topic}」`}
                className={`relative flex w-[clamp(7.5rem,18vw,12rem)] flex-none flex-col overflow-hidden rounded-xl text-left ring-1 transition-colors ${
                  active ? "bg-raised ring-2 ring-gold-300" : "bg-panel/80 ring-white/10 active:bg-raised"
                }`}
              >
                {/* 真实样张（4:3，与 aspect-[4/3] 对齐；见文件头 ★） */}
                <img
                  src={stylePreviewUrl(style.id)}
                  alt=""
                  draggable={false}
                  className="aspect-[4/3] w-full bg-ink object-cover"
                />
                <div className="flex flex-1 flex-col gap-1 p-2">
                  <div className="text-[12px] font-semibold leading-tight text-slate-100">{technique}</div>
                  <div className="text-[10px] font-semibold text-brand-200">{topic}</div>
                  <p className="text-[10px] leading-snug text-slate-400">{styleLine(style)}</p>
                </div>
                {active && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-gold-500 px-1.5 text-[10px] font-semibold leading-[1.6] text-ink">
                    <Trans>已选</Trans>
                  </span>
                )}
              </button>
            );
          })}
          {choices.length === 0 && (
            <p className="self-center text-[11px] text-slate-400">
              <Trans>这一局没有抽到风格卡（数据不对）——点右上角「返回大厅」再开一局。</Trans>
            </p>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <GameBtn
            onClick={() => selected && useGame.getState().pickStyle(selected)}
            tone="primary"
            disabled={selected === null}
            className="px-6 py-2 text-[12px]"
          >
            <Trans>锁定这张风格，开局</Trans>
          </GameBtn>
          {/* 点不动的理由要看得见（手机上 title 没用） */}
          <span className="text-[10px] text-slate-400">
            {selected === null ? <Trans>先点一张风格卡，再锁定</Trans> : <Trans>锁定之后整局都不能换</Trans>}
          </span>
        </div>
      </div>
    </div>
  );
}
