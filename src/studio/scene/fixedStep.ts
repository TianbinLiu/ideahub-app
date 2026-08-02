// 固定步长累加器：显式积分的弹簧对 dt 极其敏感，而渲染 dt 在用户操作镜头时会剧烈
// 波动（转镜头那几帧要重算蒙皮做射线检测，帧时间能从 1ms 跳到 50ms）。同一个静止
// 姿势会因为帧长忽长忽短而抖动、形变。物理按固定步长跑、渲染帧只决定跑几步，操作
// 镜头时就完全稳定。
//
// 上限存在的意义：页面切回前台/长卡顿后 dt 可达 1s+，不封顶会一帧内跑几十步（表现
// 为"炸开"）。封顶的代价是物理落后于真实时间，但对装饰性摆动没有任何可见影响。
export class FixedStepper {
  private acc = 0;
  constructor(
    readonly step = 1 / 60,
    readonly maxSteps = 3,
  ) {}

  /** 喂入真实 dt，返回本帧应当执行的步数（0..maxSteps） */
  take(dt: number): number {
    this.acc = Math.min(this.acc + Math.max(0, dt), this.step * this.maxSteps);
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) {
      this.acc -= this.step;
      n++;
    }
    return n;
  }

  reset() {
    this.acc = 0;
  }
}
