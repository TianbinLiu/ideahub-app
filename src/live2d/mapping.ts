/**
 * companion.json —— 第三方 Live2D 模型到我们「演出协议」（protocol.ts）的映射。
 *
 * 服务器上传时生成 / 校验（server `services/live2dCapabilities.service.js`），放在市场包的 model3.json 旁边；
 * 官方 mascot 打包在客户端里、没有这个文件 → 所有槽位按 protocol.ts 写死的默认走，行为与从前逐字相同。
 * 有文件时：动作槽 → 模型自己的动作组名、表情槽 → exp3 表情名或一组参数、触摸区 → 模型自己的 HitAreas 名（+ Tap@区 之类的动作）、
 * 参数槽 → 模型自己的参数 id（旧式 PARAM_ANGLE_X 也行）。★ 缺的槽位 = 静默不演，永不报错、永不回退到我们的补片。
 * 形状与生成规则见 App 仓 docs/digital-human-creator-center.md §3.3–3.4。
 */
import { ACTION_MOTIONS, TOUCH_AREAS, type CompanionAction, type CompanionFace, type TouchArea } from "../companion/protocol";

export type MappedFace = { expression?: string; params?: Record<string, number> } | null;
export type MappedTouch = { hitAreas: string[]; motion: string | null } | null;
export type ParamSlot =
  | "mouthOpen"
  | "mouthForm"
  | "eyeL"
  | "eyeR"
  | "eyeBallX"
  | "eyeBallY"
  | "angleX"
  | "angleY"
  | "angleZ"
  | "bodyX"
  | "breath"
  | "cheek";

export type CompanionMapping = {
  version: 1;
  idle: string | null;
  start: string | null;
  actions: Partial<Record<CompanionAction, string | null>>;
  faces: Partial<Record<CompanionFace, MappedFace>>;
  touch: Partial<Record<TouchArea, MappedTouch>>;
  params: Partial<Record<ParamSlot, string | null>>;
  fit?: { heightRatio?: number; xBias?: number };
};

/** 标准参数 id（官方 mascot 与 Cubism 模板模型都用这套；没有 companion.json 时就是它） */
export const STANDARD_PARAMS: Record<ParamSlot, string> = {
  mouthOpen: "ParamMouthOpenY",
  mouthForm: "ParamMouthForm",
  eyeL: "ParamEyeLOpen",
  eyeR: "ParamEyeROpen",
  eyeBallX: "ParamEyeBallX",
  eyeBallY: "ParamEyeBallY",
  angleX: "ParamAngleX",
  angleY: "ParamAngleY",
  angleZ: "ParamAngleZ",
  bodyX: "ParamBodyAngleX",
  breath: "ParamBreath",
  cheek: "ParamCheek",
};

/** 解析后的参数 id 表：null = 这个模型没这个功能，运行时跳过那一行读写 */
export type ParamIds = Record<ParamSlot, string | null>;

export function resolveParamIds(mapping: CompanionMapping | null): ParamIds {
  const out: ParamIds = { ...STANDARD_PARAMS };
  if (!mapping || !mapping.params) return out;
  for (const slot of Object.keys(STANDARD_PARAMS) as ParamSlot[]) {
    if (!Object.prototype.hasOwnProperty.call(mapping.params, slot)) continue;
    const v = mapping.params[slot];
    out[slot] = typeof v === "string" && v ? v : null;
  }
  return out;
}

/** 语义动作 → 动作组名：有映射按映射（服务器写满所有槽位，null = 这个模型不演这个），没映射按 protocol 默认 */
export function motionGroupFor(mapping: CompanionMapping | null, action: CompanionAction): string | null {
  if (!mapping) return ACTION_MOTIONS[action];
  return mapping.actions[action] ?? null;
}

/** 触摸区自己的动作（nizima 的 Tap@Head 之类）；没有 → null */
export function touchMotionFor(mapping: CompanionMapping | null, area: TouchArea): string | null {
  return mapping?.touch[area]?.motion ?? null;
}

/**
 * 命中区原名 → 我们的触摸区名，按 TOUCH_AREAS 的优先级排序；没映射原样返回（官方 mascot 的 HitAreas 名字就是我们的区名）。
 */
export function mapHitAreas(mapping: CompanionMapping | null, raw: string[]): string[] {
  if (!mapping) return raw;
  const hit = new Set(raw);
  const out: string[] = [];
  for (const area of TOUCH_AREAS) {
    const t = mapping.touch[area];
    if (t && t.hitAreas.some((name) => hit.has(name))) out.push(area);
  }
  return out;
}

/**
 * 读模型旁边的 companion.json。只对绝对 URL 发请求（市场包在 API 域名上）；相对路径 = 打包在客户端里的官方模型，没有这个文件。
 * 任何失败都当没有：404、非 JSON、版本不对、Capacitor 的本地静态服务器对不存在的路径回 200 + index.html……
 */
export async function loadCompanionMapping(modelUrl: string): Promise<CompanionMapping | null> {
  if (!/^https?:\/\//i.test(modelUrl)) return null;
  try {
    const res = await fetch(new URL("companion.json", modelUrl).toString(), { cache: "no-cache" });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<CompanionMapping> | null;
    if (!data || typeof data !== "object" || data.version !== 1) return null;
    return {
      version: 1,
      idle: typeof data.idle === "string" ? data.idle : null,
      start: typeof data.start === "string" ? data.start : null,
      actions: data.actions && typeof data.actions === "object" ? data.actions : {},
      faces: data.faces && typeof data.faces === "object" ? data.faces : {},
      touch: data.touch && typeof data.touch === "object" ? data.touch : {},
      params: data.params && typeof data.params === "object" ? data.params : {},
      fit: data.fit && typeof data.fit === "object" ? data.fit : undefined,
    };
  } catch {
    return null;
  }
}
