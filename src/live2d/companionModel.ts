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
 *   - ParamSkirtSway -10→10 = 裙摆左右摆（mascot9 的 Skirt Warp，Cubism「Auto Generation of Sway Motion」生成，支点在腰）。
 *     ★ 2026-09-05 起模型自带 mascot.physics3.json（手写：前发/侧发/后发/裙摆 4 组摆锤，输入是头身角度）：
 *     有物理时这几个参数由 Cubism 物理在 update 里算，我们的弹簧不再写（写了也会被物理覆盖），只每帧改物理的
 *     wind 向量吹一阵慢正弦"微风"，让静止时摆锤也自己轻轻晃；没有物理的老模型/市场包才走下面的弹簧兜底。
 *     物理输出只在 model.update() 之前那一刻存在（update 末尾 loadParameters 会还原），所以别在 tick 里读它们。
 *     没物理时"布料的惯性"由这里的二阶弹簧代劳：每帧读动作/呼吸算出的 ParamBodyAngleX，
 *     裙摆慢半拍跟上、过冲再回摆。idle 动作的身体摆只有 ±2、框架呼吸 ±4，所以要乘增益才看得见。
 *   - ParamHairFront / ParamHairBack（mascot10 的 Front/Back Hair Warp，同样是「Auto Generation of Sway Motion」）：
 *     弹簧追头部角度（AngleX/AngleZ）+ 一点身体角度，头一转发梢就跟着甩。
 *   - ParamArmL / ParamArmR（-10→10 = 肩部旋转，+ 为向外张）：呼吸时轻轻开合、随身体倾斜、[action:wave] 时右臂来回挥。
 *   - 触摸：model3.json 的 HitAreas 把 脸/头发/披风/裙子/双臂/腿 标成命中区，hitTest() 回区名，
 *     页面据此演一句（protocol.ts 的 TOUCH_REACTIONS）。
 * ★ 所有写参数的操作都挂在 ticker 的 LOW 优先级：pixi-live2d-display 每帧先跑 动作→表情→呼吸→物理，
 *   之后我们再叠加（addParameterValueById）或覆盖，否则会被动作覆盖掉。框架自带的自动眨眼（EyeBlink 组）
 *   在构造时拆掉，否则它和我们的曲线会各眨各的。
 * ★ 口型包络的起落时间（40ms / 90ms）决定了嘴是"抖"还是"说"，改之前看 protocol.ts 的注释。
 * ★★ 全页只有一个 pixi Application、一个画布、一个 WebGL 上下文，活到页面关闭；换模型（换装）只换 stage 里的模型。
 *   Cubism 框架把编译好的着色器缓存在单例里（CubismShader_WebGL._shaderSets），pixi-live2d-display 只在模型
 *   【带裁剪蒙版】时才在上下文变化时清这份缓存（updateWebGLContext 里包在 _clippingManager 判断内）——
 *   看板娘没有蒙版，于是任何"销毁 Application 再新建"都会让新上下文拿到旧程序：控制台刷
 *   "useProgram: object does not belong to this context"，画布一片空白。两次踩坑：2026-09-04 客服页切「我的工单」
 *   再切回来（组件重挂）、同日换装（acquire 新 url 时销毁重建）。所以 Application/画布是模块级的、从不销毁，
 *   CompanionModel 实例只拥有"模型 + 驱动状态"；组件只负责把画布挂进/摘出自己的容器。
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
/** 裙摆弹簧：刚度（1/s²）与阻尼（1/s）。刚度越小摆得越慢越"飘"，阻尼越小晃得越久；这组值 ≈ 0.8s 一个来回、过冲一次 */
const SKIRT_STIFFNESS = 28;
const SKIRT_DAMPING = 4.2;
/** 身体摆 ±6（idle ±2 + 呼吸 ±4）→ 裙摆参数 ±10 */
const SKIRT_GAIN = 3;
const SKIRT_RANGE = 10;
/** 没人碰也在飘：叠一个 0.37Hz 的微摆，裙子永远不是死的 */
const SKIRT_IDLE_AMP = 1.2;
const SKIRT_IDLE_HZ = 0.37;
/** 头发弹簧：比裙子硬、回摆快；前发只跟头，后发跟头 + 身体（后发长，摆幅大） */
const HAIR_STIFFNESS = 46;
const HAIR_DAMPING = 5.5;
/** ParamHairFront/Back 量程是 -1..1（不是 -10..10）：头转 20° 时前发到 ±0.8 左右，和物理版对齐 */
const HAIR_FRONT_GAIN = 0.04;
const HAIR_BACK_GAIN = 0.05;
const HAIR_RANGE = 1;
/** 有 physics3 时的微风：两个不同频率的正弦叠加（相对重力 1；实测 0.1 → 前发约 ±0.45、裙摆约 ±0.6，0.4 就把前发吹到满） */
const WIND_AMP = 0.12;
const WIND_HZ = 0.37;
const WIND_AMP2 = 0.05;
const WIND_HZ2 = 0.11;
/** 手臂：呼吸微开合 + 随身体倾斜；挥手 1.8s、2.2Hz、±9 */
const ARM_BREATH_AMP = 1.4;
const ARM_FOLLOW_GAIN = 0.35;
const ARM_WAVE_MS = 1800;
const ARM_WAVE_HZ = 2.2;
const ARM_WAVE_AMP = 9;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

let singleton: CompanionModel | null = null;
let pending: Promise<CompanionModel> | null = null;
/** 正在加载的那次是哪个 url（acquire 串行化用，见 acquire 的 ★） */
let pendingUrl = "";

type SharedStage = { pixi: PixiRuntime; app: PixiApplication; canvas: HTMLCanvasElement };
/** 全页唯一的 Application + 画布（见文件头 ★★），第一次 acquire 时创建，之后换模型都复用 */
let sharedStage: SharedStage | null = null;

async function getSharedStage(): Promise<SharedStage> {
  if (sharedStage) return sharedStage;
  const pixi = await loadLive2DRuntime();
  if (sharedStage) return sharedStage;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.setAttribute("aria-hidden", "true");
  const app = new pixi.Application({
    view: canvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 1.5),
    width: 2,
    height: 2,
  });
  sharedStage = { pixi, app, canvas };
  return sharedStage;
}

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
  /** 裙摆弹簧的位置与速度（ParamSkirtSway 的单位） */
  private skirt = 0;
  private skirtVel = 0;
  private hairFront = 0;
  private hairFrontVel = 0;
  private hairBack = 0;
  private hairBackVel = 0;
  /** 挥手手势的起点；0 = 没在挥 */
  private waveStart = 0;
  private readonly bornAt = performance.now();
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
   * 换了 modelUrl 就销毁重建（2026-09-04 起客服页可以换成市场模型，SupportStage 按 url 变化调这里）。
   * ★ 正在加载的那次是别的 url 时，排在它后面再换，而不是把那次的 pending 直接递出去：
   *   客服页会出现「先按官方 url 起加载、几十毫秒后设置回来要换市场模型」—— 老写法不看 url，
   *   换装方拿到的是官方模型还以为换成功了（零报错，屏幕上就是没换）。
   */
  static acquire(modelUrl: string): Promise<CompanionModel> {
    if (singleton && !singleton.disposed && singleton.modelUrl === modelUrl) return Promise.resolve(singleton);
    if (pending) {
      if (pendingUrl === modelUrl) return pending;
      const retry = () => CompanionModel.acquire(modelUrl);
      return pending.then(retry, retry);
    }
    pendingUrl = modelUrl;
    pending = (async () => {
      const { pixi, app, canvas } = await getSharedStage();
      // 先加载新模型再拆旧的：加载失败（作者删了包 / 贴图坏了）时旧模型原样留着，舞台不会空掉
      const model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: false, idleMotionGroup: "Idle" });
      if (singleton) {
        singleton.destroy();
        singleton = null;
      }
      app.stage.addChild(model);
      model.anchor.set(0.5, 0.5);
      singleton = new CompanionModel(pixi, app, model, canvas, modelUrl);
      return singleton;
    })().finally(() => {
      pending = null;
      pendingUrl = "";
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
    // 挥手没有单独的动作文件（动作走 excited），手臂的来回由 tick 里的手势叠上去
    if (action === "wave") this.waveStart = now;
    void this.model.motion(group, 0, this.pixi.live2d.MotionPriority.FORCE).catch(() => undefined);
  }

  /** 舞台里的点击落在哪些命中区（model3.json HitAreas 的名字：Head/Hair/Body/Skirt/ArmL/ArmR/Legs）；空数组 = 没点到人 */
  hitTest(clientX: number, clientY: number, stageOrigin: { left: number; top: number }): string[] {
    if (this.disposed || typeof this.model.hitTest !== "function") return [];
    try {
      return this.model.hitTest(clientX - stageOrigin.left, clientY - stageOrigin.top);
    } catch {
      return [];
    }
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

  /**
   * 拆掉这个模型（换模型时由 acquire 调；正常卸载走 detach）。
   * ★ 只拆模型，不动 Application / 画布 / WebGL 上下文（文件头 ★★）：画布留在原容器里，下一个模型直接画上去
   */
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

    // 裙摆：二阶弹簧追这一帧的身体角度（动作 + 呼吸 + 表情叠加之后的值）。
    // 老模型没有 ParamSkirtSway 时 setParameterValueById 被 Cubism 忽略，无害
    const readParam = (id: string) => (typeof core.getParameterValueById === "function" ? core.getParameterValueById(id) || 0 : 0);
    const bodyX = readParam("ParamBodyAngleX");
    const headX = readParam("ParamAngleX");
    const headZ = readParam("ParamAngleZ");
    const breath = readParam("ParamBreath");
    const dtSec = Math.min(0.05, dt / 1000);
    const tSec = (now - this.bornAt) / 1000;
    // 二阶弹簧一步：返回 [新位置, 新速度]；裙摆量程 ±10，头发量程 ±1
    const spring = (pos: number, vel: number, target: number, k: number, c: number, range = SKIRT_RANGE): [number, number] => {
      const v = vel + (k * (target - pos) - c * vel) * dtSec;
      return [Math.max(-range, Math.min(range, pos + v * dtSec)), v];
    };
    const wind = this.model.internalModel.physics?._options?.wind;
    if (wind) {
      // 模型自带 physics3：裙摆/头发由 Cubism 物理按头身角度算（读的是上一帧我们和动作写进去的值），
      // 这里只吹微风——静止时摆锤也会自己轻轻晃，比往参数上叠正弦自然（各组摆锤相位、幅度都不一样）
      wind.x = Math.sin(tSec * 2 * Math.PI * WIND_HZ) * WIND_AMP + Math.sin(tSec * 2 * Math.PI * WIND_HZ2 + 1) * WIND_AMP2;
    } else {
      const idleSway = Math.sin(tSec * 2 * Math.PI * SKIRT_IDLE_HZ) * SKIRT_IDLE_AMP;
      [this.skirt, this.skirtVel] = spring(this.skirt, this.skirtVel, bodyX * SKIRT_GAIN + idleSway, SKIRT_STIFFNESS, SKIRT_DAMPING);
      core.setParameterValueById("ParamSkirtSway", this.skirt);
      // 头发：前发只跟头，后发跟头 + 身体（量程 ±1）
      [this.hairFront, this.hairFrontVel] = spring(this.hairFront, this.hairFrontVel, (headX + headZ * 0.6) * HAIR_FRONT_GAIN, HAIR_STIFFNESS, HAIR_DAMPING, HAIR_RANGE);
      [this.hairBack, this.hairBackVel] = spring(this.hairBack, this.hairBackVel, (headX * 0.5 + headZ * 0.8 + bodyX * 1.2) * HAIR_BACK_GAIN, HAIR_STIFFNESS, HAIR_DAMPING, HAIR_RANGE);
      core.setParameterValueById("ParamHairFront", this.hairFront);
      core.setParameterValueById("ParamHairBack", this.hairBack);
    }
    // 手臂：呼吸时两臂一起轻轻开合、身体倾斜时同向摆；挥手时右臂叠一段带包络的来回
    const armIdle = (breath - 0.5) * 2 * ARM_BREATH_AMP + bodyX * ARM_FOLLOW_GAIN;
    let wave = 0;
    if (this.waveStart) {
      const phase = now - this.waveStart;
      if (phase >= ARM_WAVE_MS) this.waveStart = 0;
      else wave = Math.sin((phase / 1000) * 2 * Math.PI * ARM_WAVE_HZ) * ARM_WAVE_AMP * Math.sin((phase / ARM_WAVE_MS) * Math.PI);
    }
    core.setParameterValueById("ParamArmL", Math.max(-10, Math.min(10, armIdle)));
    core.setParameterValueById("ParamArmR", Math.max(-10, Math.min(10, armIdle + wave)));
  }
}
