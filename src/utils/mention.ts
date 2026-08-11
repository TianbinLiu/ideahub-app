// @提及的规则 —— **App 侧唯一一处**（铁律六）。
//
// ★★ 2026-08 的产品决定：**要能 @ 显示名**（昵称叫「我是王桑」的人必须能被
//   `@我是王桑` 叫到），而且**改名之后，已经发出去的那些 @ 要跟着显示新名字**。
//   这个文件原来通篇在论证「身份不能挂在可变且不唯一的 displayName 上」——
//   那个顾虑本身是对的，但解法不是退回 `@username`，而是把**身份**与**显示**拆开：
//
//     · 身份永远是 **userId** —— 存进库的是它，"通知发给谁"只由它决定；
//     · 显示永远取**当前**的 displayName —— 渲染时按 userId 现查，所以改名自动同步；
//     · 正文里那段名字只是**当时打出来的字面**，不承担任何身份职责。
//
//   于是"名字会变、会重名"不再是问题：名字变了显示跟着变，重名也各是各的 userId。
//
// ★★ 中文没有词边界，所以**不靠正则猜**。`@我是王桑你看看这个` 是切不出「我是王桑」的：
//   贪婪匹配会把整句吃掉，逐个试前缀等于一句话查 N 次库。真正知道"用户选的是谁"的
//   是**补全面板**（他是从面板里挑的人），所以由客户端把 span（正文里这一段是谁）
//   一起报上去。服务端**不盲信**这份名单（盲信等于谁都能给任意人发通知），而是**核对**：
//
//       text[offset] === '@'  且  text.slice(offset+1, offset+1+length) === 那个人当前的名字
//
//   核对这一步保证「客户端声称 @ 了谁」与「正文里真的写着谁」一致 ——
//   伪造不出一个正文里根本没出现的提及。核不过的那一条被服务端丢掉（不是整条评论 400）。
//
// ★ 下面两条 ASCII 令牌常量**没有删**：服务端**同时保留** `@username` 的自动解析当兜底 ——
//   手打 `@tianbinliu`（不经补全面板）必须继续可用，老版本 App 发上来的评论也必须继续可用。
//   它们现在只服务于这条兜底路径：
//     · MentionText  —— 老数据/老服务端回的 mention **没有 span** 时，退回按令牌在正文里定位；
//     · MentionInput —— 判"这个 @ 是不是贴在邮箱中间"，决定要不要弹补全面板。
//
// ★ 这里原来还有 `MENTION_NAME_MAX = 32`（服务端兜底正则 `{1,32}` 的镜像）和
//   `isMentionName()`：补全面板用它们拦掉"中文昵称"和"超长 username"的查询词 ——
//   因为那时令牌就是 `@username`，查出来也 @ 不到。改成按显示名 + span 之后这两条
//   拦截**必须**去掉（拦着的话中文昵称永远搜不出人，正是这一轮要修的问题），
//   于是它们一个调用方都不剩了。写了没人读 = 纯占地方，一并删掉；
//   那个 32 只约束服务端自己那条兜底正则，App 侧再没有地方需要知道它。

/** ASCII 兜底令牌里允许出现的单个字符（服务端字符类 `[A-Za-z0-9_-]`）。
 *  用来判"这个令牌到这儿是不是真的结束了"——不判的话 `@alice` 会在 `@alicexyz` 里点亮半截。 */
export const MENTION_NAME_CHAR = /[A-Za-z0-9_-]/;

/**
 * `@` **前面**那个字符：出现这些就说明这个 `@` 多半不是一次提及的开头。
 *
 * 与服务端兜底解析的前置断言 `(?<![\w@])` 逐字对应（`\w` 无 `u` 标志 = `[A-Za-z0-9_]`）。
 * 那条断言是用来挡**邮箱**的：`bob@alice.com` 里的 `@alice` 服务端从来不算一次提及。
 */
export const MENTION_PREV_BLOCK = /[A-Za-z0-9_@]/;

// ── 补全面板挑中的人 → 提交时的 span ──────────────────────

/** 补全面板插进正文的一次选择：「我把这个人的这个名字打进去了」。
 *  `name` 是**插入那一刻**的显示名（displayName || username），只用来在最终文本里定位。 */
export interface MentionPick {
  userId: string;
  name: string;
  /**
   * 插入那一刻 `@` 的下标，只作**定位提示**用。
   *
   * ★ 为什么需要它：`displayName` 不唯一。两个人都叫「王桑」时，光靠"按 picks 顺序
   *   认领第一处还没被占的 `@王桑`"会认错人 —— 用户先在句尾插了 B、又把光标移回句首插了 A，
   *   picks 顺序是 [B, A] 而文本顺序是 [A, B]，于是两条 span 正好对调。
   *   而服务端那三道核对对**两个同名用户都成立**（正文里确实写着这个名字），挡不住这次错配，
   *   表现是"@ 到了同名的另一个人"，两边都不报错。
   * ★ 只是提示不是断言：插入之后用户还会继续编辑，下标会漂。所以最终仍以正文为准，
   *   只是在多个候选位置里挑**离提示最近**的那一个。缺省（老调用方没传）时退回原来的"取第一个"。
   */
  at?: number;
}

/** 报给服务端的一段提及。`offset` 是正文里那个 `@` 的下标，`length` 是名字长度（不含 `@`）。 */
export interface MentionSpan {
  userId: string;
  offset: number;
  length: number;
}

/**
 * 把「这次编辑里挑过哪些人」落成「最终文本里的哪几段是谁」。
 *
 * ★★ **必须在按下发送的那一刻算，不能沿用插入时算好的 offset。**
 *   用户挑完人还会接着编辑：在前面加一句话、删掉几个字、把 @ 整段删了重打 ——
 *   插入时算的下标会整体漂掉。漂了不会报错：服务端拿着漂掉的 offset 去核对
 *   `text[offset] === '@'`，核不过就把这一条丢掉 —— 表现是"面板里明明选了人，
 *   对方就是收不到"，正是铁律八要消灭的静默失败。所以这里以**最终文本**为准重新定位。
 *
 * ★ 同一个名字在正文里出现多次时，**按出现顺序依次配对**：picks 是按插入顺序攒的，
 *   每个 pick 认领它能找到的第一处**尚未被占用**的位置。两个人恰好同名（displayName
 *   本来就不唯一）时，先插的那个配到前面那一处，与用户看到的顺序一致。
 *
 * ★ 找不到 = 用户把那一段删了（或改花了）。**直接丢掉**，不报错也不猜：正文里
 *   已经没有那个人的名字了，再报上去服务端核对也过不了。
 *
 * ★ 同一个 userId 只留第一次（服务端也会去重，但两边都做，省得多发一条上去）。
 *
 * ★ 长度用 `String.length`（UTF-16 code unit），不是码点数：服务端核对时用的是
 *   JS 的 `String.prototype.slice`，两边必须同一个口径，否则昵称里带 emoji
 *   或生僻字（代理对）的人会被整批核对失败 —— 又是一次不报错的失败。
 */
export function resolveMentionSpans(text: string, picks: MentionPick[]): MentionSpan[] {
  if (!text || picks.length === 0) return [];
  const spans: MentionSpan[] = [];
  const seen = new Set<string>();
  /** 已被前面的 pick 认领的区间，避免两个 pick 抢同一处 `@名字` */
  const taken: Array<[number, number]> = [];
  for (const p of picks) {
    if (!p || !p.userId || !p.name || seen.has(p.userId)) continue;
    const token = `@${p.name}`;
    // 先把这个名字在正文里所有**还没被认领**的出现位置收齐，再挑一个 —— 不是见到第一个就要。
    const free: number[] = [];
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at < 0) break;
      from = at + 1; // +1 而不是 +token.length：`@@alice` 这种重叠写法也要能扫到
      const end = at + token.length;
      if (!taken.some(([s, e]) => at < e && end > s)) free.push(at);
    }
    if (free.length === 0) continue;
    // ★ 有插入位置提示就挑**离它最近**的那一处（同名两个人时这是唯一能分辨谁是谁的信息，
    //   见 MentionPick.at）；没有提示就退回"取最靠前的一处"，与原来的行为一致。
    const at =
      typeof p.at === "number"
        ? free.reduce((best, cur) => (Math.abs(cur - p.at!) < Math.abs(best - p.at!) ? cur : best), free[0])
        : free[0];
    taken.push([at, at + token.length]);
    spans.push({ userId: p.userId, offset: at, length: p.name.length });
    seen.add(p.userId);
  }
  // 按位置排序：服务端不要求有序，但排过之后日志与单测都好读
  return spans.sort((a, b) => a.offset - b.offset);
}
