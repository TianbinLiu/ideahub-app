/**
 * 规则拒绝的那一下说成什么人话 —— **只有这一份**（G2 第二块）。
 *
 * ★ 为什么单独一个文件：rules.ts 是零依赖纯函数、只回稳定的英文原因码（`RuleRejectReason`），
 *   界面负责说人话（docs/game-rules-engine.md「约定」）。商店 / 背包 / 装备 / 风格屏都会说这几句，
 *   各写一份的话同一个失败在不同面板会念出两种说法（甚至一块面板干脆不说 —— 铁律八）。
 * ★ 话里出现的数字全部来自 RuleFailure 自己带的 count / cap / need / have（rules 给的），
 *   这里不重算任何规则：不读金币、不查上限、不数背包。
 * ★ 调用那一刻才翻（函数体里的 t），别把这几句提成模块常量（会冻结在开机语言）。
 */
import { t } from "@lingui/core/macro";
import type { RuleFailure } from "./rules";
import { cardTypeName } from "./labels";

export function ruleFailureText(failure: RuleFailure): string {
  switch (failure.reason) {
    case "bag-full":
      return t`背包满了（${failure.count ?? 0} / ${failure.cap ?? 9} 格）——先卖一张，或者用它替换掉背包里的一张卡`;
    case "type-cap": {
      const typeName = failure.cardType ? cardTypeName(failure.cardType) : t`这类`;
      return t`${typeName}卡已经 ${failure.count ?? 0} / ${failure.cap ?? 0} 张，到上限了——先卖一张，或者替换掉一张${typeName}卡`;
    }
    case "card-not-in-bag":
      return t`这张卡不在背包里了（可能刚被卖掉或被替换掉）`;
    case "item-equipped":
      return t`这件道具正装备在角色身上——先点那张角色卡把它卸下来`;
    case "role-equipped":
      return t`这张角色身上还挂着道具——先点它卸下道具，再替换`;
    case "not-an-item":
      return t`只有道具卡能装到角色身上`;
    case "not-a-role":
      return t`道具只能装到角色卡上`;
    case "role-already-equipped":
      return t`这张角色已经有一件道具了——一个角色只能挂一件，先卸下再换`;
    case "no-equipped-item":
      return t`这张角色身上没有道具`;
    case "not-enough-gold":
      return t`金币不够：要 ${failure.need ?? 0} 金，现在只有 ${failure.have ?? 0} 金`;
    case "slot-empty":
      return t`商店这一格已经买走了`;
    case "bad-slot":
      return t`商店没有这一格`;
    case "wrong-phase":
      return t`现在不是买卖的时候——买卡、卖卡、装备都只在商店阶段能做`;
    case "unknown-player":
      return t`这一局里找不到你`;
    case "player-eliminated":
      return t`你已经淘汰了，不能再操作`;
    case "style-locked":
      return t`风格卡选定就锁死了，整局都不能换`;
    case "style-not-offered":
      return t`这张风格卡不在你抽到的那三张里`;
    case "ranking-mismatch":
      return t`名次名单和存活玩家对不上，这次结算没有生效`;
    case "option-unavailable":
      return t`这个事件选项现在不出现（要先升级或连胜数不够）`;
    case "event-not-drawn":
      return t`这一回合没有抽到事件`;
    case "event-already-picked":
      return t`这一回合你已经选过了`;
    case "round-limit":
      return t`已经打到第 ${failure.cap ?? failure.count ?? 0} 回合，没有下一回合了`;
    case "no-cards-left":
      return t`卡池里已经没有这种品质的卡了`;
    default:
      // 规则层以后新增了原因码、这里还没写人话：把原因码原样摆出来（不吞掉、不编一个"操作失败"）。
      return t`这一步没成功（规则回的原因：${String(failure.reason)}）`;
  }
}
