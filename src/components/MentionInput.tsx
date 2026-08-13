// 带 @提及补全的单行输入框。**两个评论输入口共用这一份**（首页评论抽屉 CommentSheet、
// 详情页 VideoPage 的评论框）——铁律六：补全规则、防抖、插入光标位置这三件事一旦分叉，
// 就会出现"抽屉里能 @ 出来、详情页 @ 不出来"这种只有用户才发现得了的差异。
//
// ★★ 面板插进正文的是 **@username**（句柄），与候选格子第二行画的那一串逐字相等。
//   username 不可改、天然唯一，所以"我该在 @ 后面打什么"有一个永远不变的答案。
//   身份仍然不靠这段字面承担 —— 面板同时记住"这一次挑的是哪个 userId"（picks），
//   提交时由 data/videos.addReply 按最终正文把它落成 span 报给服务端，服务端再核对；
//   而**渲染**时显示的是对方**当下的显示名**（见 MentionText），所以改名照样同步。
//   一句话：**打的是句柄，看到的是名字**。完整取舍写在 utils/mention.ts 顶部。
//
// ★★ 为什么这个补全仍然是**功能的一部分**而不是锦上添花：这个 App 从头到尾显示的都是
//   displayName，`username` 除了这块面板与搜人结果之外**一次都没露过**（见 UserRow）。
//   没有补全，用户根本无从知道该在 @ 后面打哪一串 —— 每一次 @ 都会静悄悄地
//   谁也通知不到（铁律八）。另外 username 允许是非 ASCII（注册侧只校验长度），
//   那种账号服务端的兜底正则解析不到，只能靠面板报上去的 span。
//
// ★ 离线模式不出补全面板：那时这台机器上只有你一个人，面板永远是空的，
//   摆一个永远查不到人的搜索框比不摆更糟（CLAUDE.md「界面上摆一个永远点不动的选项」）。
import { useCallback, useEffect, useRef, useState } from "react";
import UserRow from "./UserRow";
import { searchUsers, type ApiUserLite } from "../api/users";
import { remoteOn } from "../data/videos";
// ★ `@` 的前置边界规则与 MentionText 共用**同一份**（utils/mention.ts）。
import { MENTION_PREV_BLOCK, type MentionPick } from "../utils/mention";

/** 防抖。250ms：短于一次连击的间隔，又不至于让人觉得列表"卡了一下才出来"。
 *  ★ 不防抖的话每敲一个字母就是一次请求，而 `/api/users/search` 那条查询是**全表扫**
 *  （不锚定 + 大小写不敏感的正则用不上索引）。服务端已经按 IP 限到 120/分钟
 *  （server 仓 routes/users.routes.js 的 `users:search`），但那道闸的额度是**按防抖之后
 *  的真人手速**定的（一次搜索约 3~5 个请求）。这里去掉防抖，逐字母发请求就会把同一个
 *  出口的额度吃光 —— 撞上就是 429，而同一个 Wi-Fi 下的其他人也一起搜不出人来。 */
const DEBOUNCE_MS = 250;
/** 一次最多列几个。手机上超过 6 行面板就会盖住半屏评论 */
const LIMIT = 6;
/**
 * 光标前那一段查询词最多取多长。
 *
 * ★ 这不是"名字上限"，也不是"句柄上限"（username 最长 32），是**别把整句话当查询词
 *   发出去**：`@` 后面用户可能一直打下去，而服务端的 searchRegex 会截断、查全表。
 *   服务端是**子串**匹配，不必打全 —— 24 个字符足够认出任何一个昵称或句柄；
 *   超过就当他不是在 @ 人（面板收起来，正文照旧是纯文本）。
 */
const QUERY_MAX = 24;

/** 光标前那个正在输入的 @查询。返回 null = 现在不该弹面板 */
function mentionQueryAt(value: string, caret: number): { at: number; q: string } | null {
  const head = value.slice(0, caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  // ★ 这个 `@` 前面贴着字母/数字/_/@ 的话不弹面板 —— 那是**邮箱**的形状
  //   （`bob@example.com`）。服务端的 ASCII 兜底解析用同一条前置断言把它挡在外面。
  //   走 span 那条路的话服务端其实认（它只核对 text[offset]==='@' 与名字），
  //   但在一个邮箱地址中间弹出"选个人"的面板是纯粹的噪音，而用户想真的 @ 人时
  //   只要在 @ 前面留个空格就行 —— 代价小，误弹的频率高。
  if (at > 0 && MENTION_PREV_BLOCK.test(head[at - 1])) return null;
  const q = head.slice(at + 1);
  // 光标就贴在 @ 后面（q 为空）不查：空 q 服务端也只会回空表，白打一次请求
  if (q.length < 1) return null;
  // 打得太长 = 他在写正文，不是在挑人
  if (q.length > QUERY_MAX) return null;
  // ★ 换行/制表符出现在查询词里说明这个 @ 早就结束了（多行输入时）
  if (/[\n\r\t]/.test(q)) return null;
  // ★★ 查询词**以空白结尾 = 这一次 @ 已经打完了**，面板必须收起来。
  //   查询词里允许有空格（显示名本来就可以带空格，`@我是 王桑` 要搜得到），
  //   但结尾那一下空格是"名字到此为止"的信号。漏了这一条的后果是一个**闭环**：
  //   insert() 插进去的 token 自带尾随空格（`@我是王桑 `），光标停在空格之后 →
  //   查询词变成 `"我是王桑 "` → searchUsers 里 `q.trim()` 又把它还原成 `"我是王桑"`
  //   → 服务端 exactDisplay 那一发照样命中 → **刚挑完人，面板 250ms 后自己又弹回来**，
  //   而面板开着时的回车是"选中这个人"不是"发送"（见 onKeyDown）——
  //   用户挑完人按回车，评论发不出去，只会把同一个人再插一遍。
  //   （原来这条是靠 `isMentionName(query)` 顺带挡住的：空格不在 `[A-Za-z0-9_-]` 里。
  //     这一轮为了让中文昵称能搜而删掉了那道门禁，就必须把这半条规则单独补回来。）
  if (/\s$/.test(q)) return null;
  return { at, q };
}

export interface MentionInputProps {
  value: string;
  onChange: (v: string) => void;
  /**
   * 从面板里挑中了一个人。
   *
   * ★★ 调用方要把这些 pick **攒起来**、在提交时原样交给 data 层
   *   （`addReply(..., picks)`）。为什么不是在这里就把 offset 算好交出去：
   *   用户挑完人还会接着编辑正文（在前面加字、删字），插入那一刻算的下标会整体漂掉。
   *   所以这里只交出"是谁 + 当时打进去的名字"，真正的定位在**按下发送的那一刻**
   *   由 utils/mention.resolveMentionSpans 按最终正文重算（那里写了完整理由）。
   */
  onPick?: (pick: MentionPick) => void;
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
  onPick,
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

  // ★ 竞态守门：输入快时后发的请求可能先回来。用一个自增序号，只认最后一次那发的结果，
  //   否则面板会闪回上一个词的候选人（而用户以为那就是当前词的结果，@ 错人）。
  const seq = useRef(0);

  useEffect(() => {
    if (!remoteOn() || !active) {
      setUsers([]);
      setNote("");
      return;
    }
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      void searchUsers(query, LIMIT)
        .then((r) => {
          if (seq.current !== mine) return;
          // ★★ 这里**不按 username 长度过滤候选人**（2026-08 删掉过一道 32 字符的门禁，
          //   这一轮令牌改回 username 也不加回来）：服务端兜底正则的 `{1,32}` 与注册侧的
          //   MAX_USERNAME_LEN 是同一个数，长到 @ 不动的 username 根本存不进库；
          //   而万一哪天存进去了，span 那条路照样定位得到。在这儿镜像一份 32 只会变成
          //   第二处实现 —— 服务端放宽之后，这里会静默地把一批人从搜索结果里抹掉。
          setUsers(r.users);
          setHi(0);
          // 老服务端 / SPA 回退：说清楚是"这台服务器没有这个能力"，
          // 不要伪装成"查无此人"——后者会让用户以为对方注销了
          setNote(r.supported ? "" : "这台服务器还不支持搜人，@ 可能收不到");
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
  }, [query, active]);

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
    // ★★ 插的是 **username**（句柄），与候选格子第二行画的那一串**逐字相等** ——
    //   这一条是这一轮修的东西：上一版格子里写 `@username`、插进去的却是显示名。
    //   ★ 尾随空格是刻意的：`@alice好棒` 读起来分不出句柄到哪儿结束，而服务端的
    //     ASCII 兜底解析也要靠这个边界（`@alice好棒` 里 `好` 不是令牌字符，其实切得出来，
    //     但 `@alice2` 就会被当成另一个人）。span 那条路不受影响，正文是给人读的。
    const handle = u.username;
    const token = `@${handle} `;
    onChange(before + token + after);
    // ★ 身份在这里就记下来（userId），不靠事后从正文里猜。顺带把插入位置也交出去：
    //   同一个句柄在正文里出现两次时，这是提交时唯一能分辨"用户挑的是哪一处"的信息
    //   （见 MentionPick.at）。它只是提示，最终仍以提交那一刻的正文为准。
    onPick?.({ userId: u._id, name: handle, at: hit.at });
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
                    {/* ★ 与分区页搜人结果**同一个组件**（铁律六）：这一行第二排画的
                        `@username` 就是 insert() 插进正文的那一串，两处不许各画各的 */}
                    <UserRow user={u} size={28} />
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
