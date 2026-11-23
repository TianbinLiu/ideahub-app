/**
 * 对局界面的展示名（G2 第二块）：卡名 / 类型 / 品质 / 风格卡 / 模型档位。
 *
 * ★ 为什么中文名不写在 rules 里：规则层是零依赖纯函数，`check-i18n` 的棘轮也盯着它
 *   （rules.ts 里连一句中文都不许有，见 rules.ts 文件头）。规则只给英文占位名与 id，
 *   中文名与"一句话说明"是界面这一层的事，随 Lingui 目录一起进来。
 * ★ 按 **id** 认，不按英文名认：规则层以后把占位英文名换掉 / 从服务端下发目录时，
 *   这里不用跟着改；认不出的卡（目录新增了条目但这里还没写）回落到规则给的英文名 ——
 *   少一句中文，但界面上永远有字（铁律八：别静默变成空白）。
 * ★ 函数体里的 t 是"调用那一刻才翻"，别把这几句提到模块顶层存成常量（会冻结在开机语言）。
 */
import { t } from "@lingui/core/macro";
import type {
  CardQuality,
  CardType,
  EventEffect,
  GameCard,
  GameEventOption,
  GameGenerationTier,
  GamePhase,
  StyleCard,
} from "./types";
import type { CardType as TarotCardType } from "../../types";

// ────────────────────────────── 卡牌 ──────────────────────────────

/** 规则层的三种卡 → 塔罗卡的类型徽记（角色/场景/道具 = 人/景/具）。装备不进卡面，用不到 style。 */
export function tarotTypeOf(type: CardType): TarotCardType {
  return type === "role" ? "character" : type === "item" ? "prop" : "scene";
}

/** 类型名（类型上限那句话、商店说明里都要用同一个词） */
export function cardTypeName(type: CardType): string {
  switch (type) {
    case "role":
      return t`角色`;
    case "scene":
      return t`场景`;
    case "item":
      return t`道具`;
  }
}

/**
 * 卡的展示名。key 是规则目录的**目录 id**（`GameCard.id` 去掉 `#流水号` 那一段，
 * 见 rules.CARD_LIBRARY 与 drawCard）。
 */
export function gameCardName(card: GameCard): string {
  const base = card.id.split("#")[0];
  switch (base) {
    case "role-intern":
      return t`实习生导演`;
    case "role-extra":
      return t`街头群演`;
    case "role-gaffer":
      return t`灯光师`;
    case "role-stylist":
      return t`造型师`;
    case "role-lead":
      return t`主演`;
    case "role-scout":
      return t`勘景师`;
    case "role-star":
      return t`女明星`;
    case "role-dp":
      return t`金像摄影指导`;
    case "scene-rooftop":
      return t`黄昏天台`;
    case "scene-alley":
      return t`雨巷`;
    case "scene-arcade":
      return t`霓虹街机厅`;
    case "scene-theater":
      return t`废弃剧院`;
    case "scene-city":
      return t`浮空城`;
    case "item-fan":
      return t`手持小风扇`;
    case "item-crown":
      return t`塑料王冠`;
    case "item-camera":
      return t`复古相机`;
    case "item-umbrella":
      return t`霓虹伞`;
    case "item-smoke":
      return t`烟雾机`;
    case "item-mirrorball":
      return t`镜面球`;
    case "item-mic":
      return t`金色麦克风`;
    default:
      // 目录新增了条目、这里还没写中文：用规则给的占位名，别让卡面变成一张没有名字的图。
      return card.name;
  }
}

/** 品质名（§2.1 白/绿/蓝/紫/金 = 1/2/3/4/5 费） */
export function qualityName(quality: CardQuality): string {
  switch (quality) {
    case 1:
      return t`白`;
    case 2:
      return t`绿`;
    case 3:
      return t`蓝`;
    case 4:
      return t`紫`;
    case 5:
      return t`金`;
  }
}

/** 品质色（文字色）。语义色只写别名 danger / warn / ok（check-warn 钉着），紫与金走品牌阶梯 */
export function qualityClass(quality: CardQuality): string {
  switch (quality) {
    case 1:
      return "text-slate-200";
    case 2:
      return "text-ok-300";
    case 3:
      return "text-brand-300";
    case 4:
      return "text-violet-300";
    case 5:
      return "text-gold-300";
  }
}

// ────────────────────────────── 模型档位（§2.3b） ──────────────────────────────

/**
 * 档位名：草稿 / 高清 / 电影级。
 * ★ 只认得 rules.MODEL_LEVEL_TIERS 的 tier 字段（draft / hd / cinema），与出片档位表
 *   （data/videoTierTable）是两套东西：那是给真实出片定价的，这里是"游戏内这一发按什么档位"。
 *   接 G4 时由翻译层把 level 对到出片档位，界面上不在这里对。
 */
export function modelTierName(tier: GameGenerationTier["tier"]): string {
  switch (tier) {
    case "draft":
      return t`草稿`;
    case "hd":
      return t`高清`;
    case "cinema":
      return t`电影级`;
  }
}

// ────────────────────────────── 风格卡（§2.2） ──────────────────────────────

interface StyleMeta {
  technique: string;
  topic: string;
  /** 一行说明：色调 / 材质 / 镜头语言（§2.2「卡面 = 标题 + 一张真实样张 + 一行说明」） */
  line: string;
}

/** 8 张风格卡的中文名与说明；认不出的 id 回落到规则层的英文占位（见文件头 ★） */
function styleMeta(id: string): StyleMeta | null {
  switch (id) {
    case "cel-cyberpunk":
      return {
        technique: t`赛璐璐着色 ＋ 三渲二`,
        topic: t`赛博朋克`,
        line: t`高饱和霓虹、硬边阴影，夜里的都市像一块发光的电路板。`,
      };
    case "film-hk-neon":
      return {
        technique: t`胶片颗粒 ＋ 50mm 浅景深`,
        topic: t`九十年代香港霓虹`,
        line: t`颗粒感胶片、浅景深光斑，像从旧录像带里截下来的一帧。`,
      };
    case "fresco-renaissance":
      return {
        technique: t`湿壁画质感 ＋ 伦勃朗光`,
        topic: t`文艺复兴奇幻`,
        line: t`墙面斑驳的矿物色，一束侧光只照亮脸的一侧。`,
      };
    case "toon-wasteland":
      return {
        technique: t`3D 动画 ＋ 体积光`,
        topic: t`末日废土`,
        line: t`圆润的立体造型、橙黄与铁锈色的废墟，歪掉的霓虹还亮着。`,
      };
    case "ink-wuxia":
      return {
        technique: t`水墨留白`,
        topic: t`武侠山水`,
        line: t`墨色分层、大片留白，风与雾气比人物更抢戏。`,
      };
    case "picturebook-forest":
      return {
        technique: t`绘本水彩 ＋ 柔边勾线`,
        topic: t`童话森林`,
        line: t`水彩晕染的柔和边缘、暖黄与苔绿，雨丝里飘着萤火般的光点。`,
      };
    case "noir-alley":
      return {
        technique: t`硬派明暗对照`,
        topic: t`霓虹黑色小巷`,
        line: t`大块黑白对比、湿地面反光，红是画面里唯一的亮色。`,
      };
    case "gouache-seaside":
      return {
        technique: t`水粉 ＋ 柔粉调`,
        topic: t`海边夏日`,
        line: t`粉橘色的天空、笔触松软，像夏天午后的甜味。`,
      };
    default:
      return null;
  }
}

export function styleTechnique(style: StyleCard): string {
  return styleMeta(style.id)?.technique ?? style.technique;
}

export function styleTopic(style: StyleCard): string {
  return styleMeta(style.id)?.topic ?? style.topic;
}

export function styleLine(style: StyleCard): string {
  return styleMeta(style.id)?.line ?? t`这一套风格还没有中文说明`;
}

// ────────────────────────────── 玩家 / 阶段（§2.0） ──────────────────────────────

/**
 * 座位 id → 展示名。单机版固定四个座位：本地玩家 "me"、三个 AI 陪玩 ai-1/2/3。
 * ★ 只认 id 不认顺序：以后 G5 联机换成服务端下发的昵称时，改这一个函数就够了。
 * ★ 多语言照常走 t（"对手 A" 在英文界面里是 "Rival A"）。
 */
export function playerName(playerId: string): string {
  switch (playerId) {
    case "me":
      return t`我`;
    case "ai-1":
      return t`对手 A`;
    case "ai-2":
      return t`对手 B`;
    case "ai-3":
      return t`对手 C`;
    default:
      return playerId;
  }
}

/**
 * 阶段名（§2.0 的五个阶段 + 选风格 / 事件）。
 * ★ 这是 HUD 上「第 N 回合 · 阶段名」那一格，也是阶段按钮旁边那句提示的词 —— 只有这一份。
 */
export function phaseName(phase: GamePhase): string {
  switch (phase) {
    case "style":
      return t`选风格`;
    case "ready":
      return t`准备`;
    case "shop":
      return t`商店`;
    case "create":
      return t`创作`;
    case "screening":
      return t`展映`;
    case "voting":
      return t`投票`;
    case "event":
      return t`事件`;
    case "round-end":
      return t`回合结算`;
    case "over":
      return t`对局结束`;
  }
}

// ────────────────────────────── 事件（§2.3b） ──────────────────────────────

/** 事件名（规则层只有 id 与英文 art 名） */
export function eventName(eventId: string): string {
  switch (eventId) {
    case "model-arms-race":
      return t`模型军备`;
    case "inspiration-burst":
      return t`灵感爆发`;
    case "supply-drop":
      return t`补给站`;
    default:
      return eventId;
  }
}

/** 事件效果的一句话（§2.3b「卡片带一句话收益说明」；数字全部来自规则层的数据，这里只念） */
export function eventEffectText(effect: EventEffect): string {
  switch (effect.kind) {
    case "gold":
      return effect.delta >= 0 ? t`立刻 +${effect.delta} 金` : t`立刻 −${-effect.delta} 金`;
    case "hp":
      return effect.delta >= 0 ? t`立刻回 ${effect.delta} 血` : t`立刻掉 ${-effect.delta} 血`;
    case "model-level":
      return t`本局出片档位升到 ${modelTierName(effect.to === 2 ? "hd" : "cinema")}`;
    case "next-round-cost-half":
      return t`下一回合出片费减半`;
    case "next-round-segments":
      return t`下一回合能出 ${effect.value} 段`;
    case "prompt-limit-pct":
      return t`下一回合提示词上限 +${effect.pct}%`;
    case "item-limit":
      // G4 §3 起"哪一类的上限 +1"只剩道具这一格（背包不再按种类计数，桌面卡位的数不归事件改）
      return t`每张角色能挂的道具 +${effect.delta}`;
    case "free-refresh":
      return t`免费刷新券 ×${effect.count}`;
    case "random-card":
      return t`随机一张${qualityName(effect.quality)}卡`;
  }
}

/** 一个事件选项的全部效果拼成一句（三选一里每条最多两个效果） */
export function eventOptionText(option: GameEventOption): string {
  return option.effects.map((effect) => eventEffectText(effect)).join("；");
}

/**
 * 一个事件选项的**卡名**（G4 §5 参照图：每张卡是"标题 + 一行收益 + 花费"三层）。
 *
 * ★ 为什么标题不直接用 `eventOptionText`：那句话是要念的**收益**（带数字、可能两句），
 *   当标题用就变成"立刻 +4 金"这种指令句 —— 参照图里标题是一个名字（金币大使叽米），
 *   收益那句在它下面。两层分开，扫读时才先认出"这是哪张卡"、再看代价。
 * ★ 名字里不重复数字（数字全在 eventOptionText 里，且都来自 rules 的 effects）：
 *   两处各写一遍就会漂 —— 改规则时忘了改卡名，屏幕上就是"多出一条片"配"能出 2 段"。
 * ★ 认不出 id 时回 id（同 gameCardName）：事件数据加了新选项、这里还没写，卡上也有字。
 */
export function eventOptionName(option: GameEventOption): string {
  switch (option.id) {
    case "upgrade-draft":
      return t`画质升级`;
    case "upgrade-cinema":
      return t`画质升级 · 顶配`;
    case "half-next":
      return t`批量采购`;
    case "free-gold":
      return t`金币大使`;
    case "double-shoot":
      return t`双机位`;
    case "long-prompt":
      return t`灵感喷涌`;
    case "free-blue-card":
      return t`天降蓝卡`;
    case "bag-expand":
      return t`道具扩容`;
    case "heal":
      return t`医疗补给`;
    case "free-refresh":
      return t`刷新补贴`;
    default:
      return option.id;
  }
}

/**
 * 卡面图标位里的那个徽记（§5 参照图每张卡正中一个发光六边形 + 一个符号）。
 *
 * ★ 不是文案：不随界面语言变，所以**不进** Lingui 目录（这里是按 id 认的符号表）。
 * ★ 为什么先用字形：包里一个事件插画都没有 —— `rules.GAME_EVENTS[].art` 指向的
 *   `public/events/<id>.webp` 至今没落过文件（art.ts 也没有事件这一档）。真补了图之后，
 *   这个函数换成返回 `<img src={…}>` 的插画位即可，卡的结构不用动。
 * ★ 认不出 id 时回那颗骰子：事件选项都是"抽一下 / 涨一点"，骰子不会说错话。
 */
export function eventOptionGlyph(option: GameEventOption): string {
  switch (option.id) {
    case "upgrade-draft":
      return "🎞️";
    case "upgrade-cinema":
      return "🎥";
    case "half-next":
      return "🏷️";
    case "free-gold":
      return "🪙";
    case "double-shoot":
      return "🎬";
    case "long-prompt":
      return "✍️";
    case "free-blue-card":
      return "🎴";
    case "bag-expand":
      return "🎒";
    case "heal":
      return "💊";
    case "free-refresh":
      return "🔄";
    default:
      return "🎲";
  }
}

// ────────────────────────────── AI 陪玩的提示词（§2.4） ──────────────────────────────

/**
 * AI 交片时随机抽的那几句提示词。
 * ★ 为什么放在这里（界面层）而不是 bots.ts：AI 的"决策"是纯逻辑（不认语言），
 *   而提示词是要显示在展映屏上的**界面文案**（要进 Lingui 目录、要能切语言）——
 *   由 store 把这一份递进 phases.toCreation，bots 只负责挑一条。
 */
export function aiPromptPool(): string[] {
  return [
    t`雨夜里一个女孩回头`,
    t`霓虹灯下追着跑的两个人`,
    t`纸片小镇的清晨`,
    t`墨色的山与一阵风`,
    t`天台上的最后一支烟`,
    t`镜子里多出来的那个人`,
  ];
}
