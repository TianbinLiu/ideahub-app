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
 * 「现在能不能**动这个开关**」的**唯一**判断。三个调用点共用。
 * 返回 null = 能动；否则返回的这句话会显示在按钮下面 ——
 * 灰着一个按钮却不说为什么，跟功能坏了没有区别。
 *
 * ★★ 这个开关有**两个方向**，而下面多数规则只对"发出去"那个方向成立
 *   （2026-08-30 修）。原来它们无方向地拦，后果是**已经分享出去的东西撤不下来**：
 *   · 卡组的卡被移完（或被 removeCard 摘完）→「空卡组不能分享」把取消分享一起堵死，
 *     广场上那条还挂着、别人还在装，App 里没有任何撤下办法；
 *   · 分享之后才挂上第三方版权模型、或才勾选"真实人物"→ 同样撤不下来。
 *     **真人那条尤其反了**：那条规则存在的全部理由是保护画上那个真实的人，
 *     而它当时的效果恰恰是"想撤也撤不掉"。
 *   ⇒ 凡是"这东西不适合出现在广场上"的规则，一律只在 `published === false` 时生效；
 *     "撤下来"永远只需要能连上服务器。
 */
export function shareBlockReason(input: {
  /** 这次会话是不是真的连着服务器（account.isRemoteMode()） */
  remote: boolean;
  /**
   * 现在是不是已经分享出去了 —— 也就是这一下要做的是**撤下来**。
   *
   * ★ **必填**（不是可选）：可选的话，新加的调用点忘了传就悄悄退回"两方向都拦"，
   *   而那正是这个参数要治的病（撤不下来），且零症状。本仓治这类问题的成方是让类型
   *   说话（economy 的 CardMintCap 同款）。三个调用点旁边本来就在给组件传
   *   `published={!!x.published}`，取同一个表达式即可。
   */
  published: boolean;
  /** 卡组：组内卡数。卡片不传 */
  cardCount?: number;
  /** 卡片：这张卡在不在我自己的库里。卡组不传 */
  owned?: boolean;
  /** 卡片：它挂的 3D 建模。第三方版权模型服务端会直接 400，按钮不能是亮的 */
  modelUrl?: string | null;
  /** 卡片：声明过是真实人物（types.Card.realPerson）。真人卡一律不许分享，见下 */
  realPerson?: boolean;
}): string | null {
  // ↓ 这两条**两个方向都成立**：撤下来同样要打服务端；不是我的东西，撤也轮不到我
  //   （别人的已分享卡片详情页也会渲染这个条，放行的话那颗键会亮着）。
  // ★ 但**话要按方向说**：此刻想撤的人读到"离线库里没有别人"会觉得答非所问 ——
  //   恰恰是外面有别人他才要撤。
  if (!input.remote) {
    return input.published
      ? "取消分享要先连上服务器：广场上那份在服务器上，离线改不动它。"
      : "分享需要先连接服务器并登录 —— 离线库里没有「别人」。";
  }
  if (input.owned === false) {
    return input.published
      ? "这张卡不在你的库里，它的分享开关归卡主管。"
      : "只能分享自己库里的卡：先把它添加到我的卡片。";
  }

  // ↓ 以下都是"这东西不适合出现在广场上"，只拦**发出去**这个方向（见函数头 ★★）
  if (input.published === true) return null;

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
  /**
   * 抛错即视为失败，错误会显示成红字；组件自己管 pending 态。
   * `note` 只在 kind==="card" 且这一下是"发出去"时有值（见下面的推荐语输入）。
   */
  onToggle: (next: boolean, note?: string) => void | Promise<void>;
  /**
   * 卡片：分享时可写的一句推荐语（广场那行显示它）。传了这个就长出输入框。
   * ★ 卡组**不传**：卡组的简介写在卡组详情页的编辑态里，两处都能写就是同一条规则的
   *   第二处实现，而且两条写路（PATCH 防抖 vs publish）会互相覆盖。
   */
  noteMax?: number;
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
  noteMax,
  className = "",
}: WorkshopShareBarProps) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [shareNote, setShareNote] = useState("");
  const working = pending || busy;
  const blocked = !!disabledReason;
  const target = kind === "card" ? "这张卡" : "整套卡组";

  async function click() {
    if (working || blocked) return;
    setErr("");
    setPending(true);
    try {
      await onToggle(!published, shareNote.trim() || undefined);
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
      {/* 推荐语：只在"还没分享出去、且这次能分享"时露出来 —— 已经在广场上的那句要改，
          去卡片详情页改（这里再放一个就是两个写入口互相覆盖）。 */}
      {noteMax !== undefined && !published && !blocked && (
        <input
          value={shareNote}
          onChange={(e) => setShareNote(e.target.value)}
          maxLength={noteMax}
          placeholder="一句话推荐（选填）：这张卡适合画什么？"
          className="mt-2 w-full rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
      )}
      {note && <p className="mt-1 text-[11px] leading-relaxed text-amber-400/90">{note}</p>}
      {disabledReason && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{disabledReason}</p>}
      {err && <p className="mt-1 text-[11px] leading-relaxed text-rose-400">分享失败：{err}</p>}
    </div>
  );
}
