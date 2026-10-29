/**
 * @file loader.ts - Live2D 运行时按需加载（pixi.js + pixi-live2d-display + Cubism Core）
 * @category Utility
 *
 * ★ 为什么走 <script> 按需加载而不是 npm 依赖：
 *   - Cubism Core 是闭源二进制，没有 npm 包；pixi-live2d-display 的 lipsync 补丁版只发了 UMD 包，
 *     且它要求 window.PIXI 全局存在才能自注册 Ticker，打进 vite 包里反而要额外 shim；
 *   - 首页不聊天的人根本不会触发下载（舞台组件挂载才加载），三段脚本（≈ 800 KB）不进主包对首屏更友好。
 * ★ 三段脚本都【自托管】在 public/live2d/runtime/（许可说明见那里的 README）而不是 CDN：
 *   国内到 jsDelivr 时常超时、个别环境连 cubism.live2d.com 都解析不了（2026-09-03 本机实测），
 *   一挂看板娘就整个不出现。Core 本地副本失败时回退官方地址。
 *   版本号写进文件名，升级时换文件 + 改这里的常量，避免浏览器缓存串版。
 * ★ 三段脚本有顺序依赖（Core → pixi → 插件），必须串行；并发调用共享同一个 Promise，避免重复插 <script>。
 * ★ 加载 moc3 之前的版本 + 一致性检查也装在这里（installMocGuard，2026-10-26）：运行时一加载完就包好，
 *   所有模型地址都经过它。别往 `Live2DModel.from` 的选项里传 checkMocConsistency —— 在这份运行时上不生效，见那个函数的 ★★。
 */

import { checkMoc, type CubismCoreLike } from "./mocCheck";

const CUBISM_CORE_URL = "/live2d/runtime/live2dcubismcore.min.js";
const CUBISM_CORE_FALLBACK_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
const PIXI_URL = "/live2d/runtime/pixi-7.4.2.min.js";
/**
 * ★ pixi 7 默认用 new Function 生成着色器 uniform 同步代码；APK 的 CSP 是 script-src 'self' 'wasm-unsafe-eval'
 *   （没有 'unsafe-eval'），模型一加载就抛 "Current environment does not allow unsafe-eval"（2026-09-04 真机实测）。
 *   官方的 @pixi/unsafe-eval 是无 eval 的替代实现，UMD 版加载即自动打补丁（要求 window.PIXI 已存在，所以排在 pixi 之后）。
 *   官网没有 CSP 也一起带上：两边同一份 loader，少一个"只在 App 里坏"的分叉。
 */
const PIXI_UNSAFE_EVAL_URL = "/live2d/runtime/pixi-unsafe-eval-7.4.2.min.js";
const LIVE2D_DISPLAY_URL = "/live2d/runtime/pixi-live2d-display-cubism4-0.5.0-ls-8.min.js";

/** 我们用到的 pixi / pixi-live2d-display 子集；全局包没有类型，这里只描述真正调用的成员 */
export type PixiPoint = { set(x: number, y?: number): void; x: number; y: number };

export type Live2DCoreModel = {
  getModel?: () => { parameters: { ids: ArrayLike<string> }; parts: { ids: ArrayLike<string> } };
  getPartIndex?: (id: string) => number;
  setPartOpacityByIndex: (index: number, opacity: number) => void;
  getParameterIndex?: (id: string) => number;
  setParameterValueById: (id: string, value: number, weight?: number) => void;
  addParameterValueById: (id: string, value: number, weight?: number) => void;
  getParameterValueById?: (id: string) => number;
};

export type Live2DModelInstance = {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: PixiPoint;
  scale: PixiPoint;
  internalModel: {
    coreModel: Live2DCoreModel;
    originalWidth?: number;
    originalHeight?: number;
    settings: { motions?: Record<string, unknown[]>; expressions?: Array<{ Name: string }> };
    motionManager: { expressionManager?: { resetExpression(): void } };
    /** model3.json 引用了 physics3.json 才有；_options 里的 gravity/wind 是框架的 CubismVector2，只能改 x/y，不能整个换掉 */
    physics?: {
      _options?: { gravity: { x: number; y: number }; wind: { x: number; y: number } };
      /** Cubism 框架 CubismPhysics.evaluate(model, 秒)：pixi-live2d-display 每帧调一次，我们开场多调几十次让摆锤收敛 */
      evaluate?: (model: Live2DCoreModel, deltaTimeSeconds: number) => void;
    } | null;
    /** InternalModel 是 EventEmitter：beforeModelUpdate 在 动作/物理 之后、coreModel.update() 之前触发 */
    on?: (event: "beforeModelUpdate", fn: () => void) => unknown;
    off?: (event: "beforeModelUpdate", fn: () => void) => unknown;
  };
  motion(group: string, index?: number, priority?: number): Promise<boolean>;
  expression(id?: string | number): Promise<boolean>;
  /** 画布坐标（css px，相对画布左上）→ 命中的 HitAreas 名字 */
  hitTest(x: number, y: number): string[];
  destroy(options?: { children?: boolean }): void;
};

export type PixiApplication = {
  stage: { addChild(child: unknown): void; removeChild(child: unknown): void };
  renderer: {
    resize(width: number, height: number): void;
    /**
     * 手动画一帧（平时由 ticker 调）。★ 只有 `CompanionModel.snapshot()` 用它：舞台那台 Application
     * **没开** `preserveDrawingBuffer`，绘制缓冲一合成就被清掉，所以截图只能"自己画一帧、同一拍里立刻读"。
     */
    render(displayObject: unknown): void;
  };
  ticker: {
    add(fn: (delta: number) => void, context?: unknown, priority?: number): void;
    remove(fn: (delta: number) => void, context?: unknown): void;
    start(): void;
    stop(): void;
    deltaMS: number;
  };
  destroy(removeView?: boolean, options?: { children?: boolean }): void;
};

export type PixiRuntime = {
  Application: new (options: Record<string, unknown>) => PixiApplication;
  UPDATE_PRIORITY: { LOW: number };
  live2d: {
    Live2DModel: { from(url: string, options?: Record<string, unknown>): Promise<Live2DModelInstance> };
    MotionPriority: { NONE: number; IDLE: number; NORMAL: number; FORCE: number };
    /** 运行时注册表（静态数组，按 version 降序）；加载 moc3 那一步从这里取 runtime 调它的 createCoreModel。见 installMocGuard */
    Live2DFactory?: { runtimes?: Live2DRuntimeEntry[] };
  };
};

/** Live2DFactory.runtimes 里的一项（我们只碰 version 与 createCoreModel） */
type Live2DRuntimeEntry = {
  version: number;
  createCoreModel?: (mocBytes: ArrayBuffer, options?: unknown) => unknown;
  /** installMocGuard 装过的记号（同一个运行时对象只包一层） */
  __mocGuard?: boolean;
};

type Live2DWindow = Window & { PIXI?: PixiRuntime; Live2DCubismCore?: unknown };

const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string) {
  const existing = scriptLoads.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[data-live2d-runtime="${src}"]`);
    if (found?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = found ?? document.createElement("script");
    const done = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    const fail = () => {
      scriptLoads.delete(src);
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!found) {
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.live2dRuntime = src;
      document.head.appendChild(script);
    }
  });
  scriptLoads.set(src, promise);
  return promise;
}

let runtimePromise: Promise<PixiRuntime> | null = null;

/** 加载并返回全局 PIXI（含 PIXI.live2d）。失败会清掉缓存，下次调用重试。 */
export function loadLive2DRuntime(): Promise<PixiRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    try {
      await loadScript(CUBISM_CORE_URL);
    } catch {
      await loadScript(CUBISM_CORE_FALLBACK_URL);
    }
    await loadScript(PIXI_URL);
    await loadScript(PIXI_UNSAFE_EVAL_URL);
    await loadScript(LIVE2D_DISPLAY_URL);
    const pixi = (window as Live2DWindow).PIXI;
    if (!pixi || !pixi.live2d) throw new Error("PIXI.live2d is not available after loading runtime scripts");
    installMocGuard(pixi);
    return pixi;
  })().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

/** 已加载的 Cubism Core（全局 Live2DCubismCore）；还没加载 / 形状不对回 null */
function loadedCubismCore(): CubismCoreLike | null {
  const core = (window as Live2DWindow).Live2DCubismCore as Partial<CubismCoreLike> | undefined;
  return core && typeof core.Version?.csmGetLatestMocVersion === "function" && typeof core.Moc?.prototype?.hasMocConsistency === "function"
    ? (core as CubismCoreLike)
    : null;
}

/**
 * 给 Cubism 4 运行时加载 moc3 的那一步包一层：先过 `mocCheck.checkMoc`（版本 + 一致性），不过就抛 `MocCheckFailed`，
 * 一路原样传到 `Live2DModel.from` 的调用方（中间件执行器对错误是原样 reject，不包装）。
 *
 * ★★ 为什么不往 `Live2DModel.from(url, { checkMocConsistency: true })` 里传选项：在随包的这份运行时上那是**空操作**，
 *   而且零报错。运行时自己的 `createCoreModel(moc, options)` 确实认 `options.checkMocConsistency`，可加载 moc 的那个中间件
 *   调它时写的是 `createCoreModel(r)` —— 只传字节，`from()` 的 options 只交给了 `createInternalModel`
 *   （pixi-live2d-display-cubism4-0.5.0-ls-8.min.js 里 `createCoreModel(` 一共出现两次：一次定义、一次这个单参调用）。
 * ★ 包在这里（运行时加载完那一拍）而不是 companionModel 里自己 fetch 一遍 moc3 预检：这一层 http 地址、上传向导的
 *   `zip://blob:` 地址、随包的官方形象三条路都要经过；自己 fetch 的话 zip:// 那条拿不到字节，向导预览会漏掉。
 * ★ 运行时取 runtime 是每次加载时现查 `Live2DFactory.findRuntime`（遍历的就是这个数组里的同一批对象），所以改对象上的方法就生效。
 * ★ 找不到 runtime / Core（将来换了运行时）只 console.warn、不拦加载：检查没装上 = 回到原来的行为，不该让看板娘因此出不来。
 */
function installMocGuard(pixi: PixiRuntime): void {
  const rt = pixi.live2d.Live2DFactory?.runtimes?.find((r) => r.version === 4);
  const original = rt?.createCoreModel;
  if (!rt || typeof original !== "function") {
    console.warn("[live2d] Cubism 4 runtime not found in Live2DFactory.runtimes; moc3 consistency check is NOT installed");
    return;
  }
  if (rt.__mocGuard) return;
  rt.createCoreModel = (mocBytes: ArrayBuffer, options?: unknown) => {
    const core = loadedCubismCore();
    if (core) checkMoc(mocBytes, core);
    else console.warn("[live2d] Live2DCubismCore not found; skipped moc3 consistency check");
    return original.call(rt, mocBytes, options);
  };
  rt.__mocGuard = true;
}

/**
 * 对一份 moc3 字节跑同一道加载前检查（上传向导第 ① 步本地核对用：作者在预览之前就知道这份 moc3 读不了）。
 * 不过抛 `MocCheckFailed`；运行时 / Core 没加载出来抛别的错误 —— 调用方要分开（那不是包的问题，第 ② 步加载时还会再查一次）。
 */
export async function checkMocBytes(mocBytes: ArrayBuffer | Uint8Array): Promise<void> {
  await loadLive2DRuntime();
  const core = loadedCubismCore();
  if (!core) throw new Error("Live2DCubismCore is not available after loading runtime scripts");
  checkMoc(mocBytes, core);
}
