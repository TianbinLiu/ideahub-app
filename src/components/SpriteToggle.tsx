// 「两形态」精灵图：一条逐帧序列的**两端各当一个状态**，切换时把中间那段演出来。
//
// ★ 为什么不是两张静态图 + 淡入淡出：
//   那是"换了张贴纸"，不是"她动了一下"。中间帧是 Seedance 从 A 到 B 补出来的真实
//   运动弧线（见 design/lib/sprite-pipeline.mjs），淡入淡出把它整个扔掉了。
//
// ★ 为什么收成一个组件：这条规则现在有两个用处——工作流页「生成本段」旁的素材按钮
//   （MascotStage 的 MaterialButtonArt）和分区页六个分区图标。规则本身有四个坑，
//   抄第二份必然漏掉其中一两个（铁律六）：
//     ① steps 用 frames-1、位移终点用 (frames-1)*size，不是 frames*size；
//        steps(n) 只在动画【结束瞬间】跳到终值，取 frames 格那一跳会落到精灵图外面，
//        配上 forwards 就是定格在一片空白。
//     ② 换 key 才会重播：同一个元素上只改 animation-direction，CSS 不会重新起一次动画。
//     ③ 只认 on 的【跳变】，不认"effect 又跑了一次"：进页面时本来就是某个状态，
//        播一遍等于凭空动一下。★ 判据必须是"上一次的 on 值"而不是"挂载过没有" ——
//        StrictMode 下 effect 在挂载时会被**双调用**，用"挂载过没有"的话第二次就成立了，
//        于是一进分区页六个图标各自倒放一遍（实测：backgroundPositionX 全是 -322px，
//        也就是选中态的位移，而一个都没被选中）。
//     ④ 没在动的时候直接按状态定格 background-position，不指望动画的 fill 去兜底
//        （prefers-reduced-motion 下动画被禁掉，只剩这一条撑着）。
import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface SpriteSheet {
  /** 单格宽高（生成脚本跑完会打印，照抄过来）。写错不报错，只会把角色拉扁 */
  w: number;
  h: number;
  frames: number;
}

export default function SpriteToggle({
  src,
  sheet,
  /** 渲染宽度（高度按单格比例算） */
  size,
  /** 正播/倒播一次的时长 */
  ms = 420,
  /** true = 停在最后一帧（展开态/选中态），false = 停在第 0 帧 */
  on,
  className = "",
}: {
  src: string;
  sheet: SpriteSheet;
  size: number;
  ms?: number;
  on: boolean;
  className?: string;
}) {
  const h = Math.round((size * sheet.h) / sheet.w);
  const steps = sheet.frames - 1; // ① 见文件头
  const shift = steps * size;

  // ③ 只认 on 的跳变（StrictMode 下 effect 会被双调用，见文件头）
  const prevOn = useRef(on);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (prevOn.current === on) return;
    prevOn.current = on;
    setAnimate(true);
  }, [on]);

  return (
    <span className={`pointer-events-none relative block ${className}`} style={{ width: size, height: h }} aria-hidden>
      <span
        key={on ? "on" : "off"} // ② 见文件头
        className="mascot-art"
        style={
          {
            backgroundImage: `url(${src})`,
            backgroundSize: `${sheet.frames * size}px 100%`,
            backgroundPositionX: animate ? undefined : on ? `-${shift}px` : "0px", // ④
            animation: animate ? `perch-run ${ms}ms steps(${steps}) 1 forwards ${on ? "normal" : "reverse"}` : undefined,
            "--sheet-shift": `-${shift}px`,
          } as CSSProperties
        }
      />
    </span>
  );
}
