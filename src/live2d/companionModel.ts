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
 *   - ParamArmL / ParamArmR（-10→10 = 肩部旋转 ±8°，+ 为向外张）：呼吸时轻轻开合、随身体倾斜。
 *   - ★ mascot13（2026-09-05）手臂拆成 上臂/前臂/手 三段：ParamForearmL/R（+10 = 前臂向内弯 70° 手到胸前，-10 = 外张 25°）、
 *     ParamHandL/R（手腕 ±25°）；挥手/害羞/惊讶/鞠躬/思考都是 motion3 文件里带前臂曲线的动作（protocol.ts ACTION_MOTIONS），
 *     这里的运行时挥手（右肩来回）只给没有前臂参数的老模型/市场包兜底。眼球 ParamEyeBallX/Y、眉毛 BrowY/Angle/Form、
 *     披风 ParamCapeSway（physics3 摆锤）也是 mascot13 才有键。
 *   - 触摸：model3.json 的 HitAreas 把 脸/头发/双手/双臂/披风/裙子/腿 标成命中区，hitTest() 回区名，
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
 * ★ 第三方模型（市场包）的名字对不上我们的协议：动作组不叫 nod/wave、表情是 exp3 文件、命中区不叫 Head/Body、参数 id 可能是旧式
 *   PARAM_ANGLE_X。2026-09-05 起 acquire() 先读 model3.json 旁边的 companion.json（服务器上传时生成 / 校验，见 ./mapping.ts），
 *   playAction / setFace / hitTest / 每帧读写的参数 id 全部走映射；官方 mascot 没这个文件 → 与从前逐字相同。
 *   刚点过的触摸区若映射了模型自己的动作（nizima 的 Tap@Head），紧接着的 playAction 播它而不是通用动作。
 * ★ 演出跟着声音走（2026-10-25，客服页回答句）：三样新东西，触摸反应 / 上传向导试跑 / 老师页都不经过它们 ——
 *   ① 压制窗口里到来的语义动作不再直接丢，记成待播（只留最新一个），窗口一过由 tick 补播（pendingAction）；
 *   ② holdFace / releaseFace：表情保持到这一句念完再放，不按 FACE_POSES 的固定 holdMs 到点收回（face() 的老行为原样保留）；
 *   ③ playCue：垫场动作（等第一句时的 think），NORMAL 优先级、不占压制窗口，语义动作（FORCE）来了直接盖过去。
 */

import { loadLive2DRuntime, type Live2DModelInstance, type PixiApplication, type PixiRuntime } from "./loader";
import { loadCompanionMapping, mapHitAreas, motionGroupFor, resolveParamIds, touchMotionFor, type CompanionMapping, type ParamIds } from "./mapping";
import {
  EXPRESSION_PARTS,
  FACE_POSES,
  TIMING,
  TOUCH_AREAS,
  type CompanionAction,
  type CompanionFace,
  type ExpressionPart,
  type FacePose,
  type TouchArea,
} from "../companion/protocol";

export type StageRect = { x: number; y: number; width: number; height: number };

type PartState = Record<ExpressionPart, number>;

/** hitTest 之后多久内的 playAction 优先播触摸区自己映射的动作（页面是先 hitTest 再挑台词再 playAction，几十毫秒） */
const TOUCH_MOTION_WINDOW_MS = 1500;
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
/** 开场前几帧每帧多迭代的物理步数 / 帧数（见构造函数里「开场稳定」的说明） */
const PHYSICS_SETTLE_STEPS = 60;
const PHYSICS_SETTLE_FRAMES = 6;
/** 手臂：呼吸微开合 + 随身体倾斜；挥手 1.8s、2.2Hz、±9 */
const ARM_BREATH_AMP = 1.4;
const ARM_FOLLOW_GAIN = 0.35;
const ARM_WAVE_MS = 1800;
const ARM_WAVE_HZ = 2.2;
const ARM_WAVE_AMP = 9;
/**
 * 待播动作最多等多久，过了作废。待播只会在压制窗口里生成，正常情况下最多等 TIMING.actionSuppressMs 就轮到它；
 * 比这还老 = 渲染循环停过（标签页切到后台 rAF 停了），它所属的那句话早念完了，这时补播就是对不上嘴。
 * +200ms 给帧间隔与计时抖动留余量（与提议里的 2.5 秒同值，但它是从窗口长度推出来的，不是另拍的数）。
 */
const PENDING_ACTION_MAX_MS = TIMING.actionSuppressMs + 200;
/**
 * releaseFace 之后表情再留多久才回 normal。要盖住的是「下一句已经合成好、紧接着开口」那一下的空档：
 * 中间只隔 SpeechPlayer 的一拍包络回调（20ms）加起播，几十毫秒 —— 不留这一拍，连着两句同一个表情会先褪一下再回来
 * （表情渐变 POSE_FADE_MS 220ms，褪一半就看得出来）。也不能留太久：短句念完表情还挂着，正是这次要治的毛病。
 * 取 300ms（两份提议都写「句长 + 300ms」）；TTS 音频结尾本来还有 0~0.54 秒静音（CLAUDE.md 剪辑页配音那条量过），
 * 所以落到人眼里，表情比最后一个字晚收半拍到一拍。
 */
const FACE_RELEASE_TAIL_MS = 300;
/**
 * holdFace 的兜底上限 —— 正常靠 releaseFace 放，这个数只防「放的那一下没来」（演出队列卡住之类）把表情永远挂住。
 * 服务端一句最长约 60 字（server companion.service 的 createSentenceSplitter maxLen=60，超了在最近的逗号处切），
 * 汉字一秒念约 4 个 ⇒ 最长一句约 15 秒，加上首尾静音约 1 秒，再留余量取 20 秒。
 */
const FACE_HOLD_MAX_MS = 20_000;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * probeParams 的结果（上传向导第 ⑤ 步自动量「动没动」，判定在 App 的 data/live2dMotionCheck）。
 * 下标空间：先是全部真实参数（0..参数个数-1），接着是全部 Part（不透明度），两段连在一起。
 */
export type ParamProbe = {
  /** 采到了几帧（页面在后台时 rAF 不跑，会很少甚至是 0） */
  frames: number;
  /** 每个下标在窗口里的最小 / 最大值，已按各自量程归一化到 0~1（Part 不透明度本来就是 0~1） */
  min: number[];
  max: number[];
  /** 判「动没动」时不看的下标：我们每帧自己写的（口型、双眼、眼球、手臂、没物理时的裙摆 / 头发、表情补片 Part）与物理的输出（风一直在吹，自己会晃） */
  skip: number[];
  /** 视线会叠上去的头部左右 / 上下两个下标（gazed 为真时也不看） */
  gaze: number[];
  /** 窗口里视线动过（有人在舞台上按住 / 拖动，头会跟着转） */
  gazed: boolean;
  /** 口型 / 左眼两个槽对应的真实下标；-1 = 模型里没有这个参数 */
  mouth: number;
  eye: number;
};

/** Cubism Core 的原始模型（getModel()）里 probeParams 要读的那几格；全局包没有类型，只描述用到的 */
type RawCoreModel = {
  parameters: { ids: ArrayLike<string>; values: ArrayLike<number>; minimumValues: ArrayLike<number>; maximumValues: ArrayLike<number> };
  parts: { ids: ArrayLike<string>; opacities: ArrayLike<number> };
};
/** 框架 CubismBreath 的内部字段（pixi-live2d-display 0.5 里没混淆，见 probeParams 的 ★） */
type BreathInternals = {
  _currentTime?: number;
  _breathParameters?: Array<{ parameterId?: string; offset?: number; peak?: number; cycle?: number; weight?: number }>;
};
/** 框架 CubismPhysics 的内部字段：每条输出写给哪个参数 */
type PhysicsInternals = { _physicsRig?: { outputs?: Array<{ destination?: { id?: string } } | null> } };
/** probeParams 判「视线动过」的门槛：lookForward 之后视线按 260ms 的时间常数回正，到 0.02 时头部只剩 0.3° 的偏转 */
const PROBE_GAZE_EPS = 0.02;

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
  /** companion.json（第三方模型的协议映射）；官方 mascot 为 null */
  private readonly mapping: CompanionMapping | null;
  /** 每帧读写的参数 id（按映射解析；null = 这个模型没这个功能，跳过） */
  private readonly P: ParamIds;
  /** 当前挂着的 exp3 表情名（映射到 expression 的表情槽用）；null = 没挂 */
  private currentExpression: string | null = null;
  /** 最近一次 hitTest 命中的触摸区：TOUCH_MOTION_WINDOW_MS 内的 playAction 优先播它映射的动作 */
  private lastTouch: { area: TouchArea; at: number } | null = null;
  /** ExprClosed 常开（闭眼补片由 ParamEyeL/ROpen 的关键帧控制露出），其余补片默认关 */
  private readonly partCurrent: PartState = { ExprSmile: 0, ExprAngry: 0, ExprClosed: 1, ExprMouthOpen: 0 };
  private pose: FacePose = FACE_POSES.normal;
  private poseUntil = 0;
  /** 当前表情是 holdFace 挂上的「保持到显式释放」（releaseFace 放）；setFace 与表情到期都会清掉它 */
  private poseHeld = false;
  /**
   * 压制窗口里到来、还没轮到的语义动作（只留最新一个），tick 在窗口过去那一帧补播。
   * ★ 存**已经解析好的组名**：playAction 一进门就清了 lastTouch，补播时再按 action 解析，触摸区映射的动作（Tap@Head）就丢成了通用动作。
   */
  private pendingAction: { group: string; action: CompanionAction; at: number } | null = null;
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

  private constructor(pixi: PixiRuntime, app: PixiApplication, model: Live2DModelInstance, canvas: HTMLCanvasElement, modelUrl: string, mapping: CompanionMapping | null) {
    this.pixi = pixi;
    this.app = app;
    this.model = model;
    this.canvas = canvas;
    this.modelUrl = modelUrl;
    this.mapping = mapping;
    this.P = resolveParamIds(mapping);
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
    // ★ 开场稳定（2026-09-05）：Cubism 物理的摆锤链初始是笔直下垂的，头几帧输入（动作 + 我们写的头身角度 → 摆锤根部平移）
    //   从 0 跳到当前值，链节之间瞬间弯折；裙摆/后发的输出是「相邻两节的夹角 × Scale(240)」，弯 0.5° 就顶满 ±10，
    //   看起来像模型一出场就大幅左右甩（实测 ParamSkirtSway 0.3s 内到 10、2s 才衰完）。
    //   办法：前 PHYSICS_SETTLE_FRAMES 帧里，每帧物理算完（beforeModelUpdate，在 coreModel.update 之前）用同样的输入
    //   再多迭代 PHYSICS_SETTLE_STEPS 步，让链条当场收敛到当前姿势；之后逐帧输入都是连续的，正常摆。
    //   要盯好几帧是因为我们的 tick 在 LOW 优先级、渲染之后才写参数——第 1 帧物理只看到动作的值，第 2 帧才看到我们的。
    //   （试过框架的 physics.stabilization()：它把链条摆到 重力+风 的方向，下一帧照样弯折跳满；风从 0 缓升也没用，
    //   因为根本不是风推的。physics3.json 的 Meta.Fps=30 另外把积分改成固定步长，页面卡一下 dt 大也不会飞。）
    const physics = model.internalModel.physics;
    if (physics && typeof physics.evaluate === "function" && typeof model.internalModel.on === "function") {
      const evaluate = physics.evaluate;
      let frames = 0;
      const settle = () => {
        try {
          for (let i = 0; i < PHYSICS_SETTLE_STEPS; i++) evaluate.call(physics, core, 1 / 30);
        } catch {
          frames = PHYSICS_SETTLE_FRAMES; // 框架版本不对就不再试，最多开场甩两下
        }
        if (++frames >= PHYSICS_SETTLE_FRAMES) model.internalModel.off?.("beforeModelUpdate", settle);
      };
      model.internalModel.on("beforeModelUpdate", settle);
    }
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
      // 市场包旁边可能有 companion.json（协议映射）：先读它——待机动作组的名字要在加载前定下来；官方模型是相对路径，直接跳过
      const mapping = await loadCompanionMapping(modelUrl);
      const model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: false, idleMotionGroup: mapping?.idle || "Idle" });
      if (singleton) {
        singleton.destroy();
        singleton = null;
      }
      app.stage.addChild(model);
      model.anchor.set(0.5, 0.5);
      singleton = new CompanionModel(pixi, app, model, canvas, modelUrl, mapping);
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
    // 换页 / 卸载：别让上一页没放的表情与没轮到的待播动作，在下一次 attach（别的页面）里冒出来
    this.clearPendingAction();
    this.releaseFace();
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
    const base = FACE_POSES[face] || FACE_POSES.normal;
    if (!this.mapping) {
      this.pose = base;
    } else {
      // 第三方模型：映射到 exp3 表情就挂表情（参数可选叠加）；映射为 null 的表情退到我们的参数版（缺的参数 Cubism 自己忽略；补片它没有，写了也白写）
      const mapped = face === "normal" ? null : (this.mapping.faces[face] ?? null);
      this.pose = mapped ? { parts: {}, params: mapped.params ?? {}, holdMs: base.holdMs, blink: base.blink } : base;
      this.applyExpression(mapped?.expression ?? null);
    }
    this.poseHeld = false;
    this.poseUntil = this.pose.holdMs > 0 ? performance.now() + this.pose.holdMs : 0;
  }

  /**
   * 换表情并**保持到 releaseFace**（客服页回答句：这一句念完才放）。不按 FACE_POSES 的固定 holdMs 到点收回 ——
   * 那个数（3.2~4.6 秒）与句子长短无关：长句念到一半表情就没了，短句念完了还挂着。
   * normal 没有什么可保持的，与 setFace 完全一样。FACE_HOLD_MAX_MS 只是兜底。
   */
  holdFace(face: CompanionFace) {
    if (this.disposed) return;
    this.setFace(face);
    if (this.pose === FACE_POSES.normal) return;
    this.poseHeld = true;
    this.poseUntil = performance.now() + FACE_HOLD_MAX_MS;
  }

  /** 放掉 holdFace 挂着的表情：再留 FACE_RELEASE_TAIL_MS 就回 normal。没挂着（触摸反应、试跑走的 setFace）= 空操作 */
  releaseFace() {
    if (this.disposed || !this.poseHeld) return;
    this.poseHeld = false;
    this.poseUntil = performance.now() + FACE_RELEASE_TAIL_MS;
  }

  /** 挂 / 摘 exp3 表情（只有映射到 expression 的表情槽会用到）；同名不重复挂，null = 摘掉回到中性 */
  private applyExpression(name: string | null) {
    if (name === this.currentExpression) return;
    this.currentExpression = name;
    if (name) void this.model.expression(name).catch(() => undefined);
    else this.model.internalModel.motionManager.expressionManager?.resetExpression();
  }

  playAction(action: CompanionAction) {
    if (this.disposed) return;
    const now = performance.now();
    // 刚点过的触摸区若映射了模型自己的动作（nizima 的 Tap@Head 之类），这一下播它，比通用动作贴切；只认这一次
    const touchGroup = this.lastTouch && now - this.lastTouch.at < TOUCH_MOTION_WINDOW_MS ? touchMotionFor(this.mapping, this.lastTouch.area) : null;
    this.lastTouch = null;
    const group = touchGroup || motionGroupFor(this.mapping, action);
    if (!group) return;
    if (!this.model.internalModel.settings.motions?.[group]) return;
    // 上一个语义动作还没做完，别抢戏 —— 但也别丢（2026-10-25）：原来这里直接 return，回答里前一句短于 2.3 秒时，
    // 后一句的动作就整个没了。现在记成待播、只留最新一个（不攒队列：连着三个动作排着补，就是一句话做三遍动作），
    // 窗口一过由 tick 补播（见 pendingAction 的 ★）
    if (now < this.actionSuppressUntil) {
      this.pendingAction = { group, action, at: now };
      return;
    }
    this.startAction(group, action, now);
  }

  /** 真正起一个语义动作（playAction 当场起、tick 补播待播动作共用这一段）：占 2.3 秒压制窗口，FORCE 优先级 */
  private startAction(group: string, action: CompanionAction, now: number) {
    // 新起了一个就没有更早的待播可言（更早的那个比它旧，「只留最新一个」）
    this.pendingAction = null;
    this.actionSuppressUntil = now + TIMING.actionSuppressMs;
    // 挥手没有单独的动作文件（动作走 excited），手臂的来回由 tick 里的手势叠上去
    if (action === "wave") this.waveStart = now;
    void this.model.motion(group, 0, this.pixi.live2d.MotionPriority.FORCE).catch(() => undefined);
  }

  /** 作废还没轮到的待播动作（停止 / 它所属的那句话已经念完）；没有 = 空操作 */
  clearPendingAction() {
    this.pendingAction = null;
  }

  /**
   * 垫场动作（客服页等第一句时的 think，2026-10-25）：NORMAL 优先级、**不占**语义动作的压制窗口、不消费触摸区、不碰待播格。
   * 第一句的语义动作（FORCE）来了直接把它盖过去（Cubism 的动作队列会给旧动作做淡出）；正在做 FORCE 动作时它起不来，也不该起。
   * ★ 不走 playAction：那条路会占 2.3 秒窗口（think 本身 2.6 秒），第一句的动作反而被压成待播、晚将近一秒才出来。
   * @returns false = 这个模型没有对应的动作组
   */
  playCue(action: CompanionAction): boolean {
    if (this.disposed) return false;
    const group = motionGroupFor(this.mapping, action);
    if (!group || !this.model.internalModel.settings.motions?.[group]) return false;
    void this.model.motion(group, 0, this.pixi.live2d.MotionPriority.NORMAL).catch(() => undefined);
    return true;
  }

  /**
   * **试演专用**：直接播包里的某一个动作组，不经语义槽、不受压制。上传向导第 ④ 步「摸这里播哪个动作」那行的 ▶。
   *
   * ★★ 为什么必须是公开入口而不是"借一个语义槽临时指过去"（2026-09-07 收口）：借槽那种写法要**原地改**
   *   正在生效的映射对象，一旦还原那一步没跑到（异常、组件卸载、两次点击撞上），用户表里那一格就被
   *   悄悄改成了别的组，然后**原样发布出去** —— 零报错，而且发布之后才看得出来。
   * ★ 它**不吃**那 2.3 秒的语义动作压制（`playAction` 里那道闸）：压制防的是"一句话里连着三个动作标签
   *   变成三次半途打断"，而试演是人一下一下点的 —— 等 2.3 秒的表现就是"点了没反应"。
   * @returns false = 这个组不在包里（调用方据此说"这个组没了"，别静默）
   */
  playMotionGroup(group: string): boolean {
    if (this.disposed || !group) return false;
    if (!this.model.internalModel.settings.motions?.[group]) return false;
    this.lastTouch = null; // 试演不是触摸，别让它蹭上一次点击的触摸动作
    this.pendingAction = null; // 点了什么就演什么：别让之前排着的语义动作过一会儿把试演盖掉
    void this.model.motion(group, 0, this.pixi.live2d.MotionPriority.FORCE).catch(() => undefined);
    return true;
  }

  /**
   * **试演专用**：直接挂包里的某一个 exp3 表情（`null` = 摘掉）。与 `setFace` 的区别是它不走语义槽、
   * 不改 `pose`，所以摘掉之后脸自己回到当前语义表情。
   * @returns false = 这个表情不在包里
   */
  setExpressionByName(name: string | null): boolean {
    if (this.disposed) return false;
    if (name && !this.model.internalModel.settings.expressions?.some((e) => e.Name === name)) return false;
    this.applyExpression(name);
    return true;
  }

  /**
   * 截当前这一帧，画进一块新的 2D 离屏画布（尺寸 = 舞台画布的像素尺寸）；`null` = 截不到。
   *
   * ★★ 为什么是"先手动画一帧，再在**同一个同步块**里读"（2026-09-07，上传向导第 ⑥ 步要拿它当封面）：
   *   这台 Application 故意**没开** `preserveDrawingBuffer` —— 它是客服页那位看板娘的常驻舞台，
   *   开了就是让每一个用户为一个几乎没人用的截图功能天天付渲染代价（工坊导演台那块画布是用完就扔的，
   *   所以那边开着）。而 WebGL 的绘制缓冲一旦被合成就清空，随便挑个时刻 `drawImage(canvas)` 拿到的是全透明。
   *   按规范，绘制缓冲在**被合成之前**一直有效，所以 `renderer.render()` 之后不让出线程、立刻 drawImage
   *   就一定读得到像素 —— 这也正是"toDataURL 要紧跟在 render 后面"那条老经验的由来。
   *   ⚠ 这中间**一个 await 都不能有**：让出去一拍就可能被合成掉，那时读回来的又是全透明。
   * ★ 底色不在这里垫：要不要垫、垫什么色是调用方（要 JPEG 就得垫，要 PNG 就不用）的事。
   */
  snapshot(): HTMLCanvasElement | null {
    if (this.disposed) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return null;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    try {
      this.app.renderer.render(this.app.stage);
      ctx.drawImage(this.canvas, 0, 0);
    } catch {
      return null; // 上下文丢了 / 画布被污染（贴图都是同源 blob，不该发生）
    }
    return out;
  }

  /**
   * 舞台里的点击落在哪些触摸区（protocol.ts TOUCH_AREAS 的名字，按优先级排序）；空数组 = 没点到人。
   * 官方 mascot 的 HitAreas 名字就是区名；第三方模型按 companion.json 把它自己的命中区名翻译过来。
   */
  hitTest(clientX: number, clientY: number, stageOrigin: { left: number; top: number }): string[] {
    if (this.disposed || typeof this.model.hitTest !== "function") return [];
    try {
      const areas = mapHitAreas(this.mapping, this.model.hitTest(clientX - stageOrigin.left, clientY - stageOrigin.top));
      const top = areas.find((a) => (TOUCH_AREAS as readonly string[]).includes(a)) as TouchArea | undefined;
      this.lastTouch = top ? { area: top, at: performance.now() } : null;
      return areas;
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

  // ── 试演专用：上传向导第 ⑤ 步自动量「动没动」（2026-10-26，App 独有）─────────────────────────────
  // ★ 官网 client 的 companionModel.ts 也有一份驱动，但官网没有 Live2D 上传向导：下面 stopMotions / resetFaceForProbe / blinkNow /
  //   probeParams 这一段官网那份不搬 —— 别把它当成漏同步。四个都只新增，不改上面任何一条演出路径（客服页、老师页都不调它们）。

  /**
   * 试演专用：立刻停掉正在播的动作（不淡出），连同还没轮到的待播动作与压制窗口；框架下一帧自己从头起待机动作。
   * 试跑每一项之前调一次：不停的话上一项的动作还在播 / 淡出，那一截会算进下一项的采样窗口 —— 下一项哪怕是个哑动作也会被量成「动了」。
   */
  stopMotions() {
    if (this.disposed) return;
    this.pendingAction = null;
    this.actionSuppressUntil = 0;
    this.waveStart = 0;
    try {
      (this.model.internalModel.motionManager as { stopAllMotions?: () => void }).stopAllMotions?.();
    } catch {
      // 框架版本不对：不停也只是让下一项的判定宽一点，别为这个打断试跑
    }
  }

  /**
   * 试演专用：表情当场回平静（不渐变），并把表情会碰的那些参数写回默认值。试跑每一项之前调一次。
   * ★★ 只 setFace("normal") 不够（2026-10-26 在官方看板娘上量出来的）：表情参数是 tick 里每帧 addParameterValueById 叠上去的，
   *   而 tick 跑在 loadParameters 之后 —— 待机动作不带曲线的参数（眉毛、嘴形、脸红）每帧叠的量会留到下一帧、越叠越多，
   *   几帧就顶到量程边上，回 normal 之后也停在那儿（实测 sad 之后 ParamBrowLForm 一直是 -1）。不写回的话，
   *   「哭」排在「难过」后面、往同一个方向推，量出来一动不动，被标「看不出变化」。
   *   这是演出那一侧的老问题，这里只在试跑里把起点摆正，不改客服页的演出。
   */
  resetFaceForProbe() {
    if (this.disposed) return;
    this.setFace("normal");
    this.poseCurrent = {};
    const raw = this.model.internalModel.coreModel.getModel?.() as (RawCoreModel & { parameters: { defaultValues?: ArrayLike<number> } }) | undefined;
    const defaults = raw?.parameters.defaultValues;
    if (!raw || !defaults) return;
    const ids = Array.from(raw.parameters.ids);
    const keys = new Set<string>();
    for (const pose of Object.values(FACE_POSES)) for (const k of Object.keys(pose.params)) keys.add(k);
    for (const f of Object.values(this.mapping?.faces ?? {})) for (const k of Object.keys(f?.params ?? {})) keys.add(k);
    // 直接写 Core 的数组（框架的 _parameterValues 就是它）：下一帧动作从这个值起算、saveParameters 存下的也是它，于是留得住
    const values = raw.parameters.values as unknown as { [i: number]: number };
    for (const k of keys) {
      const i = ids.indexOf(k);
      if (i >= 0) values[i] = defaults[i];
    }
  }

  /** 试演专用：现在就眨一次（平时随机隔 2.4~6 秒才眨，试跑「眨眼」那一项等不起）。当前表情要求不眨（laughing 等）时照旧不眨 */
  blinkNow() {
    if (this.disposed) return;
    this.nextBlinkAt = performance.now();
  }

  /**
   * 试演专用：在 ms 毫秒里逐帧记下每个真实参数 / Part 的最小、最大值（按各自量程归一化到 0~1）。判「动没动」不在这里。
   *
   * ★★ 挂在 internalModel 的 beforeModelUpdate 上读（构造函数里「开场稳定」也挂这里）：运行时一帧的顺序是
   *   动作 → saveParameters → exp3 表情 → 呼吸 → 物理 → pose → beforeModelUpdate → coreModel.update() → loadParameters，
   *   我们的 tick 在渲染之后才跑 —— 在 tick 里读，读到的是 loadParameters 还原过、只剩动作的那一份，exp3 表情与物理全看不见。
   * ★★ 只按真实下标读（getModel().parameters.values，长度 = 参数个数），不用 getParameterValueById：Cubism 对模型里没有的 id
   *   会另开一个假下标、把写进去的值存在那儿，按 id 读回来的是我们自己每帧写进去的值 —— 不存在的参数也会显得「动了」。
   *   找下标也只查 parameters.ids，不调 getParameterIndex（它对不存在的 id 当场分一个假下标，有副作用）。
   * ★ 框架的「呼吸」（CubismBreath：头三个角度、身体、ParamBreath 各一条 3~15 秒周期的正弦，与演什么无关）照它的公式逐帧扣掉：
   *   它的周期比采样窗口长，不扣的话同一个哑动作换个时刻量，头部角度的起伏能差出一截。读的是框架内部字段
   *   （_breathParameters / _currentTime，这份运行时里没混淆），读不到就不扣 —— 判定那一侧只会更宽松，不会抛错。
   * ★ skip（不看的下标）：我们每帧自己写的口型 / 双眼 / 眼球 / 手臂 / 裙摆 / 头发、表情补片 Part（官方形象才有）、物理的输出（风每帧在吹）；
   *   视线叠上去的头部左右 / 上下单列在 gaze，窗口里有人碰过舞台时由判定那一侧一起跳过。
   * ★ 用 setTimeout 收尾而不是数帧：页面在后台时 rAF 不跑，数帧会永远等下去（CLAUDE.md「等媒体事件一律带上限」）；
   *   帧数照实交回去，太少由调用方说「没量到」。
   * @returns null = 模型已经拆了 / 这份运行时读不到参数表
   */
  probeParams(ms: number): Promise<ParamProbe | null> {
    if (this.disposed) return Promise.resolve(null);
    const internal = this.model.internalModel;
    const readRaw = () => internal.coreModel.getModel?.() as RawCoreModel | undefined;
    const raw = readRaw();
    const on = internal.on;
    const off = internal.off;
    if (!raw?.parameters?.values || !raw.parts?.opacities || typeof on !== "function" || typeof off !== "function") return Promise.resolve(null);
    const paramIds = Array.from(raw.parameters.ids);
    const n = paramIds.length;
    const partCount = raw.parts.ids.length;
    const lo = Array.from(raw.parameters.minimumValues);
    const hi = Array.from(raw.parameters.maximumValues);
    const indexOf = (id: string | null | undefined) => (id ? paramIds.indexOf(id) : -1);

    const skip = new Set<number>();
    // 口型 / 双眼 / 眼球按映射的 id；手臂、裙摆、头发是 onTick 里按写死的 id 每帧整值写的（手臂跟着待机动作的呼吸参数开合，
    // 实测官方看板娘一个哑动作播完、待机从头再起时，ParamArmL 的起伏是待机基线的 1.55 倍 —— 不排除就把哑动作量成「动了」）
    for (const id of [this.P.mouthOpen, this.P.eyeL, this.P.eyeR, this.P.eyeBallX, this.P.eyeBallY, "ParamArmL", "ParamArmR", "ParamSkirtSway", "ParamHairFront", "ParamHairBack"]) {
      const i = indexOf(id);
      if (i >= 0) skip.add(i);
    }
    for (const i of this.partIndex.values()) if (i >= 0 && i < partCount) skip.add(n + i);
    const outputs = (internal.physics as PhysicsInternals | null | undefined)?._physicsRig?.outputs;
    if (Array.isArray(outputs)) {
      for (const o of outputs) {
        const i = indexOf(o?.destination?.id);
        if (i >= 0) skip.add(i);
      }
    }
    const gaze = [indexOf(this.P.angleX), indexOf(this.P.angleY)].filter((i) => i >= 0);

    // 呼吸：每个真实下标上挂着哪几条正弦（同一个参数可能挂两条，照原样逐条扣）
    const breath = (internal as { breath?: BreathInternals | null }).breath ?? null;
    const breathTerms: Array<{ i: number; offset: number; peak: number; cycle: number; weight: number }> = [];
    if (breath && Array.isArray(breath._breathParameters)) {
      for (const b of breath._breathParameters) {
        const i = indexOf(b?.parameterId);
        if (i < 0 || !b.cycle) continue;
        breathTerms.push({ i, offset: b.offset ?? 0, peak: b.peak ?? 0, cycle: b.cycle, weight: b.weight ?? 1 });
      }
    }

    const total = n + partCount;
    const min = new Array<number>(total).fill(Infinity);
    const max = new Array<number>(total).fill(-Infinity);
    const values = new Array<number>(n);
    let frames = 0;
    let gazed = false;
    const onFrame = () => {
      const live = readRaw();
      if (!live) return;
      frames++;
      if (this.gazeTarget.x !== 0 || this.gazeTarget.y !== 0 || Math.abs(this.gaze.x) > PROBE_GAZE_EPS || Math.abs(this.gaze.y) > PROBE_GAZE_EPS) gazed = true;
      for (let i = 0; i < n; i++) values[i] = live.parameters.values[i];
      // 与框架 CubismBreath.updateParameters 同一个式子（相位 = 2 × _currentTime × 3.14159，它自己就写的 3.14159）
      if (breathTerms.length && typeof breath?._currentTime === "number") {
        const phase = 2 * breath._currentTime * 3.14159;
        for (const b of breathTerms) values[b.i] -= (b.offset + b.peak * Math.sin(phase / b.cycle)) * b.weight;
      }
      for (let i = 0; i < n; i++) {
        const span = hi[i] - lo[i];
        const x = span > 0 ? (values[i] - lo[i]) / span : 0;
        if (x < min[i]) min[i] = x;
        if (x > max[i]) max[i] = x;
      }
      for (let j = 0; j < partCount; j++) {
        const x = live.parts.opacities[j];
        if (x < min[n + j]) min[n + j] = x;
        if (x > max[n + j]) max[n + j] = x;
      }
    };
    on.call(internal, "beforeModelUpdate", onFrame);
    return new Promise((resolve) => {
      setTimeout(
        () => {
          try {
            off.call(internal, "beforeModelUpdate", onFrame);
          } catch {
            // 模型已经拆了：事件源跟着没了，摘不摘都一样
          }
          if (this.disposed) {
            resolve(null);
            return;
          }
          const finite = (v: number) => (Number.isFinite(v) ? v : 0);
          resolve({ frames, min: min.map(finite), max: max.map(finite), skip: [...skip], gaze, gazed, mouth: indexOf(this.P.mouthOpen), eye: indexOf(this.P.eyeL) });
        },
        Math.max(0, ms),
      );
    });
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
      this.poseHeld = false;
      this.applyExpression(null);
    }

    // 待播动作：压制窗口一过就补播；放太久的（渲染循环停过）作废。先摘下来再起：起动作万一抛错，也不会每帧再抛一次
    if (this.pendingAction && now >= this.actionSuppressUntil) {
      const pendingAction = this.pendingAction;
      this.pendingAction = null;
      if (now - pendingAction.at <= PENDING_ACTION_MAX_MS) this.startAction(pendingAction.group, pendingAction.action, now);
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
    if (this.P.angleX) core.addParameterValueById(this.P.angleX, this.gaze.x * 14);
    if (this.P.angleY) core.addParameterValueById(this.P.angleY, -this.gaze.y * 8);
    if (this.P.eyeBallX) core.addParameterValueById(this.P.eyeBallX, this.gaze.x * 0.6);
    if (this.P.eyeBallY) core.addParameterValueById(this.P.eyeBallY, -this.gaze.y * 0.4);

    // 口型与眼睛：每帧【覆盖】写入（动作/表情文件里没有这两组参数，覆盖不会吃掉别的演出）
    if (this.P.mouthOpen) core.setParameterValueById(this.P.mouthOpen, mouthOpen);
    if (this.P.eyeL) core.setParameterValueById(this.P.eyeL, eyeOpen);
    if (this.P.eyeR) core.setParameterValueById(this.P.eyeR, eyeOpen);

    // 裙摆：二阶弹簧追这一帧的身体角度（动作 + 呼吸 + 表情叠加之后的值）。
    // 老模型没有 ParamSkirtSway 时 setParameterValueById 被 Cubism 忽略，无害
    const readParam = (id: string) => (typeof core.getParameterValueById === "function" ? core.getParameterValueById(id) || 0 : 0);
    const bodyX = this.P.bodyX ? readParam(this.P.bodyX) : 0;
    const headX = this.P.angleX ? readParam(this.P.angleX) : 0;
    const headZ = this.P.angleZ ? readParam(this.P.angleZ) : 0;
    const breath = this.P.breath ? readParam(this.P.breath) : 0.5;
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
    // 有前臂参数的模型（mascot13+）挥手走 wave.motion3.json，不再在肩上硬摆
    if (this.waveStart && typeof core.getParameterIndex === "function" && core.getParameterIndex("ParamForearmR") >= 0) this.waveStart = 0;
    if (this.waveStart) {
      const phase = now - this.waveStart;
      if (phase >= ARM_WAVE_MS) this.waveStart = 0;
      else wave = Math.sin((phase / 1000) * 2 * Math.PI * ARM_WAVE_HZ) * ARM_WAVE_AMP * Math.sin((phase / ARM_WAVE_MS) * Math.PI);
    }
    core.setParameterValueById("ParamArmL", Math.max(-10, Math.min(10, armIdle)));
    core.setParameterValueById("ParamArmR", Math.max(-10, Math.min(10, armIdle + wave)));
  }
}
