// 工作流页屏幕中央的看板娘演出（逐帧精灵图）。
//
//   handover  桌后双手前伸摊开  —— 拖素材卡时的「交给我」提示
//   forge     双手在桌上法阵间  —— 出片过程中循环播
//   forged    捧起成形的卡牌笑开 —— 本段炼成的那一下
//
// ★ 与 components/CharacterPerch 是两套东西，别合并：
//   那边是 50px 图标上的 Q 版挂件（单格 160px、带"埋进图标里"的进出场编排），
//   这边是屏幕中央 ~250px 的正片演出，用的是与 /create 三张封面同一位二次元角色
//   （同一张定妆照出的图，见 design/gen-mascot-sprites.mjs）。Q 版放大到这个尺寸就是一团糊。
//
// 资源生成方式与踩过的坑：design/gen-mascot-sprites.mjs + public/perch/README.md。
import { memo, useEffect, useRef, type CSSProperties } from "react";
import SpriteToggle from "./SpriteToggle";

export type MascotPose = "handover" | "handover-glad" | "receive" | "forge" | "forged" | "cardbtn";

/** 各精灵图的单格尺寸与帧数。★ 生成脚本跑完会打印这张表，换图时照抄过来——
 *  高度写错不会报错，只会让角色被拉扁，而这种失真很难一眼看出来。 */
const SHEET: Record<MascotPose, { w: number; h: number; frames: number }> = {
  // 交卡三段式：伸手 → （拖到落点上方）表情转开心 → （松手）收回捧在胸前。
  // 16 帧不是为了"更流畅的循环"，而是为了姿势变化本身够顺；停住之后的呼吸/浮动
  // 交给 CSS transform 做 60fps（breathe），堆帧堆不出那个效果，只会把包撑大。
  handover: { w: 420, h: 407, frames: 16 },
  "handover-glad": { w: 420, h: 405, frames: 16 },
  receive: { w: 420, h: 402, frames: 16 },
  // ★ forge 也是 16 帧，而且是这几套里【最需要】的：它在整个出片过程（几十秒到几分钟）
  //   里循环播，是用户盯得最久的一段动画。8 帧摊在 1500ms 里只有 5.3fps，
  //   真机上就是一格一格地顿——用户报的「点了生成本段之后动画太卡」说的正是它。
  //   同屏的 handover 早就是 16 帧了，两者一对比更刺眼。
  forge: { w: 420, h: 362, frames: 16 },
  forged: { w: 420, h: 391, frames: 8 },
  // 素材按钮那颗小人。Q 版、单格小得多——按钮里只有 ~40px 净高，
  // 正片那 420px 的脸缩到这个尺寸就是一团糊（见 design/gen-mascot-sprites.mjs）
  cardbtn: { w: 180, h: 197, frames: 8 },
};

/** 循环播的一轮时长。handover 是"招手示意"，慢一点更像在等；forge 是"正在使劲"，稍快 */
const LOOP_MS: Record<MascotPose, number> = {
  handover: 900,        // 伸手：一次性播完就停住等卡
  "handover-glad": 520, // 只有表情在变，要快，慢了像卡顿
  receive: 1100,        // 收回并捧住
  // 16 帧 / 1200ms ≈ 13fps（原来是 8 帧 /1500ms ≈ 5.3fps）。
  // 再快就把"缓缓张开法阵"演成了甩手，再慢帧率又掉回去——法阵本身在转，慢一点也不显呆。
  forge: 1200,
  forged: 1100,
  cardbtn: 420,
};

function MascotStageImpl({
  pose,
  width = 250,
  /** 循环播（handover / forge）还是只播一遍停在最后一帧（forged） */
  loop = true,
  breathe = false,
  className = "",
  onDone,
}: {
  pose: MascotPose;
  width?: number;
  loop?: boolean;
  /**
   * 叠一层「呼吸」：极轻微的起伏与缩放，60fps 的 CSS transform。
   *
   * ★ 这是「动作停住但人没死」的关键。伸手等卡时姿势必须固定（不能来回收放，
   *   否则用户永远等不到一个稳定的落点），但定格在一帧就成了贴纸。
   *   呼吸交给 transform 而不是堆帧：16 帧摊在 1 秒里也才 16fps，
   *   而 transform 是合成层动画，稳稳的 60fps，还不占包体。
   */
  breathe?: boolean;
  className?: string;
  /** 只在 loop=false 时有意义：播完一遍回调（调用方据此收场） */
  onDone?: () => void;
}) {
  const art = SHEET[pose];
  const h = Math.round((width * art.h) / art.w);
  const ms = LOOP_MS[pose];

  // ★ 循环用 steps(frames)、一次性用 steps(frames-1)，两者的位移终点也不同：
  //   steps(n, end) 只在动画【结束瞬间】跳到终值。一次性若取 frames 格，
  //   最后那一跳会落到精灵图外面，配上 forwards 就是定格在一片空白。
  //   循环则相反——它永远跑不到终值（到点就回卷），取 frames 格才能把 8 帧都放出来。
  const steps = loop ? art.frames : art.frames - 1;

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (loop) return;
    const t = setTimeout(() => doneRef.current?.(), ms);
    return () => clearTimeout(t);
  }, [loop, ms, pose]);

  return (
    <span
      className={`relative block ${breathe ? "mascot-breathe" : ""} ${className}`}
      style={{ width, height: h }}
      aria-hidden
    >
      <span
        className="mascot-art"
        style={
          {
            backgroundImage: `url(/mascot/${pose}.webp)`,
            backgroundSize: `${art.frames * width}px 100%`,
            // 关键帧与 perch 共用 perch-run（都是"横向平移背景"）——抄第二条必然会漂
            animation: `perch-run ${ms}ms steps(${steps}) ${loop ? "infinite alternate" : "1 forwards"}`,
            "--sheet-shift": `-${steps * width}px`,
          } as CSSProperties
        }
      />
    </span>
  );
}

/** memo：出片浮层每秒都因为日志读秒重渲染，角色本身无状态，不必跟着重画 */
export const MascotStage = memo(MascotStageImpl);
export default MascotStage;

/**
 * 素材按钮上的那颗 Q 版小人：收起态躲在牌后面只露眼睛，展开态举牌得意大笑。
 *
 * 两个状态是**同一条 8 帧序列的两端**（正播=展开，倒播=收起），这条规则连同它的
 * 四个坑收在 components/SpriteToggle 里——分区页六个分区图标用的是同一条规则。
 * 这里只负责"用哪张图、多快"。
 */
export function MaterialButtonArt({ open, size = 40 }: { open: boolean; size?: number }) {
  return <SpriteToggle src="/mascot/cardbtn.webp" sheet={SHEET.cardbtn} size={size} ms={LOOP_MS.cardbtn} on={open} />;
}
