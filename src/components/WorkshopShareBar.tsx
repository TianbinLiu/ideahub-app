// 「分享到创意工坊」开关条。卡片详情页 / 卡组详情页 / 工坊列表三处共用。
//
// ★ 为什么抽成组件而不是各写一遍：这块东西有四条**必须一致**的规则 ——
//   ① 离线（没连服务器）不能分享；② 空卡组不能分享；③ 处理中要锁住按钮；
//   ④ 失败必须**看得见**。抄三遍必然有一处会漏，而漏掉第 ④ 条的表现是
//   "点了没反应"——用户会一直点，每点一次发一个必然失败的请求（铁律六 + 铁律八）。
//
// ★ 措辞按创意工坊的真实语义写，不要写成"公开/私密"这种放之四海皆准的空话：
//   用户要判断的是"别人会不会拿走我的东西"，不是"这条数据的可见性字段是什么"。
import { useState } from "react";
import { isThirdPartyModel } from "../types";
import Icon from "./Icon";

/**
 * 「现在能不能分享」的**唯一**判断。三个调用点共用。
 * 返回 null = 能分享；否则返回的这句话会显示在按钮下面 ——
 * 灰着一个按钮却不说为什么，跟功能坏了没有区别。
 */
export function shareBlockReason(input: {
  /** 这次会话是不是真的连着服务器（account.isRemoteMode()） */
  remote: boolean;
  /** 卡组：组内卡数。卡片不传 */
  cardCount?: number;
  /** 卡片：这张卡在不在我自己的库里。卡组不传 */
  owned?: boolean;
  /** 卡片：它挂的 3D 建模。第三方版权模型服务端会直接 400，按钮不能是亮的 */
  modelUrl?: string | null;
  /** 卡片：声明过是真实人物（types.Card.realPerson）。真人卡一律不许分享，见下 */
  realPerson?: boolean;
}): string | null {
  if (!input.remote) return "分享需要先连接服务器并登录 —— 离线库里没有「别人」。";
  if (input.owned === false) return "只能分享自己库里的卡：先把它添加到我的卡片。";
  if (input.cardCount === 0) return "空卡组不能分享：先往里放几张卡。";
  // ★ 这一条以前是当"额外说明"（note）画出来的：按钮照样是亮的，而服务端一定 400。
  //   一个"按下去必然失败"的按钮比灰着更糟 —— 用户会以为是自己网不好，一直点。
  //   判据在 types.isThirdPartyModel 一处（服务端还有一份权威的同规则）。
  if (isThirdPartyModel(input.modelUrl)) return "这张卡挂的是第三方版权模型，未获授权前不能分享出去。";
  // ★★ 真人卡一律不许分享（产品决定，docs/backlog.md §1.4）。理由不是"怕麻烦"：
  //   ① 卡上那张脸是**某个真实的人**，他同意的是"你拿去做视频"，不是"挂到市场上任人取用"
  //      —— 我们没有资格替他做那第二个授权；
  //   ② 就算做过方舟肖像授权，那份可信素材也**绑死在授权给的那个火山账号**下
  //      （而且是本机侧库、根本不随卡走）。别人装走这张卡，拿到的是一张有脸的图、
  //      却没有任何授权依据 —— 把违规风险转嫁给了不知情的人。
  //   ⚠ 服务端也有一份权威的同规则（发布路径），这里只是不让按钮是亮的
  //      —— 一个"按下去必然失败"的按钮比灰着更糟。
  if (input.realPerson === true) return "这张卡声明过是真实人物，不能分享到创意工坊：肖像授权只覆盖你自己使用。";
  return null;
}

export interface WorkshopShareBarProps {
  /** 分享的是一张卡还是一套卡组 —— 只影响措辞（"这张卡" vs "整套") */
  kind: "card" | "deck";
  published: boolean;
  /** 被别人装了多少次（卡组有，卡片暂无） */
  installs?: number;
  /** 外部正在处理（比如工坊页用一个 busyDeck 管着整列） */
  busy?: boolean;
  /**
   * 非空 = 现在分享不了，这句话会**显示出来**。
   * 灰着一个按钮却不说为什么，跟坏了没有区别。
   */
  disabledReason?: string | null;
  /** 额外说明（例：这张卡的 3D 建模只存在本机，分享出去不会带上） */
  note?: string | null;
  /** 抛错即视为失败，错误会显示成红字；组件自己管 pending 态 */
  onToggle: (next: boolean) => void | Promise<void>;
  className?: string;
}

export default function WorkshopShareBar({
  kind,
  published,
  installs = 0,
  busy = false,
  disabledReason = null,
  note = null,
  onToggle,
  className = "",
}: WorkshopShareBarProps) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const working = pending || busy;
  const blocked = !!disabledReason;
  const target = kind === "card" ? "这张卡" : "整套卡组";

  async function click() {
    if (working || blocked) return;
    setErr("");
    setPending(true);
    try {
      await onToggle(!published);
    } catch (e) {
      // ★ 绝不 catch 后不响：全 app 没有任何地方监听 emitApiError，
      //   吞掉就等于"点了没反应"（铁律八）。
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={click}
          disabled={working || blocked}
          className={`inline-flex min-h-[30px] items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold transition disabled:opacity-40 ${
            published ? "bg-gold/20 text-gold" : "bg-brand/15 text-brand"
          }`}
        >
          <Icon name="share" size={13} />
          {working ? "处理中…" : published ? "已在工坊 · 取消分享" : "分享到创意工坊"}
        </button>
        {published && installs > 0 && <span className="text-[11px] text-slate-500">{installs} 人装过</span>}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        {published
          ? `公开中：会出现在创意工坊的「从市场添加」里，别人可以把${target}装走。`
          : `私有：只在你自己的库里。分享后会出现在创意工坊的「从市场添加」里，别人可以把${target}装走。`}
      </p>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-amber-400/90">{note}</p>}
      {disabledReason && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{disabledReason}</p>}
      {err && <p className="mt-1 text-[11px] leading-relaxed text-rose-400">分享失败：{err}</p>}
    </div>
  );
}
