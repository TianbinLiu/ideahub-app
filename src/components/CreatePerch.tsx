// 底栏中间 ➕ 上的看板娘：每次切 Tab 随机换一套动作演一遍。
//
// 目的很直白 —— 把注意力从"我在浏览"拉到"我可以创作"。➕ 是全 app 唯一的主 CTA，
// 但一颗静止的圆钮在四个会动的 Tab 中间反而最容易被忽略。
//
// ★ 她手里【不拿加号】，加号仍然是那枚矢量图标（Icon 的 plus）。
//   位图画的加号缩到 26px 一定比矢量糊，而且出图提示词里写死了"无任何文字与符号"
//   （文生图写符号本来就不稳，见 design/lib/sprite-pipeline.mjs 的 Q_STAGE）。
//   「Q 版看板娘 + 加号」是**两个元素合成一颗按钮**，不是把加号画进贴图里 ——
//   这也正是 CharacterPerch 那六个挂件与图标"长在一起"的同一套做法。
//
// ★ 与 components/CharacterPerch 的分工：
//   那边是"对这一次操作的即时反应"，姿势与 Tab 一一对应、固定不变；
//   这边是"招揽"，姿势**刻意随机**——一套固定动作看三次就成了背景板。
//   两者共用 index.css 里的 .perch-pop（辉光 + 接触阴影）与 perch-run（翻页关键帧）：
//   都是"从图标后面探出来的 Q 版挂件"，抄第二套迟早会漂（铁律六）。
//
// 资源与生成方式：public/createbtn/README.md + design/gen-createbtn-sprites.mjs。
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";

export type CreatePose = "invite" | "cheer" | "pull" | "magic";

/** 一次演出的总时长。★ 唯一真源：CSS 用 --perch-ms 拿它推各阶段，卸载定时器也用它。 */
export const CREATE_PERCH_MS = 1900;

/** 生成脚本跑完会打印这张表，换图时照抄过来。
 *  ★ 高度写错不报错，只会把角色拉扁——这种失真很难一眼看出来。 */
const SHEET: Record<CreatePose, { w: number; h: number; frames: number }> = {
  invite: { w: 200, h: 228, frames: 12 },
  cheer: { w: 200, h: 200, frames: 12 },
  pull: { w: 200, h: 243, frames: 12 },
  magic: { w: 200, h: 193, frames: 12 },
};

const POSES = Object.keys(SHEET) as CreatePose[];

/**
 * 切 Tab 时换一套并演一遍。返回 { token, pose }：token 0 = 不显示，>0 = 第 n 次。
 * 调用方要把 token 当 `key` 用（同 usePerchBurst：不换 key 元素不重挂载，动画不重播）。
 *
 * ★ 只认路径的【变化】，不认"当前在哪一页"：挂载时不演（进 app 就蹦一下太吵），
 *   与本组件无关的重渲染也不演。用 ref 存上一次的路径来区分。
 *
 * ★ 定时器存 ref、不用 effect 的 cleanup 管 —— CharacterPerch 在这儿修过一个真 bug：
 *   cleanup 会在下一次 effect 之前把隐藏定时器清掉，而那次 effect 若提前 return，
 *   就【不再补新定时器】，角色于是永远停在显示态。定时器的生命周期本来就不该
 *   和依赖项的变化绑定。
 *
 * ★ 换姿势时排除当前这一套：`Math.random() * 4` 有 1/4 概率抽到同一套，
 *   而"换了一套"正是这个功能的全部意义——连着两次一样，用户只会觉得是同一张图。
 */
export function useCreateBurst(pathKey: string): { token: number; pose: CreatePose } {
  const [token, setToken] = useState(0);
  const [pose, setPose] = useState<CreatePose>(() => POSES[Math.floor(Math.random() * POSES.length)]);
  const prev = useRef(pathKey);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (prev.current === pathKey) return;
    prev.current = pathKey;
    setPose((cur) => {
      const rest = POSES.filter((p) => p !== cur);
      return rest[Math.floor(Math.random() * rest.length)];
    });
    setToken((t) => t + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToken(0), CREATE_PERCH_MS);
  }, [pathKey]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { token, pose };
}

/**
 * 趴在 ➕ 按钮后面演一段的 Q 版角色。调用方负责用 useCreateBurst 控制挂载/卸载，
 * 并给父元素 `relative isolate`（角色用负 z-index 沉到按钮下面，需要独立层叠上下文兜住）。
 *
 * ★ bottom 取按钮直径的 0.72（重叠 28%）：与 CharacterPerch 的 0.68 同一个量级，
 *   但这颗按钮是**实心亮色**的圆钮而不是描边图标，盖多了会把品牌色那一圈吃掉。
 *   重叠比例只由 bottom 与按钮尺寸决定，与贴图大小无关。
 */
function CreatePerchImpl({ pose, size = 48 }: { pose: CreatePose; size?: number }) {
  const art = SHEET[pose];
  // 1.33×：比 CharacterPerch 的 1.75× 收敛得多——那边的宿主是 23px 的线性图标，
  // 这边是 48px 的实心圆钮，同样倍率会让角色高到把首页视频挡掉一大块。
  const w = Math.round(size * 1.33);
  const h = Math.round((w * art.h) / art.w);

  // 时序全部由 CREATE_PERCH_MS 推导，不写死秒数（唯一真源见上）
  const runMs = Math.round(CREATE_PERCH_MS * 0.54);
  const delayMs = Math.round(CREATE_PERCH_MS * 0.18);
  // ★ steps 用 frames-1、位移终点用 (frames-1)*w：steps(n) 在动画【结束瞬间】才跳到
  //   终值，取 frames 格那一跳会落到精灵图外面，配上 forwards 就是退场全程空白。
  const steps = art.frames - 1;

  return (
    <span
      className={`perch-pop create-perch create-${pose} pointer-events-none absolute left-1/2 -z-10 -translate-x-1/2`}
      style={
        {
          bottom: `${Math.round(size * 0.72)}px`,
          width: w,
          height: h,
          "--perch-ms": `${CREATE_PERCH_MS}ms`,
          "--perch-glow": "34 211 238", // cyan-400，与 ➕ 的品牌渐变同色相
        } as CSSProperties
      }
      aria-hidden
    >
      <span
        className="perch-art"
        style={
          {
            backgroundImage: `url(/createbtn/${pose}.webp)`,
            backgroundSize: `${art.frames * w}px 100%`,
            animation: `perch-run ${runMs}ms steps(${steps}) ${delayMs}ms 1 forwards`,
            "--sheet-shift": `-${steps * w}px`,
          } as CSSProperties
        }
      />
    </span>
  );
}

/** memo：底栏在首页滚动/播放中频繁重渲染，角色无状态，不必跟着重画 */
export const CreatePerch = memo(CreatePerchImpl);
export default CreatePerch;
