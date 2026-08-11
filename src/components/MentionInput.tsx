// 带 @提及补全的单行输入框。**两个评论输入口共用这一份**（首页评论抽屉 CommentSheet、
// 详情页 VideoPage 的评论框）——铁律六：补全规则、防抖、插入光标位置这三件事一旦分叉，
// 就会出现"抽屉里能 @ 出来、详情页 @ 不出来"这种只有用户才发现得了的差异。
//
// ★★ 为什么这个补全是**功能的一部分**而不是锦上添花：
//   提及的令牌是 **@username**（服务端 mentionParser 认的就是它；`username` 唯一且不可改，
//   `displayName` 可空、不唯一、随时能改——身份不能挂在会变的字段上）。
//   而这个 App 从头到尾显示的都是 displayName，`username` **一次都没露过**。
//   没有这个补全，用户在 @ 后面只能凭猜，猜错就是"发出去了、对方收不到"——
//   而正文里那一 @ 看起来一切正常。这正是铁律八要消灭的那类静默失败。
//
// ★ 离线模式不出补全面板：那时这台机器上只有你一个人，面板永远是空的，
//   摆一个永远查不到人的搜索框比不摆更糟（CLAUDE.md「界面上摆一个永远点不动的选项」）。
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { searchUsers, userDisplayName, type ApiUserLite } from "../api/users";
import { remoteOn } from "../data/videos";
// ★ 令牌规则（字符集 / 长度上限 / 前置边界）与 MentionText 共用**同一份**
//   （utils/mention.ts）：两边问的是同一个问题「服务端会把这一段认成一次提及吗」。
//   这一轮给它加长度上限时才发现规则原来抄了两份 —— 一改就得改两处（铁律六）。
import { MENTION_NAME_MAX, MENTION_PREV_BLOCK, isMentionName } from "../utils/mention";

/** 中日韩字。只用来判"用户是不是在拿中文昵称当 @ 的对象"，好给一句提示 */
const CJK = /[一-鿿㐀-䶿]/;

/** 防抖。250ms：短于一次连击的间隔，又不至于让人觉得列表"卡了一下才出来"。
 *  ★ 不防抖的话每敲一个字母就是一次请求，而 `/api/users/search` 那条查询是**全表扫**
 *  （不锚定 + 大小写不敏感的正则用不上索引）。服务端已经按 IP 限到 120/分钟
 *  （server 仓 routes/users.routes.js 的 `users:search`），但那道闸的额度是**按防抖之后
 *  的真人手速**定的（一次搜索约 3~5 个请求）。这里去掉防抖，逐字母发请求就会把同一个
 *  出口的额度吃光 —— 撞上就是 429，而同一个 Wi-Fi 下的其他人也一起搜不出人来。 */
const DEBOUNCE_MS = 250;
/** 一次最多列几个。手机上超过 6 行面板就会盖住半屏评论 */
const LIMIT = 6;

/** 光标前那个正在输入的 @查询。返回 null = 现在不该弹面板 */
function mentionQueryAt(value: string, caret: number): { at: number; q: string } | null {
  const head = value.slice(0, caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  // ★★ 这个 `@` 前面贴着字母/数字/_/@ 的话，服务端**根本不会**把它当成一次提及
  //   （mentionParser 的 `(?<![\w@])`，那条断言是用来挡 `bob@example.com` 的）。
  //   不判这一下的后果最坏：用户打 "cc@ali" → 面板照样弹 → 他从里面挑了一个人 →
  //   插进去变成 "cc@alice " → 发出去，服务端一个提及都没解析到，对方**永远收不到**。
  //   也就是补全面板亲手把用户带进了铁律八要消灭的那种静默失败。不弹面板才是实情。
  if (at > 0 && MENTION_PREV_BLOCK.test(head[at - 1])) return null;
  const q = head.slice(at + 1);
  // 光标就贴在 @ 后面（q 为空）不查：空 q 服务端也只会回空表，白打一次请求
  if (q.length < 1) return null;
  return { at, q };
}

export interface MentionInputProps {
  value: string;
  onChange: (v: string) => void;
  /** 回车提交。★ 面板开着时**不会**触发——那一下回车是"选中这个人"，不是"发送" */
  onEnter?: () => void;
  placeholder?: string;
  /** 输入框自己的样式（调用方各有各的圆角/配色，只有行为共用） */
  className?: string;
  /** 外层定位盒的样式；面板是相对它绝对定位的 */
  wrapperClassName?: string;
  /** 调用方要主动聚焦时用（CommentSheet 点「回复」会聚焦） */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function MentionInput({
  value,
  onChange,
  onEnter,
  placeholder,
  className = "",
  wrapperClassName = "relative min-w-0 flex-1",
  inputRef,
}: MentionInputProps) {
  const innerRef = useRef<HTMLInputElement>(null);
  const el = inputRef ?? innerRef;
  const [caret, setCaret] = useState(0);
  const [users, setUsers] = useState<ApiUserLite[]>([]);
  const [hi, setHi] = useState(0);
  /** 查不了/查失败的原因，直接给用户看。空串 = 没话说 */
  const [note, setNote] = useState("");
  /** 用户按过 Esc：这一轮查询不再弹面板（换个查询词自动复位） */
  const [dismissed, setDismissed] = useState(false);

  const found = mentionQueryAt(value, caret);
  const query = found?.q ?? "";
  const active = found !== null;
  // 字符集 + 长度一起判：超过 MENTION_NAME_MAX 的串服务端只会截前 32 个字去查，
  // 谁都匹配不上（见 utils/mention.ts）——那种查询查出来的人插进去也是白插
  const canSearch = query.length > 0 && isMentionName(query);

  // ★ 竞态守门：输入快时后发的请求可能先回来。用一个自增序号，只认最后一次那发的结果，
  //   否则面板会闪回上一个词的候选人（而用户以为那就是当前词的结果，@ 错人）。
  const seq = useRef(0);

  useEffect(() => {
    if (!remoteOn() || !active) {
      setUsers([]);
      setNote("");
      return;
    }
    if (!canSearch) {
      setUsers([]);
      // ★ 两种"打了也白打"要分开说，说错等于给用户一个假原因：
      //   · 中文昵称必然 @ 不中 —— 服务端只认 ASCII 的 username。
      //   · 超过 32 个字符的令牌服务端只截前 32 个去查，同样匹配不到人。
      //   与其让用户打完、发出去、再靠"没变成链接"去发现失败，不如现在就说清楚。
      setNote(
        query.length > MENTION_NAME_MAX
          ? `账号最多 ${MENTION_NAME_MAX} 个字符，再往后打就 @ 不到人了`
          : CJK.test(query)
            ? "@ 的是对方的账号（字母/数字/_/-），不是昵称"
            : "",
      );
      return;
    }
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      void searchUsers(query, LIMIT)
        .then((r) => {
          if (seq.current !== mine) return;
          // ★★ 账号本身超过 32 个字符的人**不能列进来**：列了、用户挑了、插进正文，
          //   服务端解析时只截到前 32 个字符 —— 匹配不到任何人，那条提及就凭空消失了
          //   （评论发成功、正文里 @ 得好好的、对方永远收不到，正是铁律八要消灭的
          //   那类静默失败）。丢掉也不能不吭声，下面把"丢了几个"说出来。
          const usable = r.users.filter((u) => u.username.length <= MENTION_NAME_MAX);
          const dropped = r.users.length - usable.length;
          setUsers(usable);
          setHi(0);
          // 老服务端 / SPA 回退：说清楚是"这台服务器没有这个能力"，
          // 不要伪装成"查无此人"——后者会让用户以为对方注销了
          setNote(
            !r.supported
              ? "这台服务器还不支持搜人，@ 可能收不到"
              : dropped > 0
                ? `有 ${dropped} 个账号超过 ${MENTION_NAME_MAX} 个字符，@ 不到他们`
                : "",
          );
        })
        .catch((e) => {
          if (seq.current !== mine) return;
          // 全 app 没有任何地方监听 emitApiError：这里吞掉 = 面板永远空着，
          // 用户分不出"没这个人"和"网炸了"（铁律八）
          setUsers([]);
          setNote(e instanceof Error ? `搜人失败：${e.message}` : "搜人失败");
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, canSearch, active]);

  // 换了查询词就复位 Esc 的效果：用户重新打字显然是想再看候选
  useEffect(() => setDismissed(false), [query]);

  const sync = useCallback(
    (e: { currentTarget: HTMLInputElement }) => setCaret(e.currentTarget.selectionStart ?? 0),
    [],
  );

  const open = !dismissed && (users.length > 0 || note !== "");

  function insert(u: ApiUserLite) {
    const node = el.current;
    const pos = node?.selectionStart ?? value.length;
    const hit = mentionQueryAt(value, pos);
    if (!hit) return;
    const before = value.slice(0, hit.at);
    const after = value.slice(pos);
    // 尾随空格是刻意的：不加的话下一次输入会被并进用户名里（`@alice好棒` 解析成 `alice好棒`）
    const token = `@${u.username} `;
    onChange(before + token + after);
    setUsers([]);
    setNote("");
    const next = before.length + token.length;
    // 受控组件：value 要等父组件那一拍才回来，光标必须在**回来之后**再摆，
    // 否则会被浏览器按旧值重置到末尾
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(next, next);
      setCaret(next);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && users.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHi((h) => (h + 1) % users.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHi((h) => (h - 1 + users.length) % users.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
      // isComposing：中文输入法选词时的回车是"上屏"，不是别的意思（与两个调用方一致）
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        insert(users[Math.min(hi, users.length - 1)]);
        return;
      }
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) onEnter?.();
  }

  return (
    <div className={wrapperClassName}>
      {open && (
        // 面板开在输入框**上方**：手机上键盘从底部升起来，开在下方就被键盘盖住了。
        // 只是 absolute（不是 fixed）——祖先里有 backdrop-blur/transform 时 fixed 会
        // 认错包含块（CLAUDE.md 里那条坑），而这里本来也只需要贴着输入框。
        <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-xl border border-slate-700 bg-panel shadow-[0_8px_30px_rgba(0,0,0,.5)]">
          {note && <p className="px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">{note}</p>}
          {users.length > 0 && (
            <ul className="max-h-52 overflow-y-auto">
              {users.map((u, i) => (
                <li key={u._id}>
                  <button
                    type="button"
                    // ★ 必须在 pointerdown 就拦下来：等到 click 时输入框已经 blur 过一轮，
                    //   移动端上表现为"点了一下面板关了，人没插进去"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      insert(u);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                      i === hi ? "bg-slate-700/60" : ""
                    }`}
                  >
                    <Avatar name={userDisplayName(u)} src={u.avatarUrl} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">{userDisplayName(u)}</span>
                      {/* ★ @username 必须显示出来：用户认得的是昵称，而真正被插进去、
                          真正决定"通知发给谁"的是这一行。不显示就等于让人蒙着眼睛选。 */}
                      <span className="block truncate text-[11px] text-slate-500">@{u.username}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <input
        ref={el}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={sync}
        onClick={sync}
        onSelect={sync}
        placeholder={placeholder}
        className={`w-full ${className}`}
      />
    </div>
  );
}
