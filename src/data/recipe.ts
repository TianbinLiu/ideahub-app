// 「公开配方」（制作过程）的形状与**白名单投影** —— 纯函数，零 store 依赖。
//
// 作者选择公开时，别人能在作品页点「查看制作过程」看这条片是怎么做出来的，并按它复制一条流水线到自己的草稿里
// 接着做（方案全文：docs/template-workflow-research.md §三 C；主人 2026-10-02 拍板默认公开、发布前过一屏预览）。
//
// ★★ 公开的**不是**回炉用的那份画布（data/projects 的 CanvasSnapshot）：画布里有用户的原话、没选中的方案、
//   圈选标注、出片日志、真人卡、上传的参考视频 —— 不能原样给别人。这里从画布出一份**白名单投影**：
//   只有下面 WorkflowRecipe 里点了名的字段出得去，其余一律不带。服务端用同一份形状的严格 schema 再验一遍
//   （server `schemas/branchRecipe.schemas.js`，逐字段相等 —— 加字段要三处一起动：这里的类型、这里的投影、那边的 schema）。
//
// ★★ 脱敏（方案 §C5，这几条是红线，服务端按作者的卡库再核一遍）：
//   · 真人卡 → **空位**，连名字都不带（那是一个真实的人；真人卡本来就不许上广场）；
//   · 从别人那儿装来的卡 → 空位，带名字（转发件不许再分享，名字留着方便使用者自己去广场找）；
//   · 卡上的 3D 模型 / 生成提示词（卡主私有）→ 不带，与作品卡组快照同一条口径；
//   · 上传的参考视频 / 中间帧、导演台、圈选 → 不带，只在那一段上留一个记号（flags），故事板据此说一句；
//   · 白模段的点名句（「最左边=凛…」）→ 不带：里面是原作挂的卡名（可能就是真人卡的名字），
//     而复制的人挂自己的卡时本来就要重新合成这一句。
//
// ★ 段模板**只回指、不带快照**：出片时服务端只认已登记的模板视频地址（方舟 r2v 那道闸），快照里的地址对应的
//   模板一旦没了，带过去也出不了片。复制时现去取那条模板，取不到那一段就退成普通段并说明。
//
// ★ 依赖方向：本文件属 data 层，只引 economy（价目）、refMentions（点名的认法，零依赖）与 types。画布节点当 `unknown` 读（与 projects / drafts 同一种写法）——
//   FlowNode 的类型在 store 层，这里不能引；所以每一格都自己验形状，读不出来的当没有。
import { r2vTokens, segTokens, tierOf } from "./economy";
import { dropMention, usableExtraRefs, type ExtraRef } from "./refMentions";
import type { CardType, CardView, ShotSpec, VideoAspect } from "../types";

/** 随配方带走的一张卡（字段与作品卡组快照同一批） */
export interface RecipeCard {
  cardId: string;
  type: CardType;
  name: string;
  summary: string;
  cover: string;
  tags: string[];
  idLine: string;
  textDesc: string;
  startFrames?: Partial<Record<VideoAspect, string>>;
  views: CardView[];
}

/** 空位为什么空着：real = 真人卡；foreign = 从别人那儿装来的卡；private = 没能随配方带上的卡 */
export type RecipeSlotWhy = "real" | "foreign" | "private";

/** 「要使用者自己填的位子」 */
export interface RecipeSlot {
  type: CardType;
  why: RecipeSlotWhy;
  /** real 恒为空串 */
  name: string;
}

export type RecipeNodeKind = "classic" | "blockout" | "custom";
/**
 * 原作这一段还用过、但没有随配方带走的东西（故事板据此说一句）。
 * ★ `mid-frames` 自 2026-10-03（N1）起的含义是「作者另给过自己的参考图」：中间帧**或**临时参考图（FlowNode.extraRefs）。
 *   没有另开一个记号：服务端那份 schema 的枚举是写死的，新记号要先上服务端再发 App，而这两样对看配方的人是同一句话。
 */
export type RecipeNodeFlag = "ref-video" | "mid-frames" | "stage" | "anns" | "revised";

export interface RecipeTplRef {
  /** 服务端模板 id（24 位十六进制） */
  id: string;
  title: string;
  /** 分段模板组里的第几段（从 0 起）/ 一共几段 */
  part?: { index: number; count: number };
}

export interface RecipeNode {
  title: string;
  plot: string;
  shot?: ShotSpec;
  durationSec: number;
  /** 档位 id 与当时那一档底下的模型 id（档位的模型会换代，所以两样都记） */
  tier: string;
  model?: string;
  aspect: VideoAspect;
  chain: boolean;
  kind: RecipeNodeKind;
  /** 这一段挂了哪几张卡（deck 里的 cardId）与哪几个空位（cast 的下标） */
  cards: string[];
  slots: number[];
  tpl?: RecipeTplRef;
  flags: RecipeNodeFlag[];
  /** 起止画面：只给人看，复制时不带进流水线 */
  preview?: { first?: string; last?: string };
}

export interface WorkflowRecipe {
  v: 1;
  mode: "workflow" | "simple";
  nodes: RecipeNode[];
  deck: RecipeCard[];
  cast: RecipeSlot[];
}

// ── 上限：与 server `schemas/branchRecipe.schemas.js` 逐个相等（超了那边是整发 400，不是截断）──
export const RECIPE_MAX_NODES = 24;
export const RECIPE_MAX_CARDS = 60;
export const RECIPE_MAX_SLOTS = 30;
const NODE_MAX_CARDS = 30;

const CARD_TYPES: readonly CardType[] = ["character", "scene", "background", "prop", "style"];
const VIEW_KINDS = ["face", "body", "detail"] as const;
const VIEW_ROLES = ["face", "primary", "aux", "display"] as const;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 别人的设备取得到的地址：http(s)，且不是方舟的临时链接（约 24 小时过期）。与 projects 的不变量同一条判据 */
function isPublicUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v) && !/\.(volces|volccdn)\.com\//i.test(v) && v.length <= 2000;
}

export interface ProjectRecipeOpts {
  /**
   * 预览用：把本机地址（dataURL / idb:）的画面也留着。**只许给界面画预览时传真** ——
   * 发布页那一屏「别人会看到这些」是在画布瘦身之前画的，那时帧还是本机地址；真正上行的那一份一律不传。
   */
  allowLocal?: boolean;
  /** 本机模板 id → 服务端模板 id（认不出来回 null）。data/templates 开机时登记；不给 = 只认快照自带的 */
  templateRemoteId?: (localId: string) => string | null;
}

export type RecipeIssue = "empty" | "too-many-nodes";

/** 模板 id 的解析器（data/templates 开机时登记自己的那份）。放在这里是为了让本文件不必引 templates —— 那边引的东西多，容易绕成环 */
let tplResolver: ((localId: string) => string | null) | null = null;
export function registerTemplateResolver(fn: (localId: string) => string | null): void {
  tplResolver = fn;
}

const HEX24 = /^[a-f0-9]{24}$/i;

/**
 * 画布 → 公开配方。**唯一实现**：发布页的预览、发布后真正上行的那一份、编辑页给存量作品补公开，走的都是它。
 *
 * @returns 配方；画不出来时回原因代码（空画布 / 段数超过上限），由调用方说成人话。
 */
export function projectRecipe(canvas: unknown, opts: ProjectRecipeOpts = {}): WorkflowRecipe | RecipeIssue {
  const flow = rec(rec(canvas)?.flow);
  const nodes = arr(flow?.nodes)
    .map(rec)
    .filter((n): n is Rec => !!n);
  if (!flow || nodes.length === 0) return "empty";
  if (nodes.length > RECIPE_MAX_NODES) return "too-many-nodes";

  const url = (v: unknown): string => {
    if (isPublicUrl(v)) return v;
    if (opts.allowLocal && typeof v === "string" && /^(data:[a-z]+\/|idb:)/i.test(v)) return v;
    return "";
  };
  const resolveTpl = opts.templateRemoteId ?? tplResolver;

  const deck: RecipeCard[] = [];
  const deckIds = new Set<string>();
  const cast: RecipeSlot[] = [];
  /** 同一张卡在几段里都用到，只占一个空位（「一次选角，全片生效」靠的就是它） */
  const slotOf = new Map<string, number>();

  const slotFor = (key: string, slot: RecipeSlot): number | null => {
    const hit = slotOf.get(key);
    if (hit !== undefined) return hit;
    if (cast.length >= RECIPE_MAX_SLOTS) return null;
    cast.push(slot);
    slotOf.set(key, cast.length - 1);
    return cast.length - 1;
  };

  const out: RecipeNode[] = nodes.map((n) => {
    const proposals = arr(n.proposals)
      .map(rec)
      .filter((p): p is Rec => !!p);
    const chosen = proposals.find((p) => p.id === n.chosenId) ?? proposals[0] ?? {};
    // 「这一段用哪个模板」是三态（flowStore.tplOfNode 的规矩）：undefined = 没表过态，退回整条流水线那一份；null = 明确没有
    const tpl = rec(n.tpl !== undefined ? n.tpl : flow.template);
    const blockout = !!rec(tpl?.refVideo);
    const custom = n.custom === true;
    const kind: RecipeNodeKind = blockout ? "blockout" : custom ? "custom" : "classic";
    const tier = str(n.videoTier, 80) || "std";

    const cards: string[] = [];
    const slots: number[] = [];
    for (const raw of arr(n.materials)) {
      const c = rec(raw);
      const id = str(c?.id, 120);
      const type = CARD_TYPES.find((t) => t === c?.type);
      if (!c || !id || !type) continue;
      const name = str(c.name, 120);
      // ── 红线：真人卡 / 装来的卡 → 空位（见文件头）──
      if (c.realPerson === true) {
        const i = slotFor(id, { type, why: "real", name: "" });
        if (i !== null && !slots.includes(i)) slots.push(i);
        continue;
      }
      if (c.fromOthers === true) {
        const i = slotFor(id, { type, why: "foreign", name });
        if (i !== null && !slots.includes(i)) slots.push(i);
        continue;
      }
      if (!deckIds.has(id)) {
        if (deck.length >= RECIPE_MAX_CARDS) {
          // 卡太多带不完：超出的那几张也变成空位（带名字），别悄悄丢掉
          const i = slotFor(id, { type, why: "private", name });
          if (i !== null && !slots.includes(i)) slots.push(i);
          continue;
        }
        deck.push(cardOf(c, id, type, name, url));
        deckIds.add(id);
      }
      if (cards.length < NODE_MAX_CARDS && !cards.includes(id)) cards.push(id);
    }

    const flags: RecipeNodeFlag[] = [];
    const customRef = rec(n.customRef);
    if (customRef && typeof customRef.url === "string" && customRef.url) flags.push("ref-video");
    // 临时参考图（N1）是作者自己的图，不随配方带走：只留记号，句子里的 `@名字` 退成普通文字（复制的人那边没有这张图可点）
    const extras = usableExtraRefs(arr(n.extraRefs) as ExtraRef[]);
    if (arr(customRef?.mids).length > 0 || extras.length > 0) flags.push("mid-frames");
    if (rec(n.stage)) flags.push("stage");
    if (arr(n.anns).length > 0) flags.push("anns");
    if (typeof chosen.prevVideoUrl === "string" && chosen.prevVideoUrl) flags.push("revised");

    const shot = shotOf(chosen.shot);
    const first = url(chosen.poster) || url(chosen.firstFrame);
    const last = url(chosen.lastFrame);
    const tplRef = blockout && tpl ? tplRefOf(tpl, resolveTpl) : null;
    const dur = Number(chosen.durationSec);

    return {
      title: str(chosen.title, 200),
      // 白模段不带点名句（见文件头）
      plot: blockout ? "" : extras.reduce((s, x) => dropMention(s, x.name), str(chosen.plot, 8000)),
      ...(shot ? { shot } : {}),
      durationSec: Number.isFinite(dur) ? Math.min(60, Math.max(1, dur)) : 5,
      tier,
      model: tierOf(tier).id === tier ? tierOf(tier).model : undefined,
      aspect: n.aspect === "portrait" ? "portrait" : "landscape",
      chain: n.chain === true,
      kind,
      cards,
      slots,
      ...(tplRef ? { tpl: tplRef } : {}),
      flags,
      ...(first || last ? { preview: { ...(first ? { first } : {}), ...(last ? { last } : {}) } } : {}),
    };
  });

  return { v: 1, mode: flow.mode === "simple" ? "simple" : "workflow", nodes: out, deck, cast };
}

function shotOf(raw: unknown): ShotSpec | null {
  const s = rec(raw);
  if (!s) return null;
  const size = str(s.size, 40);
  const camera = str(s.camera, 40);
  const beat = str(s.beat, 200);
  if (!size && !camera && !beat) return null;
  return { ...(size ? { size } : {}), ...(camera ? { camera } : {}), ...(beat ? { beat } : {}) };
}

function cardOf(c: Rec, id: string, type: CardType, name: string, url: (v: unknown) => string): RecipeCard {
  const views: CardView[] = [];
  for (const raw of arr(c.views)) {
    const v = rec(raw);
    const u = url(v?.url);
    if (!v || !u || views.length >= 3) continue;
    const kind = VIEW_KINDS.find((k) => k === v.kind) ?? "detail";
    const role = VIEW_ROLES.find((r) => r === v.role);
    const tag = str(v.tag, 24);
    const note = str(v.note, 200);
    views.push({ url: u, kind, ...(role ? { role } : {}), ...(tag ? { tag } : {}), ...(note ? { note } : {}) } as CardView);
  }
  const sf = rec(c.startFrames);
  const portrait = url(sf?.portrait);
  const landscape = url(sf?.landscape);
  return {
    cardId: id,
    type,
    name,
    summary: str(c.summary, 2000),
    cover: url(c.cover),
    tags: arr(c.tags)
      .map((t) => str(t, 40))
      .filter(Boolean)
      .slice(0, 12),
    idLine: str(c.idLine, 200),
    textDesc: str(c.textDesc, 200),
    ...(portrait || landscape ? { startFrames: { ...(portrait ? { portrait } : {}), ...(landscape ? { landscape } : {}) } } : {}),
    views,
  };
}

function tplRefOf(tpl: Rec, resolve: ((localId: string) => string | null) | null): RecipeTplRef | null {
  const local = str(tpl.id, 120);
  const snap = str(tpl.remoteId, 64);
  const id = HEX24.test(snap) ? snap : HEX24.test(local) ? local : ((local && resolve?.(local)) || "");
  if (!HEX24.test(id)) return null;
  const g = rec(tpl.group);
  const index = Number(g?.index);
  const count = Number(g?.count);
  const part = g && Number.isInteger(index) && Number.isInteger(count) && count > 1 && index >= 0 && index < count ? { index, count } : undefined;
  return { id, title: str(tpl.title, 120), ...(part ? { part } : {}) };
}

// ── 读回来的配方：形状检查 ─────────────────────────────────────────

/**
 * 服务端回来的配方 → 我们认得的形状；认不出来回 null。
 * ★ 服务端存的是它自己验过的那份，这里再读一遍不是不信它，是**不信"这台服务器回的就是配方"**：
 *   真机上未命中路径回的是 200 + 首页的 HTML（CLAUDE.md 那条坑），老服务端 / 代理出错时回的可能是任何东西。
 */
export function readRecipe(raw: unknown): WorkflowRecipe | null {
  const r = rec(raw);
  if (!r || r.v !== 1 || !Array.isArray(r.nodes) || r.nodes.length === 0) return null;
  const deck: RecipeCard[] = [];
  const url = (v: unknown): string => (isPublicUrl(v) ? v : "");
  for (const raw2 of arr(r.deck)) {
    const c = rec(raw2);
    const id = str(c?.cardId, 120);
    const type = CARD_TYPES.find((t) => t === c?.type);
    if (!c || !id || !type) continue;
    deck.push(cardOf(c, id, type, str(c.name, 120), url));
  }
  const ids = new Set(deck.map((c) => c.cardId));
  const cast: RecipeSlot[] = [];
  for (const raw2 of arr(r.cast)) {
    const s = rec(raw2);
    const type = CARD_TYPES.find((t) => t === s?.type);
    const why = (["real", "foreign", "private"] as const).find((w) => w === s?.why);
    if (!s || !type || !why) return null; // 空位的下标被段引用着，丢一个后面的全错位 —— 整份不认
    cast.push({ type, why, name: why === "real" ? "" : str(s.name, 120) });
  }
  const nodes: RecipeNode[] = [];
  for (const raw2 of r.nodes) {
    const n = rec(raw2);
    if (!n) return null;
    const kind = (["classic", "blockout", "custom"] as const).find((k) => k === n.kind);
    const tier = str(n.tier, 80);
    const dur = Number(n.durationSec);
    if (!kind || !tier || !Number.isFinite(dur)) return null;
    const shot = shotOf(n.shot);
    const tplRaw = rec(n.tpl);
    const tplId = str(tplRaw?.id, 64);
    const part = rec(tplRaw?.part);
    const pv = rec(n.preview);
    const first = url(pv?.first);
    const last = url(pv?.last);
    nodes.push({
      title: str(n.title, 200),
      plot: str(n.plot, 8000),
      ...(shot ? { shot } : {}),
      durationSec: Math.min(60, Math.max(1, dur)),
      tier,
      ...(str(n.model, 80) ? { model: str(n.model, 80) } : {}),
      aspect: n.aspect === "portrait" ? "portrait" : "landscape",
      chain: n.chain === true,
      kind,
      cards: arr(n.cards)
        .map((x) => str(x, 120))
        .filter((x) => ids.has(x)),
      slots: arr(n.slots)
        .map((x) => Number(x))
        .filter((x) => Number.isInteger(x) && x >= 0 && x < cast.length),
      ...(tplRaw && HEX24.test(tplId)
        ? {
            tpl: {
              id: tplId,
              title: str(tplRaw.title, 120),
              ...(part && Number.isInteger(Number(part.index)) && Number.isInteger(Number(part.count))
                ? { part: { index: Number(part.index), count: Number(part.count) } }
                : {}),
            },
          }
        : {}),
      flags: arr(n.flags).filter((f): f is RecipeNodeFlag =>
        (["ref-video", "mid-frames", "stage", "anns", "revised"] as const).some((k) => k === f),
      ),
      ...(first || last ? { preview: { ...(first ? { first } : {}), ...(last ? { last } : {}) } } : {}),
    });
  }
  return { v: 1, mode: r.mode === "simple" ? "simple" : "workflow", nodes, deck, cast };
}

// ── 摘要与估价 ───────────────────────────────────────────────────

export interface RecipeSummary {
  segs: number;
  totalSec: number;
  /** 用到的档位 id（去重，按出现顺序） */
  tiers: string[];
  aspect: VideoAspect | "mixed";
  cards: number;
  slots: number;
  /** 用了段模板的段数 */
  templated: number;
}

export function recipeSummary(r: WorkflowRecipe): RecipeSummary {
  const tiers: string[] = [];
  for (const n of r.nodes) if (!tiers.includes(n.tier)) tiers.push(n.tier);
  const aspects = new Set(r.nodes.map((n) => n.aspect));
  return {
    segs: r.nodes.length,
    totalSec: Math.round(r.nodes.reduce((s, n) => s + n.durationSec, 0)),
    tiers,
    aspect: aspects.size === 1 ? r.nodes[0].aspect : "mixed",
    cards: r.deck.length,
    slots: r.cast.length,
    templated: r.nodes.filter((n) => n.kind === "blockout").length,
  };
}

/**
 * 照原样把每一段炼出来，**视频那一半**大约要多少 token（按今天的价目）。null = 有一段报不出价（那一档没有这种出片的价目）。
 * ★ 取自算真扣的那两条式子（economy.segTokens / r2vTokens），不另算一遍；白模段的输入时长就是那一段登记的模板时长
 *   （套模板时写进 durationSec 的正是它）。
 * ★ 只是视频那一半：推演方案、画设定帧、圈选改图按各人的做法另算，所以界面上要写「约」「不含画面与推演」。
 */
export function recipeVideoCost(r: WorkflowRecipe): number | null {
  let sum = 0;
  for (const n of r.nodes) {
    const t = n.kind === "blockout" ? r2vTokens(Math.round(n.durationSec), n.tier) : segTokens(n.durationSec, n.tier);
    if (t === null) return null;
    sum += t;
  }
  return sum;
}
