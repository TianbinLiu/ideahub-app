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
    case "type-cap": {
      const typeName = failure.cardType ? cardTypeName(failure.cardType) : t`这类`;
      return t`${typeName}位已经 ${failure.count ?? 0} / ${failure.cap ?? 0} 个了——先把桌上一张拖回背包，或者直接拖到想换掉的那一格上`;
    }
    case "wrong-slot-type": {
      // 拖错类型要当场说清"这个位子要什么、你拖的是什么"（施工单：走规则层的原因，别自己编）
      const got = failure.cardType ? cardTypeName(failure.cardType) : t`这张`;
      if (failure.cardType === "item") return t`道具卡不占桌面卡位——它是从右边栏拖到角色卡上装备的`;
      const want = failure.expected ? cardTypeName(failure.expected) : t`另一种`;
      return t`这个位子放的是${want}卡：${got}卡拖不进这一格`;
    }
    case "bad-table-slot":
      return t`这个桌面卡位不存在（只有 4 个角色位 + 1 个场景位）`;
    case "table-slot-empty":
      return t`这一格是空的——拖一张卡上去才算占位`;
    case "card-on-table":
      return t`这张卡已经摆在桌面上了——先把它从卡位拖回背包`;
    case "role-not-on-table":
      return t`这张角色卡还没摆到桌面上——先把它拖进一个角色位，道具才挂得上去`;
    case "card-not-in-bag":
      return t`这张卡不在背包里了（可能刚被卖掉 / 摆到桌上 / 挂到角色身上）`;
    case "item-equipped":
      return t`这件道具正装备在角色身上——先把那个角色身上的道具卸下来`;
    case "role-equipped":
      return t`这张角色身上还挂着道具——先卸下道具，再挪动或换掉它`;
    case "not-an-item":
      return t`只有道具卡能装到角色身上`;
    case "not-a-role":
      return t`道具只能装到角色卡上`;
    case "item-limit":
      return t`这张角色已经挂了 ${failure.count ?? 0} / ${failure.cap ?? 0} 张道具——上限了，先卸一张（或者拖拆除工具一次清空）`;
    case "no-equipped-item":
      return t`这张角色身上没有道具`;
    case "not-enough-gold":
      return t`金币不够：要 ${failure.need ?? 0} 金，现在只有 ${failure.have ?? 0} 金`;
    case "slot-empty":
      return t`商店这一格已经买走了`;
    case "bad-slot":
      return t`商店没有这一格`;
    case "wrong-phase":
      return t`这个阶段做不了这件事——买卡 / 卖卡 / 装备在商店阶段，交片在创作阶段，点赞在展映，投票在投票阶段`;
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
    // ── G3 回合循环（§2.4 创作 / §2.5 展映投票）──
    case "prompt-empty":
      return t`写一句提示词再拍——这一期拍什么就靠这句话`;
    case "prompt-too-long":
      return t`提示词太长了：最多 ${failure.cap ?? 0} 字，现在 ${failure.have ?? 0} 字`;
    case "entries-pending":
      return t`还有 ${failure.count ?? 0} 个人没交片——展映要把全员的片子都放一遍`;
    case "entry-not-found":
      return t`这一期没有这条片子`;
    case "entry-already-liked":
      return t`这一条你已经点过赞了（同一期同一条只能点一次）`;
    case "already-voted":
      return t`这一期你已经投过票（或者已经弃权了）——一人一票`;
    case "self-vote":
      return t`不能投给自己——选别人的一条`;
    case "votes-pending":
      return t`还有 ${failure.count ?? 0} 个人没投票——全员表态之后才结算`;
    default:
      // 规则层以后新增了原因码、这里还没写人话：把原因码原样摆出来（不吞掉、不编一个"操作失败"）。
      return t`这一步没成功（规则回的原因：${String(failure.reason)}）`;
  }
}
