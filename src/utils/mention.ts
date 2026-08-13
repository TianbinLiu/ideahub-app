// @提及的规则 —— **App 侧唯一一处**（铁律六）。
//
// ★★ 2026-08 的产品决定：**@ 的句柄就是 `username`**。
//   username 是注册时定下、之后**不可改**的登录标识，天然唯一 —— 拿它当公开句柄，
//   "我该在 @ 后面打什么"这个问题就有了一个永远不会变的答案。
//
//   这一条推翻了上一轮的「令牌用显示名」。推翻的直接理由不是理论，而是那一版**自相矛盾**：
//   补全面板的候选格子上画的是 `@username`，真正插进正文的却是显示名 ——
//   用户照着面板念出来的那一串，和 App 替他打进去的那一串不是同一个东西。
//
// ★★ 但「身份 / 显示 / 字面」仍然是**三件事**，这一层没有回退：
//     · 身份永远是 **userId** —— 存进库的是它，"通知发给谁"只由它决定；
//     · 显示永远取**当前**的 displayName —— MentionText 拿 span 把正文那一段**换成**
//       此刻的显示名再画出来，所以对方改名之后，已经发出去的那些 @ 照样跟着变；
//     · 正文里那一段只是**当时打进去的字面**（现在是 username），不承担身份职责。
//   也就是说：**打的是句柄，看到的是名字**。改名同步这件事一个字都没丢。
//
// ★★ span（正文里这一段是谁）**继续报**，它不是显示名那一版的遗留物：
//   ① `username` 允许是非 ASCII（注册侧只校验长度，见 server 的 utils/username.js），
//      而服务端的兜底正则只认 `[A-Za-z0-9_-]` —— 中文 username 的账号**只能**靠 span
//      被 @ 到（服务端 mentionParser 文件头写着这条，那是它的原话）；
//   ② span 与 ASCII 兜底解析是**两条独立的路**，服务端合并去重。ASCII username 这条
//      主路现在两条都走得通，多一层保险不多花一次查询（服务端两条查询并行发）。
//
//   服务端**不盲信**这份名单（盲信等于谁都能给任意人发通知），而是**核对**：
//
//       text[offset] === '@'  且  text.slice(offset+1, offset+1+length)
//                                 === 那个人当下的 displayName **或** username
//
//   ★ 「或 username」这一支是服务端自己写着的（mentionParser.resolveMentionSpans，
//     理由是"从没设过昵称的人显示的就是 username"）—— 所以这一轮把令牌从显示名改回
//     username，**span 照样核得过**，通知不会因此失效。这句是读过服务端代码确认的，
//     不是推测。
//
// ★ 下面两条 ASCII 令牌常量服务于**兜底定位**那条路：
//     · MentionText  —— 老数据/老服务端回的 mention **没有 span** 时，退回按令牌在正文里定位；
//     · MentionInput —— 判"这个 @ 是不是贴在邮箱中间"，决定要不要弹补全面板。
//
// ★ 补全面板**不再**按 username 长度过滤候选人（那道门禁上一轮删掉了，这一轮不加回来）：
//   服务端兜底正则的上限 `{1,32}` 与注册侧的 `MAX_USERNAME_LEN = 32` 是同一个数，
//   也就是说**不存在**长到 @ 不动的 username；而真有那么一天，span 这条路也定得到位。
//   在 App 侧再镜像一份 32 就是第二处实现，改了服务端却没人记得回来改这里。

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

/** 补全面板插进正文的一次选择：「我把这个人的句柄打进去了」。 */
export interface MentionPick {
  userId: string;
  /**
   * 插进正文的那一串**句柄**（`username`，不含 `@`），只用来在最终文本里定位。
   *
   * ⚠ 字段名留作 `name` 是刻意的：两个调用方（CommentSheet / VideoPage）只是把整个
   *   pick 原样攒起来再交给 data 层，谁都不读这个字段 —— 为了改个名去动两个不归本轮
   *   管的文件，风险大于收益。语义以这段注释为准：它是句柄，不是显示名。
   */
  name: string;
  /**
   * 插入那一刻 `@` 的下标，只作**定位提示**用。
   *
   * ★ 令牌改回 username（唯一）之后，"两个同名的人被认错"这个原始动机没有了 ——
   *   每个 pick 的令牌各不相同，也就抢不到同一处。留着它是为了另一件仍然会发生的事：
   *   **同一个句柄在正文里出现两次**（用户手打了一次 `@alice`，又从面板挑了一次）。
   *   这时按提示挑离插入点最近的那一处，画出来的链接才落在用户真正挑的那一段上；
   *   取第一处的话链接会跑到他手打的那一串上。
   *   ⚠ 这是**观感**问题不是通知问题：句柄唯一，两处都指向同一个 userId，
   *     哪一处被选中都通知得到人。所以别为了它再加什么校验。
   * ★ 只是提示不是断言：插入之后用户还会继续编辑，下标会漂。所以最终仍以正文为准，
   *   只是在多个候选位置里挑**离提示最近**的那一个。缺省（老调用方没传）时退回"取第一个"。
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
 * ★ 定位用的是**句柄**（`pick.name` = username），与 MentionInput 真正插进正文的
 *   那一串逐字相等。这两处一旦分叉就是"面板里选了人、报上去的 span 指着别处"，
 *   而服务端只会把核不过的那一条**默默丢掉** —— 所以插入与定位必须读同一个字段。
 *
 * ★ 同一个句柄在正文里出现多次时，**按出现顺序依次配对**：picks 是按插入顺序攒的，
 *   每个 pick 认领它能找到的第一处**尚未被占用**的位置（有 `at` 提示时挑离它最近的）。
 *
 * ★ 找不到 = 用户把那一段删了（或改花了）。**直接丢掉**，不报错也不猜：正文里
 *   已经没有那个句柄了，再报上去服务端核对也过不了。
 *
 * ★ **不在这里判令牌前后的边界**（`@alice` 落在 `@alicexyz` 里那种）。这条规则属于
 *   服务端的 ASCII 兜底解析与 MentionText 的兜底定位，而 span 这条路按定义就是
 *   "客户端明确指出的一段"，服务端也只核对那一段的内容。在这儿再判一次等于第三处实现，
 *   而且它会让"用户挑完人紧接着又打了个字母"变成**一个通知都收不到**（span 被自己丢掉、
 *   ASCII 兜底也匹配不上那个更长的串）—— 比现在这个"链接只画在句柄那几个字上"糟得多。
 *
 * ★ 同一个 userId 只留第一次（服务端也会去重，但两边都做，省得多发一条上去）。
 *
 * ★ 长度用 `String.length`（UTF-16 code unit），不是码点数：服务端核对时用的是
 *   JS 的 `String.prototype.slice`，两边必须同一个口径，否则句柄里带非 ASCII
 *   （username 允许中文）的人会被整批核对失败 —— 又是一次不报错的失败。
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
    // 先把这个句柄在正文里所有**还没被认领**的出现位置收齐，再挑一个 —— 不是见到第一个就要。
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
    // ★ 有插入位置提示就挑**离它最近**的那一处（同一个句柄在正文里出现两次时，这是唯一
    //   能分辨"用户挑的是哪一处"的信息，见 MentionPick.at）；没有提示就退回"取最靠前的一处"。
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
