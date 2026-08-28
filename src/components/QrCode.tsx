// 二维码：把一段文本（这里是方舟邀约链接）画成 SVG。
//
// ★ 用 qrcode-generator 只做**编码**（拿 isDark(r,c) 的模块矩阵），格子由我们自己画成 SVG ——
//   不引入任何黑盒 canvas，且 SVG 天然清晰、可换色、能随容器缩放。
// ★ 固定纠错级 "M"（15%）：邀约链接约 120 字，M 级足够容错又不至于把码撑得太密；
//   被拍者多半是隔着屏幕扫，容错留一点更稳。
// ★★ 底色写死**白**、码点写死**黑**：二维码的对比度是功能不是审美 —— 跟着深色主题反色
//   会让一半扫码器读不出（浅色码点+深背景是最常见的扫不出原因）。所以这块**不吃主题色**。
import qrcode from "qrcode-generator";
import { useMemo } from "react";

export default function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    // 把所有黑格子拼成一条 SVG path（比 n*n 个 <rect> 省一个数量级的节点）
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [text]);

  // 留 2 格静默区（quiet zone），否则贴边的码有些扫码器读不出
  const quiet = 2;
  const vb = count + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="授权二维码"
      style={{ background: "#fff", borderRadius: 8 }}
    >
      <path d={path} fill="#000" transform={`translate(${quiet} ${quiet})`} />
    </svg>
  );
}
