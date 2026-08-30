// mock AI 管线：卡片生成 / 市场检索 / 三方案推演。
// 接口形状按未来 server 端点设计（异步 + 延迟），换成真实 AI 时仅需替换实现。
import { Card, CardRole, CardType, Proposal, VideoAspect, uid } from "../types";
import { makeCover, makeFrame } from "./frames";
import { makeRng, pick } from "./rng";
// ★ mock 也读**同一张**图位表：它只用来告诉用户"这一档本该画几张"，而那句话一旦
//   与真实管线分叉，就成了演示模式里一句谁也验不了的假话（铁律五）。
import { slotsFor } from "../data/economy";
// 图位要不要调模型只有 promptSchemes.isGenerated 一处判据 —— 演示模式也走它，
// 否则"哪几格算生成型"会有第二份答案，而它正是报价的输入。
import { isGenerated, type PromptScheme } from "../data/promptSchemes";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms + Math.random() * 400));

// ── 市场种子卡（模拟社区最热卡片） ─────────────────────────────
const MARKET_DEFS: Array<{ type: CardType; name: string; summary: string; hot: number; tags: string[] }> = [
  { type: "character", name: "赛博侦探·凛", summary: "霓虹雨夜中行走的义体侦探，左眼是全息扫描仪，习惯在案发现场点一支电子烟。", hot: 12842, tags: ["赛博朋克", "侦探"] },
  { type: "character", name: "剑修·白无衣", summary: "青城山下拾剑十年的白衣剑修，剑出无声，斩的是心魔。", hot: 11207, tags: ["古风", "武侠"] },
  { type: "character", name: "废土信使小满", summary: "背着比自己还高的邮包穿越辐射区的少女，坚信每封信都值得抵达。", hot: 9530, tags: ["废土", "治愈"] },
  { type: "character", name: "AI 管家 T-7", summary: "一丝不苟的老式管家机器人，关节会漏气，说话像上世纪的电台播音员。", hot: 8114, tags: ["科幻", "幽默"] },
  { type: "character", name: "食堂阿姨·铁勺王", summary: "手抖界的反叛者——打菜从不手抖，江湖人称铁勺王。", hot: 7642, tags: ["搞笑", "日常"] },
  { type: "scene", name: "雨夜霓虹街", summary: "永远在下雨的九龙城寨式街道，招牌层层叠叠，积水倒映着整座城市。", hot: 13511, tags: ["赛博朋克", "夜景"] },
  { type: "scene", name: "云海剑冢", summary: "万剑插土、云海翻涌的古战场，每一柄锈剑都埋着一个名字。", hot: 10099, tags: ["古风", "史诗"] },
  { type: "scene", name: "废土集市", summary: "由报废飞船残骸搭成的黑市，什么都卖，包括昨天的天气预报。", hot: 8867, tags: ["废土", "市集"] },
  { type: "scene", name: "深海观测站", summary: "一万米深处的孤独观测站，舷窗外偶尔游过发光的未知生物。", hot: 7208, tags: ["科幻", "悬疑"] },
  { type: "scene", name: "老式绿皮车厢", summary: "摇晃的绿皮火车穿过九十年代的麦田，车窗上有一层薄薄的灰。", hot: 6931, tags: ["怀旧", "旅途"] },
  { type: "background", name: "黄昏金", summary: "整体笼罩在落日熔金的暖色氛围里，逆光轮廓带柔和光晕。", hot: 9312, tags: ["氛围", "暖色"] },
  { type: "background", name: "雨幕青", summary: "冷青色调的连绵雨幕，高光锐利，阴影里泛着蓝。", hot: 8455, tags: ["氛围", "冷色"] },
  { type: "background", name: "星野紫", summary: "银河横贯天幕的深紫夜空，地景压暗，星光作主光源。", hot: 7770, tags: ["氛围", "夜空"] },
  { type: "prop", name: "会说谎的罗盘", summary: "永远指向持有者最不想去的方向，但从未错过真正的宝藏。", hot: 6520, tags: ["奇幻", "道具"] },
  { type: "prop", name: "老式拍立得", summary: "拍出的照片会比现实晚三秒——有时能拍到即将发生的事。", hot: 6118, tags: ["悬疑", "道具"] },
  { type: "style", name: "水墨留白", summary: "大写意水墨风，浓淡干湿之间大量留白，运镜如卷轴展开。", hot: 10240, tags: ["国风", "艺术"] },
  { type: "style", name: "胶片颗粒", summary: "35mm 胶片质感，轻微漏光与颗粒噪点，色彩微微偏绿。", hot: 8090, tags: ["复古", "质感"] },
  { type: "style", name: "像素梦境", summary: "16-bit 像素风渲染，霓虹调色板，运动帧率刻意降到 12fps。", hot: 7333, tags: ["像素", "游戏"] },
];

/**
 * 市场卡按主题成套。素材卡是拿来配着用的——单张「雨幕青」没什么意思，
 * 「侦探 + 雨夜街 + 雨幕青 + 拍立得」才是一条能直接开拍的线。
 * 工坊的卡组广场与新账号的初始卡组都读这张表（见 data/account.ts）。
 */
export const MARKET_DECKS: Array<{ id: string; name: string; intro: string; cards: string[] }> = [
  {
    id: "mktdeck_rain",
    name: "雨夜霓虹",
    intro: "赛博雨夜的一整套：义体侦探、永雨长街、冷青调子，外加一台会拍到未来的相机。",
    cards: ["赛博侦探·凛", "雨夜霓虹街", "雨幕青", "老式拍立得"],
  },
  {
    id: "mktdeck_sword",
    name: "云海剑冢",
    intro: "白衣剑修与万剑埋骨之地，配大写意水墨——开拍即是一卷徐徐展开的国风短片。",
    cards: ["剑修·白无衣", "云海剑冢", "水墨留白"],
  },
  {
    id: "mktdeck_waste",
    name: "废土信使",
    intro: "橘色邮包穿过辐射区，落日熔金，罗盘永远指着最不想去的方向。治愈向废土。",
    cards: ["废土信使小满", "废土集市", "黄昏金", "会说谎的罗盘"],
  },
  {
    id: "mktdeck_deep",
    name: "深海孤站",
    intro: "一万米深处的老式管家与舷窗外的未知生物，星野紫压着整片画面。悬疑科幻。",
    cards: ["AI 管家 T-7", "深海观测站", "星野紫"],
  },
  {
    id: "mktdeck_retro",
    name: "绿皮车厢",
    intro: "九十年代的麦田与摇晃的车厢，胶片颗粒，食堂阿姨也在这趟车上。怀旧日常。",
    cards: ["老式绿皮车厢", "胶片颗粒", "食堂阿姨·铁勺王"],
  },
];

let marketCache: Card[] | null = null;

function marketAll(): Card[] {
  if (!marketCache) {
    marketCache = MARKET_DEFS.map((d, i) => ({
      id: `mkt_${i}`,
      type: d.type,
      name: d.name,
      summary: d.summary,
      hot: d.hot,
      tags: d.tags,
      // 真实卡面（Seedream 出，见 design/gen-market-cards.mjs）。
      // ★ 文件名按【下标】绑定，所以**绝不要往 MARKET_DEFS 中间插卡**——
      //   插一张，它后面每张卡的图都会错位一格（图是剑修、字是侦探）。
      //   要加卡就往数组末尾追加，然后只跑新增的那几张。
      cover: `/cards/market/mkt_${i}.webp`,
    }));
  }
  return marketCache;
}

/** 按名字取市场卡（卡组表里存的是名字，比下标经得起改动） */
export function marketCardsByName(names: string[]): Card[] {
  const all = marketAll();
  return names.map((n) => all.find((c) => c.name === n)).filter((c): c is Card => !!c);
}

/** 市场检索：空词 → 最热；有词 → 名称/简介/标签模糊匹配 */
/**
 * 演示模式的「按方案炼形象图」：不出网，按方案的图位数回同样多张假图。
 * ★ 形状必须与 real 那份**逐字段一致**（含 role/tag）：形状不一致的话，演示模式下
 *   走通的流程在真实模式里会在落卡那一步才炸，而那时钱已经花了。
 */
export async function portraitViews(o: {
  scheme: PromptScheme;
  bodyCrop: string;
  faceCrop?: string | null;
  subject?: string;
  onProgress?: (s: string) => void;
}): Promise<{ role: CardRole; tag: string; dataUrl: string }[]> {
  const out: { role: CardRole; tag: string; dataUrl: string }[] = [];
  for (let i = 0; i < o.scheme.slots.length; i++) {
    const slot = o.scheme.slots[i];
    if (!isGenerated(slot)) {
      out.push({ role: slot.role, tag: slot.tag, dataUrl: slot.ref === "face" && o.faceCrop ? o.faceCrop : o.bodyCrop });
      continue;
    }
    o.onProgress?.(`绘制${slot.tag}…（${i + 1}/${o.scheme.slots.length}·演示）`);
    await new Promise((r) => setTimeout(r, 300));
    out.push({ role: slot.role, tag: slot.tag, dataUrl: makeCover(`portrait:${slot.role}:${i}`, slot.tag) });
  }
  return out;
}

/** 演示模式的「融图」：不出网，回一张假帧（形状与 real 一致） */
export async function fuseFrame(o: {
  sources: string[];
  instruction: string;
  aspect: VideoAspect;
  onProgress?: (s: string) => void;
}): Promise<string> {
  o.onProgress?.(`融合 ${o.sources.length} 张参考图…（演示）`);
  await new Promise((r) => setTimeout(r, 400));
  return makeFrame(`fuse:${o.instruction}`, o.aspect);
}

export async function searchMarket(query: string): Promise<Card[]> {
  // 市场卡目前是本地静态种子，不再假装有网络延迟——
  // 500ms 的 delay 会让「搜索中…」在纯本地数据上闪一下，是白白制造的等待感。
  // 等接了真实社区接口，延迟自然会回来。
  const all = marketAll();
  const q = query.trim();
  const list = q
    ? all.filter((c) => c.name.includes(q) || c.summary.includes(q) || (c.tags ?? []).some((t) => t.includes(q)))
    : all;
  // 不再 slice(0, 8)：8 是"一屏摆得下几张"的旧口径，把另外 10 张种子卡直接扔了。
  // 现在桌面分页展示（见 layout.MARKET.perPage），取全量交给 UI 翻页。
  return [...list].sort((a, b) => (b.hot ?? 0) - (a.hot ?? 0));
}

// ── 素材 → 卡片 ───────────────────────────────────────────────
export interface MaterialFile {
  name: string;
  /** 图片文件的 dataURL（作为真实卡面） */
  dataUrl: string | null;
  /** 文本文件的内容片段 */
  text: string | null;
}

function matchType(hint: string): CardType | null {
  if (/人物|角色|主角|char|hero|少女|少年|侦探|机器人/i.test(hint)) return "character";
  if (/场景|地图|scene|街|城|站|海|山|市|房间/i.test(hint)) return "scene";
  if (/背景|氛围|天空|光|色调|bg/i.test(hint)) return "background";
  if (/道具|物品|武器|prop|item/i.test(hint)) return "prop";
  if (/风格|画风|style|水墨|像素|胶片/i.test(hint)) return "style";
  return null;
}

/** 类型推断优先级：文件名 > 文件内容 > 补充说明 */
function inferType(fileName: string, text: string | null, note: string, isImage: boolean): CardType {
  for (const h of [fileName, text ?? "", note]) {
    const t = matchType(h);
    if (t) return t;
  }
  return isImage ? "character" : "scene";
}

function stemOf(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem.length > 12 ? stem.slice(0, 12) : stem || "神秘素材";
}

/** NPC 铸卡：本地文件 + 补充说明 → 若干张卡（mock：图片用原图作卡面）。
 *  forcedType 是用户在素材窗第一步选定的卡种——给了就不再猜。类型猜错是
 *  最常见的重炼理由（"白裙少女"被当成场景），把选择权交回用户比调正则实在。
 *
 *  返回 `{ cards, minted, notes }` 与真实实现同形（ai/index.ts 靠这个签名做真假切换）。
 *  ★ `minted` 恒为全 0：mock 一张图都没真画过，卡面要么是用户自己的原图、要么是
 *    本地画的占位图。报一个非零数就是**凭空造出一笔账** —— 结算读的正是这个数组
 *    （data/economy.forgeSettle），写 1 就等于在演示模式里扣真钱。
 *  ★ `tierId` 在这里**确实没用上**（没有出图这回事），所以必须**说出来**：
 *    用户在界面上选了「精绘」那一档，最后拿到一张占位图，中间一句话都没有的话，
 *    他只会认为这个档位坏了（铁律八）。 */
export async function generateCards(
  files: MaterialFile[],
  note: string,
  forcedType?: CardType | null,
  opts?: { tierId?: string; onProgress?: (msg: string) => void },
): Promise<{ cards: Card[]; minted: number[]; notes: string[] }> {
  const cards: Card[] = [];
  for (const f of files) {
    const name = stemOf(f.name);
    const type = forcedType ?? inferType(f.name, f.text, note, !!f.dataUrl);
    const rng = makeRng(`cardgen:${f.name}:${note}`);
    const flavor = pick(rng, [
      "由你的素材炼成，气质拿捏得恰到好处。",
      "铸卡师看了三秒，决定给它加一点戏剧张力。",
      "封存了素材里最有故事感的一瞬间。",
      "边角还带着一点炉温，小心烫手。",
    ]);
    cards.push({
      id: uid("card"),
      type,
      name,
      summary: note ? `${note}——${flavor}` : `${(f.text ?? "").slice(0, 40) || flavor}`,
      cover: f.dataUrl ?? makeCover(`gen:${f.name}:${note}`, name),
    });
  }
  if (cards.length === 0 && note.trim()) {
    const type = forcedType ?? inferType("", null, note, false);
    const name = note.trim().slice(0, 8);
    cards.push({
      id: uid("card"),
      type,
      name,
      summary: `根据描述「${note.trim().slice(0, 60)}」铸成。`,
      cover: makeCover(`gen:${note}`, name),
    });
  }
  // 演示模式的实情：这一档本该画几张、实际一张没画。张数走 slotsFor（唯一实现），
  // 免得这里手写一个"3"，哪天图位表改了它还在原地说谎。
  // ★ 说"最多"不说"每张"：卡种不同张数就不同（非人物卡只有 2 格），
  //   一批里混着两种卡时，"每张 3 张"这句话本身就是假的。
  const notes: string[] = [];
  if (cards.length > 0) {
    const want = Math.max(...cards.map((c) => slotsFor(c.type, opts?.tierId).length));
    notes.push(
      `演示模式（这台机器没接上 AI 出图）：这一档本该给每张卡画最多 ${want} 张图，这次一张都没画；` +
        `卡面用的是你的原图或本地占位图，不计费`,
    );
  }
  // ★★ 这一发必须在 `await delay` **之前**，而且卡也必须在 delay 之前就造好。
  //   原来的顺序是「delay → 造卡 → onProgress → return」：onProgress 与 return 之间
  //   没有任何 await，调用方（studioStore.forgeCards）拿到结果后 `finally` 立刻把
  //   forgeProgress 清空 —— 这句话发出去的瞬间就被抹掉，React **一帧都没画过**，
  //   而档位面板上还明晃晃写着「每张卡出 3 张图」。100% 不会被看见的话等于没说（铁律八）。
  //   挪到 delay 前面，它至少能在这 1.2 秒里被真正读到；
  //   要长期留在界面上的那一份靠返回的 `notes`（与真实实现同形，调用方一份代码处理两种构建）。
  if (notes.length > 0) opts?.onProgress?.(notes[0]);
  await delay(1200);
  return { cards, minted: cards.map(() => 0), notes };
}

// ── 节点 → 三方案推演 ─────────────────────────────────────────
export interface ProposalContext {
  /** 第几段（从 0 计） */
  index: number;
  materials: Card[];
  requirement: string;
  durationMode: "ai" | "manual";
  durationSec: number;
  /** 上一段已选方案的画面种子（保证首帧承接上一段尾帧色调） */
  prevFrameSeed: string | null;
  /** 本段的确定开头帧（dataURL）：默认=上一节点已选方案的尾帧，
   *  用户也可在节点卡里上传本地图替换。有值时三个方案共用它当首帧，
   *  视频直接从这一画面继续（真正的段间无缝衔接） */
  startFrame: string | null;
  /** 已选路径的剧情，用于“沿路径续写” */
  pathPlots: string[];
  /** 本段画幅（竖/横）：决定设定帧的画布与构图提示词；缺省=横屏 */
  aspect?: VideoAspect;
}

const VARIANTS: Array<{ key: string; name: string; open: string[]; turn: string[]; close: string[] }> = [
  {
    key: "steady",
    name: "顺势推进",
    open: ["镜头缓缓推近，", "画面自上一幕的余韵中醒来，", "光线沿着地平线铺开，"],
    turn: ["一切都按部就班地发生着，却在细节里埋下伏笔——", "节奏克制而绵密，观众的呼吸被悄悄带走——", "看似平静的推进中，某个微小的异样一闪而过——"],
    close: ["镜头停在一个欲言又止的瞬间。", "画面在光影交界处缓缓定格。", "最后一帧里，故事把答案藏进了阴影。"],
  },
  {
    key: "clash",
    name: "风云突变",
    open: ["毫无预兆地，", "上一幕的平静被瞬间撕开，", "低音鼓点骤起，"],
    turn: ["冲突在此刻全面爆发，所有铺垫轰然兑现——", "对峙升级，镜头以凌厉的快切逼近核心——", "命运的齿轮咬合出刺耳的声响——"],
    close: ["尾帧凝固在爆发的最高点。", "画面在碎裂的光斑中戛然而止。", "镜头甩向天空，留下未落地的悬念。"],
  },
  {
    key: "twist",
    name: "柳暗花明",
    open: ["谁也没想到，", "镜头轻轻一转，", "故事在此处拐了一个温柔的弯，"],
    turn: ["真相以完全出乎意料的方式浮出水面——", "一个被忽略的细节此刻成为唯一的钥匙——", "看似绝境之处竟藏着另一条通路——"],
    close: ["尾帧落在一个会心一笑的瞬间。", "画面亮起久违的暖色，尘埃缓缓落定。", "镜头拉远，新的地平线在雾中显形。"],
  },
];

export async function generateProposals(ctx: ProposalContext): Promise<Proposal[]> {
  await delay(1600);
  const char = ctx.materials.find((m) => m.type === "character")?.name ?? "主角";
  const scene = ctx.materials.find((m) => m.type === "scene")?.name ?? "故事发生之地";
  const bg = ctx.materials.find((m) => m.type === "background")?.name;
  const prop = ctx.materials.find((m) => m.type === "prop")?.name;
  const style = ctx.materials.find((m) => m.type === "style")?.name;

  return VARIANTS.map((v) => {
    const id = uid("prop");
    const rng = makeRng(`plot:${id}:${v.key}:${ctx.index}`);
    const sentences: string[] = [];
    sentences.push(`${pick(rng, v.open)}${char}的身影出现在${scene}。`);
    if (bg) sentences.push(`整段画面浸在「${bg}」的氛围里。`);
    if (prop) sentences.push(`那件「${prop}」在此刻显出了它真正的分量。`);
    if (ctx.requirement.trim()) sentences.push(`按照“${ctx.requirement.trim().slice(0, 50)}”的设想，${pick(rng, v.turn)}`);
    else sentences.push(pick(rng, v.turn));
    if (ctx.pathPlots.length > 0) sentences.push(`前${ctx.pathPlots.length}段埋下的线索在这里得到回应。`);
    sentences.push(pick(rng, v.close));
    if (style) sentences.push(`（呈现方式：${style}）`);

    const durationSec = ctx.durationMode === "manual" ? ctx.durationSec : 4 + Math.floor(rng() * 5);
    const title = `第${ctx.index + 1}段 · ${v.name}`;
    return {
      id,
      title,
      plot: sentences.join(""),
      // 有确定开头帧（上一段尾帧/用户上传）时直接沿用——mock 也保持"无缝衔接"语义；
      // 否则三个方案的首帧共享上一段尾帧的色调（承接）
      firstFrame:
        ctx.startFrame ?? makeFrame(`${id}#first`, `${title} · 首帧`, ctx.prevFrameSeed ?? `${id}#first`, ctx.aspect),
      lastFrame: makeFrame(`${id}#last`, `${title} · 尾帧`, `${id}#last`, ctx.aspect),
      durationSec,
    };
  });
}

/** 合成整片（mock：只是延迟，让合成动画有时间感） */
export async function composeVideo(): Promise<void> {
  await delay(2600);
}

// ── NPC 闲聊（离线/降级应答）────────────────────────────────
// 这套**不是只有开发看得到的死代码**：余额不足、请求失败时真实用户也会走到它
// （见 ai/index.ts 的 npcChatOffline），所以它必须一直能用、也必须在人设里。
export interface NpcChatContext {
  text: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  system: string;
  deskBlock: string;
}

/** 关键词 → 固定应答。命中一条就用它，命中不了走轮转池。 */
const CHAT_RULES: Array<[RegExp, string[]]> = [
  [/你好|您好|在吗|hi|hello/i, ["（抬眼）在。", "炉子还热着。说吧。"]],
  [/你是谁|你叫什么|名字/, ["铸卡师。这屋子里只有我一个，你不会叫错。"]],
  [/你是(不是)?(ai|人工智能|机器人)/i, ["是。声音也是合成的。还有别的要问吗。"]],
  [/累|难受|烦|不开心|压力/, ["（停下手里的活）嗯。手上有活的时候会好一点。"]],
  [/谢谢|感谢/, ["不用。炉子不空着就行。"]],
  [/再见|拜拜|走了/, ["门在那边。素材记得带回来。"]],
  [/多少钱|贵|收费|额度/, ["炼一张要烧一次炉。具体数目写在你按之前那行小字上。"]],
  [/几点|今天|日期|天气|新闻/, ["外面的事我不知道。我出不去这间屋子。"]],
];

/** 轮转池：按已说过的句数取模，避免连着重复同一句 */
const CHAT_POOL = [
  "（把一张卡翻过来又扣回去）说下去。",
  "嗯。",
  "这我记下了。",
  "（拨了拨炉火）继续。",
  "桌上还空着。想炼什么，直接说。",
  "我听着。",
];

/** 画布指挥的离线档：**不装大模型**，回空串。canvasAgent 收到空/坏回复就退到
 *  本地直白句式解析（localParse，一处实现）——真实构建余额不足时走的也是那条路，
 *  所以它不是只有开发看得到的死代码。 */
export async function canvasAgentChat(_system: string, _user: string): Promise<string> {
  await delay(200);
  return "";
}

export async function npcChat(ctx: NpcChatContext): Promise<{ text: string; tokens: number }> {
  await delay(300); // 一点点延迟，否则"秒回"反而像假的
  for (const [re, lines] of CHAT_RULES) {
    if (re.test(ctx.text)) return { text: lines[ctx.history.length % lines.length], tokens: 0 };
  }
  return { text: CHAT_POOL[ctx.history.length % CHAT_POOL.length], tokens: 0 };
}
