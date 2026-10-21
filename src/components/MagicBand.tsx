// 个人页头像后面那条启梦纹样（2026-10-21，docs/ui-benchmark-2026-10.md 第四、五节）。
//
// ★ 为什么是纹样不是看板娘：国内 App 的个人页都有一条头图（抖音 / B 站 / 小红书），我们先给一条缩小版、品牌化的默认头图
//   —— 淡青的法阵圆环 + 几颗金色四角星（取看板娘的星形发夹）。public/createbtn 那套精灵图的 README 明写「别挪去当挂件用」，
//   个人页上也已经有头像那张看板娘了，再放一个就是同一个形象在一屏里出现两次。
// ★ 纯装饰：aria-hidden，不吃点击（pointer-events-none），不动（法阵转起来会和头像抢注意力）。
// ★ 宿主要给自己开一个层叠上下文（relative isolate），本组件用 -z-10 沉到资料区的文字后面。
export default function MagicBand({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[88px] overflow-hidden ${className}`}>
      {/* 底色：顶上一层淡青往下褪成透明，与顶栏的 ink 自然接上 */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-400/[0.14] via-sky-400/[0.05] to-transparent" />
      <svg className="absolute left-1/2 top-0 h-full w-[420px] -translate-x-1/2" viewBox="0 0 420 88" preserveAspectRatio="xMidYMin slice">
        <g fill="none" stroke="#38bdf8" strokeOpacity="0.22">
          {/* 法阵：两道同心圆 + 一圈符文刻度，圆心压在头像中心附近（头像 92px，资料区 pt-1） */}
          <circle cx="210" cy="50" r="74" />
          <circle cx="210" cy="50" r="62" strokeDasharray="2 5" />
          <circle cx="210" cy="50" r="98" strokeOpacity="0.12" />
        </g>
        <g fill="#fbbf24">
          {[
            [70, 26, 7, 0.75],
            [342, 18, 9, 0.85],
            [312, 64, 5, 0.6],
            [104, 70, 4.5, 0.55],
          ].map(([x, y, r, o], i) => (
            // 四角星（与 Icon「sparkle」同一个意思）：四个尖、腰收到 0.25r，按中心与半径就地画
            <path
              key={i}
              opacity={o}
              d={`M${x} ${y - r}L${x + r * 0.25} ${y - r * 0.25}L${x + r} ${y}L${x + r * 0.25} ${y + r * 0.25}L${x} ${y + r}L${x - r * 0.25} ${y + r * 0.25}L${x - r} ${y}L${x - r * 0.25} ${y - r * 0.25}Z`}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
