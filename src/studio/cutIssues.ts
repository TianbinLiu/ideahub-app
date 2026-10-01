// 剪辑工程的改法被拒时的那句人话 —— **一处**（剪辑页手点的与「对剪辑台说话」办的，报的是同一句）。
// data/cutProject 是不认识界面语言的纯模块，只回原因代码（CutIssue）；话在这里说。
// ★ 调用那一刻才翻（函数体里的 t）：别在模块顶层把这几句存成常量 —— 会冻结在开机那一刻的语言上。
import { t } from "@lingui/core/macro";
import { MIN_CLIP_SEC, type CutIssue } from "../data/cutProject";

export function cutIssueText(issue: CutIssue): string {
  switch (issue) {
    case "edge":
      return t`分割点离片段边缘太近（至少留 ${MIN_CLIP_SEC} 秒）`;
    case "short":
      return t`这样裁完只剩不到 ${MIN_CLIP_SEC} 秒，片段太短了`;
    case "sibling":
      return t`这个片段是分割出来的，同一段还有另一半在时间轴上——回到整段会和它重叠，成片里同一截会播两遍。想撤销分割，先删掉另一半。`;
    case "last":
      return t`时间轴上只剩这一个片段了，不能再删。`;
    case "gone":
      return t`这个片段已经不在时间轴上了，重新点一个再操作。`;
  }
}
