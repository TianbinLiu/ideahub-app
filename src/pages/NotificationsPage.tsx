// 通知页（全屏推入，不在 TabLayout 里 —— 底栏只有五格，几何是承重的，见 CLAUDE.md）。
// 入口在个人页顶栏那颗铃铛，与设置齿轮并排。
//
// ★ 四种状态都要画出来：加载中 / 出错 / 空 / 离线。少画一种的表现都是同一件事 ——
//   用户看到一个空列表，然后自己去猜到底是"没人理我"还是"坏了"（铁律八）。
import { useCallback, useEffect, useSyncExternalStore } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import { useBackOr } from "../hooks/useBackOr";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationsState,
  refreshNotifications,
  subscribeNotifications,
  type NotificationItem,
} from "../data/notifications";
import { relativeTime } from "../types";

/** 一句话说清"谁做了什么"。作品名/评论正文在下一行单独展示，这里只给动作 */
function actionText(n: NotificationItem): string {
  switch (n.type) {
    case "BRANCH_LIKE":
      return "赞了你的作品";
    case "BRANCH_COMMENT":
      return "评论了你的作品";
    case "BRANCH_COMMENT_REPLY":
      return "回复了你的评论";
    case "BRANCH_COMMENT_LIKE":
      return "赞了你的评论";
    case "BRANCH_MENTION":
      // ★ 与「评论了你的作品」分开写：被 @ 的人**未必是作品作者**，多半是路过的第三个人。
      //   共用一句文案会让他以为是自己的作品被评论了，点进去发现是别人的片子。
      return "在评论里 @ 了你";
    case "ADMIN_NOTICE":
      // 平台口吻的那一行不走这个句式（见 NoticeRow），这里只是类型上兜全
      return "平台通知";
    case "SUPPORT_TICKET":
      return "提交了客服工单";
    case "SUPPORT_REPLY":
      return "客服回复了你的工单";
    default:
      // ★★ 铁律七：**不认识的类型原样显示类型名**，不吞、不崩。这一支在类型上是
      //   never（白名单是闭合联合），但运行时形状由服务端决定 —— 哪天两边版本错开，
      //   能在界面上看见那个陌生词的人才知道该升级 App 了（铁律八：静默失败最糟）。
      //   ⚠ 今天真正的未知类型到不了这里：data/notifications.ts 的 toItem 会把
      //   白名单外的类型整条丢掉（return null）。这里是渲染层自己的最后一道兜底。
      return String((n as NotificationItem).type);
  }
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const backOrMe = useBackOr("/me");
  const state = useSyncExternalStore(subscribeNotifications, notificationsState);

  // 重复刷新（切回本页 / App 从后台恢复）才看可见性。
  //
  // ★ 后台/最小化的 WebView 里定时器会被节流甚至停掉，所以**不做 setInterval 轮询**。
  //   真正会发生的两件事：路由切回本页、App 从后台恢复 —— 就在这两处刷新。
  //   hidden 时连请求都不发：那一发既看不见结果，也可能被浏览器挂到恢复之后才真正
  //   发出，白白制造一次"回来时数据是旧的"。
  const reload = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void refreshNotifications();
  }, []);

  useEffect(() => {
    // ★★ **首次装载不看可见性**。这条 guard 原来也罩着首次装载，于是
    //   visibilityState 是 hidden 的时候进本页，请求不发、loading 也没人清掉 ——
    //   页面就永远停在「正在取消息…」，自己好不了（实测：窗口被挡住时必现）。
    //   "别做无用的后台轮询"是对的，但把它套在**用户刚刚点进来的那一次**上就成了
    //   一个永不结束的转圈。用户导航到这一页本身就是"我现在要看"，照发不误；
    //   下面那两个监听器负责之后的事。
    void refreshNotifications();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Capacitor 的原生恢复最终也会走 window focus（WebView 重新拿到焦点）
    window.addEventListener("focus", reload);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);

  /**
   * 点开一条通知。
   *
   * ★★ 有目标可去时**不在这儿标已读**，把这一步交给真正打开成功的那一页
   *   （VideoPage 拿到内容后调 markNotificationRead）。
   *   原来是点下去就标：而这一跳很可能落在「视频不存在」上 —— 被 @ 的人多半是
   *   路过的第三个人，那支片子本来就不在他的推荐流里。结果是内容没看到、红点也没了，
   *   唯一的入口就这么消失。已读的含义是"这条我处理过了"，在把人送到之前不该先划掉。
   * ★ 没有目标可去的那些（服务端没 populate 出 videoId）照旧就地标已读：
   *   它本来就只能"看一眼"，不标的话红点永远消不掉。
   */
  function open(n: NotificationItem) {
    // 客服工单：管理员进后台队列，用户进「我的工单」。工单页打开即算处理过，就地标已读。
    if (n.ticketId) {
      void markNotificationRead(n.id);
      navigate(n.type === "SUPPORT_TICKET" ? "/admin?view=support" : `/support?tab=tickets&ticket=${encodeURIComponent(n.ticketId)}`);
      return;
    }
    if (n.videoId) {
      navigate(`/video/${n.videoId}`, { state: { fromNotification: n.id } });
      return;
    }
    void markNotificationRead(n.id);
  }

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        sticky
        onBack={backOrMe}
        title="消息"
        right={
          state.unread > 0 ? (
            <button
              onClick={() => void markAllNotificationsRead()}
              className="h-11 flex-none whitespace-nowrap px-2 text-xs font-semibold text-slate-400 active:opacity-60"
            >
              全部已读
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-8">
        {/* ★ 顺序是承重的：**先**看"问出结果没有"。online 要等 refreshNotifications
            跑过一次才有意义（它在 useEffect 里，首帧之后），先判 online 的话每次进来
            都会先闪一下"当前是离线模式"——一个还没查证就下的结论。 */}
        {state.loading ? (
          <div className="flex flex-col items-center gap-3 py-20 text-slate-500">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
            <span className="text-xs">正在取消息…</span>
          </div>
        ) : !state.online ? (
          // ★ 措辞不能说成"这个版本没有服务器"：!remoteOn() 也包括「配了地址但连不上」。
          //   说死了会让一个只是断网的人以为要换个包。
          <Empty text="通知需要连上服务器 · 当前是离线模式" hint="联网后重新打开这一页就能看到" />
        ) : !state.supported ? (
          <Empty text="这台服务器还没有通知功能" hint="服务端升级后即可使用，App 不用重装" />
        ) : state.error ? (
          <div className="py-16 text-center">
            <p className="text-sm text-rose-300">通知没拉到：{state.error}</p>
            <button
              onClick={() => void refreshNotifications()}
              className="mt-4 rounded-full bg-panel px-5 py-2 text-sm font-semibold text-slate-100 ring-1 ring-slate-700"
            >
              重试
            </button>
          </div>
        ) : state.items.length === 0 ? (
          <Empty text="还没有新消息" hint="别人赞你、评论你、回复你、在评论里 @ 你，或平台发来通知时会出现在这里" />
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {state.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className="flex w-full items-start gap-3 py-3.5 text-left active:opacity-70"
                >
                  {n.type === "ADMIN_NOTICE" ? (
                    // ★ 平台口吻：**不显示是哪个管理员发的**（数据里 actor 是那位管理员，
                    //   但把审核员透给被通知的用户等于把他摆到被骚扰的位置 ——
                    //   与举报下架不带 by 是同一条取舍）。头像位画一只铃铛顶替。
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand/15 text-brand">
                      <Icon name="bell" size={20} />
                    </span>
                  ) : (
                    <Avatar name={n.actorName} src={n.actorAvatar} size={40} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200">
                      {n.type === "ADMIN_NOTICE" ? (
                        <span className="font-semibold">平台通知</span>
                      ) : (
                        <>
                          <span className="font-semibold">{n.actorName}</span>
                          <span className="text-slate-400"> {actionText(n)}</span>
                        </>
                      )}
                    </div>
                    {n.type === "ADMIN_NOTICE" ? (
                      // ★ 正文**不截断**（互动通知那行是预览，这行是内容本身）：
                      //   平台通知多半在解释一次处置，被截掉一半比没收到更糟。
                      n.commentText ? (
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-300">
                          {n.commentText}
                        </div>
                      ) : (
                        // 服务端没把正文放进 payload.commentText —— 契约问题，说出来（铁律八）
                        <div className="mt-0.5 text-[13px] text-rose-300">（通知内容缺失）</div>
                      )
                    ) : (
                      n.commentText && (
                        <div className="mt-0.5 truncate text-[13px] text-slate-300">「{n.commentText}」</div>
                      )
                    )}
                    {n.videoTitle && (
                      <div className="mt-0.5 truncate text-xs text-slate-500">{n.videoTitle}</div>
                    )}
                    <div className="mt-1 text-[11px] text-slate-600">{relativeTime(n.at)}</div>
                  </div>
                  {/* 未读点：靠右，与头像同一条基线 */}
                  {!n.read && <span className="mt-2 h-2 w-2 flex-none rounded-full bg-rose-500" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Icon name="bell" size={40} className="text-slate-700" />
      <p className="text-sm text-slate-400">{text}</p>
      <p className="text-xs text-slate-600">{hint}</p>
    </div>
  );
}
