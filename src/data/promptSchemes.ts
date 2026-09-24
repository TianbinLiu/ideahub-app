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
//   ② **合成规格图（三视图 / 分栏设定稿）的默认 role**：2026-09-23 起是 `aux`（进管线，排最后），
//      此前是 `display`（永不进模型）。改的依据是**我们自己付费实测的**那一次 A/B
//      （8 发 hd 出片 ¥20.84，同素材同剧情，A=面部+全身、B=A+规格稿、C=A+三视图）：方舟指南那句
//      「多视图素材……模型易将其识别为多个不同主体，反而加剧 ID 漂移」在本仓的送法下**一次都没复现**
//      —— 没出现多个人、没画出分栏/网格/文字标注/人台头，近景的身份贴合与只送两张时同水平。
//      ⚠ 测的是**带着那句说明**送（绑定句里的 CHAR_AUX_CLAUSE：「同一个人的不同角度排版，不是多个人」），
//        删了那句结论就不算数了。
//      ⚠ 实测到的真效应是**另一件事**：多送的那张一旦与主图不一致，模型听多送的那张
//        （C 组转身那发照着三视图画了深色短裤，而主图是白衬衫裙）。所以这一格的取舍要交给作者 ——
//        卡片页上每张图都能改「出片用 / 仅展示」（data/cardViews.setCardViewRole）。
//   ③ **图位数 ≤ MAX_CARD_VIEWS**：那个 3 是跨仓的（server 的 zod 也钉着），
//      多出来的存不下，存不下就是"方案说出 5 张、卡上只有 3 张"，零报错。
//
// ★ 与模板市场的关系：形状刻意照着 `data/templates.ts`（mine/shared/remoteId），
//   将来接服务端共享时是同一套搬法。本轮只做**本机方案库 + 内置方案**，
//   远端共享见 docs/backlog.md。
import {
  BUILTIN_SLOT_ZH,
  CARD_SIZE,
  CardRole,
  CardType,
  MAX_CARD_VIEWS,
  VIEW_TAG_MAX,
  builtinSlotLabel,
  builtinSlotZh,
  uid,
  type BuiltinSlotId,
} from "../types";
import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { splitByOwner } from "./ownerSplit";

/** 这一格的参考图从哪张裁剪来 */
export type SchemeRef = "body" | "face";

export interface SchemeSlot {
  /**
   * 内置图位的 id —— **只有内置方案的图位带它**（BUILTIN_SCHEMES 里逐格写 `builtinSlot("x", { … })`，tag 是按 id 现翻的 getter）。
   * 这一格的身份键与铸卡写进 CardView.tag 的值按它取（slotKey / slotCardTag，理由见 types.BUILTIN_SLOT_ZH）；
   * 用户方案没有 id（另存为时 SchemeEditorSheet 去掉它），按 tag 认。
   * ★ **它不上线**：内置方案不发服务端，另存为的副本已经把它去掉，就算带上服务端的 z.object 也会 strip ——
   *   所以 `api/schemes.ts` 文件头那条「图位加字段要四处一起加」**不适用于这一位**（那句「六个字段一个不少」
   *   数的是上线的那几位）。
   */
  id?: BuiltinSlotId;
  /**
   * 界面上显示的名字。用户方案的图位按它认格子、原样进 CardView.tag；内置方案走 id（见上），它的 tag 是**读时取值的 getter**
   * （builtinSlot：types.builtinSlotLabel 按当前界面语言翻），`{ ...slot }` 一展开就定格成当时那种语言的字符串。
   * ★ ≤24 字：server 的 CARD_VIEW_TAG_MAX 跨仓镜像（内置图位的英文名也守这条：另存为后它原样成为用户方案的图位名）
   */
  tag: string;
  /** 出片管线里干什么（进 CardView.role）。合成规格图默认 aux（2026-09-23 放开，见文件头 ★★★②）；作者可在卡片页逐张改 */
  role: CardRole;
  /**
   * 这一格的提示词**正文**。风格那句由 `slotPrompt` 统一拼，作者写不了也删不掉（★★★①）。
   * 支持 `{{主体}}` 占位符 —— 自传图做卡片那页插的是用户填的那句描述，圈选提取那边插的是卡名
   * （2026-09-18 起不再插简介：简介常带着动作、手里的东西、地点，见 ai/cardScope）。
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
  /**
   * 这套自定义方案是**谁的**（user.id）。2026-09-18 起本机方案库按账号分开（见下面「本机方案库」那段）。
   * ★ 内置方案没有它；升级前存的自定义方案也没有，由升级后第一个登录的人认领。
   */
  owner?: string;
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

/** 内置方案里带 id 的那一格 → 冻结的中文原名；其余（用户方案、id 不认得）回 undefined。slotKey 与 slotCardTag 共用这一个判据 */
function builtinNameOf(scheme: Pick<PromptScheme, "builtin">, slot: SchemeSlot): string | undefined {
  return scheme.builtin && slot.id ? builtinSlotZh(slot.id) : undefined;
}

/**
 * 一格图位的**身份键** —— 唯一实现。自建卡页的草稿照片（customCardStore.schemeShots）、选图 / 圈选改图 / 报错落在哪一格、
 * portraitViews 画回来的图放进哪一格，全按它认。
 *
 * ★★ 内置方案取冻结的中文原名（types.BUILTIN_SLOT_ZH，**为什么冻结写在那里**），**不取 slot.tag** —— 那是显示名，随界面语言变
 *   （builtinSlot 的 getter）。中文界面下原名与 tag 逐字相同，所以对存量草稿是零变化。用户方案照旧是 slot.tag（原样，不 trim、
 *   不截断）：它只有这一个名字。
 * ★ `scheme` 传**这一格所属的那套**：换方案时，新方案的格子拿新方案算、当前画着的格子拿当前方案算。
 *   传错了今天看不出来（两边算出来都是 tag），翻译上线之后才对不上 —— 门禁（scripts/check-slot-ids.mjs）只扫固定的几种
 *   「拿 tag 当键」的写法，**看不出传的是哪一套方案**；今天这几处调用点是靠等价测试（PR 里那份无头渲染）核过的，改调用点时自己对一遍。
 * ★★ 而且要传**原样**那一套：`builtin` 是可选位（`builtin?: boolean`），**重建一个对象字面量**（或者经一个
 *   「只挑几位出来」的小映射函数）就会把它漏掉 —— tsc 一个字不说、门禁也看不出来（传的确实是一套方案），
 *   而少了它内置图位的键与 CardView.tag 会整批退回显示名：翻译上线那天，付了钱的图落在页面根本不读的键上、
 *   卡片里存进一个外文名（还可能超过服务端 24 字）。要改就写成 `{ ...那套方案, … }`。
 *   （同族前车之鉴：CLAUDE.md「以"只渲染不落库"为由，给同一个映射抄第二份」那一格 —— 重建形状必漏字段。）
 */
export function slotKey(scheme: Pick<PromptScheme, "builtin">, slot: SchemeSlot): string {
  return builtinNameOf(scheme, slot) ?? slot.tag;
}

/**
 * 一格图位铸卡时**写进 CardView.tag 的值**。今天与 slotKey 算出来的相同，分开写是因为两者回答的是两件事：
 * slotKey 认格子（只活在本机草稿里），这个是存进卡片、跟着卡组快照在服务端一躺很久的数据。
 * ★ 内置方案写冻结的中文原名（理由见 types.BUILTIN_SLOT_ZH ②），用户方案原样写 slot.tag（与此前逐字相同）。
 *   详情页上怎么显示是显示那一层的事。
 * ★ 第一个参数与 slotKey 同一条讲究（传原样那一套、别重建对象）—— 见上面那段 ★★。
 */
export function slotCardTag(scheme: Pick<PromptScheme, "builtin">, slot: SchemeSlot): string {
  return builtinNameOf(scheme, slot) ?? slot.tag;
}

/**
 * 方案名 / 简介的长度上限 —— **跨仓镜像**：server `schemas/promptScheme.schemas.js` 的 `title.max(40)` / `intro.max(120)`。
 * ★ 那边是 zod `.max()`，超了是发布那一发**整发 400**、不是截断。schemeIssue 不查这两条（本机方案随便多长都能存、能用），
 *   只在发布前问一次（schemePublishIssue）：英文界面下另存内置方案，副本带的是英文名与英文简介（比中文长），
 *   内置那几套的英文按这两个数定过（名字 ≤34 + 「 copy」，简介 ≤120），将来换译文超了也在这儿被拦成一句人话。
 */
export const SCHEME_TITLE_MAX = 40;
export const SCHEME_INTRO_MAX = 120;
/**
 * 一格图位提示词的长度上限 —— **跨仓镜像**：server `schemas/promptScheme.schemas.js` 的 `SLOT_PROMPT_MAX = 600`（同样是整发 400、不截断）。
 * ★ 2026-09-17 从 400 放到 600（主人：围绕出片的精细度定）：这一格画得准不准，直接决定出片时那张形象参考图像不像；
 *   而上限按**字符**数，英文写同样的内容要两三倍的字符（400 个字符只够 60 来个英文词）。市面上的做法也是给足 + 计数：
 *   可灵 2,500、海螺 2,000、Runway 1,000 个字符。再往上要先动服务端那个 600。
 */
export const SCHEME_SLOT_PROMPT_MAX = 600;
/**
 * Seedream 官方对提示词长度的建议：不超过 **300 个汉字或 600 个英文单词**，再长信息会分散、模型可能顾不上细节
 * （方舟 Seedream 4.0 文档）。600 个字符装不下 600 个英文词，所以只有「汉字为主」的提示词才会走到这条提醒。
 */
export const SLOT_PROMPT_SOFT_HAN = 300;

/** 「这份方案能不能发到市场」—— 只查服务端会拒的长度；null = 没问题，否则一句整句原因。下架不问它 */
export function schemePublishIssue(s: Pick<PromptScheme, "title" | "intro">): string | null {
  if ((s.title || "").trim().length > SCHEME_TITLE_MAX) return t`方案名超过 ${SCHEME_TITLE_MAX} 个字符，服务器会拒收——先把名字改短再发布`;
  if ((s.intro || "").trim().length > SCHEME_INTRO_MAX) return t`简介超过 ${SCHEME_INTRO_MAX} 个字符，服务器会拒收——先把简介改短再发布`;
  return null;
}

/**
 * 内置方案的一格图位。★ tag 是**读时取值的 getter**：按 id 经 types.builtinSlotLabel 翻成当前界面语言（目录里没有就退回冻结原名）。
 *   不能写成 `tag: builtinSlotLabel(id)` —— 那是模块加载时算一次，而 App 切语言不重载（src/i18n/switch.ts），算一次就冻结在开机语言。
 *   身份键与铸卡写进 CardView.tag 的值仍按 id 取冻结原名（slotKey / slotCardTag），与这个 getter 无关。
 * ★ `...rest` 写在 getter **前面**（与 builtinScheme 同序）：rest 里要是混进一个 tag，后写的 getter 盖掉它；反过来写，
 *   那个 tag 会把 getter 盖成定格的字符串 —— 对象字面量里写 tag 会被 tsc 拦，`{ ...X }` 展开进来的 tsc 不查（多余属性检查不看展开），
 *   门禁 (b) 拒绝 builtinSlot 对象里的展开写法、并实跑「rest 带 tag 时 getter 仍在」，这里的顺序是第二道。
 */
function builtinSlot(id: BuiltinSlotId, rest: Omit<SchemeSlot, "id" | "tag">): SchemeSlot {
  return {
    ...rest,
    id,
    get tag() {
      return builtinSlotLabel(id) ?? BUILTIN_SLOT_ZH[id];
    },
  };
}

/** 一套内置方案：名字与简介是 msg 描述符，同样读到时现翻（getter，理由同 builtinSlot；`...rest` 同样在 getter 前面）。其余位原样 */
function builtinScheme(title: MessageDescriptor, intro: MessageDescriptor, rest: Omit<PromptScheme, "title" | "intro">): PromptScheme {
  return {
    ...rest,
    get title() {
      return i18n._(title);
    },
    get intro() {
      return i18n._(intro);
    },
  };
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
//   方案的名字、简介与图位的显示名是界面文案，都是 msg 描述符、经 getter 读到时现翻（builtinScheme / builtinSlot），
//   不能跟着一起冻结。
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

// ★ 图位一律写成 `builtinSlot("x", { role, prompt, … })`（2026-09-11 多语言 PR2 加 id、PR3 翻译显示名）：
//   id 定这一格的身份键与铸卡写进 CardView.tag 的值（冻结的中文原名，见 slotKey / slotCardTag），
//   tag 由 builtinSlot 给成按 id 现翻的 getter（types.builtinSlotLabel），别在这里写 tag。
//   方案本身写成 `builtinScheme(msg 名字, msg 简介, { id, builtin: true, examples, slots })`：名字与简介同样是读时取值的 getter。
//   msgid 就是此前写死的中文，所以中文界面上每个字都与改动前一样；英文（与给译者的长度提示）在 src/locales/en.po。
//   ★★ 这些 getter 一展开就定格：SchemeEditorSheet 另存为时 `{ ...slot }`，副本带的是**当时界面语言**的名字、没有 id，
//      从此按自己的名字认（用户方案）—— 英文界面下另存出来的就是一套英文方案，这是接受的（副本本来就是用户自己的东西）。
//   scripts/check-slot-ids.mjs (b) 核这两种写法（id 在表里、同一套不重复、表里的 id 都有人用、共用 id 是同一格、builtin: true；
//   两种对象里都**不许 `...x` 展开** —— 展开能把定格的 tag / title 绕过 tsc 的多余属性检查与门禁带进来；本文件要从 ../types 引
//   builtinSlotLabel、从 @lingui/core 引 i18n，本地另抄一份的话门禁替身看不出、而它永远不翻），
//   并把 builtinSlot / builtinScheme 抠出来实跑：显示名换成英文后键仍是冻结原名、tag / title / intro 是读时取值而不是定格的。
export const BUILTIN_SCHEMES: readonly PromptScheme[] = [
  builtinScheme(
    // ★ 2026-08-28 由「干净立绘（默认）」改名：主人点名标题直接说产出物
    msg({ message: "全身立绘+面部特写", comment: "内置提示词方案的名字：≤34 个字符（另存为会接上「 copy」，服务端方案名上限 40）" }),
    msg({
      message: "白底全身立绘 + 面部特写两张，出片管线真正会吃的就是这两张。原片截图留作对照。",
      comment: "内置方案的一句话简介：≤120 个字符（服务端上限，另存为后原样带进用户方案）",
    }),
    {
      id: "scheme_clean",
      builtin: true,
      examples: ["/schemes/clean.webp"],
      slots: [
        builtinSlot("fullBody", { role: "primary", prompt: FULL_BODY_PROMPT }),
        builtinSlot("faceCloseup", { role: "face", ref: "face", prompt: FACE_PROMPT }),
        // ★ 原片裁剪降级保留：AI 立绘再像也是重画的，出片对不上时它是唯一的对照物。
        //   不计费（fromCrop），也不进模型（display）。
        builtinSlot("sourceCrop", { role: "display", prompt: "", fromCrop: true }),
      ],
    },
  ),
  builtinScheme(
    msg({ message: "无面部白模三视图", comment: "内置提示词方案的名字：≤34 个字符（另存为会接上「 copy」，服务端方案名上限 40）" }),
    msg({
      message: "人脸与服装分离：出一张无面部的白模三视图（只锁服装/体型/比例）+ 一张服装细节图。不复刻长相，适合只想借动作与穿着的素材。",
      comment: "内置方案的一句话简介：≤120 个字符（服务端上限，另存为后原样带进用户方案）",
    }),
    {
      id: "scheme_faceless",
      builtin: true,
      faceless: true,
      examples: ["/schemes/faceless.webp"],
      slots: [
        // ★★ 这一格是主图（进管线的还有下面那格服装细节 —— 2026-09-18 订正，原来这里写的是「唯一能进管线的」）：
        //   它锁的是服装与体型，而画面里没有脸 —— 既是这套方案的卖点，也正好避开"多视图当人物参考"那条（它本来就不锁身份）。
        builtinSlot("mannequinBody", { role: "primary", prompt: MANNEQUIN_BODY_PROMPT }),
        builtinSlot("outfitDetail", { role: "aux", prompt: OUTFIT_DETAIL_PROMPT }),
        // ★ 三视图 2026-09-23 起默认进管线（aux，排在上面两格之后；实测依据见文件头 ★★★②）。
        //   不想让它进模型的作者在卡片页把它改成「仅展示」即可。
        builtinSlot("mannequinTurnaround", { role: "aux", prompt: TURNAROUND_PROMPT }),
      ],
    },
  ),
  builtinScheme(
    msg({ message: "角色设定规格图", comment: "内置提示词方案的名字：≤34 个字符（另存为会接上「 copy」，服务端方案名上限 40）" }),
    msg({
      message: "一张分栏设定稿（素描线稿 + 色板 + 服装细节），外加面部特写与全身立绘。规格稿默认也进出片，可在卡片页改回只展示。",
      comment: "内置方案的一句话简介：≤120 个字符（服务端上限，另存为后原样带进用户方案）",
    }),
    {
      id: "scheme_specsheet",
      builtin: true,
      examples: ["/schemes/specsheet.webp"],
      slots: [
        builtinSlot("faceCloseup", { role: "face", ref: "face", prompt: FACE_PROMPT }),
        builtinSlot("fullBody", { role: "primary", prompt: FULL_BODY_PROMPT }),
        // ★ 规格稿同三视图：2026-09-23 起默认 aux（文件头 ★★★②），作者可在卡片页改回「仅展示」
        builtinSlot("specSheet", { role: "aux", prompt: SPEC_SHEET_PROMPT }),
      ],
    },
  ),
];

// ── 本机方案库（用户自定义 + 内置）─────────────────────────────────
//
// ★ 形状照 data/templates.ts 的 mine：localStorage 存用户那份，内置的恒在。
//   远端共享（真·市场）见 docs/backlog.md —— 本轮不做，但 id/remoteId 的形状留着。

const LS_KEY = "ideahub.promptSchemes";

// ★★ 按账号分开（2026-09-18 主人真机点名同一台手机换账号后数据串号）：原来整台设备一份，B 能改、能删 A 的方案，
//   能把 A 的方案（连示例图）以 **B 的名义**发到市场。现在 `mine` 只装现在这个人的，别人的躺在 `others` 里
//   （从不显示，落盘时并回去），分区只经 ownerSplit.splitByOwner。
// ★★ 「现在是谁」**注入**进来（bindSchemesOwner，由 data/deviceOwner 装载时调）：本文件必须保持叶子
//   （见下面「给市场模块用的内部口子」那段 ★★：account → mock/ai → 本文件），import deviceOwner 就绕成了环。
//   注入之前（极早期）一律当作没人登录：mine 为空、新写的记成无主。
interface SchemesOwnerSource {
  /** 现在给谁看 */
  viewer: () => string;
  /** 内存里这摊活是谁的（新写的记在谁名下） */
  work: () => string;
  /** 现在这个人能不能认领升级前的无主存量（deviceOwner.mayClaimLegacy） */
  claim: () => boolean;
}
let ownerSrc: SchemesOwnerSource = { viewer: () => "", work: () => "", claim: () => false };

let mine: PromptScheme[] = [];
let others: PromptScheme[] = [];
const listeners = new Set<() => void>();
let version = 0;
partition(load());

function partition(all: PromptScheme[]): void {
  const split = splitByOwner(all, ownerSrc.viewer(), ownerSrc.claim());
  mine = split.mine;
  others = split.others;
  if (split.claimed) persist();
}

/** data/deviceOwner 装载时调一次：接上「现在是谁」与换人通知（理由见上面 ★★） */
export function bindSchemesOwner(src: SchemesOwnerSource, onViewerChange: (fn: () => void) => void): void {
  ownerSrc = src;
  partition([...mine, ...others]);
  onViewerChange(() => {
    partition([...mine, ...others]);
    emit();
  });
}

/** 新写进来的一套记在「内存里这摊活的主人」名下；不是现在这个人的就进暗格 */
function place(s: PromptScheme): void {
  const owner = s.owner || ownerSrc.work() || undefined;
  const item = owner === s.owner ? s : { ...s, owner };
  if (owner && owner !== ownerSrc.viewer()) others = [item, ...others.filter((x) => x.id !== item.id)];
  else mine = [item, ...mine.filter((x) => x.id !== item.id)];
}

function load(): PromptScheme[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isUsable) : [];
  } catch {
    // 存坏了就当没有：方案库丢了只是少几套自定义，不该让整个工坊打不开
    return [];
  }
}

/**
 * 一份方案能不能用。★ 从 localStorage / 将来从服务端读回来的都是**不可信输入**，
 * 形状不对就整份丢掉 —— 半份方案会在生成到一半时炸，而那时钱已经花了。
 */
function isUsable(s: unknown): s is PromptScheme {
  const o = s as PromptScheme;
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

function persist() {
  try {
    // ★ 别人的那几套一起写回：只写 mine 就是一次存方案把别的账号的方案整批抹掉
    localStorage.setItem(LS_KEY, JSON.stringify([...mine, ...others]));
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

/** 存一份用户自定义方案（新建或改）。返回落库那份 */
export function saveScheme(s: Omit<PromptScheme, "id" | "builtin"> & { id?: string }): PromptScheme {
  // ★ 存之前再问一次同一把尺：编辑屏可能被绕过（将来从服务端装一份方案回来也走这里），
  //   而一份半残的方案会在**生成到一半**时炸，那时钱已经花出去了。
  const issue = schemeIssue(s);
  if (issue) throw new Error(issue);
  const next: PromptScheme = {
    ...s,
    id: s.id && !s.id.startsWith("scheme_") ? s.id : uid("ps"),
    builtin: false,
    createdAt: Date.now(),
    slots: s.slots.slice(0, MAX_CARD_VIEWS),
  };
  place(next);
  persist();
  emit();
  return next;
}

export function removeScheme(id: string): void {
  mine = mine.filter((s) => s.id !== id);
  persist();
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

// ── 给「市场」模块用的内部口子 ──────────────────────────────────────
//
// ★★ 市场层（data/schemeMarket.ts）**单独成模块**，而不是写在这里：它要问
//   `videos.remoteOn()`，而 videos → account → mock/ai → 本文件 —— 本文件再去 import
//   videos 就成了环，Vite 下会拿到**半初始化的模块**（实测报 "Cannot access 'listeners'
//   before initialization"）。CLAUDE.md 那条「两个 store 互相 import」是同一件事。
//   ⇒ 本文件保持**叶子**（只依赖 types），要联网的那半边放外面。
// ★ 订阅仍然只有一处（subscribeSchemes / schemesVersion）：市场层改完自己那份状态后
//   调 `emitSchemes()`，界面因此只需要订阅一个源。

/** 我自己的那些方案（市场层要读它来决定发布哪一套） */
export function mineSchemes(): PromptScheme[] {
  return mine;
}

/** 落一份方案进本机库（装回来的、或推送后回写的）。★ 同 id 覆盖，不重复堆 */
export function upsertMine(s: PromptScheme): void {
  place(s);
  persist();
  emit();
}

/** 就地改一份本机方案的某几位（例如回写 published）。找不到就静默 —— 清理路径不该吵 */
export function patchMine(id: string, patch: Partial<PromptScheme>): void {
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
