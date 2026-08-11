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
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DANMAKU_COLORS,
  DANMAKU_MAX_LEN,
  danmakuIsShared,
  danmakuOn,
  sendDanmaku,
  setDanmakuOn,
} from "../data/danmaku";
import DanmakuGlyph from "./DanmakuGlyph";
import Icon from "./Icon";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
        className="border-t border-slate-700/60 bg-panel/95 backdrop-blur"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
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
            className="relative flex-none text-[19px] font-bold leading-none text-slate-300 transition active:scale-90"
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
            placeholder="发个友善的弹幕见证当下"
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
