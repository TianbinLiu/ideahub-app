// 评论正文渲染：把**服务端确认解析到人**的那几个 @提及画成链接，其余原样是纯文本。
//
// ★★ 这个组件最重要的一条是它**不解析正文**。
//   谁被 @ 到了由服务端说了算（客户端可以报 span，但服务端会拿正文逐条核对），
//   回包里的 `mentions` 就是"哪几 @ 真的落地了"。这里只按它给的位置去正文里**定位**，
//   而不是自己拿正则再扫一遍 —— 自己扫的话，`@不存在的人` 也会被画成蓝字，
//   用户以为通知发出去了，实际上对方永远收不到（铁律八：这正是要避免的静默失败）。
//   反过来，打错的那个 @ 留成灰字就是给用户的回执：一眼看出这一 @ 没中。
//
// ★★ 显示的名字取的是 **payload 里的当前 displayName**，不是正文里那段字面。
//   正文里那段是**发评论那一刻**打进去的名字；服务端每次回包都现查一遍当前值。
//   所以被 @ 的人改了昵称之后，已经发出去的那些 @ 会自动显示新名字 ——
//   这就是"改名后同步"的全部实现（身份是 userId，显示是当前名，两件事分开）。
import { Link } from "react-router";
import { profileHref } from "../data/videos";
// ★ 字符集/边界规则与 MentionInput 共用**同一份**（utils/mention.ts）：
//   这里只在**没有 span** 的兜底路径上用它们（老数据 / 老服务端 / 手打 `@username`）。
import { MENTION_NAME_CHAR, MENTION_PREV_BLOCK } from "../utils/mention";
import type { CommentMention } from "../types";

interface Piece {
  /** 要画出来的文字。★ 提及段用的是**当前**显示名，可能与正文里那一段不一样 */
  text: string;
  /** 有值 = 这一段是一个解析成功的提及 */
  mention?: CommentMention;
}

/** 这个人**现在**叫什么。★ 与 api/users.userDisplayName、branch.authorName 同一条口径 */
function currentName(m: CommentMention): string {
  return m.displayName || m.username;
}

/**
 * 正文 + 服务端给的提及表 → 分段。导出只为单测方便，渲染走下面的组件。
 *
 * 两条定位路径，**优先 span**：
 *
 * ① span（`offset`/`length`）—— 服务端核对过的精确位置。中文昵称只能走这条：
 *    `@我是王桑你看看这个` 没有词边界，拿名字去 indexOf 也会撞上"正文里恰好又出现了
 *    这个名字"的情况，位置只能由服务端给。这一段会被**替换**成 '@' + 当前显示名。
 *
 * ② token（`@username`）—— 兜底。老服务端、本轮之前发出去的评论、以及手打
 *    `@tianbinliu` 走服务端 ASCII 自动解析的那些，都只有 token 没有 span。
 *    这条路保持原样匹配（含前后边界判断），显示的仍是正文里那一段字面 ——
 *    没有 span 就没法确定"要替换哪一段"，硬替换会把正文改错。
 *
 * ★ 为什么**不需要**"从后往前替换"：这里不做字符串的原地替换，而是拿原文按命中区间
 *   切片、逐段推进游标拼出 pieces。所有 offset 自始至终对的都是**同一份原文**，
 *   不存在前面的替换把后面的下标冲掉的问题。（若改成 `text.slice` 拼接式的原地替换，
 *   就必须倒着做 —— 这也是为什么这里刻意不那么写。）
 *
 * ★ 大小写不敏感地找（兜底路径）：服务端把令牌 lowercase 之后再查库（`username` 本身
 *   就是小写唯一），所以正文里的 `@Alice` 与 `@alice` 解析到的**是同一个人**。
 * ★ 令牌**前后**都要判边界（兜底路径），口径必须与服务端逐字一致：
 *   后面：`@alice` 不许在 `@alicexyz` 里点亮半截。
 *   前面：服务端的 `(?<![\w@])` 把紧跟在字母/数字/下划线/@ 后面的那个 `@` 排除在外
 *   （这条前置断言就是用来挡邮箱的）。漏判的表现是：评论 "@alice 有事找我 bob@alice.com"
 *   里，邮箱**中间**那截 `@alice` 也被画成链接 —— 用户想复制邮箱，一点就跳去了别人主页，
 *   而服务端从来没把它算作一次提及。
 */
export function splitMentions(text: string, mentions?: CommentMention[]): Piece[] {
  if (!text) return [];
  if (!mentions || mentions.length === 0) return [{ text }];

  /** label = 这一段最终画出来的字；span 段是当前显示名，token 段是正文原样 */
  const hits: Array<{ start: number; end: number; label: string; mention: CommentMention }> = [];

  // ── ① span 优先 ──
  const withSpan = new Set<CommentMention>();
  for (const m of mentions) {
    // ★ 判「有没有 span」看两个字段是不是都是数字（后加字段，老数据一律 undefined）
    if (typeof m.offset !== "number" || typeof m.length !== "number") continue;
    const start = m.offset;
    const end = m.offset + 1 + m.length; // +1 = 那个 '@'
    // ★ 越界/对不上就当作没有 span：正文与 span 理论上是同时落库的，但中间层裁过字段、
    //   或者以后正文被规整过（trim/归一）都会让它对不上。切错一段比不切更糟 ——
    //   画出来的是一段乱码链接，用户完全看不懂发生了什么。
    if (start < 0 || end > text.length || text[start] !== "@") continue;
    withSpan.add(m);
    hits.push({ start, end, label: `@${currentName(m)}`, mention: m });
  }

  // ── ② 没有 span 的才走 token 兜底 ──
  const lower = text.toLowerCase();
  for (const m of mentions) {
    if (withSpan.has(m)) continue;
    const token = (m.token || `@${m.username}`).toLowerCase();
    if (token.length < 2) continue; // 只有一个 @，定位不了
    let from = 0;
    for (;;) {
      const at = lower.indexOf(token, from);
      if (at < 0) break;
      const next = text[at + token.length];
      const prev = at > 0 ? text[at - 1] : "";
      // 后面还跟着用户名字符 = 这只是更长的一个名字的前缀，不是这个人
      // 前面贴着字母/数字/_/@ = 服务端根本没把它当提及（邮箱就是这么被挡下的）
      const ok = (!next || !MENTION_NAME_CHAR.test(next)) && (!prev || !MENTION_PREV_BLOCK.test(prev));
      // ★ token 段显示的是**正文原样**（text.slice），不是 lower 那份 ——
      //   拿 lower 画出来的话 `@Alice` 会在界面上变成 `@alice`，等于悄悄改了用户写的字
      if (ok) hits.push({ start: at, end: at + token.length, label: text.slice(at, at + token.length), mention: m });
      from = at + token.length;
    }
  }
  if (hits.length === 0) return [{ text }];

  // 重叠时先到先得（span 与某个兜底 token 落在同一处、或 `@ab` 与 `@abc` 同时命中）：
  // 位置靠前、更长的优先
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (h.start > cursor) pieces.push({ text: text.slice(cursor, h.start) });
    pieces.push({ text: h.label, mention: h.mention });
    cursor = h.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor) });
  return pieces;
}

/**
 * @param onNavigate 点提及时的副作用（抽屉要先关掉自己，否则跳过去还盖着一层浮层）
 */
export default function MentionText({
  text,
  mentions,
  onNavigate,
}: {
  text: string;
  mentions?: CommentMention[];
  onNavigate?: () => void;
}) {
  const pieces = splitMentions(text, mentions);
  return (
    <>
      {pieces.map((p, i) =>
        p.mention ? (
          <Link
            key={i}
            // ★ 跳转按 **userId**：服务端解析提及时已经把人认准了，`userId` 就在手上，
            //   而展示名是可变、可重名的（拿它当身份的坑见 data/videos.renameMyVideos）。
            //   带上名字只是给目标页在还没问到服务端之前有个东西可显示（见 profileHref）。
            to={profileHref({ id: p.mention.userId, name: p.mention.displayName || p.mention.username })}
            onClick={(e) => {
              e.stopPropagation(); // 评论行整行可点（回复/点赞），别把提及的点击也算进去
              onNavigate?.();
            }}
            className="text-brand active:opacity-60"
          >
            {p.text}
          </Link>
        ) : (
          // 打错的 @ 就落在这一支里，是**普通文字**——用户据此知道这一 @ 没有落地
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
