// 第三方登录的品牌图标。
//
// ★ 不许外链：这个 App 打进 Capacitor WebView 离线运行，生产构建还带严格 CSP
//   （见 vite.config 的 cspPlugin）。图标要么内联 SVG，要么是随包发的**同源**资源
//   （`img-src 'self'` 放行），外域图标一律加载不出来。图标字体同理。
//
// ★ 各家品牌都有 brand guideline，形状与配色不要"自己发挥"：
//   Google 必须是四色 G 且放在白底上（它的规范明确禁止在彩色背景上直接放彩色 G）；
//   GitHub 是黑白 Invertocat；微信是绿底双气泡。
//   画得像不像直接决定用户敢不敢点——这一栏此前是「G / ⌥ / 微信 / QQ」四个文字占位。
//
// ★★ QQ 是唯一一个**不自己画**的（2026-08-24 换掉手绘版）。QQ互联的视觉素材页把话
//   说死了：「以下各种规格的图标版权都归腾讯公司所有，请勿更改，否则腾讯公司有权
//   单方面中止 QQ 登录连接服务」。也就是说自绘一只"更像的"企鹅同样违规——它既不是
//   官方素材，又构成对商标图形的改动。
//   现在这张来自官方 `03_qq_symbol.psd`（企鹅单独图标），只做了等比缩放导出：
//   不裁内容、不重上色、不换底、不加描边。换素材时也守这条。
import type { CSSProperties } from "react";

export type BrandName = "google" | "github" | "wechat" | "qq";

/**
 * 各家的"底"：Google 规范要求白底，其余用品牌色底 + 白色前景。
 * ★ QQ 也是白底 —— 官方企鹅是黑+红+橙的彩色实心图形，压在品牌蓝上既看不清，
 *   又等于给商标换了衬底（"请勿更改"管的不只是图形本身）。与 Google 那颗同一处理。
 */
export const BRAND_CHIP: Record<BrandName, { bg: string; label: string }> = {
  google: { bg: "#ffffff", label: "Google" },
  github: { bg: "#1b1f24", label: "GitHub" },
  wechat: { bg: "#07C160", label: "微信" },
  qq: { bg: "#ffffff", label: "QQ" },
};

function Google({ s }: { s: number }) {
  // 官方四色 G。四段弧 + 右侧横条，色序（蓝/绿/黄/红）是规范里定死的
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

function GitHub({ s }: { s: number }) {
  // Invertocat（Octicons 的 mark-github，24×24）
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#ffffff" aria-hidden focusable="false">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}

function WeChat({ s }: { s: number }) {
  // 双气泡：大的在左下、小的在右上，各带两个点眼。微信标识的核心辨识特征
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="#ffffff" aria-hidden focusable="false">
      <path d="M12.2 5C6.9 5 2.6 8.6 2.6 13c0 2.5 1.4 4.7 3.6 6.2l-.9 2.8 3.2-1.6c1.1.3 2.3.5 3.5.5h.6a7.6 7.6 0 0 1-.2-1.7c0-4.2 4.1-7.6 9.2-7.6h.6C21.5 8 17.3 5 12.2 5zm-3.3 4.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm6.7 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" />
      <path d="M29.4 19.2c0-3.6-3.6-6.5-8-6.5s-8 2.9-8 6.5 3.6 6.5 8 6.5c.9 0 1.8-.1 2.6-.4l2.7 1.4-.7-2.3c1.9-1.2 3.4-3 3.4-5.2zm-10.7-1.8a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zm5.4 0a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z" />
    </svg>
  );
}

/**
 * 官方企鹅图标（`public/brand/qq-symbol.png`，源自 QQ互联 `03_qq_symbol.psd`）。
 *
 * ★ 用 <img> 而不是内联 SVG：官方只发 PSD/PNG，把它描成 SVG 就是"改过的商标"。
 *   同源资源随包发，CSP 的 `img-src 'self'` 放行，离线也在。
 * ★ 原图 0.83:1（竖长），所以按**高**给尺寸、宽按比例走 —— 强行拉成正方形是变形。
 */
function QQ({ s }: { s: number }) {
  return (
    <img
      src="/brand/qq-symbol.png"
      alt=""
      aria-hidden
      draggable={false}
      width={Math.round((s * 120) / 144)}
      height={s}
      style={{ display: "block" }}
    />
  );
}

export default function BrandIcon({
  name,
  size = 22,
  className = "",
  style,
}: {
  name: BrandName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Art = { google: Google, github: GitHub, wechat: WeChat, qq: QQ }[name];
  return (
    <span className={`flex items-center justify-center ${className}`} style={style}>
      <Art s={size} />
    </span>
  );
}
