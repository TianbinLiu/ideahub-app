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
import { takedownReasonText } from "../api/admin";
import { createPortal } from "react-dom";
import { type VideoItem, visibilityOf } from "../types";
import Icon from "./Icon";
import BrandIcon, { BRAND_CHIP } from "./BrandIcon";
import { previewUrlOf } from "../utils/shareLink";
import { isShareable } from "../data/videos";
import { isNative } from "../utils/oauth";
import { shareVideoToQQ } from "../utils/qqLogin";
import { shareVideoToWeChat, wechatSupported } from "../utils/wechat";

/** 剪贴板：优先标准 API（Capacitor WebView 的 https origin 是安全上下文，可用），
 *  拿不到就退 execCommand —— 老 WebView 上 navigator.clipboard 可能整个 undefined。
 *  export 给个人页复制 UID 用（铁律六：剪贴板兜底只写这一份） */
export async function copyText(text: string): Promise<void> {
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
  /** 还没传上服务器：这时候的 id 是本机 id，发出去是一条永远打不开的死链（见 videos.isShareable 的 ★★） */
  const notUploaded = !isShareable(video);
  /** 私密作品的链接别人打开是 404 —— 面板上先说清，别让用户发出去才发现。
   *  ★★ 判据必须走 `visibilityOf`（2026-08-30 三档之后）：直接写
   *    `visibility === "private"` 会把**凭链接可见**的作品也说成"别人打不开" ——
   *    而那一档的全部意义就是"链接能打开"，说反了用户就不会去分享它。 */
  const isPrivate = visibilityOf(video) === "private";
  const isUnlisted = visibilityOf(video) === "unlisted";
  /**
   * 已被平台下架 —— 别人打开是 404。
   *
   * ★★ 2026-08-31 补。作者很可能不知道：首页刷到自己那条时封面在、点得开、能播，
   *   与平常毫无区别（下架只对**别人**生效）。于是他照常分享，朋友收到一条死链，
   *   而他这边零提示 —— 与 2026-08-30 刚修掉的「刚发布就分享发出死链」是同一类，
   *   只是触发原因从"还没传上去"换成"已被下架"。
   * ★ 判据走 `video.takedown` **有没有这个键**（与 data/videos 那条 ★ 同源）：
   *   服务端没下架时压根不发它，别新写一个布尔。
   */
  const takenDown = !!video.takedown;
  /** 三颗分享键一起禁：任何一条都会发出去一条别人打不开的链接 */
  const cantShare = notUploaded || takenDown;

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

  /** 微信好友。分享是"发出即成功"（新版微信取消分享不回执，原生注释有完整理由），
   *  所以 resolve 就关面板 —— 别等一个永远不来的回执。 */
  async function toWeChat() {
    if (busy) return;
    setErr("");
    setNote("");
    if (!wechatSupported()) {
      setErr("微信分享要在 App 里用，浏览器里请复制链接");
      return;
    }
    setBusy(true);
    try {
      await shareVideoToWeChat({
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
      disabled: cantShare,
      onTap: () => void toQQ(),
    },
    {
      key: "wechat",
      label: "微信",
      render: (
        <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: BRAND_CHIP.wechat.bg }}>
          <BrandIcon name="wechat" size={26} />
        </span>
      ),
      disabled: cantShare,
      onTap: () => void toWeChat(),
    },
    {
      key: "copy",
      label: "复制链接",
      render: (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-slate-100">
          <Icon name="share" size={22} />
        </span>
      ),
      // ★ 三个入口一起禁：只在上面写一句提示、按钮照样能点的话，用户还是会发出去一条死链
      disabled: cantShare,
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-700 bg-ink px-4 pt-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <p className="text-sm font-bold text-slate-100">分享这条作品</p>
        {takenDown && (
          <p className="mt-1 text-xs text-amber-300">
            这条已被平台下架，链接别人打不开，所以先不能分享。
            {video.takedown?.reason ? `原因：${takedownReasonText(video.takedown.reason)}` : ""}
          </p>
        )}
        {notUploaded && (
          <p className="mt-1 text-xs text-amber-300">
            这条还在上传中（或没连上服务器）——现在分享出去的链接别人打不开。等它传完再分享。
          </p>
        )}
        {isPrivate && (
          <p className="mt-1 text-xs text-amber-300">
            这是私密作品：链接只有你自己打得开。想给别人看，去编辑里改成「凭链接可见」或「公开」。
          </p>
        )}
        {/* ★ 这一档要说清**代价**：链接是可转发的。用户选它多半是"只想给几个人看"，
            而链接一旦被转出去，我们拦不住 —— 这句话必须在他分享**之前**出现。 */}
        {isUnlisted && (
          <p className="mt-1 text-xs text-slate-400">
            凭链接可见：不进首页和搜索，但<span className="text-amber-300">拿到链接的人都能看，也能转给别人</span>。
          </p>
        )}

        <div className="mt-4 flex items-start gap-7">
          {options.map((o) => (
            // ★★ `disabled` 以前**只改了字的颜色**，按钮照样点得动 —— 那不叫禁用，
            //   叫"看着像禁用"。真按下去照样会发出一条打不开的链接（2026-08-30 修）。
            <button
              key={o.key}
              onClick={o.onTap}
              disabled={o.disabled}
              className={`flex w-16 flex-col items-center gap-1.5 active:scale-95 ${o.disabled ? "opacity-40" : ""}`}
              aria-label={o.label}
            >
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
