// 「特效同款」（跟着做 G，2026-10-05 第一批，方案 docs/canvas-platforms-ecosystem-research.md §五）的预设库 —— 唯一实现。
//
// 纯数据 + 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-effect-presets.mjs 直接 import 它跑正反例。
// 界面上的名字 / 一句话 / 图标不在这里 —— 那是界面文案，进 Lingui 目录，在 components/flow/EffectWizard 那一份。
//
// ★★ 一条预设 = 两句进模型的话（冻结中文）：
//   · keyframe：把主角放进预设画面的**那一刻**（进出图模型，ai/real.generateFrame 的外壳已经带「单一完整画面、不要文字」与画幅，这里只写画面）；
//   · motion：从那一刻开始**接下来几秒**发生什么、镜头怎么动（进视频模型，存进方案的 plot）。
//   出处：TapNow 的 Seedance 2.0 专区（63 个模板里大多数是「1~2 张图 + 一段预设 → 一次出 5~10 秒」）、RunningHub 的一键同款。
//   ⚠ 两家的提示词一个字都没抄（别人的作品、主人定过的规矩），下面全是按这个形状自己写的。
// ★ 动作那一句**只写一个镜头**、不写「镜头1：」：写成分镜表的格式会被当成多镜头（shotScript.isMultiShot），多镜头的段不用 AI 画的结束画面、
//   出片规则就变了；一条特效本来就是一镜到底。
// ★ 占位符：{A} / {B} = 人物卡的名字（按点选的先后），{P} = 这件产品。替换只在 effectKeyframe / effectMotion 一处。
// ★ 真人档（按发计价、起拍画面就是真人卡的照片）**不画关键帧**：照片原本的背景不是预设场景，所以只有「不靠换场景也成立」的那几条
//   （环绕、时间冻结、拉远）标 realOk —— 别的摆出来，片子是照片在原地动、预设的那个场景根本不会出现。

/** 主角是谁：一个人 / 两个人 / 一件产品（产品走道具卡或传一张照片） */
export type EffectSubject = "person" | "duo" | "product";

export interface EffectPreset {
  id: string;
  subject: EffectSubject;
  /** 关键帧：那一刻的画面（进出图模型） */
  keyframe: string;
  /** 出片：接下来几秒发生什么、镜头怎么动（进视频模型） */
  motion: string;
  /** 缺省时长（秒）：按档位的窗口夹（economy.clampDuration） */
  sec: number;
  /**
   * 缺省画幅。⚠ 今天**没有人读它**（只有 check-effect-presets.mjs 核对取值）：effectDraftStore.pickPreset 有意沿用向导眼下的画幅
   * （人改过的，或接上一段的），不换成这里的缺省。要让它生效是产品决定，不是补一行代码（2.62 发版评审记下）。
   */
  aspect: "portrait" | "landscape";
  /** 真人档能不能用（见文件头 ★ 真人档那条） */
  realOk: boolean;
}

/* i18n-frozen: 特效同款的预设，两句话都进出图 / 视频模型，冻结中文 */
export const EFFECT_PRESETS: readonly EffectPreset[] = [
  {
    id: "game-hero",
    subject: "person",
    keyframe: "{A}站在一座格斗游戏风格的竞技场中央，摆出准备迎战的架势，身后是体育场的巨型灯光和观众席的剪影，地面亮着发光的能量纹路",
    motion: "{A}握拳向前冲出一记重拳，拳头带起一圈发光的冲击波，周围的尘土和碎石被震得腾空，镜头从正面快速推近再绕到侧面，在冲击波炸开的一瞬放慢",
    sec: 5,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "skate",
    subject: "person",
    keyframe: "{A}踩着滑板腾空跃过城市广场的台阶，夕阳从背后照过来，逆光勾出金色的轮廓，下方是虚化的人群和街景，运动抓拍的质感",
    motion: "{A}在空中翻转滑板，稳稳落地后顺势滑向镜头，镜头贴着地面向后退着跟拍，夕阳在身后闪过一道光晕",
    sec: 5,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "freeze",
    subject: "person",
    keyframe: "{A}站在雨后的街道上，周围的雨滴、落叶和被风卷起的纸片全都悬停在半空，像时间被按下了暂停，冷色调",
    motion: "时间静止，只有镜头在动：镜头绕着{A}缓慢环绕半圈，悬在半空的雨滴和落叶纹丝不动；最后{A}眨了一下眼，所有东西同时恢复下落",
    sec: 6,
    aspect: "portrait",
    realOk: true,
  },
  {
    id: "orbit",
    subject: "person",
    keyframe: "{A}站在干净的影棚里，背景是柔和的渐变色，一道轮廓光勾出身形，全身入画，时装大片的质感",
    motion: "{A}自然站立，微微转头看向镜头，镜头绕着{A}缓慢环绕一整圈，依次展示正面、侧面和背面的造型，光线随着角度流动",
    sec: 6,
    aspect: "portrait",
    realOk: true,
  },
  {
    id: "pullback",
    subject: "person",
    keyframe: "{A}的面部特写，眼神坚定地望向远方，晨光斜斜地打在脸上，背景完全虚化",
    motion: "镜头从{A}的面部特写开始一路向后拉远、慢慢升高，逐渐露出{A}站在一处悬崖边上，脚下是翻涌的云海和连绵的山脉，最后成为一个壮阔的远景",
    sec: 6,
    aspect: "portrait",
    realOk: true,
  },
  {
    id: "monster",
    subject: "person",
    keyframe: "{A}站在废墟城市的街道中央回头仰望，身后的云层里隐约露出一只巨大怪兽的轮廓，尘土飞扬，灾难片的气氛",
    motion: "巨大的怪兽从云层里探出头，发出低沉的吼声，地面震动、碎石滚落；{A}转身朝镜头奔跑，镜头手持着向后退着跟拍，画面剧烈晃动",
    sec: 6,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "mural",
    subject: "person",
    keyframe: "老街的一面砖墙上画着{A}的彩色壁画，壁画里的{A}正抬起一只脚，像要从墙里走出来，午后的阳光照在墙面上",
    motion: "壁画里的{A}慢慢活了过来，颜料变成真实的皮肤和衣服，一步从墙上跨到街道上，回头看了一眼墙上留下的空白轮廓，镜头缓慢推近",
    sec: 6,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "idol",
    subject: "person",
    keyframe: "{A}站在演唱会舞台中央，手里拿着麦克风，身后是巨大的灯光阵列和彩色光束，台下是挥舞荧光棒的观众剪影",
    motion: "{A}随着音乐的节拍跳起一段舞，舞台灯光跟着节奏变换颜色，彩色的纸片从空中飘落，镜头从台下仰拍，慢慢推近到{A}的半身",
    sec: 6,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "timelapse",
    subject: "person",
    keyframe: "{A}一动不动地站在城市天桥的中央，身边的人流化成模糊的光影，背后的高楼亮着灯，黄昏",
    motion: "{A}始终保持静止，身边的人流和车流加速成流动的光带，天空从黄昏飞快地变成星夜，城市的灯光一层层亮起，镜头固定不动",
    sec: 6,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "faceoff",
    subject: "duo",
    keyframe: "{A}和{B}在下着雨的天台上面对面对峙，相隔几步，雨水顺着衣角往下滴，远处城市的霓虹虚化成光斑，气氛紧绷",
    motion: "一声闷雷响起，{A}和{B}同时向对方冲去，镜头从两人中间的低角度横向摇过，雨水在慢动作里炸开，最后停在两人即将交手的一瞬",
    sec: 6,
    aspect: "landscape",
    realOk: false,
  },
  {
    id: "reveal",
    subject: "product",
    keyframe: "{P}立在一座极简的白色展台上，一束光从侧上方打下来，背景是干净的深色渐变，产品广告大片的质感",
    motion: "一道光从左到右扫过{P}的表面，映出材质的光泽，镜头缓慢环绕半圈并推近到细节，背景的光晕随之流动",
    sec: 5,
    aspect: "portrait",
    realOk: false,
  },
  {
    id: "explode",
    subject: "product",
    keyframe: "{P}悬浮在纯色背景前，周围漂着几颗发光的粒子，干净的商业摄影质感",
    motion: "{P}的外壳和零件沿着各自的方向缓缓分开，悬浮成一张立体的爆炸图，停顿片刻后又精准地合拢回原样，镜头一直缓慢环绕",
    sec: 5,
    aspect: "portrait",
    realOk: false,
  },
];

/** 这件预设要几个人（产品 = 0） */
export function castCountOf(p: Pick<EffectPreset, "subject">): number {
  return p.subject === "duo" ? 2 : p.subject === "person" ? 1 : 0;
}

/**
 * 这一档上能用的预设（按清单顺序）。真人档只留 realOk 的人物预设（见文件头 ★ 真人档那条）；别的档全都能用 ——
 * 1.0 两档拿关键帧当首帧起拍（标准档照旧补画结束帧，报价里有），2.x 两档帧当参考图发。
 */
export function effectsOn(tier: { flat: boolean }): EffectPreset[] {
  return EFFECT_PRESETS.filter((p) => !tier.flat || (p.realOk && p.subject !== "product"));
}

export function effectById(id: string | null | undefined): EffectPreset | null {
  return EFFECT_PRESETS.find((p) => p.id === id) ?? null;
}

/** 名字里的花括号会和占位符打架（一个人叫「{B}」会被当成第二个人）：替换前先剥掉 */
const safeName = (s: string): string => s.replace(/[{}]/g, "").trim();

/* i18n-frozen: 占位符没给名字时的兜底称呼，进模型，冻结中文 */
const fill = (text: string, names: { a?: string; b?: string; product?: string }): string =>
  text
    .replace(/\{A\}/g, safeName(names.a ?? "") || "主角")
    .replace(/\{B\}/g, safeName(names.b ?? "") || "对手")
    .replace(/\{P\}/g, safeName(names.product ?? "") || "这件产品");

/** 关键帧那一句（进出图模型）。参考图点名句（「图1 是…」）由调用方接在后面 */
export const effectKeyframe = (p: EffectPreset, names: { a?: string; b?: string; product?: string }): string => fill(p.keyframe, names);

/** 动作那一句（进视频模型，存进方案的 plot） */
export const effectMotion = (p: EffectPreset, names: { a?: string; b?: string; product?: string }): string => fill(p.motion, names);

/**
 * 产品预设接在关键帧后面的参考图点名句（道具卡走 ai/real.shotGroupRefs 出的「图1 是「名字」」，传的照片写死「图1 是要展示的产品」）。
 * ★ 不借九宫格那句 panelRefLine：那句说的是「人物的长相、发型与服装」，产品要锁的是外形、颜色、材质与图案。
 */
/* i18n-frozen: 产品预设的参考图点名句，进出图模型，冻结中文 */
export const productRefLine = (bind: string): string =>
  bind ? `。参考图：${bind}；产品的外形、颜色、材质和上面的图案与参考图一致，画面里只出现这一件产品` : "";

/* i18n-frozen: 传一张产品照片（不是道具卡）时的点名，进出图模型，冻结中文 */
export const PRODUCT_PHOTO_BIND = "图1 是要展示的产品";
