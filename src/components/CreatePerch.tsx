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
//   ① 接触阴影：她脚下的一团软阴影，制造承重感；
//   ② 同色辉光：背后一圈按钮的品牌青，让厚涂角色与矢量图标共享一个色相；
//   ③ 轻微重叠：她的右袖口压在按钮左沿下面（调用方给的负外边距，见 TabBar）。
//   加号本身**不画进贴图**——它是矢量 Icon，缩到 15px 也清晰。
//
// ★★ 2026-08 从"叠"改成了"并排"。原来她站在按钮背后、手搭在按钮上沿，整只角色
//   要从底栏往上探出 40 多 px —— 顶沿落在离屏幕底约 98px 处，而首页的进度条在
//   50px、时长文字在 72–86px，她**正好把播放进度挡住**。装饰盖掉信息就是回退
//   （右侧栏那条 gap 也栽过同一个跟头）。并排之后整组 40px 高，完整收在底栏里。
//   贴图本身没换：手仍然画在画面最下沿正中央（design/gen-createbtn-sprites.mjs
//   的构图硬要求），只是不再拿它去够按钮了。
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

/**
 * 开机就把五张图解好码。
 * ★ 光靠"元素一直挂着"还不够保险：opacity:0 的元素浏览器可能推迟解码，
 *   等真要显示时才解，那一下仍然可能空一帧。decode() 是显式的、解完才 resolve。
 *   失败不管——那只是回到"可能闪一下"，不该因此报错。
 */
let decoded = false;
function preloadPoses(): void {
  if (decoded || typeof Image === "undefined") return;
  decoded = true;
  for (const p of Object.keys(SHEET) as CreatePose[]) {
    const img = new Image();
    img.src = `/createbtn/${p}.webp`;
    void img.decode?.().catch(() => {});
  }
}

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
function useCreatePet(pathKey: string): CreatePose {
  const [pose, setPose] = useState<CreatePose>("idle");
  useEffect(preloadPoses, []);
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

  return pose;
}

/**
 * ➕ 按钮旁边的 Q 版角色。调用方给**祖先**元素 `relative isolate`
 * （她用负 z-index 沉到按钮下面，需要独立层叠上下文兜住，否则会一路穿到整条底栏背后），
 * 并给她一个自己的 `relative` 定位盒——她靠 left-1/2 + translateX(-50%) 居中，
 * 换成贴边定位会和 index.css 的 reduced-motion 分支打架（那里把 -50% 写死了）。
 */
function CreatePerchImpl({
  pathKey,
  /** 角色渲染宽度。按钮直径由调用方决定，两者的重叠靠调用方的负外边距调 */
  width = 38,
  /** 她的脚落在离定位盒底多高的地方。并排版式下就是 0（与按钮同一条地板线）；
   *  留着这个口子是为了以后再叠回按钮上时不用改组件。 */
  bottom = 0,
}: {
  pathKey: string;
  width?: number;
  bottom?: number;
}) {
  const pose = useCreatePet(pathKey);
  const h = Math.round((width * SHEET[pose].h) / SHEET[pose].w);

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
      {/*
        ★★ 五张图**全部常驻挂载**，靠 opacity 切换，绝不按 pose 换 key 重挂载。
          第一版是 key={pose} 换一次挂一次，真机上每次换动作会闪一帧空白 ——
          新元素第一次绘制时那张 webp 还没解码好，于是先画了一帧"什么都没有"。
          图一直挂着就一直是解码好的，切换只是改 opacity，不会有那一帧。
          （顺带：动画从 none → 有值才会起一次，所以不重挂载也能让新动作从头播。）

        ★★ steps 用 `jump-none` + 位移终点取 (frames-1)*w，这两件事必须成对：
          原来写的是 steps(frames) + 终点 frames*w —— 终点那一格**落在精灵图外面**，
          正常播放时到不了，但 alternate 每次回卷的**那一瞬间**恰好取到它，
          于是每个来回都闪一帧空白。这就是"切换黑屏一帧"的另一半原因。
          jump-none 的取值是 k/(frames-1)，k=0..frames-1 —— 正好是第 0..15 帧，
          每帧等时长，两端都落在图内，回卷点是合法的第 15 帧。
      */}
      {(Object.keys(SHEET) as CreatePose[]).map((p) => {
        const art = SHEET[p];
        const on = p === pose;
        const shift = (art.frames - 1) * width;
        const ms = p === "idle" ? IDLE_MS : REACT_MS;
        return (
          <span
            key={p}
            className="perch-art"
            style={
              {
                backgroundImage: `url(/createbtn/${p}.webp)`,
                backgroundSize: `${art.frames * width}px 100%`,
                opacity: on ? 1 : 0,
                // ★ 待机用 alternate-**reverse**：它从末帧起播。
                //   四个反应动作的第 0 帧就是 idle 的**末帧**（生成时 aFrom 复用的），
                //   而反应正播+倒播结束时停在自己的第 0 帧 —— 也就是 idle 的末帧。
                //   待机若从第 0 帧起播，交接处就会跳一下（用户报的"首尾切换不衔接"）。
                //   反过来从末帧起播，两边严丝合缝。
                animation: on
                  ? `perch-run ${ms}ms steps(${art.frames}, jump-none) ${
                      p === "idle" ? "infinite alternate-reverse" : "2 alternate"
                    }`
                  : "none",
                "--sheet-shift": `-${shift}px`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** memo：底栏在首页滚动/播放中频繁重渲染，宠物的状态只由自己的定时器驱动 */
export const CreatePerch = memo(CreatePerchImpl);
export default CreatePerch;
