// 通知页（全屏推入，不在 TabLayout 里 —— 底栏只有五格，几何是承重的，见 CLAUDE.md）。
// 入口在个人页顶栏那颗铃铛，与设置齿轮并排。
//
// ★ 四种状态都要画出来：加载中 / 出错 / 空 / 离线。少画一种的表现都是同一件事 ——
//   用户看到一个空列表，然后自己去猜到底是"没人理我"还是"坏了"（铁律八）。
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "../components/EmptyState";
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
import { fmtTokens } from "../data/economy";

/** 一句话说清"谁做了什么"。作品名/评论正文在下一行单独展示，这里只给动作 */
function actionText(n: NotificationItem): MessageDescriptor | null {
  switch (n.type) {
    case "BRANCH_LIKE":
      return msg`赞了你的作品`;
    case "BRANCH_COMMENT":
      return msg`评论了你的作品`;
    case "BRANCH_COMMENT_REPLY":
      return msg`回复了你的评论`;
    case "BRANCH_COMMENT_LIKE":
      return msg`赞了你的评论`;
    case "BRANCH_MENTION":
      // ★ 与「评论了你的作品」分开写：被 @ 的人**未必是作品作者**，多半是路过的第三个人。
      //   共用一句文案会让他以为是自己的作品被评论了，点进去发现是别人的片子。
      return msg`在评论里 @ 了你`;
    case "BRANCH_REVISED":
      // ★ 主语是**作品**不是人：收件人是收藏者，他关心的是"我收藏的那条变了"，
      //   而不是"某某做了件事"。NoticeRow 那一档同理。
      return msg`重新剪辑了你收藏的作品`;
    case "BRANCH_REMIX_REWARD":
      // 同款奖励到账（P3b）。金额与原作在下面单独两行（见渲染那段）；没带是谁的那种走礼物头像 + 「有人做了你的同款」
      return msg`做了你的同款`;
    case "ADMIN_NOTICE":
      // 平台口吻的那一行不走这个句式（见 NoticeRow），这里只是类型上兜全
      return msg`平台通知`;
    case "SUPPORT_TICKET":
      return msg`提交了客服工单`;
    case "SUPPORT_REPLY":
      return msg`客服回复了你的工单`;
    // 老师人格四类（M4）：主语分别是评分 / 评论的人、平台（回访到期没有 actor，走 NoticeRow 那种铃铛行）、作者
    case "TUTOR_RATING":
      return msg`给你发布的老师打了分`;
    case "TUTOR_COMMENT":
      return msg`评论了你发布的老师`;
    case "TUTOR_REVIEW_DUE":
      return msg`该回访了`;
    case "TUTOR_DOC_UPDATED":
      return msg`更新了你在学的老师`;
    default:
      // ★★ 铁律七：**不认识的类型原样显示类型名**，不吞、不崩。这一支在类型上是
      //   never（白名单是闭合联合），但运行时形状由服务端决定 —— 哪天两边版本错开，
      //   能在界面上看见那个陌生词的人才知道该升级 App 了（铁律八：静默失败最糟）。
      //   ⚠ 今天真正的未知类型到不了这里：data/notifications.ts 的 toItem 会把
      //   白名单外的类型整条丢掉（return null）。这里是渲染层自己的最后一道兜底。
      // 模块顶层只能给描述符（翻译要等渲染时），所以这一支回 null，由渲染层的 actionLabel 原样显示类型名
      return null;
  }
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const backOrMe = useBackOr("/me");
  const { t } = useLingui();
  /** 动作那半句：认识的类型走目录，不认识的原样显示类型名（见 actionText 的 ★★） */
  const actionLabel = (n: NotificationItem) => {
    const d = actionText(n);
    return d ? t(d) : String(n.type);
  };
  const state = useSyncExternalStore(subscribeNotifications, notificationsState);
  /** 「全部已读」在路上（要等服务端回包）：按钮上要有字 */
  const [marking, setMarking] = useState(false);

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
    // 同款奖励、但没带那条同款（拉黑 / 已不公开）：落到我自己那条被照着做的原作。已读同样交给打开成功的那一页
    if (n.reward?.originalId) {
      navigate(`/video/${n.reward.originalId}`, { state: { fromNotification: n.id } });
      return;
    }
    // 老师人格（M4）：到期回访 / 新版 → 那门课的上课页；评分 / 评论 → 课程列表（市场详情只在官网，App 里没有那一页）。
    // 上课页打开即算处理过，就地标已读（与工单同一条：它自己不认识通知）
    if (n.tutor) {
      void markNotificationRead(n.id);
      navigate(n.tutor.courseId ? `/tutor/run/${encodeURIComponent(n.tutor.courseId)}` : "/tutor");
      return;
    }
    void markNotificationRead(n.id);
  }

  return (
    <div className="min-h-full bg-ink">
      <PageHeader
        sticky
        onBack={backOrMe}
        title={t`消息`}
        right={
          state.unread > 0 ? (
            <button
              onClick={() => {
                if (marking) return;
                setMarking(true);
                void Promise.resolve(markAllNotificationsRead()).finally(() => setMarking(false));
              }}
              disabled={marking}
              className="h-11 flex-none whitespace-nowrap px-2 text-xs font-semibold text-slate-400 active:opacity-60 disabled:opacity-40"
            >
              {marking ? t`标记中…` : t`全部已读`}
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-10">
        {/* ★ 顺序是承重的：**先**看"问出结果没有"。online 要等 refreshNotifications
            跑过一次才有意义（它在 useEffect 里，首帧之后），先判 online 的话每次进来
            都会先闪一下"当前是离线模式"——一个还没查证就下的结论。 */}
        {state.loading ? (
          <EmptyState loading text={t`正在取消息…`} />
        ) : !state.online ? (
          // ★ 措辞不能说成"这个版本没有服务器"：!remoteOn() 也包括「配了地址但连不上」。
          //   说死了会让一个只是断网的人以为要换个包。
          <Empty text={t`通知需要连上服务器 · 当前是离线模式`} hint={t`联网后重新打开这一页就能看到`} />
        ) : !state.supported ? (
          <Empty text={t`这台服务器还没有通知功能`} hint={t`服务端升级后即可使用，App 不用重装`} />
        ) : state.error ? (
          <EmptyState error text={t`通知没拉到：${state.error}`} cta={{ label: t`重试`, onClick: () => void refreshNotifications() }} />
        ) : state.items.length === 0 ? (
          <Empty text={t`还没有新消息`} hint={t`别人赞你、评论你、回复你、在评论里 @ 你，或平台发来通知时会出现在这里`} />
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {state.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className="flex w-full items-start gap-3 py-3.5 text-left active:opacity-60"
                >
                  {n.type === "ADMIN_NOTICE" || n.type === "TUTOR_REVIEW_DUE" ? (
                    // ★ 平台口吻：**不显示是哪个管理员发的**（数据里 actor 是那位管理员，
                    //   但把审核员透给被通知的用户等于把他摆到被骚扰的位置 ——
                    //   与举报下架不带 by 是同一条取舍）。头像位画一只铃铛顶替。
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand/15 text-brand">
                      <Icon name="bell" size={20} />
                    </span>
                  ) : n.reward?.anonymous ? (
                    // 同款奖励、服务端没带是谁（两人之间有拉黑 / 那条同款已经不公开）：不拿「有人」两个字去画字母头像
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-500/15 text-xl" aria-hidden>
                      🎁
                    </span>
                  ) : (
                    <Avatar name={n.actorName} src={n.actorAvatar} size={40} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200">
                      {n.type === "ADMIN_NOTICE" ? (
                        <span className="font-semibold"><Trans>平台通知</Trans></span>
                      ) : n.type === "TUTOR_REVIEW_DUE" ? (
                        // 回访到期是系统发的（没有 actor）：主语是那门课，不是「有人」
                        <span className="font-semibold">{n.tutor?.count ? t`「${n.tutor.personaName}」有 ${n.tutor.count} 个阶段该回访了` : t`「${n.tutor?.personaName ?? ""}」有阶段该回访了`}</span>
                      ) : (
                        <>
                          <span className="font-semibold">{n.actorName}</span>
                          <span className="text-slate-400"> {actionLabel(n)}</span>
                        </>
                      )}
                    </div>
                    {n.type === "ADMIN_NOTICE" ? (
                      // ★ 正文**不截断**（互动通知那行是预览，这行是内容本身）：
                      //   平台通知多半在解释一次处置，被截掉一半比没收到更糟。
                      n.commentText ? (
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
                          {n.commentText}
                        </div>
                      ) : (
                        // 服务端没把正文放进 payload.commentText —— 契约问题，说出来（铁律八）
                        <div className="mt-0.5 text-xs text-rose-300"><Trans>（通知内容缺失）</Trans></div>
                      )
                    ) : n.type === "BRANCH_REVISED" ? null : ( // ★ 见下面 ★★
                      n.commentText && (
                        <div className="mt-0.5 truncate text-xs text-slate-300">「{n.commentText}」</div>
                      )
                    )}
                    {/* ★★ BRANCH_REVISED 这一档**不画正文**（2026-09-08 评审）：这一格是
                        「评论预览」——带书名号、灰字、截断，读起来就是"某人说了这句话"。
                        而服务端在这个类型的 payload.commentText 里放的是一句**系统话**
                        （"这条作品重新剪辑过了"），复用的是同一个通道。画出来的结果是
                        标题行刚说完「重新剪辑了你收藏的作品」，下一行又用评论的样子把同一句
                        重说一遍，像是作者亲手写了条评论。⇒ 整行省掉：标题行已经说清了。 */}
                    {/* 同款奖励：金额一行（数是服务端发的那个，不在这里另写）、照的是我的哪一条一行。
                        ★ 说「平台奖励」：钱不是做同款的那个人出的（token 不许在用户之间流转）。
                        下面那行通用的作品名对这一类不画 —— 它是**那条同款**的名字，摆在「原作」下面读起来像同一件东西 */}
                    {n.reward && (
                      <>
                        <div className="mt-0.5 text-xs font-semibold text-emerald-300">
                          {n.reward.tokens > 0 ? t`🎁 平台奖励你 ${fmtTokens(n.reward.tokens)} token` : t`🎁 平台给你发了同款奖励`}
                        </div>
                        {n.reward.originalTitle && (
                          <div className="mt-0.5 truncate text-xs text-slate-500"><Trans>照的是你的《{n.reward.originalTitle}》</Trans></div>
                        )}
                      </>
                    )}
                    {n.videoTitle && !n.reward && (
                      <div className="mt-0.5 truncate text-xs text-slate-500">{n.videoTitle}</div>
                    )}
                    {n.tutor && n.type !== "TUTOR_REVIEW_DUE" && (
                      <div className="mt-0.5 truncate text-xs text-slate-500">🎓 {n.tutor.personaName}{n.tutor.stars ? ` · ${"★".repeat(n.tutor.stars)}` : ""}</div>
                    )}
                    <div className="mt-1 text-[11px] text-slate-500">{relativeTime(n.at)}</div>
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
  return <EmptyState icon="bell" text={text} hint={hint} />;
}
