// 底栏 ➕ 上的看板娘 —— 一只**常驻的 app 宠物**。
//
// 她一直在那儿轻轻呼吸，每隔几秒自己挑一个动作演一遍（挥手 / 探头 / 欢呼 / 打盹），
// 切 Tab 也会立刻演一个。目的很直白：➕ 是全 app 唯一的主 CTA，却是底栏里唯一不会动的
// 东西，在四个会变实心的 Tab 中间反而最容易被忽略。
//
// ★ 与第一版的区别（第一版理解错了需求，记下来免得改回去）：
//   第一版是"切 Tab 才蹦一下的一次性挂件"，人比按钮还大、从底栏往上戳出 60px。
//   要的其实是**宠物**：按钮缩小、她在按钮背后搭着手，两者加起来占原来那么大，
//   而且**自己会时不时动**。前者是"操作反馈"（那是 CharacterPerch 的活），
//   后者是"陪着你"——两件事，别混。
//
// ★ 她与按钮的关系靠三件事成立（前两件在 index.css 的 .perch-pop 伪元素里）：
//   ① 接触阴影：她手下投在按钮上的一团软阴影，制造承重感；
//   ② 同色辉光：背后一圈按钮的品牌青，让厚涂角色与矢量图标共享一个色相；
//   ③ 重叠：她的手实打实压在按钮上沿（贴图里手就画在最下沿，见
//      design/gen-createbtn-sprites.mjs 的构图要求）。
//   加号本身**不画进贴图**——它是矢量 Icon，缩到 18px 也清晰。
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

export type CreatePose = "idle" | "wave" | "peek" | "cheer" | "nap";

/** 生成脚本跑完会打印这张表，换图时照抄过来。
 *  ★ 高度写错不报错，只会把角色拉扁——这种失真很难一眼看出来。 */
const SHEET: Record<CreatePose, { w: number; h: number; frames: number }> = {
  idle: { w: 200, h: 209, frames: 16 },
  wave: { w: 200, h: 209, frames: 16 },
  peek: { w: 200, h: 205, frames: 16 },
  cheer: { w: 200, h: 195, frames: 16 },
  nap: { w: 200, h: 197, frames: 16 },
};

const REACTIONS: CreatePose[] = ["wave", "peek", "cheer", "nap"];

/** 待机循环一轮的时长。★ 慢，而且幅度小 —— 它在底栏上一直播，
 *  快了或幅度大了就从"她在那儿待着"变成"有东西在抽搐"，很快招人烦。 */
const IDLE_MS = 1800;
/** 反应动作单程时长。来回一趟 = 两倍 */
const REACT_MS = 900;
/** 两次自发动作之间的间隔（随机取值）。太密像多动症，太疏就等于没有 */
const GAP_MIN_MS = 7000;
const GAP_MAX_MS = 15000;

/**
 * 宠物的状态机：平时 idle，时不时演一个反应动作再回到 idle。
 *
 * ★ 反应是**正播完再倒播回来**（animation-direction: alternate + 2 次迭代），
 *   结束时正好停在第 0 帧 —— 也就是 idle 的起始姿势，切回 idle 循环时接得上。
 *   只正播一次的话会定格在动作的顶点（比如手一直举在头顶），下一帧切回 idle 就是跳变。
 *   生成时四个反应的 A 端点都用 aFrom 复用了 idle 的末帧，所以"第 0 帧 = 待机姿势"
 *   这件事在贴图层面也成立（见 design/gen-createbtn-sprites.mjs）。
 *
 * ★ 定时器一律存 ref、不用 effect 的 cleanup 管 —— CharacterPerch 在这儿修过一个真 bug：
 *   cleanup 会在下一次 effect 之前把定时器清掉，而那次 effect 若提前 return 就不再补新的，
 *   状态机于是永远停在某一格。
 *
 * @param pathKey 路由路径。变化时立刻演一个（切 Tab 的即时反馈）
 */
function useCreatePet(pathKey: string): { pose: CreatePose; reacting: boolean } {
  const [pose, setPose] = useState<CreatePose>("idle");
  const gap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const back = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef<CreatePose>("idle");
  const prevPath = useRef(pathKey);

  useEffect(() => {
    let alive = true;
    /** ★ 排除上一次那套：直接 random 有 1/4 概率抽到同一个，
     *  而"她换了个动作"正是这个功能的全部意义 */
    const pick = () => {
      const rest = REACTIONS.filter((p) => p !== last.current);
      return rest[Math.floor(Math.random() * rest.length)];
    };
    const react = () => {
      if (!alive) return;
      const next = pick();
      last.current = next;
      setPose(next);
      clearTimeout(back.current);
      back.current = setTimeout(() => {
        if (!alive) return;
        setPose("idle");
        schedule();
      }, REACT_MS * 2); // 来回一趟
    };
    const schedule = () => {
      clearTimeout(gap.current);
      gap.current = setTimeout(react, GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(gap.current);
      clearTimeout(back.current);
    };
  }, []);

  // 切 Tab：不等自发的那一轮，立刻演一个
  useEffect(() => {
    if (prevPath.current === pathKey) return;
    prevPath.current = pathKey;
    const rest = REACTIONS.filter((p) => p !== last.current);
    const next = rest[Math.floor(Math.random() * rest.length)];
    last.current = next;
    setPose(next);
    clearTimeout(back.current);
    back.current = setTimeout(() => setPose("idle"), REACT_MS * 2);
  }, [pathKey]);

  return { pose, reacting: pose !== "idle" };
}

/**
 * 趴在 ➕ 按钮后面的 Q 版角色。调用方给父元素 `relative isolate`
 * （她用负 z-index 沉到按钮下面，需要独立层叠上下文兜住，否则会一路穿到整条底栏背后）。
 */
function CreatePerchImpl({
  pathKey,
  /** 角色渲染宽度。按钮直径由调用方决定，两者的重叠靠 bottom 调 */
  width = 48,
  /** 她的手落在离容器底多高的地方。★ 真机上量出来的，见 TabBar 里的取值说明：
   *  小了手被按钮盖住（只剩探头），大了变成悬空贴纸。 */
  bottom = 26,
}: {
  pathKey: string;
  width?: number;
  bottom?: number;
}) {
  const { pose, reacting } = useCreatePet(pathKey);
  const art = SHEET[pose];
  const h = Math.round((width * art.h) / art.w);

  // ★ 循环与来回都用 steps(frames)、位移终点取 frames*w（不是 frames-1）：
  //   steps(n) 只在动画【结束瞬间】跳到终值，而 alternate 到点就回卷、永远跑不到，
  //   所以取 frames 格才能把 16 帧全放出来。
  //   （一次性播完就定格的那种才要用 frames-1，否则最后一跳会落到精灵图外面变空白——
  //     见 MascotStage 的同款注释。这里没有一次性播完的分支。）
  const steps = art.frames;
  const shift = steps * width;
  const ms = reacting ? REACT_MS : IDLE_MS;

  return (
    <span
      className="perch-pop create-perch pointer-events-none absolute left-1/2 -z-10 -translate-x-1/2"
      style={
        {
          bottom: `${bottom}px`,
          width,
          height: h,
          "--perch-glow": "34 211 238", // cyan-400，与按钮的品牌渐变同色相
        } as CSSProperties
      }
      aria-hidden
    >
      <span
        // key 跟着 pose 走：只改 background-image 的话 CSS 动画不会重新起一次，
        // 换动作时会停在上一个动作的进度上
        key={pose}
        className="perch-art"
        style={
          {
            backgroundImage: `url(/createbtn/${pose}.webp)`,
            backgroundSize: `${art.frames * width}px 100%`,
            // 待机无限循环；反应正播一次 + 倒播一次（2 迭代 alternate），停回第 0 帧
            animation: `perch-run ${ms}ms steps(${steps}) ${reacting ? "2" : "infinite"} alternate`,
            "--sheet-shift": `-${shift}px`,
          } as CSSProperties
        }
      />
    </span>
  );
}

/** memo：底栏在首页滚动/播放中频繁重渲染，宠物的状态只由自己的定时器驱动 */
export const CreatePerch = memo(CreatePerchImpl);
export default CreatePerch;
