// 「角色跳上图标演一下再收回去」——激活瞬间播一次的二次元 Q 版角色。
//
// 形象即创作入口 /create 三张封面里的同一位角色：
//   银白长发 · 薄荷绿挑染 · 金色五角星发饰 · 青蓝大眼 · 藏蓝短披风 + 金色圆扣 + 白立领
//
// ★ 是【一次性演出】而不是常驻标记：
//   早先跟着 filled 常驻，于是点完赞角色就一直杵在心形上方，
//   既挡视频又让"激活态"这件事被说了两遍（实心红心已经说过了）。
//   现在改成：冒出来 → 做一套动作 → 缩回图标后面消失，全程 PERCH_MS。
//   角色的职责是【对这次操作的即时反应】，不是状态显示。
//
// ★ 真的在动，而不是整张图在位移：
//   每个姿势有 A/B 两帧（如挥手抬到头顶、指路改成搭凉棚），播放时硬切来回翻，
//   这才是角色在动。只靠容器做缩放位移的话，看到的永远是"一张画弹出来了"。
//   两帧按【头部锚点】对齐生成（见 public/perch/README.md）——
//   按包围盒对齐会因为 B 帧手臂张得更开而让整个人左右乱窜。
//
// ★ 每个动作一张图、一套动效（pose 同时决定贴图、翻页帧和进出场动画）：
//   六处共用一套时，点赞和切 Tab 的反馈完全一样，角色就退化成到处乱贴的水印。
//   姿势与动效由【同一个 pose】派生，而不是拆成两个 prop——
//   拆开就总有一天会配出「挥手的图 + 蹦跳的动画」。
//
// ★ 怎么让角色和图标「长在一起」（都在 index.css 的 .perch-pop 伪元素里）：
//   ① 画在图标【下面】：角色从图标后面探出来抱住它，两者立刻有了前后关系。
//      盖在图标上时，一个厚涂人物压住一个单色图标，视觉上非常突兀。
//   ② 接触阴影：角色脚下一团投在图标上的软阴影，制造承重与接触感；
//   ③ 同色辉光：角色背后一圈该图标激活色的辉光（赞=玫红、藏=金、Tab=青）；
//   ④ 重叠 32%：埋进图标后面，而不是悬在半空。
//
// 资源生成方式与踩过的坑记录在 public/perch/README.md。
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

export type PerchPose = "like" | "save" | "home" | "explore" | "studio" | "mine";

/** 一次演出的总时长。★ 这是唯一真源：CSS 用 --perch-ms 拿到它算各阶段，
 *  卸载定时器也用它。别在 index.css 里另写一个写死的秒数，两边一定会漂。 */
export const PERCH_MS = 1600;

/** 各姿势 A 帧的原始尺寸（生成脚本按 160 宽等比缩放，高度略有差异）。换图时同步改。
 *  B 帧与 A 帧同尺寸——生成时就用同一个裁切框，保证翻页不跳。 */
const ART: Record<PerchPose, { w: number; h: number }> = {
  like: { w: 160, h: 159 },
  save: { w: 160, h: 159 },
  home: { w: 160, h: 156 },
  explore: { w: 160, h: 149 },
  studio: { w: 160, h: 159 },
  mine: { w: 160, h: 153 },
};

/** 辉光色 = 该图标的激活色，以 "r g b" 给出供 CSS 拼 alpha。
 *  这是「融合」的关键一环：颜色对上了，两个形状才像同一个东西。 */
const GLOW: Record<PerchPose, string> = {
  like: "244 63 94", // rose-500，同点赞实心心的颜色
  save: "240 193 75", // gold，同收藏实心书签的颜色
  home: "34 211 238", // cyan-400，Tab 走品牌色
  explore: "34 211 238",
  studio: "34 211 238",
  mine: "34 211 238",
};

/**
 * 「激活的那一下」播一次演出。返回演出编号：0 = 不显示，>0 = 第 n 次。
 * 调用方要把它当 `key` 用，见下面第 3 条。
 *
 * ★ 只认 false→true 的【跳变】，不认「当前为 true」：
 *   否则滑回一条早就点过赞的视频、或者应用启动时停在首页 Tab，
 *   角色都会莫名其妙地演一遍。用 ref 存上一次的值来区分这两种情况。
 *   ref 初值取传入值，所以挂载时不会触发。
 *
 * ★ 定时器存在 ref 里，不用 effect 的 cleanup 管 —— 这里修过一个真 bug：
 *   原来 `return () => clearTimeout(t)` 挂在 [active] 上。true→false 时
 *   cleanup 先把隐藏定时器清掉，随后那次 effect 又因为 `!active` 直接 return，
 *   【不再补新定时器】，于是角色永远停在显示态、再也不消失。
 *   快速反复点收藏必现。定时器的生命周期本来就不该和 active 的变化绑定。
 *
 * ★ 取消激活立刻收回，不等演完：
 *   快速点两下收藏，期望看到的是"冒出来又缩回去"，而不是第二下没反应。
 *
 * ★ 返回递增编号而不是 boolean，是为了让调用方拿它做 key：
 *   连续两次激活之间若没经过隐藏态，show 一直是 true，组件不重挂载，
 *   CSS 动画就不会重头播——表现为"快速连点没有反应"。
 *   编号变化会强制 React 重建元素，动画随之重播。
 */
export function usePerchBurst(active: boolean): number {
  const [token, setToken] = useState(0);
  const prev = useRef(active);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const was = prev.current;
    prev.current = active;
    if (!active) {
      clearTimeout(timer.current);
      setToken(0);
      return;
    }
    if (was) return; // 本来就是激活态：挂载、或与本组件无关的重渲染
    setToken((t) => t + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToken(0), PERCH_MS);
  }, [active]);

  // 卸载时清掉在途定时器（滑走的视频、切走的 Tab）
  useEffect(() => () => clearTimeout(timer.current), []);

  return token;
}

/**
 * 趴坐在图标顶部演一段的角色。调用方负责用 usePerchBurst 控制挂载/卸载。
 *
 * 定位约定：调用方给父元素 `relative`，本组件绝对定位到图标【上边缘】，
 * 双手压到图标正面（bottom 取图标尺寸的比例），形成「捧住图标」的关系。
 * bottom 用比例而非固定 px —— 23px 的 Tab 图标与 28px 的右栏图标若共用固定偏移，
 * 会一个悬空一个陷进去。
 *
 * ★ 角色画在图标【下面】（-z-10 + 调用方给容器 isolate）：
 *   盖在图标上时，一个厚涂人物突然压住一个单色图标，视觉上非常突兀；
 *   压在图标后面则读成"从图标后面探出来"，两者立刻有了前后关系。
 *   isolate 必不可少：不给容器建独立层叠上下文的话，负 z-index 会一路穿到
 *   整条右侧栏的背后，跑到别的按钮和计数文字下面去。
 *
 * ★ 0.68 这个值是量出来的，不是估的，调过四轮：
 *   0.52（重叠 46%）角色盖在图标上时把图标糊掉，认不出是什么；
 *   0.78（22%）图标清楚了，但角色变成悬在半空的贴纸；
 *   0.74（26%）好一些，但角色仍压在图标前面；
 *   现在角色改到图标【后面】，遮挡不再是约束，于是收到 0.68（重叠 32%）——
 *   埋得更深，"从后面探出来"的关系更明确，向上占的空间也更小。
 *   注意重叠比例只由 bottom 与图标高度决定，与角色贴图大小无关。
 */
function CharacterPerchImpl({
  pose,
  size = 28,
  className = "",
}: {
  pose: PerchPose;
  size?: number;
  className?: string;
}) {
  // 1.75×：小于这个比例，脸上的眼睛/腮红会缩到看不清，角色就退回成一个彩色斑点。
  // 角色坐在图标【上方】而非覆盖其上，宽一点不伤图标辨识。
  const w = Math.round(size * 1.75);
  const art = ART[pose];
  const h = Math.round((w * art.h) / art.w);

  // ★ B 帧没就位就不翻页：翻到一张还没下载完的图 = 角色凭空消失一帧，
  //   比不做动作更糟。没就位时退化为"只播进出场"，是可接受的降级。
  const [flip, setFlip] = useState(false);

  return (
    <span
      className={`perch-pop perch-${pose} pointer-events-none absolute left-1/2 -z-10 -translate-x-1/2 ${className}`}
      style={
        {
          bottom: `${Math.round(size * 0.68)}px`,
          width: w,
          height: h,
          "--perch-ms": `${PERCH_MS}ms`,
          "--perch-glow": GLOW[pose],
        } as CSSProperties
      }
      aria-hidden
    >
      <img className={`perch-f${flip ? " perch-fa" : ""}`} src={`/perch/${pose}.png`} alt="" width={w} height={h} draggable={false} />
      <img
        className={`perch-f${flip ? " perch-fb" : ""}`}
        src={`/perch/${pose}-b.png`}
        alt=""
        width={w}
        height={h}
        draggable={false}
        style={flip ? undefined : { opacity: 0 }}
        onLoad={() => setFlip(true)}
      />
    </span>
  );
}

/** memo：右侧栏与底栏在滚动/播放中频繁重渲染，角色无状态，不必跟着重画 */
export const CharacterPerch = memo(CharacterPerchImpl);
export default CharacterPerch;
