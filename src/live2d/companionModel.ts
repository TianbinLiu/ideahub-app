/**
 * @file companionModel.ts - 看板娘模型驱动（pixi-live2d-display 之上的一层薄壳）
 * @category Utility
 *
 * 职责：把「表情 / 动作 / 口型 / 视线」这些语义调用翻译成 Cubism 参数与 Part 不透明度。
 *
 * ★ 这个模型的表情是"补片式"的（Cubism 工程里的 ExprSmile/ExprAngry/ExprClosed/ExprMouthOpen 四个 Part），
 *   moc3 里 ParamMouthOpenY / ParamEyeLOpen 目前没有形变（还没做嘴/眼的变形器），
 *   所以张嘴、眨眼靠切换 Part 不透明度，参数只是顺手一起写（将来补了变形器就自动生效）。
 * ★ 所有写参数的操作都挂在 ticker 的 LOW 优先级：pixi-live2d-display 每帧先跑 动作→表情→呼吸→物理，
 *   之后我们再叠加（addParameterValueById）或覆盖，否则会被动作覆盖掉。
 * ★ 口型包络的起落时间（40ms / 90ms）与"补片阈值"决定了嘴是"抖"还是"说"，改之前看 protocol.ts 的注释。
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

const BLINK_MS = 120;
const POSE_FADE_MS = 220;
const PART_FADE_MS = 140;

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
  private readonly partCurrent: PartState = { ExprSmile: 0, ExprAngry: 0, ExprClosed: 0, ExprMouthOpen: 0 };
  private pose: FacePose = FACE_POSES.normal;
  private poseUntil = 0;
  private poseCurrent: Record<string, number> = {};
  private nextBlinkAt = performance.now() + 1800;
  private blinkUntil = 0;
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
    // 导出的 moc3 里补片 Part 默认不透明度是 1（全都露出来 = 四种表情叠在脸上），挂载第一帧就得关掉
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
      this.blinkUntil = 0;
    }

    // 表情到期 → 回 normal
    if (this.poseUntil && now > this.poseUntil) {
      this.pose = FACE_POSES.normal;
      this.poseUntil = 0;
    }

    // 眨眼调度
    if (this.pose.blink && now >= this.nextBlinkAt) {
      this.blinkUntil = now + BLINK_MS;
      this.nextBlinkAt = now + 2400 + Math.random() * 3600;
    }
    const blinking = now < this.blinkUntil;

    // 口型：合成 or 音频包络 → 起落平滑 → 补片不透明度
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
    const mouthOpacity = clamp01((this.mouthLevel - 0.12) / 0.3);

    // 补片目标：表情 + 眨眼 + 口型
    const target: PartState = { ExprSmile: 0, ExprAngry: 0, ExprClosed: 0, ExprMouthOpen: mouthOpacity };
    for (const id of EXPRESSION_PARTS) {
      const value = this.pose.parts[id];
      if (value) target[id] = value;
    }
    if (blinking) target.ExprClosed = 1;
    for (const id of EXPRESSION_PARTS) {
      const instant = id === "ExprMouthOpen" || (id === "ExprClosed" && blinking);
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

    // 参数版口型/眨眼（将来补了变形器就生效；现在无害）
    core.setParameterValueById("ParamMouthOpenY", this.mouthLevel);
    if (blinking) {
      core.setParameterValueById("ParamEyeLOpen", 0);
      core.setParameterValueById("ParamEyeROpen", 0);
    }
  }
}
