// 评论正文渲染：把**服务端确认解析到人**的那几个 @提及画成链接，其余原样是纯文本。
//
// ★★ 这个组件最重要的一条是它**不解析正文**。
//   谁被 @ 到了由服务端说了算（它自己扫正文、自己去库里查 username，不信客户端报的名单），
//   回包里的 `mentions` 就是"哪几 @ 真的落地了"。这里只拿那几个令牌去正文里**定位**，
//   而不是自己拿正则再扫一遍 —— 自己扫的话，`@不存在的人` 也会被画成蓝字，
//   用户以为通知发出去了，实际上对方永远收不到（铁律八：这正是要避免的静默失败）。
//   反过来，打错的那个 @ 留成灰字就是给用户的回执：一眼看出这一 @ 没中。
import { Link } from "react-router";
import { profileHref } from "../data/videos";
// ★ 字符集/边界规则与 MentionInput 共用**同一份**（utils/mention.ts）：
//   两边问的是同一个问题「服务端会把这一段认成一次提及吗」，答案分叉就会出现
//   "面板里 @ 得到、正文里不点亮"（或反过来）这种只有用户才发现得了的差异（铁律六）。
import { MENTION_NAME_CHAR, MENTION_PREV_BLOCK } from "../utils/mention";
import type { CommentMention } from "../types";

interface Piece {
  text: string;
  /** 有值 = 这一段是一个解析成功的提及 */
  mention?: CommentMention;
}

/**
 * 正文 + 服务端给的提及表 → 分段。导出只为单测方便，渲染走下面的组件。
 *
 * ★ 大小写不敏感地找：服务端把令牌 lowercase 之后再查库（`username` 本身就是小写唯一），
 *   所以正文里的 `@Alice` 与 `@alice` 解析到的**是同一个人** —— 两个都点亮才是实情。
 * ★ 令牌**前后**都要判边界，两边口径必须与服务端逐字一致，否则会出现"点亮了、其实没通知"。
 *   后面：`@alice` 不许在 `@alicexyz` 里点亮半截。
 *   前面：服务端的 `(?<![\w@])` 把紧跟在字母/数字/下划线/@ 后面的那个 `@` 排除在外（这条
 *   前置断言就是用来挡邮箱的）。这里漏判的表现是：评论 "@alice 有事找我 bob@alice.com"
 *   里，邮箱**中间**那截 `@alice` 也被画成链接 —— 用户想复制邮箱，一点就跳去了别人主页，
 *   而服务端从来没把它算作一次提及。
 */
export function splitMentions(text: string, mentions?: CommentMention[]): Piece[] {
  if (!text) return [];
  if (!mentions || mentions.length === 0) return [{ text }];

  const lower = text.toLowerCase();
  const hits: Array<{ start: number; end: number; mention: CommentMention }> = [];
  for (const m of mentions) {
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
      if (ok) hits.push({ start: at, end: at + token.length, mention: m });
      from = at + token.length;
    }
  }
  if (hits.length === 0) return [{ text }];

  // 重叠时先到先得（`@ab` 与 `@abc` 同时命中同一处的极端情况）：位置靠前、更长的优先
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    if (h.start > cursor) pieces.push({ text: text.slice(cursor, h.start) });
    pieces.push({ text: text.slice(h.start, h.end), mention: h.mention });
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
