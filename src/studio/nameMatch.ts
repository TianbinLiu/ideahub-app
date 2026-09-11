// 画布指挥「按名字找模板 / 找卡 / 摘卡」的匹配规则 —— 唯一实现（D10 第 1 步，统一执行顺序第 5 批）。
//
// ★★ 为什么要有它：原来三处各写一份「双向包含」（canvasAgent 的 findTemplate / findCard / 摘卡），两个坑：
//   · 说全名也会歧义：分段组的标题是「宗主 · 第 1/3 段」「宗主 · 第 2/3 段」…（server branchTemplate.routes.js），
//     另有一个就叫「宗主」的模板时，说「宗主」三个全中 —— 用户说得再准也被拒；
//   · 摘卡那一处连歧义都不报：用 find 取**第一个**包含命中，段上同时挂着「凛」和「凛·校服」时说「摘掉凛」，
//     摘哪张看挂的先后，零报错地摘错卡。
// ⇒ 规则：两边先按同一套规范化（剥引号、剥开头的「模板」、去空白、小写），**相等优先**；一个相等的都没有才退回双向包含；
//   多个同样好的命中照样交给调用方报歧义（同名不同 id 是真实存在的）。
// ★ 零依赖、纯函数：浏览器里直接 import 就能测，不牵 store。

/** 句子里常见的引号（中文直角 / 书名式 / 弯引号 / 直引号）——模型和用户都爱给名字加 */
const QUOTES = /[「」『』“”"']/g;
/** 开头的「模板」（「套模板「宗主」」切出来常常是「模板宗主」「模板「宗主」」） */
const TEMPLATE_PREFIX = /^模板/;

/** 名字的规范形：剥引号 → 去空白 → 剥开头的「模板」→ 小写。模板标题与卡名两边用同一个 */
export function normName(raw: string): string {
  return String(raw ?? "")
    .replace(QUOTES, "")
    .replace(/\s+/g, "")
    .replace(TEMPLATE_PREFIX, "")
    .toLowerCase();
}

/**
 * 在 items 里按名字找：相等优先，没有相等才退回双向包含。返回全部同样好的命中（0 个 = 没找到，>1 = 歧义，由调用方说）。
 * ★ 规范化后是空串（只写了引号、只写了「模板」）一律当没找到 —— 空串被任何名字「包含」，不拦的话会命中全部。
 */
export function matchByName<T>(items: readonly T[], raw: string, nameOf: (item: T) => string): T[] {
  const key = normName(raw);
  if (!key) return [];
  const exact = items.filter((it) => normName(nameOf(it)) === key);
  if (exact.length > 0) return exact;
  return items.filter((it) => {
    const n = normName(nameOf(it));
    return n.length > 0 && (n.includes(key) || key.includes(n));
  });
}
