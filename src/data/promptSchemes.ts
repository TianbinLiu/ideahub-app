// 「提示词方案」：一套方案 = 若干个**图位模板**，决定从一张圈选裁剪能炼出哪几张形象图。
//
// ★★ 为什么要有它：图位曾经写死成三格（全身立绘/面部特写/标志性细节），而真实的
//   人物卡设定图流派**产出的图位数量与种类都不同** —— 有的整套无脸（人脸与服装分离），
//   有的产出一张分栏规格图，有的只要"特写 + 全身"两张。写死三格等于把这些流派全挡在外面。
//
// ★★★ 三条**方案作者改不动**的硬规则（写在这一层，不开放给提示词）：
//   ① **风格跟随参考图**：提示词里绝不点名画风。真人截图出写实立绘、动漫截图出同风格插画
//      （2026-08-24 华强截图实测：写实版与动漫版各一发，Seedream i2i 对真人照片放行）。
//      开放给方案作者的下场就是"真人被动漫化"那个已经修过一次的 bug 卷土重来。
//      ★ 2026-09-04 补一档：调用方**已经知道**参考图是真人照片时（真人素材扫脸那条路、
//        圈选提卡勾了「这是真人」），画风句换成**无条件**的照片锁定（`slotPrompt` 的
//        `realPhoto`），不再让模型自己判"这是不是照片" —— 主人真机实测：同一张授权自拍，
//        「面部特写」出的是照片、「全身立绘」出的是厚涂二次元。机理与实测数见 PHOTO_LOCK_CLAUSE。
//   ② **合成规格图一律 `role:"display"`**：方舟提示词指南原文「多视图素材包含同一人物的
//      不同角度，模型易将其识别为多个不同主体，反而加剧 ID 漂移」。三视图/分栏设定稿
//      对人极有用、对模型有害 —— 让它进管线是**主动把画面变差**，还要为它收出片的钱。
//   ③ **图位数 ≤ MAX_CARD_VIEWS**：那个 3 是跨仓的（server 的 zod 也钉着），
//      多出来的存不下，存不下就是"方案说出 5 张、卡上只有 3 张"，零报错。
//
// ★ 与模板市场的关系：形状刻意照着 `data/templates.ts`（mine/shared/remoteId），
//   将来接服务端共享时是同一套搬法。本轮只做**本机方案库 + 内置方案**，
//   远端共享见 docs/backlog.md。
//
// ★★ 图位的身份是 `slot.id`，**不是 `slot.tag`**（2026-09-11 多语言 PR2，主人拍板「名字不再当身份键」）。
//   这条规则这一批暂时写在这里与 data/schemeSlotIds 文件头、没进 CLAUDE.md（CLAUDE.md 同时在好几条分支上被改，
//   合流容易冲突；之后补进「已知的坑」）：
//   · 草稿照片的键、正在处理 / 出错 / 圈选改图的是哪一格，一律读 id；tag 只是显示名 —— 内置方案名字一接 Lingui，
//     拿 tag 当键的地方切一次语言就对不上，照片不画、不当卡面、铸卡不带走，花钱出的 AI 图落空，零报错。
//   · id 只有三个来处：下面 BUILTIN_SCHEMES 里写死的内置 id、编辑屏新加格子的 schemeSlotIds.freshSlotId（暂定的）、
//     其余一律 schemeSlotIds.normalizeSlotIds（本文件经 load / withSlotIds / saveScheme / upsertMine 调它）。
//   · 服务端会 strip `slots[].id`：读服务端回来的方案一律过 withSlotIds（apiToScheme）；存进 CardView.tag 的名字只由 slotCardTag 决定。
//   · 「服务端现在存着哪一版图位」记在 localStorage（noteServerSlots：推上去成功、装回来之后写；换掉 / 删掉本机某一套时 seedServerSlots 补记）：
//     「已装 · 用它」/ 删掉再装回来先拿它对齐 id，否则发布后本机改过、重启过的那几格，草稿照片够不着（复核第 4、5 轮）。启动时不写。
//     删掉那一刻的本机那份另记在内存里（removedSlots）：同一次会话里装回来时当本机那份对齐（复核第 6 轮）。
import { BUILTIN_SLOT_ZH, CARD_SIZE, CardRole, CardType, MAX_CARD_VIEWS, VIEW_TAG_MAX, builtinSlotZh, uid } from "../types";
import { t } from "@lingui/core/macro";
import { editBefore, normalizeSlotIds, type BuiltinSlotLineage } from "./schemeSlotIds";

/** 这一格的参考图从哪张裁剪来 */
export type SchemeRef = "body" | "face";

export interface SchemeSlot {
  /**
   * 这一格在**本方案里**的身份：自建卡草稿照片的键（customCardStore.schemeShots）、正在处理 / 出错 / 圈选改图的是哪一格，都认它。
   * ★★ 只当键：不上屏、不解析、永不等于 CardView 的 kind 词（face / body / detail —— 那三个与它共用 busySlot / slotErr 的键空间）。
   * ★ 内置图位**跨方案共用同一个 id**（clean 与 specsheet 都有 fullBody / faceCloseup）：换方案时照片还挂在原来那格上，靠的就是这个。
   * ★★ role 是身份的一部分：一格的 role 变了，保存时就换成 role 变体（照片收起来，不以另一种 role 铸进卡里）；改名不换。
   *   改回原 role 就换回原 id —— 三类 id 都一样，与中间改没改名、正文无关（理由见 SchemeEditorSheet.patchSlot 的注释，门禁钉着）。
   * ★ 从哪来：内置图位是 BUILTIN_SCHEMES 里写死的字面量；编辑屏新加的空白格子先拿 schemeSlotIds.freshSlotId 发的**暂定** id
   *   （头一回保存时 normalizeSlotIds 可能把它换成内置血统 id，也可能原样留下；存下去之后就不再换）；其余一律由 normalizeSlotIds 算
   *   （经 load / withSlotIds / saveScheme / upsertMine）。服务端会 strip 掉，读回来现算。
   */
  id: string;
  /**
   * 界面上显示的名字，**只是显示名、永远不当身份键**（身份是上面的 id，理由见文件头 ★★）。
   * 存进 CardView.tag 的值不直接读它，走 slotCardTag。★ ≤24 字：server 的 CARD_VIEW_TAG_MAX 跨仓镜像
   */
  tag: string;
  /** 出片管线里干什么（进 CardView.role）。合成规格图必须 display，见文件头 ★★★② */
  role: CardRole;
  /**
   * 这一格的提示词**正文**。风格那句由 `slotPrompt` 统一拼，作者写不了也删不掉（★★★①）。
   * 支持 `{{主体}}` 占位符 —— 插进来的是 `slotPrompt` 的 subject 参数（用户在命名屏写的那句描述），与这一格的 tag 无关。
   */
  prompt: string;
  /** 拿哪张裁剪当 i2i 参考。缺省 body（人物主裁剪） */
  ref?: SchemeRef;
  /** 出图尺寸。缺省 CARD_SIZE（3:4 卡面画布） */
  size?: string;
  /**
   * 不调模型，直接放**原片裁剪**。★ 这种格子**不计费**（`schemeCost` 只数生成型的），
   * 报价与实扣同源就靠这一条（economy 那侧读的是同一个数）。
   */
  fromCrop?: boolean;
}

export interface PromptScheme {
  id: string;
  title: string;
  /** 一句话说清它产出什么、适合谁 */
  intro: string;
  author?: string;
  /** 适用卡种。★ 空 = 只适用人物卡（绝大多数方案都是） */
  cardTypes?: CardType[];
  slots: SchemeSlot[];
  /**
   * **无脸/风格化**方案：产出里不含可辨认的真人面孔（人脸与服装分离、白模台、纯剪影）。
   *
   * ★★ 这一位不是装饰，它是市场的**默认排序键**（`listSchemes` 把 true 的排前面）：
   *   无脸方案对"想用真人素材的动作/服装、又不复刻身份"这个正当需求是直给的答案，
   *   而且天然避开肖像权与供应商的真人闸。市场主推它是产品决定（仓库主人拍板）。
   * ⚠ 它**只描述产出形态**，不是"绕过检测的成功率"——市场**不得**按绕过率排序或标注，
   *   预览示例也不得用真人（理由写在 docs/card-prompt-scheme-market-design.md §B2）。
   */
  faceless?: boolean;
  /**
   * 方案预览图（作者出一次存起来）。选方案时给用户看"用这套做出来长什么样"。
   *
   * ★★ 存的是**缩图**（`SCHEME_EXAMPLE_MAX_W`）不是原图：方案库整个躺在 localStorage
   *   （几 MB 上限），塞几张 1MB 级的卡面进去会把整份方案库写失败 —— 而 `persist()`
   *   是**吞掉配额错误**的（那本是对的：方案库不该让工坊打不开），于是后果会变成
   *   "自建的方案下次打开就没了"，且零报错。
   * ⚠ **不得用真人**（design doc §B2）：`canBeExample` 是那条规则的唯一实现。
   */
  examples?: string[];
  /** 内置方案：不可删、不可改（改了就"另存为"一份用户方案） */
  builtin?: boolean;
  /** 已发布到广场（远端态的镜像）。★ 判**存在性**：老数据/离线恒缺省 = 没发布 */
  published?: boolean;
  createdAt?: number;
}

/**
 * 风格那句 —— **全仓唯一一处**，拼在每个图位的提示词**后面**（文件头 ★★★①）。
 * 方案作者的正文在它前面，改不了也删不掉。
 *
 * ★ "画风句在正文之后"是量出来的，别换位置（2026-09-04 Seedream 4.0 实测，白底黑 T
 *   头肩照当参考、各写法两发）：把画风句挪到正文**前面**，「全身立绘」的"全身"就丢了 ——
 *   四张里一张头肩、三张半身；留在后面全身 2/2。构图句在前、画风句在后。
 */
/* i18n-frozen: 出图提示词的画风句，发给模型 */
const STYLE_CLAUSE =
  "严格保持参考图的画风（照片则照片级写实，插画则同风格插画）与人物相貌、发型、服装、神态完全一致";

/**
 * 调用方**已知**参考图是真人照片时用的锁定句 —— **无条件**，不给模型判断的余地。
 *
 * ★★ 为什么 STYLE_CLAUSE 那句条件句不够（2026-09-04 主人真机 + 本机复现）：那句是
 *   "照片则写实、插画则插画"，**由模型自己判参考图是哪种**。参考图是清晰照片时它判得对
 *   （本机合成的白底头肩照 / 室内自拍两种参考，现行写法 14/14 写实）；参考图是低清、重压缩、
 *   开过美颜的自拍（扫脸流程留下的正是这种：把同一张自拍缩到 300×400 再拉回来、JPEG q55）
 *   时，4 张里 2 张飘成光滑的 CG/厚涂感。而「全身立绘」这一格要模型**编出**参考图里根本
 *   没有的整个身体，飘的空间最大；「面部特写」几乎是把参考图重画一遍 —— 于是同一张参考下
 *   特写是照片、全身是二次元，正是主人看到的那一幕。既然真人这条路上"参考图是照片"是
 *   已知事实，就直接说死，别让模型猜。
 * ⚠ 只在 `realPhoto` 为真时用：动漫截图拼上它就是老 bug 的反向版（动漫被真人化）。
 * ⚠ 仍然接在正文**后面**（理由见 STYLE_CLAUSE 那条 ★）。
 */
/* i18n-frozen: 出图提示词的真人照片锁定句，发给模型 */
const PHOTO_LOCK_CLAUSE =
  "参考图是真人照片：成品必须是真实摄影照片（真人写实质感、真实皮肤纹理与布料质感），" +
  "绝不能画成插画、动漫、厚涂或任何绘画风格；人物相貌、发型、服装、神态与参考图完全一致";

/** 占位符：用户在命名屏写的那句描述插进这里 */
const SUBJECT_TOKEN = /\{\{\s*主体\s*\}\}/g;

/**
 * 一个图位的**最终提示词**。唯一实现 —— 调用点不许自己拼（拼第二份就等于给了作者
 * 覆盖风格那句的口子，而那正是"真人被动漫化"的复发路径）。
 *
 * ★ `realPhoto` **必填**（不是 `?:`）：漏传零症状 —— 退回条件句，真人路又开始随参考图
 *   质量飘，而屏幕上什么都不会报。调用方拿它的 `realPerson` 状态传（两条路各一处：
 *   CustomCardPage.runAiForge / VideoCardAnnotator.makePortraits）。
 */
export function slotPrompt(slot: SchemeSlot, subject: string | undefined, o: { realPhoto: boolean }): string {
  const body = slot.prompt.replace(SUBJECT_TOKEN, (subject || "").trim());
  return `${body}；${o.realPhoto ? PHOTO_LOCK_CLAUSE : STYLE_CLAUSE}`;
}

/** 这一格要不要调模型（= 要不要收钱）。唯一判据，economy 与生成侧共用 */
export function isGenerated(slot: SchemeSlot): boolean {
  return !slot.fromCrop;
}

// ── 内置方案 ───────────────────────────────────────────────────────
//
// ★ 三套的取材：仓库主人 2026-08-24 给的三张参考截图（人物卡设定图流派）。
//   照搬那些超长提示词没有意义（它们是给通用对话模型写的、含大量排版指令），
//   这里提炼的是**每一派真正决定产出形态的那几句**。

// ★ 内置方案的 examples 是 public/ 路径（几十字节的字符串），不占 localStorage 配额 ——
//   examples 字段头上那条「必须缩图」的 ★★ 管的是**用户方案**（存 dataURL 那种）。
//   四张图由 design/gen-scheme-examples.mjs 出（真实 Seedream 产出，主人点名"不要美工示意"），
//   脚本对下面的图位提示词做子串断言：改了提示词记得重出图，否则脚本会当场报错。

/**
 * 「全身立绘」这一格的正文 —— clean / specsheet 两套**共用一份**（此前各抄一份，改一处漏一处）。
 *
 * ★★ 措辞是量出来的（2026-09-04，Seedream 4.0，只有**头肩**参考的最难情形：降质自拍）：
 *   老写法「全身完整可见，站姿自然」在只有头肩参考时约半数出半身（4 张里 1 张全身）——
 *   参考图里没有身体，模型就顺着参考的取景画半身。点名**鞋子**、**头顶脚下留白**、
 *   **不裁切**之后 8/8 从头到鞋（两种措辞各 4 张）。
 * ⚠ 别写「参考图只提供了脸和发型」这类**对参考图的断言**：圈选提卡的参考常常带着身体，
 *   那句会让模型丢掉参考里真有的服装。这里只描述产出，不描述参考。
 * ⚠ 也试过把头肩照垫在白底画布顶部当参考（想喂"头在上、下面空"的版式）：0/4，模型不认。
 * ⚠ 改了这句要同步 design/gen-scheme-examples.mjs 的 CLEAN_BODY（它对本文件做子串断言）。
 */
/* i18n-frozen: 出图提示词正文，发给模型 */
const FULL_BODY_PROMPT =
  "参考图中人物的全身立绘：远景，从头顶到鞋底完整入镜，双脚和鞋子清晰可见，头顶上方与脚下各留出空白，" +
  "身体任何部位都不裁切；纯白色背景，无任何背景元素与文字；站姿自然，正面朝向镜头";
/** 「面部特写」那一格的正文，同样两套共用 */
/* i18n-frozen: 出图提示词正文，发给模型 */
const FACE_PROMPT = "参考图中人物的面部特写肖像：纯白色背景，无任何背景元素与文字；头肩构图，五官清晰";

// ★ 下面四格的正文原来直接写在 BUILTIN_SCHEMES 里。提出来是为了整句冻结（发给模型的提示词，不是界面文案）：
//   方案的名字、简介、图位名是界面文案，它们还留在 BUILTIN_SCHEMES 里，不能跟着一起冻结。
//   ⚠ 措辞与「"…" +」换行拼接的排版一个字没动 —— design/gen-scheme-examples.mjs 按源码文本做子串断言，
//   它先抹掉「" +」换行再比对，在拼接的字符串中间插注释会让断言失败。
/* i18n-frozen: 出图提示词正文，发给模型 */
const MANNEQUIN_BODY_PROMPT =
  "参考图中人物的全身，头部替换为无面部特征的纯白色人台模型（mannequin head, blank face），" +
  "身体比例写实，服装完整穿着在人台上、面料质感写实；纯白色背景，无任何背景元素与文字";
/* i18n-frozen: 出图提示词正文，发给模型 */
const OUTFIT_DETAIL_PROMPT =
  "参考图中人物服装的局部细节特写：领口结构、面料与版型、下装轮廓；" +
  "纯白色背景，无任何背景元素与文字，不出现人脸";
/* i18n-frozen: 出图提示词正文，发给模型 */
const TURNAROUND_PROMPT =
  "同一角色的标准站姿三视图横向并排：正面全身、侧面全身、背面全身；" +
  "头部均为无面部特征的纯白色人台模型，服装完整穿着，浅灰白底加等距网格辅助线，专业服装设计稿风格";
/* i18n-frozen: 出图提示词正文，发给模型 */
const SPEC_SHEET_PROMPT =
  "专业角色设计规格说明图（Character Design Spec Sheet），浅灰白色背景与网格辅助线：" +
  "左栏为角色头部铅笔素描线稿（正面 + 侧面 45°两图并排，精细面部结构线条，无上色）；" +
  "中栏为色彩参考色板横排（发色、眼色、肤色、服装主色与配色）；" +
  "右栏为服装局部细节特写三图。整体冷色调专业设计感排版";

export const BUILTIN_SCHEMES: readonly PromptScheme[] = [
  {
    id: "scheme_clean",
    // ★ 2026-08-28 由「干净立绘（默认）」改名：主人点名标题直接说产出物
    title: "全身立绘+面部特写",
    intro: "白底全身立绘 + 面部特写两张，出片管线真正会吃的就是这两张。原片截图留作对照。",
    builtin: true,
    examples: ["/schemes/clean.webp"],
    // ★ 内置图位的 id 与名字从 types.BUILTIN_SLOT_ZH 的**同一个键**来（id: "x" 配 tag: BUILTIN_SLOT_ZH.x），
    //   scripts/check-slot-ids.mjs 核这一对；同一格在几套内置方案里用同一个 id（理由见 SchemeSlot.id）
    slots: [
      {
        id: "fullBody",
        tag: BUILTIN_SLOT_ZH.fullBody,
        role: "primary",
        prompt: FULL_BODY_PROMPT,
      },
      {
        id: "faceCloseup",
        tag: BUILTIN_SLOT_ZH.faceCloseup,
        role: "face",
        ref: "face",
        prompt: FACE_PROMPT,
      },
      // ★ 原片裁剪降级保留：AI 立绘再像也是重画的，出片对不上时它是唯一的对照物。
      //   不计费（fromCrop），也不进模型（display）。
      { id: "sourceCrop", tag: BUILTIN_SLOT_ZH.sourceCrop, role: "display", prompt: "", fromCrop: true },
    ],
  },
  {
    id: "scheme_faceless",
    title: "无面部白模三视图",
    intro:
      "人脸与服装分离：出一张无面部的白模三视图（只锁服装/体型/比例）+ 一张服装细节图。不复刻长相，适合只想借动作与穿着的素材。",
    builtin: true,
    faceless: true,
    examples: ["/schemes/faceless.webp"],
    slots: [
      {
        // ★★ 这一格是**唯一**能进管线的：它锁的是服装与体型，而画面里没有脸 ——
        //   既是这套方案的卖点，也正好避开"多视图当人物参考"那条（它本来就不锁身份）。
        id: "mannequinBody",
        tag: BUILTIN_SLOT_ZH.mannequinBody,
        role: "primary",
        prompt: MANNEQUIN_BODY_PROMPT,
      },
      {
        id: "outfitDetail",
        tag: BUILTIN_SLOT_ZH.outfitDetail,
        role: "aux",
        prompt: OUTFIT_DETAIL_PROMPT,
      },
      {
        // 三视图是给人看的规格图 —— 必须 display（文件头 ★★★②）
        id: "mannequinTurnaround",
        tag: BUILTIN_SLOT_ZH.mannequinTurnaround,
        role: "display",
        prompt: TURNAROUND_PROMPT,
      },
    ],
  },
  {
    id: "scheme_specsheet",
    title: "角色设定规格图",
    intro: "一张分栏设定稿（素描线稿 + 色板 + 服装细节），外加一张能出片的面部特写。规格稿只作展示。",
    builtin: true,
    examples: ["/schemes/specsheet.webp"],
    slots: [
      {
        id: "faceCloseup",
        tag: BUILTIN_SLOT_ZH.faceCloseup,
        role: "face",
        ref: "face",
        prompt: FACE_PROMPT,
      },
      {
        id: "fullBody",
        tag: BUILTIN_SLOT_ZH.fullBody,
        role: "primary",
        prompt: FULL_BODY_PROMPT,
      },
      {
        id: "specSheet",
        tag: BUILTIN_SLOT_ZH.specSheet,
        role: "display",
        prompt: SPEC_SHEET_PROMPT,
      },
    ],
  },
];

// ── 图位 id ────────────────────────────────────────────────────────
//
// ★ 算法的唯一实现在 data/schemeSlotIds（零依赖，scripts/check-slot-ids.mjs 直接 import 它跑正反例）；这里只接线。

/** 从存储 / 服务端读回来、还没过 withSlotIds 的图位：id 可能没有、可能是坏值 */
type RawSlot = Omit<SchemeSlot, "id"> & { id?: unknown };
type RawScheme = Omit<PromptScheme, "slots"> & { slots: RawSlot[] };

/**
 * 内置图位的「血统表」：没有 id 的老图位按它认回内置 id（normalizeSlotIds 的 C 步）。
 * ★★ 必须是**函数**，不能是模块级 const：`load()` 在模块初始化那一刻就跑（下面的 `let mine = load()`），
 *   写在那一行下面的 const 在 load 里读是 TDZ ReferenceError —— 被 load 的 catch 吞掉、返回 []，
 *   下一次 persist() 就把用户整个方案库覆盖成空，零报错。函数声明会提升，它读的 BUILTIN_SCHEMES 在上面已经初始化好。
 * ★ 按 id 去重：clean 与 specsheet 共用 fullBody / faceCloseup（同一个 id、同一份正文）。
 * ★ 原名走 builtinSlotZh 查（只认自有属性）；查不到的内置 id 不进血统表，不拿 undefined 去比名字。
 */
function builtinLineage(): BuiltinSlotLineage[] {
  const out: BuiltinSlotLineage[] = [];
  const seen = new Set<string>();
  for (const sc of BUILTIN_SCHEMES) {
    for (const s of sc.slots) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const zh = builtinSlotZh(s.id);
      if (zh === undefined) continue;
      out.push({ id: s.id, zh, role: s.role, prompt: s.prompt, ref: s.ref, size: s.size, fromCrop: s.fromCrop });
    }
  }
  return out;
}

/**
 * 给一组图位定 id —— 没有服务端回包要与本机那份对齐时用（读 localStorage、读服务端回包、存编辑屏）。
 * 自带合法 id 的原样留着，没有的按内置血统 / 名字派生（规则见 normalizeSlotIds）。
 * @param mode 读存储 / 读服务端传 `"read"`；存编辑屏的改动（只有 saveScheme）传 `{ before }` —— 同一套方案改之前那一版
 *   （schemeSlotIds.editBefore 算：本机此刻存着的 + 编辑屏打开时拷贝的），新建 / 另存为时是 null。
 *   ★★ 必填不是可选，两档也不许互相顶替 —— 传错哪一边都零症状。⚠ tsc 只逼调用方**选一档**，选没选对它看不见
 *   （`{ before: null }` 在哪儿都通过编译）：load / apiToScheme / saveScheme 各传哪一档，由 scripts/check-slot-ids.mjs 的
 *   「接线」一节从源码核，改了调用点的写法就同步改那一节。传错的后果：
 *   · 存的时候当成读：role 是身份的一部分，编辑屏把一格从「全身」改成「脸部」而这里不知道存着的那一版，那格 id 照旧，
 *     草稿里的全身照就以脸部 role 铸进卡里、钱照扣；这一次新加的「全身立绘」也认不回内置 id。
 *   · 读的时候当成存：读回来的新建 id 会被当成「这一次新加的」按名字换成内置 id —— 某一格的照片挂到另一格上
 *     （复核第 2 轮那条，见 schemeSlotIds.normalizeSlotIds 的 ★★ 存下来的 id）。
 */
export function withSlotIds(slots: readonly RawSlot[], mode: "read" | { before: readonly SchemeSlot[] | null }): SchemeSlot[] {
  return normalizeSlotIds(slots, { builtins: builtinLineage(), edit: mode === "read" ? undefined : mode }).slots;
}

// ── 本机方案库（用户自定义 + 内置）─────────────────────────────────
//
// ★ 形状照 data/templates.ts 的 mine：localStorage 存用户那份，内置的恒在。
//   远端共享（真·市场）见 docs/backlog.md —— 本轮不做，但 id/remoteId 的形状留着。

const LS_KEY = "ideahub.promptSchemes";

/**
 * 本机记下的「服务端现在存着的那一版图位」（带 id），按方案 id 存 —— upsertMine 对齐图位 id 时先看它
 * （normalizeSlotIds 的 server，理由见它的 ★★ 服务端那一版）。
 * ★★ 为什么要落盘（复核第 5 轮）：发布之后本机改过、App 重启过，再在改过的那一格上传照片、点「已装 · 用它」（或删掉再装回来）——
 *   服务端那份是重启之前推上去的那一版，本机当前那份对不上，那一格的 id 对齐之后没有任何一套方案拿着，照片（可能是花钱出的 AI 图）
 *   从此够不着，零报错。第 4 轮的做法是只在内存里记「这一次会话里被换掉的旧版」，重启就没了，而照片可以是重启之后才传的。
 * ★ 什么时候写（**启动时一个字节都不落**，只在下面几个动作里写）：
 *   · 推上去成功之后（schemeMarket.shareScheme → noteServerSlots）：服务端那一行就是推上去的那一版；
 *   · 装回来之后（upsertMine → noteServerSlots）：回包就是服务端那一行；
 *   · 换掉 / 删掉本机一套、它还没有记录、又是发布过或装来的（seedServerSlots）：它是这个 App 更新之前推上去 / 装回来的，没来得及记，
 *     换掉之前这一版是对服务端那一行最好的猜测 —— 猜错了也只是 S 步内容对不上、退回按本机那份对齐（藏起来，不挪）。
 * ★ 删掉一套**不删**它的记录：删掉之后从市场装回来正需要它（服务端那一行还在，deleteScheme 没有调用方）。
 * ★ 最多记 SERVER_SLOTS_MAX 套、最久没写过的先出：一套 ≤ MAX_CARD_VIEWS 格短文本，但记多了会跟方案库本身抢 localStorage 配额 ——
 *   方案库的 persist 吞掉配额错误，挤满了就是「自建的方案下次打开就没了」。
 * ★ 内存里一份、localStorage 一份：写不进去（配额满）这一次会话照样认得出。懒读，声明在 `let mine = load()` 上面（下一段 ★★ 那条纪律）。
 */
const SERVER_SLOTS_KEY = "ideahub.promptSchemes.serverSlots";
/**
 * 最多记几套。★ 最坏情形量法：一套 ≤ 3 格（MAX_CARD_VIEWS），每格正文编辑屏限 400 字、服务端 zod 放到 600 字（装来的方案可以到 600），
 *   加上名字（≤ 24）、id（≤ 80）与 JSON 外壳约 60 字 ⇒ 一格约 760 字、64 套约 15 万字（按 UTF-16 约 300KB），占 localStorage 几 MB 配额的一小块。
 *   比这更多套方案先后发布 / 装过的设备，最早那几套的记录先出。
 */
const SERVER_SLOTS_MAX = 64;
let serverSlots: Map<string, SchemeSlot[]> | null = null;

/**
 * 这一次会话里删掉的方案、删掉那一刻本机那份图位（带 id），按方案 id 存 —— 删掉之后从市场装回来，upsertMine 拿它当 prev（**只在内存里**）。
 * ★★ 为什么（复核第 6 轮）：删掉再装回来原先 prev 是空的，只剩「服务端那一版」可认 —— 发布之后在编辑屏里删掉一格、再加一格同名的
 *   （编辑屏没有上移 / 下移，挪位置就是这么挪的），在新格子上传照片（可能是花钱出的 AI 图），再把整套删掉、从市场装回来：
 *   服务端那一版里没有新格子的 id，照片从此够不着；改动前按名字认，照片会回来。拿删掉那一刻的本机那份对齐，
 *   与不删直接「已装 · 用它」走的是同一条路（normalizeSlotIds 的 S 步让位、A、B、V）。
 * ★ 只在内存里就够：草稿照片（customCardStore.schemeShots）也只在内存里 —— 照片还在，传照片、删掉、装回来就一定在同一次会话里。
 *   不落盘，启动时也就不写；重启之后没有它，退回只认服务端那一版（那时也没有草稿照片要认）。
 * ★ 删掉就覆盖成那一刻的那一版；装回来之后本机又有了这一套，prev 从 mine 里取，这一份不再被读（下一次删掉会覆盖它）。
 */
const removedSlots = new Map<string, SchemeSlot[]>();

// ★★ `load()` 在这一行、模块初始化的那一刻就跑：它读到的任何东西都必须声明在这一行**上面**，或者在函数里现算
//   （builtinLineage 就是为此写成函数的）。在下面补一个 const 再让 load 去读 = TDZ → catch 返回 [] →
//   下一次 persist() 把用户整个方案库覆盖成空。
let mine: PromptScheme[] = load();
const listeners = new Set<() => void>();
let version = 0;

function load(): PromptScheme[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    // ★ 图位 id 读的时候现算、**不写回**：启动时一个字节都不落（真正的保存 / 安装才把 id 存进去）。
    //   派生是确定性的，老方案每次冷启动算出来都是同一组 id，不写回也不会换来换去。
    return Array.isArray(arr) ? arr.filter(isUsable).map((s) => ({ ...s, slots: withSlotIds(s.slots, "read") })) : [];
  } catch {
    // 存坏了就当没有：方案库丢了只是少几套自定义，不该让整个工坊打不开
    return [];
  }
}

/**
 * 一份方案能不能用。★ 从 localStorage / 将来从服务端读回来的都是**不可信输入**，
 * 形状不对就整份丢掉 —— 半份方案会在生成到一半时炸，而那时钱已经花了。
 * ★ 图位**没有 id 照样算能用**：老数据全是这样（id 由 load 里的 withSlotIds 现算），在这里要求 id 等于把老方案整份丢掉。
 */
function isUsable(s: unknown): s is RawScheme {
  const o = s as RawScheme;
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    Array.isArray(o.slots) &&
    o.slots.length > 0 &&
    o.slots.length <= MAX_CARD_VIEWS &&
    o.slots.every((x) => !!x && typeof x.tag === "string" && typeof x.prompt === "string")
  );
}

/** 「服务端那一版」的记录表（懒读；存坏了当没有 —— 只是少认回几格的 id，照片藏起来，不影响方案库） */
function serverSlotsTable(): Map<string, SchemeSlot[]> {
  if (serverSlots) return serverSlots;
  const table = new Map<string, SchemeSlot[]>();
  try {
    const raw = localStorage.getItem(SERVER_SLOTS_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      for (const e of arr) if (Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1])) table.set(e[0], e[1] as SchemeSlot[]);
    }
  } catch {
    /* 存坏了当没有 */
  }
  serverSlots = table;
  return table;
}

/** 这一套记下的服务端那一版（没有回 undefined）。★ 元素是读回来的不可信输入，形状由 normalizeSlotIds 判 */
function serverSlotsOf(id: string): SchemeSlot[] | undefined {
  return serverSlotsTable().get(id);
}

/**
 * 记下「服务端那一行现在存着这一版图位」（带 id）—— 推上去成功之后（schemeMarket.shareScheme）、装回来之后（upsertMine）调。
 * ★ 只存算 id 用得上的几位（id、名字、role、正文、ref、size、fromCrop），不带示例图之类（配额）。
 * ★ 同一套覆盖、挪到最新；超过 SERVER_SLOTS_MAX 套从最久没写过的删起。写 localStorage 失败只丢落盘那一份，内存里照样有。
 */
export function noteServerSlots(id: string, slots: readonly SchemeSlot[]): void {
  const table = serverSlotsTable();
  table.delete(id);
  table.set(
    id,
    slots.map((s) => ({
      id: s.id,
      tag: s.tag,
      role: s.role,
      prompt: s.prompt,
      ...(s.ref ? { ref: s.ref } : {}),
      ...(s.size ? { size: s.size } : {}),
      ...(s.fromCrop ? { fromCrop: true } : {}),
    })),
  );
  for (const k of table.keys()) {
    if (table.size <= SERVER_SLOTS_MAX) break;
    table.delete(k);
  }
  try {
    localStorage.setItem(SERVER_SLOTS_KEY, JSON.stringify([...table]));
  } catch {
    /* 配额满：这一次会话内存里那份照样认得出 */
  }
}

/**
 * 换掉 / 删掉本机某一套**之前**调：它还没有「服务端那一版」的记录、又是发布过或装来的，就把此刻这一版记上。
 * ★★ 为什么（复核第 5 轮）：这个 App 更新之前推上去 / 装回来的方案没有记录，而发布之后本机一改，服务端那一版就再也拿不到了 ——
 *   之后（哪怕隔了几次重启）在改过的那一格上传照片、再「已装 · 用它」/ 删掉再装回来，照片够不着。改之前这一版是最好的猜测：
 *   服务端那一行只在推上去 / 装回来时变，而这两件事从这一版起都会记。
 * ★★ 凡是**换掉某一套的图位、或把它从 mine 里拿掉**的地方都要先调它（saveScheme / removeScheme；upsertMine 直接记回包，不用猜），
 *   scripts/check-slot-ids.mjs 数着、并在真模块上跑「更新前发布过 → 改 → 重启 → 装回来」。只改 published / examples 的两处不换图位，不用调。
 * ★ 只记发布过（published 有值）或装来的（author 有值）：从来没推上去的本机方案装不回来（服务端没有这一行），记了只是占配额、
 *   还把删掉的方案留在设备上。⚠ 编辑屏存的时候不交这两位（saveScheme 之后就没了）—— 那时记录已经在第一次改的时候写下了。
 */
function seedServerSlots(old: PromptScheme | undefined): void {
  if (!old || serverSlotsTable().has(old.id)) return;
  if (old.published === undefined && old.author === undefined) return;
  noteServerSlots(old.id, old.slots);
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(mine));
  } catch {
    /* 配额满：方案库不是关键路径，丢了下次重建即可 */
  }
}

function emit() {
  version++;
  for (const fn of listeners) fn();
}

export function subscribeSchemes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function schemesVersion(): number {
  return version;
}

/**
 * 市场/选择器要显示的方案列表。
 * ★ 排序：**无脸方案优先**（产品决定，见 PromptScheme.faceless 的 ★★），其次内置，最后自定义。
 */
export function listSchemes(type?: CardType): PromptScheme[] {
  const all = [...BUILTIN_SCHEMES, ...mine];
  const fit = all.filter((s) => !type || !s.cardTypes?.length || s.cardTypes.includes(type));
  return fit.sort((a, b) => Number(!!b.faceless) - Number(!!a.faceless) || Number(!!b.builtin) - Number(!!a.builtin));
}

export function schemeOf(id: string | undefined): PromptScheme | undefined {
  if (!id) return undefined;
  return [...BUILTIN_SCHEMES, ...mine].find((s) => s.id === id);
}

/** 默认方案 = 全身立绘+面部特写（老名字「干净立绘」）。★ 唯一实现：别在调用点各写 `?? "scheme_clean"` */
export function defaultScheme(): PromptScheme {
  return BUILTIN_SCHEMES[0];
}

/**
 * 按"是不是真人素材、有没有做过肖像授权"给默认方案 —— **「无脸方案主推」这条产品规则的
 * 唯一实现**（设计文档 §B2 / backlog"三条合规真人路"：没有授权的真人素材，最不容易被拒的
 * 产出形态是无脸/背影，所以那时把它当默认；市场排序的无脸置顶在 listSchemes，是同一条规则
 * 的另一半）。
 *
 * ★★ `authorized` 这一档是 2026-09-01 补的，补之前这条规则**有两份相反的实现**：
 *   本函数对任何真人都回无脸，而 CustomCardPage 的「真人素材扫脸认证」那颗键手写了
 *   `find(s => s.builtin && !s.faceless)` 直接套 clean。两边各自都有道理，错的是这段注释
 *   还写着"唯一实现"——主人因此问过一次「为什么真人扫脸认证默认是全身立绘+面部特写」，
 *   而代码里根本找不到答案（真正的答案在另一处的一行注释里）。
 *   现在把**区别本身**写进签名：
 *     · 没授权（圈选提卡那条路）⇒ 无脸主推，画面里没有脸就绕开了肖像问题；
 *     · 已授权（asset:// 绑定）⇒ 合规靠**绑定**不靠无脸，用户要的正是正脸立绘，
 *       而无脸方案的图位（白模/三视图）根本放不下他刚授权的那张照片。
 * ★ 漏传 `authorized` 退回**更保守**的那一档（无脸）：新调用点忘了传，后果是主推得更谨慎，
 *   不是把没授权的正脸推出去。
 * ★ 只管**默认值**，不管强制：用户手动换成别的完全合法 —— 调用方要自己记「用户碰过没有」，
 *   别在勾选真人时把人家挑好的方案覆盖掉。
 * ★ 判否定兜底：无脸内置项万一被下掉，退回 defaultScheme() 而不是 undefined 崩掉调用方。
 */
export function defaultSchemeFor(o: { realPerson?: boolean; authorized?: boolean }): PromptScheme {
  if (o.realPerson && !o.authorized) return BUILTIN_SCHEMES.find((s) => s.faceless) ?? defaultScheme();
  return defaultScheme();
}

/**
 * 「这份方案能不能存 / 能不能用」—— **唯一实现**（编辑屏与 `saveScheme` 都问它）。
 * null = 没问题，否则是一句给用户看的整句原因（铁律八：说清为什么，别只把按钮变灰）。
 *
 * ★ 抄第二份的下场：编辑屏放行、`saveScheme` 拒（或反过来），用户点了保存什么都没发生。
 */
export function schemeIssue(d: { title?: string; slots?: SchemeSlot[] }): string | null {
  if (!d.title?.trim()) return t`先给这套方案起个名字`;
  const slots = d.slots ?? [];
  if (slots.length === 0) return t`至少要有一个图位——方案就是「从一张裁剪能炼出哪几张图」`;
  if (slots.length > MAX_CARD_VIEWS)
    return t`一张卡最多存 ${MAX_CARD_VIEWS} 张形象图（服务端也钉着这个数），把图位删到 ${MAX_CARD_VIEWS} 个以内`;
  for (let i = 0; i < slots.length; i++) {
    const x = slots[i];
    const tag = (x.tag || "").trim();
    if (!tag) return t`第 ${i + 1} 个图位还没起名字（这个名字会显示在卡片详情页上）`;
    // ★★ 超长不是"截短"，是服务端 zod 整发 400 ⇒ 这张卡发不上去且零报错（见 types.VIEW_TAG_MAX）
    if (tag.length > VIEW_TAG_MAX) return t`图位名「${tag}」超过 ${VIEW_TAG_MAX} 个字——太长的话这张卡会存不到服务器上`;
    if (isGenerated(x) && !(x.prompt || "").trim()) return t`图位「${tag}」要 AI 出图，但还没写提示词`;
  }
  // ★ 全是 display 的方案炼出来的卡，出片时一张形象图都进不了模型 —— AI 完全不认识
  //   这个角色，钱照花、画面里的人是编的。这不是"高级用法"，是必然的失望，所以硬拦。
  if (slots.every((x) => x.role === "display"))
    return t`至少要有一个图位不是「只展示」——全都只展示的话，出片时 AI 一张形象图都拿不到，画面里的人只能靠它自己编`;
  return null;
}

/**
 * 存一份用户自定义方案（新建或改）。返回落库那份
 * @param base 编辑屏**打开时**拷贝的那一版图位（改自己那套时传 source.slots；新建 / 另存为传 null）。
 *   ★★ 必填：漏了是零症状的 —— 编辑屏开着的时候本机那份被「已装 · 用它」换掉，只拿此刻存着的那一版核 role，
 *   编辑屏手里的 id 一个都核不上，名字、role 一起改了的格子留着原 id，照片以另一种 role 铸卡（复核第 3 轮，见 schemeSlotIds.editBefore）。
 *   ★ 只在「改自己那一套」（传进来的 id 就是落库的 id）时才用：另存为内置方案时传进来的 base 不算数，
 *   否则内置那几格会被当成「这一次删掉的格子」，另存副本里新加的「全身立绘」认不回 fullBody（与存量老方案、装来的同一套不一致）。
 */
export function saveScheme(s: Omit<PromptScheme, "id" | "builtin"> & { id?: string }, base: readonly SchemeSlot[] | null): PromptScheme {
  // ★ 存之前再问一次同一把尺：编辑屏可能被绕过（将来从服务端装一份方案回来也走这里），
  //   而一份半残的方案会在**生成到一半**时炸，那时钱已经花出去了。
  const issue = schemeIssue(s);
  if (issue) throw new Error(issue);
  const id = s.id && !s.id.startsWith("scheme_") ? s.id : uid("ps");
  const ownEdit = id === s.id;
  /** 本机此刻存着的同一套（改之前那一版；新建 / 另存为时没有） */
  const old = mine.find((x) => x.id === id);
  const next: PromptScheme = {
    ...s,
    id,
    builtin: false,
    createdAt: Date.now(),
    // ★ 编辑屏交来的图位本来就带 id（复制来的、freshSlotId 新建的），这里过一遍做三件事：
    //   ① 兜底：绕过编辑屏的调用方漏了 id 也不会存下一份没有身份的图位；
    //   ② **role 变了就换 id**：拿本机存着的同一套（改之前那一版）当 before，内置 id 另按内置表核 ——
    //      否则另存 / 改过的方案把「全身」那格改成「脸部」，那格 id 照旧，草稿里的全身照以脸部 role 铸进卡里、钱照扣；
    //      存过的新建 id 换成 role 变体，改回原 role 时换回原 id（那格的草稿照片跟着回来）；
    //   ③ **这一次新加的**格子起了内置原名（「全身立绘」+ 全身 role）就认回内置 id，与老方案、装来的同一套一致 ——
    //      存过的格子不再换，before 里有格子占着的内置 id 也不给（否则删掉 / 改掉一格，它的照片会出现在别的格子上）。
    //   规则都在 schemeSlotIds.normalizeSlotIds。before = 本机此刻存着的同一套 + 编辑屏打开时那一版（editBefore，理由见它）；
    //   另存 / 新建时 id 是新的，mine 里找不到、base 也不算数，before 为 null（内置 id 靠内置表核）。
    slots: withSlotIds(s.slots.slice(0, MAX_CARD_VIEWS), { before: editBefore(old?.slots, ownEdit ? base : null) }),
  };
  mine = [next, ...mine.filter((x) => x.id !== next.id)];
  persist();
  // ★ 发布过 / 装来的、还没有「服务端那一版」记录的，把改之前那一版（old，换掉之前取的）记上（seedServerSlots 的 ★★）。
  //   ★ 方案库先落盘、记录后写（复核第 6 轮）：配额只剩一点时先写记录，记录会占掉最后那点空间，persist 吞掉配额错误 ——
  //     这一次保存重启就没了。记录写不进去只丢落盘那一份（内存里照样有）
  seedServerSlots(old);
  emit();
  return next;
}

export function removeScheme(id: string): void {
  const old = mine.find((s) => s.id === id);
  // ★★ 删掉那一刻的本机那份记在内存里（removedSlots 的 ★★）：同一次会话里从市场装回来，upsertMine 拿它当 prev 对齐
  if (old) removedSlots.set(id, old.slots);
  mine = mine.filter((s) => s.id !== id);
  persist();
  // ★★ 同 saveScheme（seedServerSlots，方案库先落盘）：从市场装回来时 upsertMine 靠这份记录认回原 id（记录不跟着方案一起删；
  //   复核第 4 / 5 轮：没有它每一格派生新 id，草稿照片够不着）
  seedServerSlots(old);
  emit();
}

/**
 * 预览示例缩图的宽度上限。★ 200 是量出来的取舍：选方案那一行的缩略框约 40px 宽，
 * 2 倍屏下 80px 就够清楚；再大只是把 localStorage 吃掉（见 examples 的 ★★）。
 */
export const SCHEME_EXAMPLE_MAX_W = 200;
/** 一套方案最多存几张示例。★ 2 张够表达"产出长什么样"，再多是拿配额换边际信息 */
export const SCHEME_EXAMPLE_MAX = 2;

/**
 * 「这次的产出能不能当这套方案的示例图」—— **唯一实现**（design doc §B2 那条规则）。
 * null = 可以，否则是一句整句原因。
 *
 * ★★ 真人一律不行：示例图是**给所有人看的展示物**，把某个真实的人挂上去当"用这套
 *   做出来长这样"，既是我们替被拍者做了一个他没同意的展示，也正是 §B2 说的
 *   "平台用示例图展示真人产出"——那一步会把中立工具变成主动帮凶。
 * ★ 内置方案不行：它们是模块里的冻结常量，存不进去（存了也只活在内存里，
 *   刷新就没 —— 那是比"不给存"更糟的假承诺）。
 */
export function exampleIssue(o: { scheme: PromptScheme; realPerson?: boolean }): string | null {
  if (o.scheme.builtin) return t`内置方案不能改示例图——先「另存为我的」，再给自己那份存示例`;
  if (o.realPerson) return t`这张卡声明过是真实人物，不能拿它的产出当方案示例图（示例是给所有人看的）`;
  return null;
}

/**
 * 给一套自定义方案存示例图。★ 传进来的应当是**已经缩好**的图（调用方走 shrinkDataUrl）——
 * 这里不做缩放是因为它是纯数据层，拉 canvas 进来会让它没法在非浏览器环境跑测试。
 */
export function setSchemeExamples(id: string, examples: string[]): void {
  const i = mine.findIndex((s) => s.id === id);
  if (i < 0) return;
  mine = mine.map((s, k) => (k === i ? { ...s, examples: examples.slice(0, SCHEME_EXAMPLE_MAX) } : s));
  persist();
  emit();
}

/** 出图尺寸：方案没写就用卡面画布 */
export function slotSize(slot: SchemeSlot): string {
  return slot.size || CARD_SIZE;
}

/**
 * 铸卡时这一格存进 `CardView.tag` 的名字 —— **唯一规则**（自建卡页 mint 与 ai/portraitViews 的回包都调它）。
 * ★★ 内置方案的图位存**冻结的中文原名**（types.BUILTIN_SLOT_ZH，按 id 查），不存界面上显示的名字：卡与卡组快照在服务端
 *   一躺很久、给各种界面语言的人看；而英文名很容易超过服务端 24 字（VIEW_TAG_MAX，超了是整发 400，这张卡发不上去）。
 *   今天内置图位的 tag 本来就是这些中文，所以这一批存进去的值与改动前逐字相同。
 * ★ 自建方案存作者起的名字，trim 之后截到 VIEW_TAG_MAX（服务端同样先 trim 再 max(24)）。
 * ★ 按 `scheme.builtin` 分，不按「id 在不在内置表里」分：另存内置方案的副本也带着 fullBody 这类 id，
 *   而副本的作者可能把名字改了 —— 那格存的该是他改的名字。
 */
export function slotCardTag(scheme: Pick<PromptScheme, "builtin">, slot: SchemeSlot): string {
  return (scheme.builtin ? (builtinSlotZh(slot.id) ?? slot.tag) : slot.tag).trim().slice(0, VIEW_TAG_MAX);
}

// ── 给「市场」模块用的内部口子 ──────────────────────────────────────
//
// ★★ 市场层（data/schemeMarket.ts）**单独成模块**，而不是写在这里：它要问
//   `videos.remoteOn()`，而 videos → account → mock/ai → 本文件 —— 本文件再去 import
//   videos 就成了环，Vite 下会拿到**半初始化的模块**（实测报 "Cannot access 'listeners'
//   before initialization"）。CLAUDE.md 那条「两个 store 互相 import」是同一件事。
//   ⇒ 本文件保持**叶子**（只依赖 types 与零运行时依赖的 ./schemeSlotIds —— 后者一个 import 都没有，成不了环），
//   要联网的那半边放外面。
// ★ 订阅仍然只有一处（subscribeSchemes / schemesVersion）：市场层改完自己那份状态后
//   调 `emitSchemes()`，界面因此只需要订阅一个源。

/** 我自己的那些方案（市场层要读它来决定发布哪一套） */
export function mineSchemes(): PromptScheme[] {
  return mine;
}

/**
 * 落一份方案进本机库（装回来的、或推送后回写的）。★ 同 id 覆盖，不重复堆。返回**落库那一份**。
 * ★★ 图位 id 与本机旧那份对齐（normalizeSlotIds 的 prev）：服务端回来的方案没有 id（strip 掉了，apiToScheme 现算的
 *   不作数），「已装 · 用它」重装自己的方案时不对齐的话，草稿照片会对不上格子。对齐只认「名字 + role（正文也相同的先挑）」与
 *   「同位置 + role + 正文」，对不上的格子拿新 id —— 那格的草稿照片藏起来，绝不挪到别的格子上、也绝不跟到另一种 role 上
 *   （理由见 normalizeSlotIds 的 ★★）。从本机那份认来的 id 原样用，不再换成内置 id（normalizeSlotIds 的 ★★ 存下来的 id）。
 * ★★ 先认本机记下的「服务端那一版」（serverSlotsOf，normalizeSlotIds 的 S 步）：服务端那份是本机某个过去的版本，本机之后改过、
 *   或者删掉又装回来，只看当前那份就对不上，照片够不着（复核第 4、5 轮）。
 * ★★ 本机没有这一套时（删掉之后装回来），prev 用这一次会话里删掉那一刻的那一版（removedSlots，复核第 6 轮），也没有就给空数组 ——
 *   照样对齐，不当成读。
 * ★★ 回包就是服务端那一行：落库的同时记成新的「服务端那一版」（noteServerSlots）。★ 方案库先落盘、记录后写（理由同 saveScheme）。
 */
export function upsertMine(s: PromptScheme): PromptScheme {
  const prev = mine.find((x) => x.id === s.id)?.slots ?? removedSlots.get(s.id) ?? [];
  const next: PromptScheme = {
    ...s,
    slots: normalizeSlotIds(s.slots, { builtins: builtinLineage(), prev, server: serverSlotsOf(s.id) }).slots,
  };
  mine = [next, ...mine.filter((x) => x.id !== next.id)];
  persist();
  noteServerSlots(next.id, next.slots);
  emit();
  return next;
}

/**
 * 就地改一份本机方案的某几位（例如回写 published）。找不到就静默 —— 清理路径不该吵
 * ★ 不收 `id` / `slots`：换图位只能走 saveScheme / upsertMine，那两处才会给图位定 id。
 */
export function patchMine(id: string, patch: Partial<Omit<PromptScheme, "id" | "slots">>): void {
  const i = mine.findIndex((x) => x.id === id);
  if (i < 0) return;
  mine = mine.map((x, k) => (k === i ? { ...x, ...patch } : x));
  persist();
  emit();
}

/** 让界面重渲染（市场层改了自己那份状态时调）。订阅源仍然只有这一个 */
export function emitSchemes(): void {
  emit();
}
