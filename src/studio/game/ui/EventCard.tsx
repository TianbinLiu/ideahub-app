// 事件屏上的**一张卡**（2026-11-23 接服务端出题时从 EventPanel 抽出来的那一份皮）。
//
// ★★ 为什么抽成一个组件（单机 / 联机两块牌子共用）：事件选项的**数据来源**现在有两条 ——
//   单机读 `rules.GAME_EVENTS`（view.eventViewOf），联机读服务端下发的那一份
//   （`roundsStore.event`，同一房间同一回合同一道题）。两条来源的"卡"长得必须一模一样：
//   参照图（docs/g4-ui-revamp-spec.md §5）要求每张卡是「插画位 + 标题 + 一行收益 + 花费」四层。
//   把这份皮抄第二遍，第一次改版就会只有一边改到（"联机那张卡还是旧版"）。
//   ★ 抽出来的是**皮**不是判据：摆哪些选项 / 点下去做什么仍然各在各的那一层
//   （单机递 rules.applyEventChoice，联机递 roundsStore + game store）。
// ★ 卡面（EventCardArt）独立成组件是为了 broken 这份状态：放在面板里就是一个数组下标的状态，
//   三张卡会串。
// ★ 图是十张离线生成、打进包的插画（`public/events/<选项 id>.webp`）—— 这一屏绝不实时出图
//   （同风格样张：真人真机上要等 30 秒、还会被审核拦）。地址从选项的 `art` 取
//   （`art.eventArtUrl` 只做 public/ → 站点根换算）。
// ★★ **加载失败必须看得见是"退回到字"，不是静默变空**：`onError` 记 broken，之后不再渲染 <img>，
//   露出底下那颗字形徽记 —— 真机上 public/ 下少一张图只表现为一块空六边形，与"样式写错"没法区分；
//   而这类"少一个文件"正是 vite build 零意见、`scripts/check-event-art.mjs` 才拦得住的东西。
//   所以写法是**字形常驻在底下、图盖在上面**：加载中也不是空的，失败时图整个撤掉。
// ★ 六边形是正六边形（近似正方形），图是 16:9 —— 用 object-cover 从中间裁，主体必须居中，
//   这也是生成脚本每张提示词都写"主体居中、占画面中央大部分"的原因。
import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { eventArtUrl } from "../art";
import { eventOptionGlyph } from "../labels";
import type { GameEventOption } from "../types";

/**
 * 图标位那个六边形：clip-path 一刀切出正六边形（参照图每张卡正中就是它）。
 * ★ 用 clip-path 而不是图：一个形状 3 个 span 就够，不给安装包加字节；外层是"描边"（稍大一圈的渐变），
 *   内层向内缩 2px 换成暗底 —— clip-path 会把 box-shadow / ring 一起裁掉，所以描边只能靠叠出来。
 */
const HEX = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

/** 卡面认的那两格（单机的选项与服务端下发的选项都满足；服务端那份按 id 拼同一个文件名）。 */
export type EventCardFace = Pick<GameEventOption, "id" | "art">;

/** 一张卡要用的全部数据（`cost` 与 `face` 同一份来源：单机是 GameEventOption，联机是服务端下发的选项）。 */
export type EventCardOption = EventCardFace & Pick<GameEventOption, "cost">;

/**
 * 一张卡的插画位：六边形裁切里放**真图**，图没出来时垫着原来的字形徽记。
 * ★ 只有 `id` / `art` 两格数据依赖：联机那份 `public/events/<id>.webp` 与本机选项同名同图。
 */
export function EventCardArt({ face, active }: { face: EventCardFace; active: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    // 底下垫一层径向柔光 —— 纯底色在深面板上看起来是一块死黑，加了光才像"图"（选中时转金）
    <span
      className="relative flex w-full flex-1 items-center justify-center"
      style={{
        background: active
          ? "radial-gradient(60% 62% at 50% 46%, rgba(251,191,36,0.20), transparent 72%)"
          : "radial-gradient(60% 62% at 50% 46%, rgba(56,189,248,0.16), transparent 72%)",
      }}
    >
      <span className="relative flex h-[clamp(2.6rem,6.2vw,3.5rem)] w-[clamp(2.6rem,6.2vw,3.5rem)] items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: HEX,
            background: active ? "linear-gradient(160deg,#fde68a,#38bdf8)" : "linear-gradient(160deg,#7dd3fc,#fcd34d)",
          }}
        />
        <span
          aria-hidden
          className="absolute inset-[2px] overflow-hidden"
          style={{ clipPath: HEX, background: "linear-gradient(160deg,#16223c,#0b1020)" }}
        >
          {/* 字形徽记：图加载出来就被盖住；加载失败时它就是退路（见文件头 ★★） */}
          <span className="absolute inset-0 flex items-center justify-center text-[clamp(0.95rem,2.4vw,1.3rem)] leading-none">
            {eventOptionGlyph(face)}
          </span>
          {!broken && (
            <img
              // 装饰性的图：这张卡的语义已经在按钮的 aria-label（选项名）里了
              alt=""
              src={eventArtUrl(face)}
              draggable={false}
              decoding="async"
              onError={() => setBroken(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </span>
      </span>
    </span>
  );
}

/**
 * 一张完整的选项卡（卡面 + 标题 + 一行收益 + 花费）。
 * ★ 名字 / 收益 / 花费都是**已经本地化好的字符串**：这一层只排版，不知道数据从哪儿来。
 * ★ 花费那一行三档配色：免费（绿）/ 买得起（金）/ 买不起（红，并说"还差多少"由调用方在页脚说）。
 * ★ 不设 disabled：钱不够点了要说原因（差多少金），灰着点不动在手机上等于没反应。
 */
export default function EventCard({
  option,
  name,
  text,
  gold,
  active,
  ariaLabel,
  onSelect,
}: {
  option: EventCardOption;
  name: string;
  /** 一行收益（可能为空串：服务端只给了 hp 那种选项由调用方另拼一句） */
  text: string;
  /** 我手上有多少金（只影响"买不起"那档配色） */
  gold: number;
  active: boolean;
  /** 读屏用的整句（缺省就用卡名） */
  ariaLabel?: string;
  onSelect: () => void;
}) {
  const affordable = option.cost <= gold;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={ariaLabel ?? name}
      className={`relative flex min-h-[clamp(7.5rem,44vh,12rem)] w-[clamp(9.5rem,29vw,15rem)] flex-none flex-col items-center overflow-hidden rounded-xl px-2 pb-1.5 pt-1.5 text-center ring-1 transition-colors ${
        active ? "bg-gold/[0.08] ring-2 ring-gold-300" : "bg-white/[0.04] ring-white/10 active:bg-white/[0.09]"
      }`}
    >
      {/* 选中角标：参照图靠左上/右上那颗徽记认选中，这里就在右上角打一个勾 */}
      {active && (
        <span
          aria-hidden
          className="absolute right-1 top-1 flex h-[clamp(0.9rem,2.1vw,1.1rem)] w-[clamp(0.9rem,2.1vw,1.1rem)] items-center justify-center rounded-full bg-gold-400 text-[clamp(0.5rem,1.2vw,0.62rem)] font-bold leading-none text-ink"
        >
          ✓
        </span>
      )}
      <EventCardArt face={option} active={active} />
      {/* 文字块钉在卡的下半截（mt-auto）：三张卡的收益有长有短，花费那一行仍然对齐 */}
      <span className="mt-auto flex w-full flex-col items-center gap-0.5">
        <span className="text-[clamp(0.66rem,1.6vw,0.8rem)] font-semibold leading-tight text-slate-100">{name}</span>
        <span className="line-clamp-2 text-[clamp(0.55rem,1.35vw,0.66rem)] leading-[1.35] text-slate-400">{text}</span>
        <span
          className={`mt-0.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[clamp(0.58rem,1.4vw,0.7rem)] font-semibold ring-1 ${
            option.cost === 0
              ? "bg-ok/15 text-ok-200 ring-ok/30"
              : affordable
                ? "bg-gold/15 text-gold-200 ring-gold/30"
                : "bg-danger/20 text-danger-200 ring-danger/40"
          }`}
        >
          {option.cost === 0 ? (
            <Trans>免费</Trans>
          ) : (
            <>
              <span aria-hidden className="opacity-80">
                🪙
              </span>
              <Trans>{option.cost} 金</Trans>
            </>
          )}
        </span>
      </span>
    </button>
  );
}
