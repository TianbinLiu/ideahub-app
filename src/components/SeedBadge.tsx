// 「示例 · 离线」标识 —— 三条离线演示作品专用，全 app 唯一的一份。
//
// ★★ 为什么必须有（2026-09-17 主人拍板「方案一 ①」，调研正本 §B）：没配 VITE_API_BASE 的构建、
//   或者这一趟没连上服务端时，首页铺的是三条**编出来的**演示作品（data/videos 的 SEED_SCRIPTS）。
//   它们与真人发的作品长得一模一样 —— 不标的话，用户读到的是「这个平台上就这三条片子、都是别人发的」，
//   而那三个作者、那三条片子一个都不存在。播放 / 点赞已经清零、评论已经整条撤掉，但"这是示例"
//   这句话只有角标说得出来。
// ★ 不借 AigcBadge：那一枚是**法定**标识（《标识办法》第六条，见 components/AigcBadge 的 ★★）。
//   两件事挤进一枚角标，将来谁改一次措辞就同时动了合规文案。两枚并排画。
// ★ 判据不在这儿：`videos.isSeedWork` 一处说了算（首页 / 详情页 / 分区页 / 个人页网格四处共用），
//   这里只管画。
import { Trans, useLingui } from "@lingui/react/macro";

export default function SeedBadge({
  /** overlay = 盖在画面 / 封面上（首页流与两个网格）；plain = 普通页面里（详情页） */
  tone = "plain",
  className = "",
}: {
  tone?: "overlay" | "plain";
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <span
      // ★ 不做成按钮：它是标识不是入口（与 AigcBadge 同一条）。
      title={t`没连上服务器时显示的示例内容，不是真实用户作品`}
      // ★ 几何**照抄 AigcBadge**（rounded-[4px] / px-1.5 py-px / 10px）：这两枚在四个渲染点上全是并排的，
      //   一圆一方比"不合圆角刻度"更扎眼。颜色换成琥珀 —— 它是提醒，不是标识。
      className={`inline-flex flex-none items-center rounded-[4px] px-1.5 py-px text-[10px] font-semibold leading-[1.35] ${
        tone === "overlay"
          ? "bg-black/55 text-amber-200 ring-1 ring-amber-300/40 backdrop-blur-[2px]"
          : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40"
      } ${className}`}
    >
      <Trans>示例 · 离线</Trans>
    </span>
  );
}
