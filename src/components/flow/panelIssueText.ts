// AI 看一遍发现的问题（data/gridShots.panelIssues）→ 人话 —— 九宫格分镜与对话正反打两个向导共用（2026-10-19 从 GridShotsWizard 抽出来）。
// ★ 九宫格说「这一格」、对话正反打说「这一张」：量词不当占位符拼（英文是另一种说法），每种各写一整句；九宫格那几句的原文一字没动（目录里的译文不用重做）。
// ★ 渲染时才调（t 读的是现在的界面语言），模块顶层不翻。
import { t } from "@lingui/core/macro";
import type { PanelIssue } from "../../data/gridShots";

/** 九宫格的一格（cell）还是对话正反打的一个机位（shot） */
export type PanelUnit = "cell" | "shot";

/** 一条问题 → 一句人话（英文按「接在逗号后面」写，小写开头；单独摆出来时用 panelIssuesLine） */
export function panelIssueText(x: PanelIssue, unit: PanelUnit): string {
  if (x.kind === "panels") {
    const got = x.got;
    return t`画成了 ${got} 格拼图`;
  }
  if (x.kind === "duplicate") return t`同一个人出现了两次`;
  const got = x.got;
  const want = x.want;
  if (unit === "cell") return want === 0 ? t`画面里有 ${got} 个人（这一格应该没有人）` : t`画面里有 ${got} 个人（这一格应该是 ${want} 个）`;
  return want === 0 ? t`画面里有 ${got} 个人（这一张应该没有人）` : t`画面里有 ${got} 个人（这一张应该是 ${want} 个）`;
}

/** 这一格 / 这一张的全部问题连成一句、首字母大写（中文不受影响） */
export function panelIssuesLine(issues: readonly PanelIssue[], unit: PanelUnit): string {
  const sep = t({ message: "、", comment: "列举几个名字时的分隔符" });
  const s = issues.map((x) => panelIssueText(x, unit)).join(sep);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
