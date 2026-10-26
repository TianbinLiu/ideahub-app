// 工作流「跟着做」模式的清单，与「这个出片模型上能不能用」的判定 —— 唯一实现（2026-10-04，方案 docs/guided-modes-design.md）。
//
// 纯数据 + 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-guided-modes.mjs 直接 import 它跑正反例。
// 界面上的字（名字、一句话、出处）不在这里 —— 那是界面文案，进 Lingui 目录，在 components/flow/ModePicker 那一份。
//
// ★★ 主人 10-04「六个模式也需要根据用户选择的模型来选择性显示」：模式能不能用**按档位的能力判**（收不收参考图、是不是只认一张起拍画面的真人档（startOnly）、
//   能不能推演三套），不按档位名判 —— 价目表改了、加了一档，这里不用跟着改。档位的能力由调用方从 economy.VideoTier 读出来传进来。
// ★ 还没做出来的模式**不进清单**：摆一个点不动的选项，用户只会觉得功能坏了（CLAUDE.md 已知的坑那一格）。
//   做出来的那一期再加一行，判定写在 modeBlock 里（C 九宫格分镜在第三期 2026-10-05 加上）。

import type { VideoTierSpec } from "./videoTierTable";

/** 模式 id（与设计稿的字母对照：direct = A、lead = B、grid = C、custom = F、cards = D、template = E、effect = G、dialogue = I） */
export type GuidedModeId = "direct" | "lead" | "grid" | "dialogue" | "custom" | "cards" | "template" | "effect";

/** 选法屏上的三组：基础 / 跟着高手做 / 复刻 */
export type GuidedGroup = "basic" | "pro" | "replica";

export interface GuidedModeDef {
  id: GuidedModeId;
  /** 设计稿里的字母，方便对照 docs/guided-modes-design.md */
  letter: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "I";
  group: GuidedGroup;
  /** 固定步骤数（选法屏上写「N 步」；与向导的步骤条同一个数） */
  steps: number;
}

/** 选法屏的顺序就是这张表的顺序：组内最常用的排前面（A 排第一） */
export const GUIDED_MODES: readonly GuidedModeDef[] = [
  { id: "direct", letter: "A", group: "basic", steps: 3 },
  { id: "custom", letter: "F", group: "basic", steps: 4 },
  // B 主角定妆 · 多镜头（第二期，2026-10-04）：定主角 → 写这场戏 → AI 拆镜头 → 规格 · 出片
  { id: "lead", letter: "B", group: "pro", steps: 4 },
  // C 九宫格分镜（第三期，2026-10-05）：选人物和场景 → 写这场戏（AI 写分镜清单）→ 出分镜画面（一组图）→ 挑格子 → 一格一段 · 出片
  { id: "grid", letter: "C", group: "pro", steps: 5 },
  // I 对话正反打（2026-10-05 第一批，docs/canvas-platforms-ecosystem-research.md §五）：两个人和场景 → 写对白 → 画三个机位（双人 + 两个过肩）→ 一句一段 · 出片
  { id: "dialogue", letter: "I", group: "pro", steps: 4 },
  { id: "cards", letter: "D", group: "pro", steps: 3 },
  // G 特效同款（2026-10-05 第一批）：挑一个特效 → 挑主角 → 关键帧 · 出片。复刻 · 同款这一组里最常用，排第一
  { id: "effect", letter: "G", group: "replica", steps: 3 },
  { id: "template", letter: "E", group: "replica", steps: 2 },
];

export const GUIDED_GROUPS: readonly GuidedGroup[] = ["basic", "pro", "replica"];

/** 判定要用到的档位能力（只拿这几位；档位表只 import type，这个文件照样零运行时依赖） */
export interface ModeTier {
  /** 收参考图（economy.VideoTier.refImg） */
  refImg: boolean;
  /**
   * 只认一张起拍画面的档（economy.VideoTier.startOnly，真人档）：起拍画面就是真人卡的照片，一张设定帧都不画。
   * ★ 2026-10-26 前叫 flat、调用方拿「按发计价」（flatCost）去填 —— 计价模型与出片方式是两件事。
   */
  startOnly: boolean;
  /** 出片带声音（economy.VideoTier.audio）：台词说得出来 */
  audio: boolean;
}

/**
 * 某个模式在这一档上为什么用不了（null = 能用）：
 * · refImg —— 这一档收不了参考图：「参考图直出」只剩一段纯文字生成（1.0 两档）；
 * · startOnly —— 真人档（只认一张起拍画面）：没有推演三套那一步（economy.deriveIssue），「自定义」也没意义（本来就是直出，画布那颗页签同样灰着）。
 * ★ 真人档上「参考图直出」**能用**：它就是这一档本来的样子（真人卡的照片起拍、写一句话直接出片），出片规则在 segmentGen 的真人档那一支。
 * ★ 「主角定妆 · 多镜头」只在收参考图的档上（高清 / 电影级）：它的出片就是参考图直出（主角图直接给视频模型、不画帧）加一段多镜头带台词的剧本 ——
 *   1.0 两档收不了参考图（只剩纯文字，「先把人定死」那一步白做）；真人档不收参考图、也没有多镜头台词这回事（只拿真人卡的照片起拍）。
 * ★ 「九宫格分镜」只挡真人档：它的出片是「那一格的画面当开头帧」—— 收参考图的两档另带人物图（帧当参考图发），
 *   1.0 两档那一格当首帧硬约束（标准档照旧补画结束帧，flowStore.noDrawFor）；真人档的起拍画面只能是真人卡的照片，一格画面放不进去。
 * ★ 「套模板」不按档位挡：模板能在哪几档跑由模板自己说（data/templates.templateRunsOn），货架按选的模型筛。
 */
export function modeBlock(id: GuidedModeId, tier: ModeTier): "refImg" | "startOnly" | "audio" | null {
  switch (id) {
    case "direct":
      return tier.refImg || tier.startOnly ? null : "refImg";
    case "lead":
      return tier.refImg ? null : "refImg";
    case "grid":
    case "custom":
    case "cards":
      return tier.startOnly ? "startOnly" : null;
    case "template":
      return null;
    // 特效同款每一档都能用：1.0 两档关键帧当首帧、2.x 帧当参考图、真人档只摆照片起拍也成立的几条（effectPresets.effectsOn 一处判）
    case "effect":
      return null;
    // 对话正反打的看点就是台词：出不了声的档（1.0 两档、真人档）上三句话一个字都说不出来
    case "dialogue":
      return tier.audio ? null : "audio";
  }
}

/** 这一档上能用的模式（按清单顺序） */
export function modesOn(tier: ModeTier): GuidedModeDef[] {
  return GUIDED_MODES.filter((m) => modeBlock(m.id, tier) === null);
}

/**
 * 档位表的一行 → 判定要的那几位（选法屏 ModePicker.modeTierOf 照它取）。
 * ★ 放在这里（2026-10-26 审核）：原来这一步只在 ModePicker 里，构建检查喂给 modeBlock 的是手抄的一张能力表 ——
 *   档位表加一行（P2b 的 MiniMax H3）或改了某一行的 startOnly / refImg，选法屏摆哪几个模式一条都没人核。
 *   挪到零依赖模块里，scripts/check-guided-modes.mjs 就能拿真表的每一行过一遍。
 */
export function modeTierOfSpec(tier: Pick<VideoTierSpec, "refImg" | "startOnly" | "audio">): ModeTier {
  return { refImg: tier.refImg, startOnly: tier.startOnly, audio: tier.audio };
}

/**
 * 换到什么样的档，modeBlock 说的这个原因就不再挡 —— 选法屏「换到「…」就有」那句按它数档名（ModePicker）。
 * ★ 与 modeBlock 同一位（2026-10-26 审核）：原来那句按「带得了声音样本」（refAudio）数，而 modeBlock 挡对话正反打认的是「出声」（audio）——
 *   今天两位落在同一批档上，出声却不收声音样本的档（MiniMax H3）一来，对话正反打在它上面能用、提示却永远不提它。
 *   构建检查核对（三位能力的八种组合）：clearsBlock(why, 档) ⇔ 这一档上没有任何模式因为 why 被挡 —— 宽了指去点不动的档，窄了漏掉能用的档。
 * startOnly 那个原因没有「换到哪一档」的说法（选法屏另有一句），所以不在这里。
 */
export function clearsBlock(why: "refImg" | "audio", tier: ModeTier): boolean {
  return why === "refImg" ? tier.refImg : tier.audio;
}
