// 弹幕渲染层（对标 B 站）：一条条文字从右往左飘过画面上半部。
//
// ★★ 速度**恒定**，时长按距离算 —— 不是所有弹幕共用一个 duration。
//   同一个 duration 下长弹幕走得快、短弹幕走得慢，同轨后发的会**追上并穿过**先发的，
//   糊成一团。恒速之后同轨永远追不上，轨道调度（laneFreeAt）才有意义。
//
// ★ 只动 transform（合成层）。同屏十几条在飘，底下还有一路在解码的视频，
//   动 left 就是每帧十几次重排，真机上直接把播放拖掉帧（CLAUDE.md 的约定）。
//
// ★ 宽度是**估**出来的，而且刻意往大了估。真宽度要等元素挂载后 measure，
//   那样每条都会先在右边缘杵一帧再动。估大了只是提前一点点走完（那会儿它早在屏外），
//   估小了则是没出屏就被移除 —— 画面上就是"凭空消失"。
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  DANMAKU_COLORS,
  danmakuOf,
  danmakuVersion,
  isMyDanmaku,
  subscribeDanmaku,
  type DanmakuItem,
} from "../data/danmaku";

/** 恒定速度（px/秒）。390px 宽的竖屏上一条弹幕横穿一屏约 7 秒 ——
 *  再快看不清，再慢屏幕上会同时挤着太多条 */
const SPEED_PX_PER_S = 56;
/** 轨道高度与条数。4 条 ≈ 112px，只占画面上部一小条；
 *  B 站手机端默认也就占屏高 25% 上下，多了就是拿弹幕把视频糊住 */
const LANE_H = 28;
const LANES = 4;
/** 同轨前后两条之间至少留这么宽的空当（px），否则读起来是连在一起的一长串 */
const LANE_GAP = 36;
const FONT_PX = 15;
/** 同屏元素上限。一条作品被灌了几百条弹幕时必须有个天花板，否则动画元素多到掉帧 */
const LIVE_MAX = 60;

interface Live {
  /** React key。用 id + 递增序号：拖回去重看时同一条要能再飘一次，key 不换动画不重播 */
  key: string;
  id: string;
  text: string;
  color: string;
  mine: boolean;
  lane: number;
  /** 起点（容器右外侧）与终点（左外侧）的 translateX 值 */
  from: number;
  to: number;
  ms: number;
}

/** 估算一条弹幕的像素宽度。CJK 与全角标点按 1em，其余按 0.56em；
 *  再乘 1.06 加 10px 兜住字距和 text-shadow —— 见文件头"刻意往大了估"。 */
function estWidth(text: string): number {
  let em = 0;
  for (const ch of text) em += /[⺀-鿿　-〿＀-￯]/.test(ch) ? 1 : 0.56;
  return Math.ceil(em * FONT_PX * 1.06) + 10;
}

export default function DanmakuLayer({
  videoId,
  /** 当前播放到的**全片**秒数（多段作品要把前几段时长加上，与进度条同口径） */
  time,
  paused,
  /** 轨道从容器顶往下多远开始铺。首页要避开「关注 / 推荐」那一行，所以收 CSS 值 */
  top,
}: {
  videoId: string;
  time: number;
  paused: boolean;
  top: string;
}) {
  const version = useSyncExternalStore(subscribeDanmaku, danmakuVersion, () => 0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Live[]>([]);
  /** 上一次扫到的时间点：(cursor, time] 区间内的弹幕这一拍放出去 */
  const cursor = useRef(0);
  /** 每条轨道"最早什么时候能再放下一条"（同样是视频时间轴上的秒数） */
  const laneFreeAt = useRef<number[]>(Array(LANES).fill(0));
  /** 这一轮（上次跳变以来）已经放过的弹幕 id，避免同一条被放两次 */
  const shown = useRef<Set<string>>(new Set());
  const seq = useRef(0);

  /** 把这批弹幕排进轨道并挂上去 */
  function launch(due: DanmakuItem[], at: number) {
    if (due.length === 0) return;
    const w = boxRef.current?.clientWidth ?? 360;
    const born = due.map((d) => {
      shown.current.add(d.id);
      return spawn(d, w, at, laneFreeAt.current, ++seq.current);
    });
    setLive((prev) => [...prev, ...born].slice(-LIVE_MAX));
  }

  function reset(at: number) {
    setLive([]);
    laneFreeAt.current = Array(LANES).fill(0);
    shown.current = new Set();
    cursor.current = at;
  }

  // 换作品要整层清空并把游标归位
  useEffect(() => reset(0), [videoId]);

  useEffect(() => {
    const dt = time - cursor.current;
    // 跳变（拖进度条、切段、循环回到开头）：这一轮作废，从新位置重新开始扫。
    // 阈值取 (0, 2s]：正常 timeupdate 约 250ms 一次，2 秒足够宽松；
    // 负数一定是往回跳，>2s 一定是跳着走的而不是连续播放
    if (dt < 0 || dt > 2) {
      reset(time);
      return;
    }
    if (dt <= 0) return;
    const from = cursor.current;
    cursor.current = time;
    launch(
      danmakuOf(videoId).filter((d) => d.at > from && d.at <= time && !shown.current.has(d.id)),
      time,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, videoId]);

  // ★ 用户自己刚发的那条要立刻飘出来。
  //   它的 at 就是"现在"，而游标已经走过这个点了 —— 只靠上面那个 (cursor, time] 区间
  //   是**永远扫不到**的，表现就是"点了发送，屏幕上什么都没有"。
  useEffect(() => {
    const at = cursor.current;
    launch(
      danmakuOf(videoId).filter((d) => !shown.current.has(d.id) && d.at <= at && d.at > at - 2),
      at,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, videoId]);

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-x-0 z-10 overflow-hidden"
      style={{ top, height: LANES * LANE_H }}
      aria-hidden
    >
      {live.map((b) => (
        <span
          key={b.key}
          className={`danmaku-run absolute left-0 whitespace-pre px-1 font-semibold leading-none ${
            b.mine ? "rounded-[3px] ring-1 ring-white/70" : ""
          }`}
          style={
            {
              top: b.lane * LANE_H + (LANE_H - FONT_PX) / 2,
              fontSize: FONT_PX,
              color: b.color,
              textShadow: "0 1px 2px rgba(0,0,0,.85), 0 0 3px rgba(0,0,0,.6)",
              animationDuration: `${b.ms}ms`,
              // 视频停了弹幕就得停 —— 否则暂停的画面上还有字在飘，看着像另一个视频
              animationPlayState: paused ? "paused" : "running",
              "--dm-from": `${b.from}px`,
              "--dm-to": `${b.to}px`,
            } as CSSProperties
          }
          onAnimationEnd={() => setLive((prev) => prev.filter((x) => x.key !== b.key))}
        >
          {b.text}
        </span>
      ))}
    </div>
  );
}

/**
 * 给一条弹幕挑轨道并算出它的行程。
 * 轨道调度只看"前一条的尾巴出去了没"：恒速下这个判断是充分的（同轨追不上），
 * 所以只要记住每条轨道**最早可用的时刻**就够，不必追踪每个元素的实时位置。
 */
function spawn(d: DanmakuItem, boxW: number, now: number, freeAt: number[], seq: number): Live {
  const w = estWidth(d.text);
  const ms = ((boxW + w) / SPEED_PX_PER_S) * 1000;
  let lane = freeAt.findIndex((t) => t <= now);
  // 全占着：挑最快空出来的那条，宁可挤一下也不丢弹幕 ——
  // 丢掉的很可能正是用户自己刚发的那条，"点了发送但没出现"是最难受的一种失败
  if (lane < 0) lane = freeAt.indexOf(Math.min(...freeAt));
  freeAt[lane] = now + (w + LANE_GAP) / SPEED_PX_PER_S;
  return {
    key: `${d.id}#${seq}`,
    id: d.id,
    text: d.text,
    color: d.color || DANMAKU_COLORS[0],
    mine: isMyDanmaku(d),
    lane,
    from: boxW,
    to: -w,
    ms,
  };
}
