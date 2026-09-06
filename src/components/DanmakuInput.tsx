// 发弹幕输入条：从底部升起，视频**继续播**（弹幕是"见证当下"，停下来就没意义了）。
// 版式对齐 B 站手机端：[弹幕开关] [样式] [输入框] [发送]。
//
// ★ 必须 portal 到 body，理由与 CommentSheet 一模一样：FeedPage 的根是
//   `fixed inset-0 z-0`，position+z-index 开了新的层叠上下文，留在里面的浮层
//   无论 z 写多大都压不过它的兄弟节点 TabBar（z-40）—— 表现是"发送键点下去
//   跳到了创作页"。
//
// ★ 附在哪一秒是**按下发送的那一刻**取的，不是打开输入条的那一刻。
//   打字要好几秒，按开条的时间点存，弹幕会飘在一段你根本没在看的画面上。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  DANMAKU_COLORS,
  DANMAKU_MAX_LEN,
  type DanmakuItem,
  danmakuIsShared,
  danmakuOf,
  danmakuOn,
  danmakuVersion,
  isMyDanmaku,
  removeDanmaku,
  sendDanmaku,
  setDanmakuOn,
  subscribeDanmaku,
} from "../data/danmaku";
import DanmakuGlyph from "./DanmakuGlyph";
import Icon from "./Icon";
import ReportButton from "./ReportButton";

/** 秒 → `1:23`。弹幕列表要让人认出"这条挂在哪一秒"，光一个小数没法对应到画面 */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * 「我发过的」里的一条。
 *
 * ★★ 这是**唯一**能稳定点到自己弹幕的地方：飘着的那一层是 `pointer-events-none`
 *   而且一直在动，去点画面上飞过去的字要么点不中、要么点到播放器的暂停手势上。
 * ★ 二次确认 + 失败红字，口径与 CommentDelete 一致（删除不可撤销，而失败是常态：
 *   无权、老服务端没这个端点、断网。catch 之后不响 = 用户点了没反应，铁律八）。
 */
function MyDanmakuRow({ videoId, item }: { videoId: string; item: DanmakuItem }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function del() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      // 删完 data 层会 emit，外层订阅了 danmakuVersion —— 这一行会自己从列表里消失，
      // 飘着的那一层也同步不再画它（"只删服务端、界面还飘着"是这里最要避免的）
      await removeDanmaku(videoId, item.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "没能删掉，请重试");
      setBusy(false);
    }
  }

  return (
    // ★ flex-wrap + 错误占整行（与 CommentDelete 同一版式）。
    //   错误文案可以很长（"这台服务器还不支持删除弹幕（需要升级服务端）" ≈ 240px），
    //   放在同一行当兄弟节点的话，375px 的屏上会把「确认删除 / 取消」两个键挤出可视区 ——
    //   用户看得见原因，却点不到重试也点不到取消。
    <li className="flex flex-wrap items-center gap-2 py-1">
      <span className="w-9 flex-none text-right text-[10px] tabular-nums text-slate-500">{clock(item.at)}</span>
      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: item.color || DANMAKU_COLORS[0] }}>
        {item.text}
      </span>
      {err && <span className="order-last w-full text-[10px] leading-relaxed text-rose-300">{err}</span>}
      {confirming ? (
        <>
          <button
            onClick={() => void del()}
            disabled={busy}
            className="flex-none text-[11px] font-semibold text-rose-400 active:opacity-60 disabled:opacity-40"
          >
            {busy ? "删除中…" : "确认删除"}
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              setErr("");
            }}
            className="flex-none text-[11px] text-slate-500 active:opacity-60"
          >
            取消
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            setErr("");
            setConfirming(true);
          }}
          aria-label="删除这条弹幕"
          className="-m-1 flex-none p-1 text-slate-500 active:opacity-60"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </li>
  );
}

/**
 * 「本片弹幕」里的一条（别人发的）。举报入口挂在这儿。
 *
 * ★★ 和「我发过的」删除入口是**同一条理由**：飘着的那一层是 `pointer-events-none`
 *   （不然它会把播放器的暂停/点赞手势整片吃掉），而且那些字一直在动 —— 手机上
 *   根本点不准。想举报一条弹幕，只有在这份静态列表里点得到。
 * ★ 举报本身（理由表、重复举报的说法、失败红字）走共用的 ReportButton，不在这里另写。
 */
function OtherDanmakuRow({ videoId, item }: { videoId: string; item: DanmakuItem }) {
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="w-9 flex-none text-right text-[10px] tabular-nums text-slate-500">{clock(item.at)}</span>
      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: item.color || DANMAKU_COLORS[0] }}>
        {item.text}
      </span>
      <ReportButton targetType="danmaku" targetId={item.id} videoId={videoId} className="flex-none" />
      {/* ★ 这里**没有**拉黑键，不是遗漏：弹幕项只回 `mine` 布尔、**不带作者 id**（见
          data/danmaku 的 ★ —— 回作者等于泄漏「谁在什么时间看了这个视频」）。
          而拉黑那一半仍然生效：被拉黑者的弹幕在服务端就不会下发
          （branchVideo.controller 的 blockedAuthorFilter）。要在这儿加键，得先决定
          「弹幕要不要暴露发送者」，那是另一件事，且与上面那条隐私取舍冲突。 */}
    </li>
  );
}

export default function DanmakuInput({
  videoId,
  /** 现在播到全片第几秒。传取值函数而不是数值：数值会被闭包定在打开的那一瞬间 */
  getTime,
  onClose,
}: {
  videoId: string;
  getTime: () => number;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [color, setColor] = useState(DANMAKU_COLORS[0]);
  const [styleOpen, setStyleOpen] = useState(false);
  const [on, setOn] = useState(danmakuOn);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** 「我发过的」展开着没有。默认收起：绝大多数时候用户是来发的，不是来删的 */
  const [mineOpen, setMineOpen] = useState(false);
  /** 「本片弹幕」展开着没有。同样默认收起（这是举报入口，更低频） */
  const [allOpen, setAllOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ★ 订阅弹幕库：发一条 / 删一条 / 远端那一页到货都会 emit，这一段列表要跟着变。
  //   不订阅的话删完那一行还留在屏幕上，用户会以为没删掉、再点一次（然后吃一个 404）。
  useSyncExternalStore(subscribeDanmaku, danmakuVersion, () => 0);
  // ★ 认的是服务端给的 mine 标记（弹幕不返回作者，只有这一个布尔），
  //   离线模式下是本地发的那些 —— 两种模式同一条判据（data/danmaku.isMyDanmaku）
  const all = danmakuOf(videoId);
  const mine = all.filter(isMyDanmaku);
  /** 别人发的。★ 只在真跑在服务端上时才列出来：离线库里的弹幕没有"别人"，
   *  也没有人收举报，摆一份永远举报不出去的列表比不摆更糟 */
  const others = danmakuIsShared() ? all.filter((d) => !isMyDanmaku(d)) : [];

  // 自动聚焦拉起键盘：少一次点击。autoFocus 属性在 portal 里不一定生效（元素先挂载
  // 后移动），显式调一次稳
  useEffect(() => inputRef.current?.focus(), []);

  /**
   * ★★ 真等服务端的结果再关，**不做乐观发送**。
   *   乐观发送在这儿是有害的：发失败（被限流 / 断网 / 登录过期）时用户会亲眼看着
   *   自己那条飘过去然后永远消失，而全 app 没有任何地方监听 emitApiError ——
   *   那就是一次静默的失败（铁律八）。多等两三百毫秒，换"发出去了就是发出去了"。
   *   失败时**不关窗、不清空**：用户打的字要留着，让他改一下就能再发。
   */
  async function submit() {
    if (busy) return;
    // 关着显示还发，弹幕会"发出去但看不见"，用户只会以为发失败了 —— 顺手打开
    if (!on) {
      setDanmakuOn(true);
      setOn(true);
    }
    setBusy(true);
    setErr("");
    try {
      if (!(await sendDanmaku(videoId, text, getTime(), color))) return; // 空文本，什么都没发生
      navigator.vibrate?.(10);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发送失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    // 整层拦 pointer/click：portal 之后 DOM 上已不在播放器里，但 React 合成事件
    // 仍沿**组件树**冒泡回 FeedItem 的 onPointerDown/Up（暂停/解静音/双击点赞）
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 上方留给视频：不铺遮罩，弹幕输入的整个意思就是"边看边发"。点一下收起 */}
      <div className="flex-1" onClick={onClose} />

      <div
        className="border-t border-slate-700/70 bg-panel/95 backdrop-blur"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* 「我发过的」：删自己弹幕的**唯一**入口。
            ★★ 为什么不做成"点飘着的那条弹幕来删"：弹幕层是 pointer-events-none
              （不然它会把播放器的暂停/点赞手势整片吃掉），而且那些字一直在动 ——
              手机上根本点不准。放在发弹幕的面板里，是用户想到"我那条发错了"时
              最自然会打开的地方。
            一条都没有就不显示这一行：摆一个永远空的入口比不摆更糟（CLAUDE.md）。 */}
        {mine.length > 0 && (
          <div className="border-b border-slate-700/40 px-4 pt-2.5">
            <button
              onClick={() => setMineOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 pb-2 text-[11px] text-slate-400 active:opacity-60"
            >
              <span>我发过的 {mine.length} 条</span>
              <span className={`transition ${mineOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {mineOpen && (
              // 最多占三行高：这面板是从底部升起来的，再高就把视频整块盖住了
              <ul className="max-h-28 overflow-y-auto pb-2">
                {mine.map((d) => (
                  <MyDanmakuRow key={d.id} videoId={videoId} item={d} />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 「本片弹幕」：举报别人弹幕的**唯一**入口（理由见 OtherDanmakuRow 顶部）。
            一条都没有就不显示这一行，与上面「我发过的」同一条规矩。 */}
        {others.length > 0 && (
          <div className="border-b border-slate-700/40 px-4 pt-2.5">
            <button
              onClick={() => setAllOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 pb-2 text-[11px] text-slate-400 active:opacity-60"
            >
              <span>本片弹幕 {others.length} 条</span>
              <span className={`transition ${allOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {allOpen && (
              // 与「我发过的」同一个高度上限：这面板是从底部升起来的，再高就把视频盖住了
              <ul className="max-h-28 overflow-y-auto pb-2">
                {others.map((d) => (
                  <OtherDanmakuRow key={d.id} videoId={videoId} item={d} />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 样式行：默认收起。展开后是颜色色板 —— 弹幕的"样式"在移动端就只有颜色，
            字号/位置那些放进来只会把这一条挤成一个设置页 */}
        {styleOpen && (
          <div className="flex items-center gap-2.5 px-4 pb-1 pt-3">
            {DANMAKU_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`弹幕颜色 ${c}`}
                className={`h-7 w-7 rounded-full transition active:scale-90 ${
                  c === color ? "ring-2 ring-white ring-offset-2 ring-offset-panel" : "ring-1 ring-white/25"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {/* 弹幕总开关：关了整层就不画。放在这儿而不是右侧栏，是因为它和"发"是
              一件事的两面，用户想关的那一刻通常正被弹幕挡着 */}
          <button
            onClick={() => {
              const next = !on;
              setDanmakuOn(next);
              setOn(next);
            }}
            aria-label={on ? "关闭弹幕显示" : "开启弹幕显示"}
            className={`flex-none transition active:scale-90 ${on ? "text-brand" : "text-slate-500"}`}
          >
            <DanmakuGlyph size={26} pen={false} off={!on} />
          </button>

          <button
            onClick={() => setStyleOpen((v) => !v)}
            aria-label="弹幕样式"
            className="relative flex-none text-xl font-bold leading-none text-slate-300 transition active:scale-90"
          >
            <span className="underline decoration-2 underline-offset-4">A</span>
            {/* 当前颜色就点在这儿：不然展开样式行之前，用户看不出自己选的是什么色 */}
            <span
              className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-1 ring-panel"
              style={{ background: color }}
            />
          </button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, DANMAKU_MAX_LEN))}
            onKeyDown={(e) => {
              // isComposing：中文输入法选词时的回车是"上屏"，不是"发送"
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
            }}
            placeholder="发条友善的弹幕"
            maxLength={DANMAKU_MAX_LEN}
            className="min-w-0 flex-1 rounded-full border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />

          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            aria-label="发送弹幕"
            className="flex-none p-1 text-brand transition active:scale-90 disabled:text-slate-600"
          >
            <Icon name={busy ? "replay" : "send"} size={22} className={busy ? "animate-spin" : ""} />
          </button>
        </div>

        {/* 失败就地说清楚，并且**不关窗**——用户打的字还在框里，改一下就能再发 */}
        {err && <p className="px-4 pb-1.5 text-[11px] text-rose-300">{err}</p>}

        {/* 离线模式（没配服务端或服务端没起）要如实说：这条弹幕别人看不到。
            接上服务端时这句话就不该出现了，否则又成了另一种骗人（铁律八） */}
        {!danmakuIsShared() && (
          <p className="px-4 pb-1 text-[10px] text-slate-600">当前离线，这条弹幕只存在这台设备上</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
