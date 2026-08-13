// 「一个人」长什么样 —— **两处共用这一份**（铁律六）：
//   · MentionInput 的 @补全面板（挑人）
//   · DiscoverPage 的搜人结果（点进主页）
// 两边原来各写了一遍几乎一样的三行 JSX，于是"头像多大、名字在上还是句柄在上、
// 句柄要不要带 @"这些事各有各的答案，改一处漏一处。
//
// ★★ 第二行画的是 **@username**，而**插进正文的令牌也是它**（MentionInput.insert）。
//   这两串必须逐字相等：格子上写一套、插进去另一套的话，用户照着面板念出来的
//   句柄根本 @ 不到人（上一轮就是这个形状）。所以这一行是"给用户看的句柄"的
//   **唯一出处** —— 别在调用点另拼一次。
//
// ★ 返回的是 **Fragment 不是一个盒子**：外面那层在两处是不同的东西（面板里是
//   <button>、搜索结果里是 <Link>，后者尾巴上还挂一枚箭头），间距也各有各的。
//   共用的是"一个人由哪几块信息组成"，不是"它被装在什么容器里"——把容器也吞进来
//   就得给它开一串样式参数，那种组件下一个人只会绕开它自己写。
//   调用方负责提供 `flex items-center` 的容器。
import Avatar from "./Avatar";
import { userDisplayName, type ApiUserLite } from "../api/users";

export default function UserRow({ user, size = 32 }: { user: ApiUserLite; size?: number }) {
  const name = userDisplayName(user);
  return (
    <>
      <Avatar name={name} src={user.avatarUrl} size={size} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-100">{name}</span>
        {/* ★ 显示名可以重复（两个人都叫「我是王桑」），这一行才是能把他们分开的那个东西，
            也是 @ 他时要打的那一串。缺了它，面板上两行一模一样的候选没法选。 */}
        <span className="block truncate text-[11px] text-slate-500">@{user.username}</span>
      </span>
    </>
  );
}
