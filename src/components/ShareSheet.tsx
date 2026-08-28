// 分享面板（首页视频流的「分享」键弹出）。
//
// 三个选项，各走各的链路：
//   QQ 好友   —— 原生 SDK 卡片分享（标题/摘要/封面/链接），复用登录那个插件。
//               只在 App 壳里可用，浏览器里按下去说实话。
//   微信      —— 占位。微信分享要开放平台「移动应用」过审+开发者资质认证（个人主体办不了），
//               与登录页那颗一样：灰 45%、点了给真实原因，不摆一个骗人的亮按钮。
//   复制链接  —— 预览链接（官网 /v/:id），任何聊天工具都能贴。
//
// 链接只从 utils/shareLink.previewUrlOf 拿（一处实现）；此前分享键发的是
// APK 里的 https://localhost 死链，这个面板就是那次修正的落点。
//
// ★ createPortal 到 body：FeedPage 的祖先链上有 transform/backdrop-filter，
//   fixed inset-0 不 portal 会被裁成一小块（CLAUDE.md 里评论抽屉栽过的同一坑）。
// ★ 三个 stopPropagation 与 CommentSheet 同理：portal 后 DOM 不在播放器里了，
//   但 React 合成事件仍沿组件树冒泡到 FeedItem 的手势处理。
// ★ 面板自带 err/note 显示（盖住谁就自带一份——别指望底下的错误条）。
import { useState } from "react";
import { createPortal } from "react-dom";
import type { VideoItem } from "../types";
import Icon from "./Icon";
import BrandIcon, { BRAND_CHIP } from "./BrandIcon";
import { previewUrlOf } from "../utils/shareLink";
import { isNative } from "../utils/oauth";
import { shareVideoToQQ } from "../utils/qqLogin";

/** 剪贴板：优先标准 API（Capacitor WebView 的 https origin 是安全上下文，可用），
 *  拿不到就退 execCommand —— 老 WebView 上 navigator.clipboard 可能整个 undefined */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) throw new Error("复制失败");
  } finally {
    ta.remove();
  }
}

export default function ShareSheet({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const url = previewUrlOf(video.id);
  /** 私密作品的链接别人打开是 404 —— 面板上先说清，别让用户发出去才发现 */
  const isPrivate = video.visibility === "private";

  async function toQQ() {
    if (busy) return;
    setErr("");
    setNote("");
    if (!isNative()) {
      setErr("QQ 分享要在 App 里用，浏览器里请复制链接");
      return;
    }
    setBusy(true);
    try {
      await shareVideoToQQ({
        title: video.title,
        summary: video.description || "AI 逐段生成的短片 · 来自启梦",
        targetUrl: url,
        imageUrl: video.cover,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    setErr("");
    try {
      await copyText(url);
      setNote("预览链接已复制，去贴给朋友吧");
    } catch {
      // 复制被拒时把链接直接亮出来，用户还能长按选中——比一句"失败"有用
      setErr(`复制失败，手动复制：${url}`);
    }
  }

  const options: Array<{
    key: string;
    label: string;
    disabled?: boolean;
    render: React.ReactNode;
    onTap: () => void;
  }> = [
    {
      key: "qq",
      label: "QQ 好友",
      render: (
        <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: BRAND_CHIP.qq.bg }}>
          <BrandIcon name="qq" size={26} />
        </span>
      ),
      onTap: () => void toQQ(),
    },
    {
      key: "wechat",
      label: "微信",
      disabled: true,
      render: (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full opacity-45"
          style={{ background: BRAND_CHIP.wechat.bg }}
        >
          <BrandIcon name="wechat" size={26} />
        </span>
      ),
      onTap: () => {
        setNote("");
        setErr("微信分享还没接入（需要企业主体与应用审核），先用 QQ 或复制链接");
      },
    },
    {
      key: "copy",
      label: "复制链接",
      render: (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-slate-100">
          <Icon name="share" size={22} />
        </span>
      ),
      onTap: () => void copyLink(),
    },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-panel px-5 pt-4 shadow-[0_-8px_30px_rgba(0,0,0,.5)]"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <p className="text-sm font-semibold text-slate-100">分享这条作品</p>
        {isPrivate && (
          <p className="mt-1 text-xs text-amber-300">这是私密作品：链接只有你自己打得开。想给别人看，先在编辑里改成公开。</p>
        )}

        <div className="mt-4 flex items-start gap-7">
          {options.map((o) => (
            <button key={o.key} onClick={o.onTap} className="flex w-16 flex-col items-center gap-1.5 active:scale-95" aria-label={o.label}>
              {o.render}
              <span className={`text-[11px] ${o.disabled ? "text-slate-500" : "text-slate-300"}`}>{o.label}</span>
            </button>
          ))}
        </div>

        {(err || note) && (
          <p className={`mt-3 break-all text-xs leading-relaxed ${err ? "text-red-400" : "text-emerald-400"}`}>{err || note}</p>
        )}

        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300">
          取消
        </button>
      </div>
    </div>,
    document.body,
  );
}
