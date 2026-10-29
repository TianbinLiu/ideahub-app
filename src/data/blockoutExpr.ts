// 白模模板的「神态」：套用时按卡名写一句神态（2026-10-26 主人第 3 件「白模模板保留示例视频里的表情神态」，方案 D）。
//
// ★ 为什么要有这一句（付费小验，¥63.93，读数在 docs/blockout-expression-2026-10-26.md）：
//   白模化把人换成纯白人偶时，二次元素材上**脸被抹平**，套用时换上去的角色照着白模视频演 —— 动作都在，惊讶 / 大笑没了（A0：女孩该惊讶的那一拍是闭嘴笑）。
//   服务端在白模化那一次看帧对话里**顺带**记下每个人的神态（`markExprs`，与 markSlots 按下标对齐，零额外费用），
//   套用时写一句「神态：青璃先平静，后惊讶张嘴，再大笑；赤野先惊讶张嘴，后垂眼抿唇。」—— D 那一发三拍神态全出来了；
//   半写实 3D 素材上白模本身就留住了神态，加不加这句不增不减。所以上 D，白模视频一个像素不动。
// ★ 这个文件零运行时依赖（构建里 scripts/check-blockout-expr.mjs 直接 import 它跑正反例），句子是发给视频模型的，冻结中文。
// ★ 第一版只在 **≤ 3 个角色位**的模板上写（多人群像没验过）；没有 markExprs 的模板（所有老模板、编号方案、自己传白模片那条路）一个字不变。

/** 一个人的神态最多几个字（与服务端 blockoutize.service 的 EXPR_MAX 同一个数；服务端已经洗过，这里再收一道） */
export const EXPR_MAX = 16;

/** 角色位多于几个就不写神态句（2026-10-26 只验过 2 人的素材；3 人照两人那一发的形状外推一位，再多没验过） */
export const EXPR_SLOTS_MAX = 3;

/**
 * 一条神态 → 能安全写进神态句的那一截（"" = 不写）。
 * ★ 拿掉的东西与括号描述（blockoutPrompt.descIn）同一套理由：
 *   ① `（）()` 与 `=＝@＠` —— 紧凑绑定的语法记号，混进来会让模型把神态读成一条绑定；
 *   ② `；;` —— 神态句里人与人之间的分隔符；
 *   ③ 换行 —— 这是一整句；
 *   ④ 打头的「神态：」—— 服务端解析时模型偶尔把列名也写进值里，句子里只要一个。
 * ★ 顿号换成逗号（「先平静、后惊讶」→「先平静，后惊讶」）：顿号在神态句里会被读成「下一个人」。
 * ★ 超长从尾巴丢**整拍**：神态是时间顺序（先 → 后 → 再），丢最后那一拍比丢开头那一拍好（开头是起点）；
 *   不从中间一刀 —— 「再大笑，最后」这种半拍比没有更坏（与 descIn 丢整个分句同一条理由）。一拍都丢不动（就一拍还超长）才硬切。
 */
export function exprIn(expr: unknown): string {
  if (typeof expr !== "string") return "";
  const clean = expr
    // i18n-ignore-next-line: 服务端回的列名前缀（冻结中文），只用来剥掉
    .replace(/^\s*神态\s*[：:]\s*/, "")
    .replace(/[、]/g, "，")
    .replace(/[（）()=＝；;@＠\n\r|｜]/g, "")
    .replace(/[，,]\s*$/, "")
    .trim();
  const len = (x: string) => [...x].length;
  if (len(clean) <= EXPR_MAX) return clean;
  const beats = clean.split(/[，,]/).filter(Boolean);
  while (beats.length > 1 && len(beats.join("，")) > EXPR_MAX) beats.pop();
  const left = beats.join("，");
  return len(left) <= EXPR_MAX ? left : [...left].slice(0, EXPR_MAX).join("");
}

/** 神态句里的一个位子：挂上的卡（名字 + id）与这个位子的神态 */
export interface ExprSlot {
  /** 挂上的卡；null = 这个位子没挂卡（不写它的神态：句子是按卡名说的） */
  card: { id: string; name: string } | null;
  /** 这个位子在白模视频里的神态（markExprs[markSlots.indexOf(label)]，"" = 没有） */
  expr: string;
}

/**
 * 拼出神态句（"" = 这一次不写）：「神态：青璃先平静，后惊讶张嘴，再大笑；赤野先惊讶张嘴，后垂眼抿唇。」
 * · 只收**挂了卡且有神态**的位子；顺序照调用方给的（blockoutPrompt 传排好序的 slots = 画面从左到右）；
 * · 同一张卡挂在两个位子上的**一个都不写**：句子是按卡名说的，「凛先大笑；凛先皱眉」会让模型拿不准是谁；
 * · 角色位多于 EXPR_SLOTS_MAX 个整句不写（slotCount 是这个模板的角色位总数，含没挂卡的）。
 * 写法照付费小验 D 那一句（人与人之间「；」，句末「。」），别改措辞 —— 换个说法就是另一份没验过的提示词。
 */
export function exprLineOf(slots: readonly ExprSlot[], slotCount: number): string {
  if (slotCount > EXPR_SLOTS_MAX) return "";
  const uses = new Map<string, number>();
  for (const s of slots) if (s.card) uses.set(s.card.id, (uses.get(s.card.id) ?? 0) + 1);
  const items = slots.flatMap((s) => {
    const e = exprIn(s.expr);
    if (!s.card || !e || (uses.get(s.card.id) ?? 0) > 1) return [];
    return [`${s.card.name}${e}`];
  });
  // i18n-ignore-next-line: 发给视频模型的神态句（付费小验 D 验过的写法，冻结中文）
  return items.length ? `神态：${items.join("；")}。` : "";
}

/**
 * 加上神态句之后放不放得下 —— 放不下就**整句不写**（绝不挤掉别的：括号描述、用户那句话、「不要出现字幕」都比它要紧）。
 * @param withLine 已经插进神态句的整段骨架
 * @param budget   blockoutPrompt.blockoutPromptBudget 的结果
 */
export function fitsExpr(withLine: string, budget: number): boolean {
  return withLine.length <= budget;
}
