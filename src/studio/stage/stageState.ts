// 导演台（2026-09-06，对标 LibTV 导演台 / updream 预演台）的**状态与算数**：人偶站位 + 机位 → 一张构图示意图。
// 只放纯数据与纯函数（flowStore 要存它、StageOverlay 要画它，两边都不该 import 对方）。
//
// ★ 为什么值得做：主人真机上"多人站位、机位切换"靠文字描述是在赌运气（LibTV 测评者为一场五人会议戏
//   反复生成过几百张分镜图）。摆出来截一张图，人数 / 站位 / 朝向 / 景别 / 机位全在图里，模型看图就懂。
// ★ 截图**不直接**当出片输入：灰白人偶喂给视频模型会长出灰白人偶。它经 ai/real.fuseFrame（融图）与
//   人物卡 / 场景卡合成一张真正的开头帧，再走 setFrame 那条写回路（pinned.first，与手工换帧同一条）。

export interface StageFigure {
  id: string;
  /** 地面坐标（米）。x 向右、z 向镜头（三维里 +z 朝观众） */
  x: number;
  z: number;
  /** 绕竖轴的朝向（弧度，0 = 面朝镜头） */
  rotY: number;
  /** 身高倍率（1 = 1.7 米） */
  scale: number;
}

export interface StageCam {
  /** 环绕角（弧度，0 = 正面） */
  yaw: number;
  /** 俯仰（弧度，正 = 俯拍） */
  pitch: number;
  /** 到注视点的距离（米）：近景 3 ～ 全景 9 */
  dist: number;
}

export interface StageState {
  figures: StageFigure[];
  cam: StageCam;
  /** 最近一次截图（JPEG dataURL），只做展示与重融；开头帧本身在 proposal.firstFrame */
  shot?: string;
}

/** 注视点：人偶胸口高度，环绕它转 */
export const STAGE_LOOK: [number, number, number] = [0, 1.0, 0];
export const STAGE_LIMITS = { distMin: 2, distMax: 12, pitchMin: -0.2, pitchMax: 1.3, figuresMax: 8 } as const;
/** 人偶模型归一到的身高（米） */
export const FIGURE_HEIGHT = 1.7;

export function defaultStage(): StageState {
  return { figures: [{ id: "f1", x: 0, z: 0, rotY: 0, scale: 1 }], cam: { yaw: 0, pitch: 0.22, dist: 5.5 } };
}

/** 机位 → 相机世界坐标（环绕 STAGE_LOOK） */
export function camPosition(cam: StageCam): [number, number, number] {
  const h = Math.cos(cam.pitch) * cam.dist;
  const y = STAGE_LOOK[1] + Math.sin(cam.pitch) * cam.dist;
  return [Math.sin(cam.yaw) * h, Math.max(0.3, y), Math.cos(cam.yaw) * h];
}

export const clampCam = (c: StageCam): StageCam => ({
  yaw: c.yaw,
  pitch: Math.min(STAGE_LIMITS.pitchMax, Math.max(STAGE_LIMITS.pitchMin, c.pitch)),
  dist: Math.min(STAGE_LIMITS.distMax, Math.max(STAGE_LIMITS.distMin, c.dist)),
});

/** 俯仰预设（导演口径） */
export const PITCH_PRESETS: Array<{ label: string; pitch: number }> = [
  { label: "俯拍", pitch: 0.85 },
  { label: "平视", pitch: 0.1 },
  { label: "仰拍", pitch: -0.15 },
];
/** 景别预设 = 到注视点的距离 */
export const SHOT_PRESETS: Array<{ label: string; dist: number }> = [
  { label: "特写", dist: 2.2 },
  { label: "近景", dist: 3.2 },
  { label: "中景", dist: 5.5 },
  { label: "全景", dist: 9 },
];

/**
 * 融图指令（唯一实现）里**这一段自己的那部分**：人数、谁、哪儿、什么画风。
 * 「图片1 只是人偶摆的草图、人偶必须换成真人」那层外壳在 ai/real.fuseStageFrame 里（它才知道自己发给的是哪家模型、
 * 画幅提示怎么说才不会被当真），两处别互相抄。
 */
export function stageFuseInstruction(o: { plot: string; figures: number; heroName?: string; hasScene: boolean; style?: string }): string {
  const people = o.figures === 1 ? "一个人" : `${o.figures} 个人`;
  const who = o.heroName
    ? `人物的相貌、发型、服装严格按图片2 里的角色「${o.heroName}」来画（只取这个角色的长相与穿着，不要照搬图片2 的构图、姿势与背景）${o.figures > 1 ? "，其余人按剧情设定" : ""}`
    : "人物按剧情设定来画";
  const where = o.hasScene ? `场景按${o.heroName ? "图片3" : "图片2"}的场景卡` : `场景：${o.plot.replace(/\s+/g, " ").slice(0, 60)}`;
  // ★ 画风要另说一句：图片1 是一张灰白 3D 渲染，不点名的话模型会把那股塑料感当画风照抄。有风格卡按风格卡，没有就跟人物卡走。
  const look = o.style ? `画风：${o.style}` : `画风与质感跟随${o.heroName ? "图片2 的人物卡" : "剧情设定"}`;
  return `画面里有 ${people}，人数、站位、朝向、景别与机位全部照图片1；${who}；${where}；${look}；这是这一段的开头画面`;
}
