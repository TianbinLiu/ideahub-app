// 工作流「跟着做」模式的清单，与「这个出片模型上能不能用」的判定 —— 唯一实现（2026-10-04，方案 docs/guided-modes-design.md）。
//
// 纯数据 + 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-guided-modes.mjs 直接 import 它跑正反例。
// 界面上的字（名字、一句话、出处）不在这里 —— 那是界面文案，进 Lingui 目录，在 components/flow/ModePicker 那一份。
//
// ★★ 主人 10-04「六个模式也需要根据用户选择的模型来选择性显示」：模式能不能用**按档位的能力判**（收不收参考图、是不是按发计价的真人档、
//   能不能推演三套），不按档位名判 —— 价目表改了、加了一档，这里不用跟着改。档位的能力由调用方从 economy.VideoTier 读出来传进来。
// ★ 还没做出来的模式**不进清单**：摆一个点不动的选项，用户只会觉得功能坏了（CLAUDE.md 已知的坑那一格）。
//   做出来的那一期再加一行，判定写在 modeBlock 里（C 九宫格分镜在第三期 2026-10-05 加上）。

/** 模式 id（与设计稿的字母对照：direct = A、lead = B、grid = C、custom = F、cards = D、template = E） */
export type GuidedModeId = "direct" | "lead" | "grid" | "custom" | "cards" | "template";

/** 选法屏上的三组：基础 / 跟着高手做 / 复刻 */
export type GuidedGroup = "basic" | "pro" | "replica";

export interface GuidedModeDef {
  id: GuidedModeId;
  /** 设计稿里的字母，方便对照 docs/guided-modes-design.md */
  letter: "A" | "B" | "C" | "D" | "E" | "F";
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
  { id: "cards", letter: "D", group: "pro", steps: 3 },
  { id: "template", letter: "E", group: "replica", steps: 2 },
];

export const GUIDED_GROUPS: readonly GuidedGroup[] = ["basic", "pro", "replica"];

/** 判定要用到的档位能力（只拿这几位，免得这个文件依赖档位表） */
export interface ModeTier {
  /** 收参考图（economy.VideoTier.refImg） */
  refImg: boolean;
  /** 按发计价的档（真人档）：起拍画面就是真人卡的照片，一张设定帧都不画 */
  flat: boolean;
}

/**
 * 某个模式在这一档上为什么用不了（null = 能用）：
 * · refImg —— 这一档收不了参考图：「参考图直出」只剩一段纯文字生成（1.0 两档）；
 * · flat —— 真人档：没有推演三套那一步（economy.deriveIssue），「自定义」也没意义（本来就是直出，画布那颗页签同样灰着）。
 * ★ 真人档上「参考图直出」**能用**：它就是这一档本来的样子（真人卡的照片起拍、写一句话直接出片），出片规则在 segmentGen 的真人档那一支。
 * ★ 「主角定妆 · 多镜头」只在收参考图的档上（高清 / 电影级）：它的出片就是参考图直出（主角图直接给视频模型、不画帧）加一段多镜头带台词的剧本 ——
 *   1.0 两档收不了参考图（只剩纯文字，「先把人定死」那一步白做）；真人档不收参考图、也没有多镜头台词这回事（只拿真人卡的照片起拍）。
 * ★ 「九宫格分镜」只挡真人档：它的出片是「那一格的画面当开头帧」—— 收参考图的两档另带人物图（帧当参考图发），
 *   1.0 两档那一格当首帧硬约束（标准档照旧补画结束帧，flowStore.noDrawFor）；真人档的起拍画面只能是真人卡的照片，一格画面放不进去。
 * ★ 「套模板」不按档位挡：模板能在哪几档跑由模板自己说（data/templates.templateRunsOn），货架按选的模型筛。
 */
export function modeBlock(id: GuidedModeId, tier: ModeTier): "refImg" | "flat" | null {
  switch (id) {
    case "direct":
      return tier.refImg || tier.flat ? null : "refImg";
    case "lead":
      return tier.refImg ? null : "refImg";
    case "grid":
    case "custom":
    case "cards":
      return tier.flat ? "flat" : null;
    case "template":
      return null;
  }
}

/** 这一档上能用的模式（按清单顺序） */
export function modesOn(tier: ModeTier): GuidedModeDef[] {
  return GUIDED_MODES.filter((m) => modeBlock(m.id, tier) === null);
}
