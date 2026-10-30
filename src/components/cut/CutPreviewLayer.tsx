// 剪辑页预览上的那一层：字幕 / 标题、闪黑、配音 —— 跟着播放头走。
//
// ★★ 它照的是 data/cutProject.timelinePlan 出的那份**渲染计划**，与原生合成器（utils/nativeMerge）照的是同一份：
//   哪一秒出哪句字、断成哪几行、淡入淡出多长、配音从第几秒念，这里一个都不自己算。预览与导出是两个渲染器，
//   规则只许长在计划那一处（铁律六）—— 在这里另算一遍，预览里对的东西合出来就是另一个样子。
// ★ 为什么单独一个组件、自己跑一圈 rAF：闪黑要逐帧变透明度，而剪辑页的重渲染是跟着 <video> 的 timeupdate 走的
//   （一秒四次）；让整页一秒重渲染六十次去追一层遮罩不值得。这里逐帧只读播放器的时间、直接改两处样式，
//   React 只在"现在挂着的字幕换了一批"时才重渲染一次。
// ★ 位置贴着 <video> 的画面盒子（offsetLeft/Top/Width/Height，相对同一个 relative 的预览容器）：播放器是按画面比例
//   缩进预览区的，盒子就是画面。字号按盒子的最短边 × 计划里的比例给，与合成器同一把尺。
// ★ 这一层只是"让人先看见 / 先听见"：它出任何问题都不该影响导出（下面对媒体的调用全都 catch 掉）。
import { useEffect, useRef, useState, type RefObject } from "react";
import type { RenderPlan } from "../../data/cutProject";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  plan: RenderPlan | null;
  /** 正在预览的片段（计划里的 clipId）。没有就整层收起 */
  clipId: string | null;
  playing: boolean;
  /** 配音指针 → 能播的地址。还没解析出来 / 读不出来的那几句不在表里（预览里就是没声音，字幕照出） */
  voiceUrls: Readonly<Record<string, string>>;
  /**
   * 播放头走到了这个片段的出点（每个片段只报一次）。
   * ★ 为什么由这一层来报：播放器自己的 timeupdate 一秒才来四次，变速 2 倍的片段在两次之间能多放出半秒素材 ——
   *   裁过尾巴的片段会把裁掉的那一截露出来，段尾的淡出也来不及黑到底。这里是逐帧看的。
   *   页面不可见时 rAF 不跑，播放器那边的 timeupdate 判断照旧留着兜底（两边都报也没关系，调用方是幂等的）。
   */
  onClipEnd?: () => void;
}

/** 八个方向的一圈影子当描边（合成器那边是真描边）。用 em，跟着字号走 */
const OUTLINE =
  "0.07em 0 0 #000, -0.07em 0 0 #000, 0 0.07em 0 #000, 0 -0.07em 0 #000, " +
  "0.05em 0.05em 0 #000, -0.05em 0.05em 0 #000, 0.05em -0.05em 0 #000, -0.05em -0.05em 0 #000, 0 0 0.12em #000";

export default function CutPreviewLayer({ videoRef, plan, clipId, playing, voiceUrls, onClipEnd }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  // 回调放 ref：它每次渲染都是新函数，进 effect 的依赖会让那一圈 rAF 每次渲染都重开
  const onClipEndRef = useRef(onClipEnd);
  onClipEndRef.current = onClipEnd;
  /** 已经报过「到出点了」的那个片段（同一个片段只报一次；换了片段、或者播放头被拖回去之后可以再报） */
  const endedRef = useRef<string | null>(null);
  /** 现在挂着的是计划里的哪几条字幕（下标拼成的串；只有它变了才重渲染） */
  const [shown, setShown] = useState("");
  const shownRef = useRef("");
  const audios = useRef(new Map<string, HTMLAudioElement>());

  useEffect(() => {
    let raf = 0;
    const pauseAll = () => {
      for (const a of audios.current.values()) if (!a.paused) a.pause();
    };
    const hide = () => {
      if (rootRef.current) rootRef.current.style.display = "none";
      if (shownRef.current !== "") {
        shownRef.current = "";
        setShown("");
      }
      pauseAll();
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const root = rootRef.current;
      const pc = plan && clipId ? plan.clips.find((c) => c.clipId === clipId) : undefined;
      if (!v || !root || !plan || !pc || v.offsetWidth < 2) {
        hide();
        return;
      }
      // 贴住画面
      const st = root.style;
      st.display = "block";
      st.left = `${v.offsetLeft}px`;
      st.top = `${v.offsetTop}px`;
      st.width = `${v.offsetWidth}px`;
      st.height = `${v.offsetHeight}px`;
      st.setProperty("--cap-px", `${(plan.layout.sizeRatio * Math.min(v.offsetWidth, v.offsetHeight)).toFixed(2)}px`);
      // 到出点了：逐帧看，比播放器的 timeupdate 准（见 Props.onClipEnd 的 ★）
      if (playing && v.currentTime >= pc.endSec - 0.02) {
        if (endedRef.current !== pc.clipId) {
          endedRef.current = pc.clipId;
          onClipEndRef.current?.();
        }
      } else if (v.currentTime < pc.endSec - 0.2) {
        endedRef.current = null;
      }
      // 播放头在成片时间轴上的位置：这一段的起点 + 片内走了多远 ÷ 速度
      const local = Math.min(Math.max(v.currentTime, pc.startSec), pc.endSec);
      const now = pc.outStart + (local - pc.startSec) / pc.speed;
      // 闪黑
      let k = 1;
      if (pc.fadeIn > 0 && now < pc.outStart + pc.fadeIn) k = Math.min(k, (now - pc.outStart) / pc.fadeIn);
      const stop = pc.outStart + pc.outDur;
      if (pc.fadeOut > 0 && now > stop - pc.fadeOut) k = Math.min(k, (stop - now) / pc.fadeOut);
      if (blackRef.current) blackRef.current.style.opacity = String(1 - Math.max(0, Math.min(1, k)));
      // 字幕 / 标题
      let key = "";
      for (let i = 0; i < plan.captions.length; i++) {
        const c = plan.captions[i];
        if (now >= c.startSec && now < c.endSec) key += key ? `,${i}` : String(i);
      }
      if (key !== shownRef.current) {
        shownRef.current = key;
        setShown(key);
      }
      // 配音：播放头走进哪一句的区间就从对应的位置念起，走出去 / 停下来就收声
      const live = new Set<string>();
      for (const pv of plan.voices) {
        const url = voiceUrls[pv.ref];
        if (!url) continue;
        live.add(url);
        let a = audios.current.get(url);
        if (!a) {
          a = new Audio(url);
          a.preload = "auto";
          audios.current.set(url, a);
        }
        const within = playing && now >= pv.atSec && now < pv.atSec + pv.playSec;
        if (!within) {
          if (!a.paused) a.pause();
          continue;
        }
        const want = now - pv.atSec;
        try {
          a.volume = Math.max(0, Math.min(1, pv.volume));
          if (a.paused) {
            a.currentTime = want;
            void a.play().catch(() => {});
          } else if (Math.abs(a.currentTime - want) > 0.4) {
            a.currentTime = want; // 拖过进度条 / 换过片段：对回去
          }
        } catch {
          /* 声音还没解出来：下一帧再试，不影响别的 */
        }
      }
      // 计划里已经没有的那几句（配音被去掉 / 换过一版）：收声并放掉
      for (const [url, a] of audios.current) {
        if (live.has(url)) continue;
        a.pause();
        audios.current.delete(url);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      pauseAll();
    };
  }, [videoRef, plan, clipId, playing, voiceUrls]);

  const layout = plan?.layout;
  const items = plan && shown ? shown.split(",").map((s) => plan.captions[Number(s)]).filter(Boolean) : [];
  return (
    <div ref={rootRef} className="pointer-events-none absolute overflow-hidden" style={{ display: "none" }} aria-hidden>
      <div ref={blackRef} className="absolute inset-0 bg-black" style={{ opacity: 0 }} />
      {layout &&
        items.map((c, i) => (
          <div
            key={`${c.kind}:${c.startSec}:${i}`}
            className="absolute inset-x-0 whitespace-nowrap text-center font-bold text-white"
            style={
              c.kind === "title"
                ? {
                    // 第一行的基线落在离顶 titleTopRatio 的地方（1.3 行高里基线离行顶约 0.99em）
                    top: `calc(${(layout.titleTopRatio * 100).toFixed(2)}% - 0.99em)`,
                    fontSize: `calc(var(--cap-px) * ${layout.titleScale})`,
                    lineHeight: 1.3,
                    textShadow: OUTLINE,
                  }
                : {
                    // 最后一行的基线落在离底 bottomRatio 的地方（1.3 行高里基线离行底约 0.31em）
                    bottom: `calc(${(layout.bottomRatio * 100).toFixed(2)}% - 0.31em)`,
                    fontSize: "var(--cap-px)",
                    lineHeight: 1.3,
                    textShadow: OUTLINE,
                  }
            }
          >
            {c.lines.map((ln, j) => (
              <div key={j}>{ln}</div>
            ))}
          </div>
        ))}
    </div>
  );
}
