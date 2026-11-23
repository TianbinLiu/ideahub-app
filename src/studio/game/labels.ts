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
import type { CardQuality, CardType, GameCard, GameGenerationTier, StyleCard } from "./types";
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
    case "ink-wuxia":
      return {
        technique: t`水墨留白`,
        topic: t`武侠山水`,
        line: t`墨色分层、大片留白，风与雾气比人物更抢戏。`,
      };
    case "paper-stopmotion":
      return {
        technique: t`纸片定格动画`,
        topic: t`绘本小镇`,
        line: t`层叠纸片的手工感，每一帧都有一点点手抖的错位。`,
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
    case "halftone-space":
      return {
        technique: t`半调印刷 ＋ 镀铬高光`,
        topic: t`复古未来太空歌剧`,
        line: t`网点印刷的颗粒配上镀铬反光，七十年代的未来感。`,
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
