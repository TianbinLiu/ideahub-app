// 风格卡选择屏（施工单第 5 条）：进对局前弹一屏，3 张风格卡（技法名词 + 题材 + 预览图 + 一行说明）。
//
// ★ "选定后锁死"这件事由 rules.pickStyleCard 保证（会回 style-locked）；这里只把 3 张画出来、
//   让玩家先点一张看中、再按「锁定这张风格」——不做成"点一下就锁"，误触一次整局风格就定了。
// ★ 预览图现在是**占位**（art.stylePreviewUrl 拿仓库里现成的卡面/封面顶着），真实样张是下一块
//   G2-c 的事：离线批量生成、打进包（public/styles/<id>.webp），选风格这一步绝不实时生成
//   （docs/workshop-game-design.md §2.2「每张风格卡必须带预览图」）。TODO 那一行在 art.ts 里。
// ★ 选完风格之后 AI 陪玩各自挑一张、rules 把阶段推到 ready、beginRound 开第一回合商店 —— 整串在
//   store.pickStyle / finishStyle 里（那是编排，不是规则；规则只管一人一次、选定锁死）。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { stylePreviewUrl } from "../art";
import { styleLine, styleTechnique, styleTopic } from "../labels";
import { useGame } from "../store";
import type { GameView } from "../view";
import GameBtn from "./GameBtn";

export default function StylePick({ view }: { view: GameView }) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<string | null>(null);
  const lockedStyle = view.style;

  // 边界：本地玩家已经选过、但 AI 那几步没落完（比如上一拍报错）—— 不给重选，只给"接着开局"。
  // 正常路径看不到这一屏（store.pickStyle 会一口气把三步走完）。
  if (lockedStyle) {
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-ink/95 px-4 backdrop-blur">
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
    <div className="absolute inset-0 z-40 flex flex-col bg-ink/95 px-4 py-3 backdrop-blur">
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
                {/* 占位样张：仓库里现成的卡面 / 封面（真实样张见文件头 ★） */}
                <img src={stylePreviewUrl(style.id)} alt="" className="aspect-[4/3] w-full object-cover" />
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
              <Trans>这一局没有抽到风格卡（数据不对）——去右栏结束对局再开一局。</Trans>
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
