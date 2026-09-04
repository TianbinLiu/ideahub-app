/**
 * @file companionModel.ts - 看板娘模型驱动（pixi-live2d-display 之上的一层薄壳）
 * @category Utility
 *
 * 职责：把「表情 / 动作 / 口型 / 视线」这些语义调用翻译成 Cubism 参数与 Part 不透明度。
 *
 * ★ 嘴与眼是【参数驱动的形变】（2026-09-04 起，mascot8.moc3）：
 *   - ParamMouthOpenY 0→1 = 嘴从一条线连续张到全开（Cubism 工程里 Mouth Open Warp 的两个关键帧），
 *     ParamMouthForm -1→1 = 嘴变窄/变宽；所以口型是"随音量连续变化"，不再是张/闭两张图切换。
 *   - ParamEyeL/ROpen 1→0 = 眼睛（眼白/瞳孔/睫毛整组）向下压扁到睫毛线，闭眼补片的不透明度也钉在这个参数上
 *     （1 时 0%、0 时 100%），眨眼是一条 闭 70ms → 停 40ms → 睁 120ms 的曲线，不是瞬间切换。
 *   - ExprSmile / ExprAngry 仍是补片（笑眼、怒目整块贴图），靠 Part 不透明度开关；
 *     ExprClosed / ExprMouthOpen 这两个 Part 现在【常开】，露不露由上面的参数关键帧决定。
 * ★ 所有写参数的操作都挂在 ticker 的 LOW 优先级：pixi-live2d-display 每帧先跑 动作→表情→呼吸→物理，
 *   之后我们再叠加（addParameterValueById）或覆盖，否则会被动作覆盖掉。框架自带的自动眨眼（EyeBlink 组）
 *   在构造时拆掉，否则它和我们的曲线会各眨各的。
 * ★ 口型包络的起落时间（40ms / 90ms）决定了嘴是"抖"还是"说"，改之前看 protocol.ts 的注释。
 * ★★ 全站只允许一个实例、一个 WebGL 上下文（acquire / attach / detach）：Cubism 框架把编译好的着色器缓存在
 *   单例里，第一次用的是哪个 WebGL 上下文就绑死了；组件卸载再挂载时如果新建 pixi Application，
 *   第二个上下文拿到的是旧程序 —— 控制台刷 "useProgram: object does not belong to this context"，画布一片空白
 *   （2026-09-04 在 App 客服页切「我的工单」再切回来实测）。所以画布是模型自己造的、跟着模型活一辈子，
 *   组件只负责把它挂进/摘出自己的容器。
 */

import { loadLive2DRuntime, type Live2DModelInstance, type PixiApplication, type PixiRuntime } from "./loader";
import {
  ACTION_MOTIONS,
  EXPRESSION_PARTS,
  FACE_POSES,
  TIMING,
  type CompanionAction,
  type CompanionFace,
  type ExpressionPart,
  type FacePose,
} from "../companion/protocol";

export type StageRect = { x: number; y: number; width: number; height: number };

type PartState = Record<ExpressionPart, number>;

/** 眨眼曲线：闭 → 停 → 睁（毫秒）。真人眨眼 100~150ms 合眼、稍慢睁开，比这快看着像抽搐 */
const BLINK_CLOSE_MS = 70;
const BLINK_HOLD_MS = 40;
const BLINK_OPEN_MS = 120;
const BLINK_TOTAL_MS = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;
const POSE_FADE_MS = 220;
const PART_FADE_MS = 140;
/** 张嘴上限：包络 1.0 时也只开到 85%，全开是"啊——"的夸张口型，说话用不到 */
const MOUTH_OPEN_MAX = 0.85;
/** 张嘴补片在这个开度以内从 0 淡入到 100%（避免开度极小的时候一条黑线突然出现） */
const MOUTH_PATCH_FADE = 0.1;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

let singleton: CompanionModel | null = null;
let pending: Promise<CompanionModel> | null = null;

export class CompanionModel {
  /** 模型自己的画布：由 attach() 挂进容器、detach() 摘出来，从不销毁（见文件头 ★★） */
  readonly canvas: HTMLCanvasElement;
  readonly modelUrl: string;
  private readonly pixi: PixiRuntime;
  private readonly app: PixiApplication;
  private readonly model: Live2DModelInstance;
  private readonly partIndex = new Map<ExpressionPart, number>();
  /** ExprClosed 常开（闭眼补片由 ParamEyeL/ROpen 的关键帧控制露出），其余补片默认关 */
  private readonly partCurrent: PartState = { ExprSmile: 0, ExprAngry: 0, ExprClosed: 1, ExprMouthOpen: 0 };
  private pose: FacePose = FACE_POSES.normal;
  private poseUntil = 0;
  private poseCurrent: Record<string, number> = {};
  private nextBlinkAt = performance.now() + 1800;
  /** 当前这次眨眼的起点；0 = 没在眨 */
  private blinkStart = 0;
  /** 表情要求的闭眼程度（crying 等），向目标渐变 */
  private eyeClose = 0;
  private mouthTarget = 0;
  private mouthLevel = 0;
  private synthetic: { until: number; start: number } | null = null;
  private gazeTarget = { x: 0, y: 0 };
  private gaze = { x: 0, y: 0 };
  private actionSuppressUntil = 0;
  private lastFrame = performance.now();
  private disposed = false;
  private stageWidth = 0;
  private stageHeight = 0;
  private lastRect: StageRect | null = null;
  private fitOptions = { heightRatio: 1.2, xBias: 0.5 };
  private readonly tick = () => this.onTick();

  private constructor(pixi: PixiRuntime, app: PixiApplication, model: Live2DModelInstance, canvas: HTMLCanvasElement, modelUrl: string) {
    this.pixi = pixi;
    this.app = app;
    this.model = model;
    this.canvas = canvas;
    this.modelUrl = modelUrl;
    const core = model.internalModel.coreModel;
    const rawParts = core.getModel ? Array.from(core.getModel().parts.ids) : [];
    for (const id of EXPRESSION_PARTS) {
      const viaApi = typeof core.getPartIndex === "function" ? core.getPartIndex(id) : -1;
      const index = viaApi >= 0 ? viaApi : rawParts.indexOf(id);
      if (index >= 0) this.partIndex.set(id, index);
    }
    // model3.json 声明了 EyeBlink 组，pixi-live2d-display 会自己随机眨眼；我们每帧覆盖 ParamEyeL/ROpen，
    // 把它拆掉省得两套眨眼互相打架（它在 update() 里跑，早于我们的 LOW 优先级 tick）
    (model.internalModel as { eyeBlink?: unknown }).eyeBlink = undefined;
    // 导出的 moc3 里补片 Part 默认不透明度是 1（笑眼/怒目全都露出来 = 表情叠在脸上），挂载第一帧就得关掉
    this.applyParts();
    app.ticker.add(this.tick, undefined, pixi.UPDATE_PRIORITY.LOW);
  }

  /**
   * 取全站唯一的模型实例；第一次调用才真正加载运行时与模型，之后原样复用。
   * 换了 modelUrl 才会销毁重建（同一页面里不会发生，留作将来换装）。
   */
  static acquire(modelUrl: string): Promise<CompanionModel> {
    if (singleton && !singleton.disposed && singleton.modelUrl === modelUrl) return Promise.resolve(singleton);
    if (pending) return pending;
    pending = (async () => {
      if (singleton) {
        singleton.destroy();
        singleton = null;
      }
      const canvas = document.createElement("canvas");
      canvas.style.display = "block";
      canvas.setAttribute("aria-hidden", "true");
      const pixi = await loadLive2DRuntime();
      const app = new pixi.Application({
        view: canvas,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 1.5),
        width: 2,
        height: 2,
      });
      let model: Live2DModelInstance;
      try {
        model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: false, idleMotionGroup: "Idle" });
      } catch (error) {
        app.destroy(false);
        throw error;
      }
      app.stage.addChild(model);
      model.anchor.set(0.5, 0.5);
      singleton = new CompanionModel(pixi, app, model, canvas, modelUrl);
      return singleton;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** 把画布挂进容器并恢复渲染循环。容器需要 position:relative/absolute + overflow:hidden */
  attach(container: HTMLElement) {
    if (this.disposed) return;
    if (this.canvas.parentElement !== container) container.appendChild(this.canvas);
    this.lastFrame = performance.now();
    this.app.ticker.start();
  }

  /** 组件卸载：摘出画布、停掉渲染循环，模型本体留着给下一次 attach */
  detach() {
    if (this.disposed) return;
    this.stopSpeaking();
    this.lookForward();
    this.app.ticker.stop();
    this.canvas.remove();
  }

  /** 舞台（canvas）尺寸变化时调用；随后会按上次的锚点矩形重新摆位 */
  resize(width: number, height: number) {
    if (this.disposed) return;
    this.stageWidth = Math.max(1, Math.round(width));
    this.stageHeight = Math.max(1, Math.round(height));
    this.app.renderer.resize(this.stageWidth, this.stageHeight);
    if (this.lastRect) this.fitTo(this.lastRect, this.fitOptions);
  }

  /**
   * 把模型"站"进舞台坐标系里的一个矩形：脚踩矩形底边、水平居中（xBias 偏移），
   * 身高 = 矩形高 × heightRatio（>1 表示头会伸到矩形上方——那里通常是推荐位卡片，卡片在上层，正好"站在卡片后面"）
   */
  fitTo(rect: StageRect, options?: Partial<{ heightRatio: number; xBias: number }>) {
    if (this.disposed) return;
    this.fitOptions = { ...this.fitOptions, ...options };
    this.lastRect = rect;
    const internal = this.model.internalModel;
    const originalWidth = internal.originalWidth || this.model.width / (this.model.scale.x || 1);
    const originalHeight = internal.originalHeight || this.model.height / (this.model.scale.y || 1);
    if (!originalWidth || !originalHeight) return;
    const targetHeight = Math.max(120, rect.height * this.fitOptions.heightRatio);
    const scale = targetHeight / originalHeight;
    this.model.scale.set(scale, scale);
    this.model.x = rect.x + rect.width * this.fitOptions.xBias;
    this.model.y = rect.y + rect.height - targetHeight / 2;
  }

  /** 视线目标：把页面坐标换算成相对头部的 -1~1 */
  lookAtClient(clientX: number, clientY: number, stageOrigin: { left: number; top: number }) {
    if (this.disposed) return;
    const headX = stageOrigin.left + this.model.x;
    const headY = stageOrigin.top + this.model.y - this.model.height * 0.28;
    const nx = (clientX - headX) / Math.max(200, window.innerWidth * 0.45);
    const ny = (clientY - headY) / Math.max(200, window.innerHeight * 0.45);
    this.gazeTarget = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
  }

  lookForward() {
    this.gazeTarget = { x: 0, y: 0 };
  }

  setFace(face: CompanionFace) {
    if (this.disposed) return;
    this.pose = FACE_POSES[face] || FACE_POSES.normal;
    this.poseUntil = this.pose.holdMs > 0 ? performance.now() + this.pose.holdMs : 0;
  }

  playAction(action: CompanionAction) {
    if (this.disposed) return;
    const group = ACTION_MOTIONS[action];
    if (!group) return;
    const now = performance.now();
    if (now < this.actionSuppressUntil) return; // 上一个语义动作还没做完，别抢戏
    if (!this.model.internalModel.settings.motions?.[group]) return;
    this.actionSuppressUntil = now + TIMING.actionSuppressMs;
    void this.model.motion(group, 0, this.pixi.live2d.MotionPriority.FORCE).catch(() => undefined);
  }

  /** 音频包络（0~1），由 SpeechPlayer 每 ~20ms 喂一次 */
  setMouth(level: number) {
    this.synthetic = null;
    this.mouthTarget = clamp01(level);
  }

  /** 没有音频时用 5.2Hz 的合成口型撑满给定时长 */
  speakSynthetic(durationMs: number) {
    const now = performance.now();
    this.synthetic = { start: now, until: now + Math.max(0, durationMs) };
  }

  stopSpeaking() {
    this.synthetic = null;
    this.mouthTarget = 0;
  }

  /** 彻底销毁（换模型时用；正常卸载走 detach） */
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.app.ticker.remove(this.tick);
    try {
      this.app.stage.removeChild(this.model);
      this.model.destroy({ children: true });
    } catch {
      // 模型已经被 pixi 回收
    }
    this.app.destroy(false, { children: true });
    this.canvas.remove();
    if (singleton === this) singleton = null;
  }

  private setPartOpacity(id: ExpressionPart, value: number) {
    const index = this.partIndex.get(id);
    if (index === undefined) return;
    this.model.internalModel.coreModel.setPartOpacityByIndex(index, value);
  }

  private applyParts() {
    for (const id of EXPRESSION_PARTS) this.setPartOpacity(id, this.partCurrent[id]);
  }

  /** 眨眼曲线在此刻的睁眼度（1 = 全开）；曲线走完把 blinkStart 归零 */
  private blinkOpenness(now: number) {
    if (!this.blinkStart) return 1;
    const phase = now - this.blinkStart;
    if (phase < BLINK_CLOSE_MS) return 1 - phase / BLINK_CLOSE_MS;
    if (phase < BLINK_CLOSE_MS + BLINK_HOLD_MS) return 0;
    if (phase < BLINK_TOTAL_MS) return (phase - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS;
    this.blinkStart = 0;
    return 1;
  }

  private onTick() {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = now - this.lastFrame;
    const dt = Math.min(100, rawDt);
    this.lastFrame = now;
    const core = this.model.internalModel.coreModel;

    // 标签页从后台切回来（rAF 停了很久）：别在恢复的第一帧就补一次眨眼，那一帧往往正被截图/首屏看到
    if (rawDt > 1000) {
      this.nextBlinkAt = Math.max(this.nextBlinkAt, now + 1500);
      this.blinkStart = 0;
    }

    // 表情到期 → 回 normal
    if (this.poseUntil && now > this.poseUntil) {
      this.pose = FACE_POSES.normal;
      this.poseUntil = 0;
    }

    // 眨眼调度：起一条曲线，之后每帧按曲线写参数（笑眼/闭眼类表情不眨，见 protocol.ts）
    if (this.pose.blink && !this.blinkStart && now >= this.nextBlinkAt) {
      this.blinkStart = now;
      this.nextBlinkAt = now + 2400 + Math.random() * 3600;
    }
    const blinkOpen = this.blinkOpenness(now);
    // 表情要求的闭眼（crying 的 ExprClosed:1）渐入渐出，和眨眼相乘
    const closeGoal = this.pose.parts.ExprClosed ?? 0;
    this.eyeClose += (closeGoal - this.eyeClose) * Math.min(1, dt / POSE_FADE_MS);
    const eyeOpen = clamp01(blinkOpen * (1 - this.eyeClose));

    // 口型：合成 or 音频包络 → 起落平滑 → 开度曲线（小声也微张、最响到 85%）
    if (this.synthetic) {
      if (now > this.synthetic.until) {
        this.synthetic = null;
        this.mouthTarget = 0;
      } else {
        const t = (now - this.synthetic.start) / 1000;
        this.mouthTarget = Math.max(0, Math.sin(t * 2 * Math.PI * TIMING.syntheticHz)) * TIMING.mouthCap;
      }
    }
    const tau = this.mouthTarget > this.mouthLevel ? TIMING.attackMs : TIMING.releaseMs;
    this.mouthLevel += (this.mouthTarget - this.mouthLevel) * Math.min(1, dt / tau);
    const mouthOpen = Math.pow(clamp01(this.mouthLevel), 0.7) * MOUTH_OPEN_MAX;

    // 补片目标：笑眼/怒目跟表情；闭眼补片常开；张嘴补片在极小开度内淡入（露出与否由关键帧决定）
    const target: PartState = { ExprSmile: 0, ExprAngry: 0, ExprClosed: 1, ExprMouthOpen: clamp01(mouthOpen / MOUTH_PATCH_FADE) };
    for (const id of EXPRESSION_PARTS) {
      if (id === "ExprClosed" || id === "ExprMouthOpen") continue;
      const value = this.pose.parts[id];
      if (value) target[id] = value;
    }
    for (const id of EXPRESSION_PARTS) {
      const instant = id === "ExprMouthOpen" || id === "ExprClosed";
      const current = this.partCurrent[id];
      this.partCurrent[id] = instant ? target[id] : current + (target[id] - current) * Math.min(1, dt / PART_FADE_MS);
    }
    this.applyParts();

    // 表情参数：向目标渐变后【叠加】到当前值上（动作/呼吸仍然有效）
    const keys = new Set([...Object.keys(this.poseCurrent), ...Object.keys(this.pose.params)]);
    for (const key of keys) {
      const goal = this.pose.params[key] ?? 0;
      const cur = this.poseCurrent[key] ?? 0;
      const next = cur + (goal - cur) * Math.min(1, dt / POSE_FADE_MS);
      if (Math.abs(next) < 0.001 && goal === 0) {
        delete this.poseCurrent[key];
        continue;
      }
      this.poseCurrent[key] = next;
      core.addParameterValueById(key, next);
    }

    // 视线：跟着鼠标轻微转头 + 眼球
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * Math.min(1, dt / 260);
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * Math.min(1, dt / 260);
    core.addParameterValueById("ParamAngleX", this.gaze.x * 14);
    core.addParameterValueById("ParamAngleY", -this.gaze.y * 8);
    core.addParameterValueById("ParamEyeBallX", this.gaze.x * 0.6);
    core.addParameterValueById("ParamEyeBallY", -this.gaze.y * 0.4);

    // 口型与眼睛：每帧【覆盖】写入（动作/表情文件里没有这两组参数，覆盖不会吃掉别的演出）
    core.setParameterValueById("ParamMouthOpenY", mouthOpen);
    core.setParameterValueById("ParamEyeLOpen", eyeOpen);
    core.setParameterValueById("ParamEyeROpen", eyeOpen);
  }
}
