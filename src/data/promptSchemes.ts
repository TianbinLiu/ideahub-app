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
//   ② **合成规格图一律 `role:"display"`**：方舟提示词指南原文「多视图素材包含同一人物的
//      不同角度，模型易将其识别为多个不同主体，反而加剧 ID 漂移」。三视图/分栏设定稿
//      对人极有用、对模型有害 —— 让它进管线是**主动把画面变差**，还要为它收出片的钱。
//   ③ **图位数 ≤ MAX_CARD_VIEWS**：那个 3 是跨仓的（server 的 zod 也钉着），
//      多出来的存不下，存不下就是"方案说出 5 张、卡上只有 3 张"，零报错。
//
// ★ 与模板市场的关系：形状刻意照着 `data/templates.ts`（mine/shared/remoteId），
//   将来接服务端共享时是同一套搬法。本轮只做**本机方案库 + 内置方案**，
//   远端共享见 docs/backlog.md。
import { CARD_SIZE, CardRole, CardType, MAX_CARD_VIEWS, VIEW_TAG_MAX, uid } from "../types";

/** 这一格的参考图从哪张裁剪来 */
export type SchemeRef = "body" | "face";

export interface SchemeSlot {
  /** 界面上的花名（进 CardView.tag）。★ ≤24 字：server 的 CARD_VIEW_TAG_MAX 跨仓镜像 */
  tag: string;
  /** 出片管线里干什么（进 CardView.role）。合成规格图必须 display，见文件头 ★★★② */
  role: CardRole;
  /**
   * 这一格的提示词**正文**。风格那句由 `slotPrompt` 统一拼，作者写不了也删不掉（★★★①）。
   * 支持 `{{主体}}` 占位符 —— 用户在命名屏填的那个 tag/描述会插进来。
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
 * 风格那句 —— **全仓唯一一处**，拼在每个图位的提示词前面（文件头 ★★★①）。
 * 方案作者的正文接在它后面，改不了也删不掉。
 */
const STYLE_CLAUSE =
  "严格保持参考图的画风（照片则照片级写实，插画则同风格插画）与人物相貌、发型、服装、神态完全一致";

/** 占位符：用户在命名屏写的那句描述插进这里 */
const SUBJECT_TOKEN = /\{\{\s*主体\s*\}\}/g;

/**
 * 一个图位的**最终提示词**。唯一实现 —— 调用点不许自己拼（拼第二份就等于给了作者
 * 覆盖风格那句的口子，而那正是"真人被动漫化"的复发路径）。
 */
export function slotPrompt(slot: SchemeSlot, subject?: string): string {
  const body = slot.prompt.replace(SUBJECT_TOKEN, (subject || "").trim());
  return `${body}；${STYLE_CLAUSE}`;
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

export const BUILTIN_SCHEMES: readonly PromptScheme[] = [
  {
    id: "scheme_clean",
    title: "干净立绘（默认）",
    intro: "白底全身立绘 + 面部特写两张，出片管线真正会吃的就是这两张。原片截图留作对照。",
    builtin: true,
    slots: [
      {
        tag: "全身立绘",
        role: "primary",
        prompt: "参考图中人物的全身立绘：纯白色背景，无任何背景元素与文字；全身完整可见，站姿自然",
      },
      {
        tag: "面部特写",
        role: "face",
        ref: "face",
        prompt: "参考图中人物的面部特写肖像：纯白色背景，无任何背景元素与文字；头肩构图，五官清晰",
      },
      // ★ 原片裁剪降级保留：AI 立绘再像也是重画的，出片对不上时它是唯一的对照物。
      //   不计费（fromCrop），也不进模型（display）。
      { tag: "原片截图", role: "display", prompt: "", fromCrop: true },
    ],
  },
  {
    id: "scheme_faceless",
    title: "无面部白模三视图",
    intro:
      "人脸与服装分离：出一张无面部的白模三视图（只锁服装/体型/比例）+ 一张服装细节图。不复刻长相，适合只想借动作与穿着的素材。",
    builtin: true,
    faceless: true,
    slots: [
      {
        // ★★ 这一格是**唯一**能进管线的：它锁的是服装与体型，而画面里没有脸 ——
        //   既是这套方案的卖点，也正好避开"多视图当人物参考"那条（它本来就不锁身份）。
        tag: "白模全身",
        role: "primary",
        prompt:
          "参考图中人物的全身，头部替换为无面部特征的纯白色人台模型（mannequin head, blank face），" +
          "身体比例写实，服装完整穿着在人台上、面料质感写实；纯白色背景，无任何背景元素与文字",
      },
      {
        tag: "服装细节",
        role: "aux",
        prompt:
          "参考图中人物服装的局部细节特写：领口结构、面料与版型、下装轮廓；" +
          "纯白色背景，无任何背景元素与文字，不出现人脸",
      },
      {
        // 三视图是给人看的规格图 —— 必须 display（文件头 ★★★②）
        tag: "白模三视图",
        role: "display",
        prompt:
          "同一角色的标准站姿三视图横向并排：正面全身、侧面全身、背面全身；" +
          "头部均为无面部特征的纯白色人台模型，服装完整穿着，浅灰白底加等距网格辅助线，专业服装设计稿风格",
      },
    ],
  },
  {
    id: "scheme_specsheet",
    title: "角色设定规格图",
    intro: "一张分栏设定稿（素描线稿 + 色板 + 服装细节），外加一张能出片的面部特写。规格稿只作展示。",
    builtin: true,
    slots: [
      {
        tag: "面部特写",
        role: "face",
        ref: "face",
        prompt: "参考图中人物的面部特写肖像：纯白色背景，无任何背景元素与文字；头肩构图，五官清晰",
      },
      {
        tag: "全身立绘",
        role: "primary",
        prompt: "参考图中人物的全身立绘：纯白色背景，无任何背景元素与文字；全身完整可见，站姿自然",
      },
      {
        tag: "设定规格稿",
        role: "display",
        prompt:
          "专业角色设计规格说明图（Character Design Spec Sheet），浅灰白色背景与网格辅助线：" +
          "左栏为角色头部铅笔素描线稿（正面 + 侧面 45°两图并排，精细面部结构线条，无上色）；" +
          "中栏为色彩参考色板横排（发色、眼色、肤色、服装主色与配色）；" +
          "右栏为服装局部细节特写三图。整体冷色调专业设计感排版",
      },
    ],
  },
];

// ── 本机方案库（用户自定义 + 内置）─────────────────────────────────
//
// ★ 形状照 data/templates.ts 的 mine：localStorage 存用户那份，内置的恒在。
//   远端共享（真·市场）见 docs/backlog.md —— 本轮不做，但 id/remoteId 的形状留着。

const LS_KEY = "ideahub.promptSchemes";

let mine: PromptScheme[] = load();
const listeners = new Set<() => void>();
let version = 0;

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

/** 默认方案 = 干净立绘（老行为）。★ 唯一实现：别在调用点各写一遍 `?? "scheme_clean"` */
export function defaultScheme(): PromptScheme {
  return BUILTIN_SCHEMES[0];
}

/**
 * 「这份方案能不能存 / 能不能用」—— **唯一实现**（编辑屏与 `saveScheme` 都问它）。
 * null = 没问题，否则是一句给用户看的整句原因（铁律八：说清为什么，别只把按钮变灰）。
 *
 * ★ 抄第二份的下场：编辑屏放行、`saveScheme` 拒（或反过来），用户点了保存什么都没发生。
 */
export function schemeIssue(d: { title?: string; slots?: SchemeSlot[] }): string | null {
  if (!d.title?.trim()) return "先给这套方案起个名字";
  const slots = d.slots ?? [];
  if (slots.length === 0) return "至少要有一个图位——方案就是「从一张裁剪能炼出哪几张图」";
  if (slots.length > MAX_CARD_VIEWS)
    return `一张卡最多存 ${MAX_CARD_VIEWS} 张形象图（服务端也钉着这个数），把图位删到 ${MAX_CARD_VIEWS} 个以内`;
  for (let i = 0; i < slots.length; i++) {
    const x = slots[i];
    const tag = (x.tag || "").trim();
    if (!tag) return `第 ${i + 1} 个图位还没起名字（这个名字会显示在卡片详情页上）`;
    // ★★ 超长不是"截短"，是服务端 zod 整发 400 ⇒ 这张卡发不上去且零报错（见 types.VIEW_TAG_MAX）
    if (tag.length > VIEW_TAG_MAX) return `图位名「${tag}」超过 ${VIEW_TAG_MAX} 个字——太长的话这张卡会存不到服务器上`;
    if (isGenerated(x) && !(x.prompt || "").trim()) return `图位「${tag}」要 AI 出图，但还没写提示词`;
  }
  // ★ 全是 display 的方案炼出来的卡，出片时一张形象图都进不了模型 —— AI 完全不认识
  //   这个角色，钱照花、画面里的人是编的。这不是"高级用法"，是必然的失望，所以硬拦。
  if (slots.every((x) => x.role === "display"))
    return "至少要有一个图位不是「只展示」——全都只展示的话，出片时 AI 一张形象图都拿不到，画面里的人只能靠它自己编";
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
  mine = [next, ...mine.filter((x) => x.id !== next.id)];
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
  if (o.scheme.builtin) return "内置方案不能改示例图——先「另存为我的」，再给自己那份存示例";
  if (o.realPerson) return "这张卡声明过是真实人物，不能拿它的产出当方案示例图（示例是给所有人看的）";
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
  mine = [s, ...mine.filter((x) => x.id !== s.id)];
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
