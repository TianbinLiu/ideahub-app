// 真实 AI 管线（火山方舟）：素材炼卡（Seedream 卡面/封面）+ 三方案推演
// （豆包写剧情 + Seedream 首尾帧，首帧用上一段尾帧作参考图承接色调）。
// 每个环节失败都回退到 mock 同款产物——AI 网络抖动不阻断工坊流程。
import { Card, CardType, Proposal, uid } from "../types";
import { makeCover, makeFrame } from "../mock/frames";
import type { MaterialFile, ProposalContext } from "../mock/ai";
import * as mock from "../mock/ai";
import { tierOf } from "../data/economy";
import { idbSet } from "../data/db";
import { FRAME_SIZE, chat, chatVision, generate3dModel, generateImage, generateVideo } from "./arkClient";

/** 方舟返回的图片 URL 有时效（约 24h），落地成 dataURL 再入库（草稿存 localStorage） */
async function toDataUrl(url: string): Promise<string> {
  // 方舟产物在 TOS 域且无 CORS 头——经 dev 服务器同源代取（生产走后端）
  const res = await fetch(`/api/asset?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`取图失败 ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function genImageAsDataUrl(prompt: string, imageRefs?: string[], size?: string): Promise<string> {
  const url = await generateImage(prompt, { imageRefs, size });
  return await toDataUrl(url);
}

/** 并发限流 map：免费额度下 6 张图同时打过去容易撞限流，压到 3 路并发 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const STYLE_SUFFIX =
  "二次元厚涂插画风，高细节，电影感构图，氛围光，无文字无水印。竖版 3:4 卡面。";

const TYPE_LABEL: Record<CardType, string> = {
  character: "人物立绘卡面",
  scene: "场景概念图卡面",
  background: "氛围底色卡面",
  prop: "道具特写卡面",
  style: "画风示意卡面",
};

/** 素材炼卡：图片素材保留原图作卡面；文本/纯描述素材用 Seedream 生成卡面；
 *  名称/简介/类型交给豆包精炼 */
export async function generateCards(files: MaterialFile[], note: string): Promise<Card[]> {
  const base = await mock.generateCards(files, note); // 结构/兜底沿用 mock 推断
  return await Promise.all(
    base.map(async (card, i) => {
      const f = files[i] as MaterialFile | undefined;
      try {
        // 文案精炼：名称 + 一句话简介 + 类型校正
        const meta = await chat(
          "你是卡牌游戏的铸卡师。根据素材信息输出 JSON：{\"name\":\"不超过8字的卡名\",\"summary\":\"一句30字内有故事感的简介\",\"type\":\"character|scene|background|prop|style\"}。只输出 JSON。",
          `文件名: ${f?.name ?? "无"}\n文本内容: ${(f?.text ?? "").slice(0, 300) || "无"}\n用户补充: ${note || "无"}\n是否图片素材: ${f?.dataUrl ? "是" : "否"}`,
        );
        const parsed = JSON.parse(meta.replace(/```json|```/g, "").trim()) as {
          name?: string;
          summary?: string;
          type?: CardType;
        };
        const name = parsed.name?.slice(0, 8) || card.name;
        const summary = parsed.summary?.slice(0, 60) || card.summary;
        const type = parsed.type && TYPE_LABEL[parsed.type] ? parsed.type : card.type;
        // 卡面：图片素材保留原图（用户的图就是卡面）；否则 Seedream 生成
        let cover = card.cover;
        if (!f?.dataUrl) {
          cover = await genImageAsDataUrl(
            `${TYPE_LABEL[type]}：${name}。${summary}${note ? ` 要求：${note}` : ""}。${STYLE_SUFFIX}`,
            undefined,
            "1728x2304", // 竖版 3:4，与卡面文案一致（默认 2K 是方形，白白裁掉上下）
          );
        }
        return { ...card, name, summary, type, cover };
      } catch (e) {
        console.warn("[ai] 炼卡回退 mock:", e);
        return card;
      }
    }),
  );
}

const FRAME_STYLE = STYLE_SUFFIX.replace("竖版 3:4 卡面", "横版 16:9 画面");

function framePrompts(plot: string, withRef: boolean): { first: string; last: string } {
  return {
    first: `电影分镜首帧：${plot.slice(0, 100)}。${withRef ? "延续参考图的色调与光线氛围。" : ""}${FRAME_STYLE}`,
    last: `电影分镜尾帧（这段剧情的收束瞬间）：${plot.slice(-100)}。${FRAME_STYLE}`,
  };
}

/** 三方案推演：豆包写三种走向的剧情 → Seedream 出首尾帧（首帧带上一段尾帧参考承接）。
 *  onProgress 逐阶段播报——整个过程实测约 1-1.5 分钟，没有进度就是"卡死"体感。 */
export async function generateProposals(
  ctx: ProposalContext,
  onProgress?: (status: string) => void,
): Promise<Proposal[]> {
  const fallback = await mock.generateProposals(ctx);
  let plots: Array<{ title: string; plot: string; durationSec: number }>;
  onProgress?.("剧情推演中…");
  try {
    const mats = ctx.materials.map((m) => `${m.type}:${m.name}(${m.summary?.slice(0, 40) ?? ""})`).join("；");
    const raw = await chat(
      "你是互动视频编剧。基于素材与要求，为同一段视频写 3 个不同走向（顺势推进/风云突变/柳暗花明），输出 JSON 数组：[{\"title\":\"12字内标题\",\"plot\":\"80-120字剧情，画面感强，小说式\",\"durationSec\":4到9的整数}]。只输出 JSON。",
      `这是第${ctx.index + 1}段。素材：${mats}\n要求：${ctx.requirement || "无"}\n已定前情：${ctx.pathPlots.join(" / ") || "无"}${
        ctx.startFrame
          ? "\n注意：本段开头画面已经确定（上一段的收尾画面），剧情必须从那一瞬间直接继续——人物、场景、天气、光线都要连贯，不要另起炉灶。"
          : ""
      }${
        ctx.durationMode === "manual" ? `\n用户指定时长：${ctx.durationSec}秒（durationSec 用这个值）` : ""
      }`,
    );
    plots = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!Array.isArray(plots) || plots.length < 3) throw new Error("剧情 JSON 结构不符");
  } catch (e) {
    console.warn("[ai] 剧情回退 mock:", e);
    onProgress?.("剧情 AI 未响应，改用本地剧本…");
    return fallback;
  }

  // 6 张首尾帧拍平成任务队列：限流 3 路并发 + 单张重试，完成数实时回报
  const three = plots.slice(0, 3).map((p) => ({
    ...p,
    id: uid("prop"),
    durationSec: ctx.durationMode === "manual" ? ctx.durationSec : Math.min(9, Math.max(4, p.durationSec || 5)),
  }));
  // 段间无缝衔接：开头帧已定（上一段尾帧/用户上传的本地图）时，三个方案共用它当首帧，
  // 只需给每个方案画一张尾帧（图量减半），且尾帧以开头帧作参考图保持人物与画风一致。
  const startFrame = ctx.startFrame?.startsWith("data:") ? ctx.startFrame : null;
  const refs = startFrame ? [startFrame] : ctx.prevFrameSeed?.startsWith("data:") ? [ctx.prevFrameSeed] : undefined;
  // 顺序固定为 [方案0首帧, 方案0尾帧, 方案1首帧, …]，与最终 results[pi*2] 取值对应
  const jobs = three.flatMap((p) =>
    (startFrame ? (["last"] as const) : (["first", "last"] as const)).map((which) => ({ p, which })),
  );
  let doneCount = 0;
  onProgress?.(startFrame ? `承接上段尾帧，绘制收尾画面 0/${jobs.length}…` : `剧情就绪，绘制首尾帧 0/${jobs.length}…`);
  const results = await mapLimit(jobs, 3, async ({ p, which }) => {
    const prompts = framePrompts(p.plot, !!refs);
    const prompt = which === "first" ? prompts.first : prompts.last;
    // 有确定开头帧时尾帧也带它当参考（人物/画风连贯）；否则仅首帧带上一段色调参考
    const useRefs = which === "first" || startFrame ? refs : undefined;
    let frame: string | null = null;
    try {
      frame = await genImageAsDataUrl(prompt, useRefs, FRAME_SIZE);
    } catch {
      try {
        // 带参考图失败可能是参考图本身不被受理——去掉参考图再试一次
        frame = await genImageAsDataUrl(framePrompts(p.plot, false)[which], undefined, FRAME_SIZE);
      } catch (e2) {
        console.warn(`[ai] ${p.title} ${which} 帧两次失败:`, e2);
      }
    }
    doneCount++;
    onProgress?.(`绘制画面 ${doneCount}/${jobs.length}…`);
    return frame;
  });

  const per = startFrame ? 1 : 2;
  return three.map((p, pi) => {
    const title = `第${ctx.index + 1}段 · ${p.title}`;
    const firstFrame = startFrame ?? results[pi * per];
    const lastFrame = results[pi * per + (startFrame ? 0 : 1)];
    const degraded = !firstFrame || !lastFrame;
    return {
      id: p.id,
      title,
      plot: p.plot,
      firstFrame: firstFrame ?? makeFrame(`${p.id}#first`, `${title} · 首帧`, ctx.prevFrameSeed ?? `${p.id}#first`),
      lastFrame: lastFrame ?? makeFrame(`${p.id}#last`, `${title} · 尾帧`, `${p.id}#last`),
      durationSec: p.durationSec,
      ...(degraded ? { degraded: true } : {}),
    };
  });
}

/** 从成片剧情提炼"本片卡组"：豆包分类型出卡（主要角色/场景/氛围底色/画风），
 *  Seedream 逐张出竖版卡面。视频是什么画风，卡面就跟什么画风（styleHint 注入）。 */
export async function deriveDeckCards(
  segments: Array<{ title: string; plot: string; firstFrame: string }>,
  styleHint: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">> = [],
  onProgress?: (status: string) => void,
): Promise<Card[]> {
  onProgress?.("提炼本片卡组…");
  // 把已有素材卡报给模型：同一实体（哪怕剧情里换了叫法）不许重复出卡，
  // 只补剧情里出现但还没有卡的角色/场景——每类都可以出多张
  const existingDesc =
    existing.length > 0
      ? existing.map((c) => `${TYPE_LABEL[c.type]}「${c.name}」(${(c.summary ?? "").slice(0, 24)})`).join("、")
      : "（无）";
  const raw = await chat(
    '你是卡牌游戏的铸卡师。对照"已有素材卡"清单，从视频剧情中提炼出尚未有卡的可复用创作素材，输出 JSON 数组（0~8 张）：[{"type":"character|scene|background|prop|style","name":"不超过8字","summary":"30字内有故事感的简介","imagePrompt":"该卡卡面的文生图描述，60字内，含主体与氛围"}]。规则：剧情中每个主要角色若未被已有卡覆盖（注意同一角色可能换了称呼），各出一张 character 卡，缺几个补几张；已有卡覆盖的实体绝对不要再出——例如已有人物卡「义肢少女」时，剧情里这位少女无论被叫作"电玩少女""机械臂少女"还是换了新造型，都不得再为她出卡。主要场景/地点同理，每处未覆盖的出一张 scene 卡。整体色调氛围未覆盖时至多一张 background 卡；画风鲜明且没有风格卡时至多一张 style 卡；剧情关键道具可出 prop 卡。所有实体都已被覆盖时输出 []。只输出 JSON。',
    `已有素材卡：${existingDesc}\n剧情（按段）：${segments.map((s) => s.plot).join(" / ").slice(0, 900)}\n整体画风：${styleHint || "未指明（从剧情推断）"}`,
  );
  const defs = JSON.parse(raw.replace(/```json|```/g, "").trim()) as CardDef[];
  if (!Array.isArray(defs)) throw new Error("卡组提炼 JSON 结构不符");
  return await mintCards(defs, styleHint, existing, onProgress);
}

/** 模型吐出的卡定义（提炼与视频提卡共用一套结构） */
interface CardDef {
  type?: CardType;
  name?: string;
  summary?: string;
  imagePrompt?: string;
}

/**
 * 按卡定义批量铸卡面（Seedream，每张一次图生成）。
 * 与已有卡重名的先剔掉——既避免重复出卡，也省下那张卡面的图钱。
 */
async function mintCards(
  defs: CardDef[],
  styleHint: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">>,
  onProgress?: (status: string) => void,
): Promise<Card[]> {
  if (defs.length === 0) return []; // 已有卡把实体全覆盖了：无需补卡，合法结果
  // 模型偶尔把已有实体换个叫法再提出来（"义肢少女"→"义肢电玩少女"）——
  // 同类型且已有卡名字符 ≥80% 落进新名的，判定同一实体直接丢弃
  const isDupOfExisting = (name: string, type: CardType) =>
    existing.some((c) => {
      if (c.type !== type) return false;
      const chars = [...new Set(c.name.split(""))];
      return chars.filter((ch) => name.includes(ch)).length / chars.length >= 0.8;
    });
  const out: Card[] = [];
  let done = 0;
  const jobs = defs
    .slice(0, 8)
    .filter((d) => d.name && TYPE_LABEL[d.type as CardType] && !isDupOfExisting(d.name, d.type as CardType));
  if (jobs.length === 0) return []; // 提出来的全是已有实体的换皮：等于无需补卡
  await mapLimit(jobs, 3, async (d) => {
    const type = d.type as CardType;
    try {
      // 完整生成提示词随卡保存（生成蓝图）：卡片详情页展示，
      // 后续用它就能复刻出与卡面一致的画面/建模
      const genPrompt = `${TYPE_LABEL[type]}：${d.name}。${d.imagePrompt ?? d.summary ?? ""}。${styleHint ? `画风：${styleHint}。` : ""}${STYLE_SUFFIX}`;
      const cover = await genImageAsDataUrl(genPrompt, undefined, "1728x2304");
      out.push({
        id: uid("card"),
        type,
        name: d.name!.slice(0, 8),
        summary: (d.summary ?? "").slice(0, 60),
        cover,
        genPrompt,
      });
    } catch (e) {
      console.warn(`[ai] 派生卡「${d.name}」卡面失败:`, e);
    }
    done++;
    onProgress?.(`绘制卡面 ${done}/${jobs.length}…`);
  });
  if (out.length === 0) throw new Error("派生卡面全部失败");
  return out;
}

/**
 * 从用户上传的本地视频提炼卡组：抽好的帧交给视觉模型认人认景，再逐个铸卡面。
 * 帧是调用方抽的（浏览器 canvas 抽帧比传整个视频便宜得多，也不用后端转码）。
 * 已有卡照例报给模型，重复实体不再出卡。
 */
export async function extractCardsFromVideo(
  frames: string[],
  note: string,
  existing: Array<Pick<Card, "type" | "name" | "summary">> = [],
  onProgress?: (status: string) => void,
): Promise<Card[]> {
  onProgress?.(`看片识别中（${frames.length} 帧）…`);
  const existingDesc =
    existing.length > 0
      ? existing.map((c) => `${TYPE_LABEL[c.type]}「${c.name}」`).join("、")
      : "（无）";
  const raw = await chatVision(
    '你是卡牌游戏的铸卡师。用户给你一段视频里按时间顺序抽的若干帧。请辨认画面里可复用的创作素材，输出 JSON 数组（0~8 张）：[{"type":"character|scene|background|prop|style","name":"不超过8字","summary":"30字内有故事感的简介","imagePrompt":"该卡卡面的文生图描述，60字内，含主体与氛围"}]。规则：出现的每个主要角色各出一张 character 卡；主要场景/地点各出一张 scene 卡；整体色调氛围至多一张 background 卡；画风鲜明时至多一张 style 卡；关键道具可出 prop 卡。已有卡覆盖的实体绝对不要再出。只输出 JSON。',
    `已有卡：${existingDesc}\n用户补充说明：${note || "无"}\n以下是这段视频按时间顺序的抽帧：`,
    frames,
  );
  const defs = JSON.parse(raw.replace(/```json|```/g, "").trim()) as CardDef[];
  if (!Array.isArray(defs)) throw new Error("视频提卡 JSON 结构不符");
  // 画风由模型自己在 style 卡里判断，这里不再额外注入风格提示
  const styleHint = defs.find((d) => d.type === "style")?.name ?? "";
  return await mintCards(defs, styleHint, existing, onProgress);
}

/**
 * Seed3D 产物是 zip 包（实测 2026-08-07：包内单个自包含 pbr/mesh_textured_pbr.glb，36MB 级）。
 * 浏览器侧按中央目录定位 .glb 条目并 DecompressionStream 解出 GLB blob——
 * 不引 JSZip，standard deflate 足够。
 */
async function glbFromArkZip(zipUrl: string): Promise<Blob> {
  const res = await fetch(`/api/asset?url=${encodeURIComponent(zipUrl)}`, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`取建模包失败 ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const u16 = (i: number) => buf[i] | (buf[i + 1] << 8);
  const u32 = (i: number) => (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
  // 中央目录（PK\x01\x02）里 size/offset 恒可信（本地头可能用 data descriptor 置零）
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x01 || buf[i + 3] !== 0x02) continue;
    const method = u16(i + 10);
    const compSize = u32(i + 20);
    const nameLen = u16(i + 28);
    const extraLen = u16(i + 30);
    const commentLen = u16(i + 32);
    const localOff = u32(i + 42);
    const name = new TextDecoder().decode(buf.subarray(i + 46, i + 46 + nameLen));
    if (name.toLowerCase().endsWith(".glb")) {
      // 本地头：PK\x03\x04 + 26 字节定长 + 名字/扩展区，数据紧随其后
      const lnLen = u16(localOff + 26);
      const lexLen = u16(localOff + 28);
      const dataStart = localOff + 30 + lnLen + lexLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return new Blob([raw], { type: "model/gltf-binary" });
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Blob([await new Response(stream).arrayBuffer()], { type: "model/gltf-binary" });
    }
    i += 45 + nameLen + extraLen + commentLen;
  }
  throw new Error("建模包里没有 .glb 文件");
}

/**
 * 3D 风格视频的角色卡自动建模：Seed3D 按卡面出带纹理+PBR 的 3D 文件（约 2.4 元/张）。
 * GLB 36MB 级——存 IndexedDB blob 仓（key=model3d:<cardId>），卡上只挂 `idb:` 指针
 * （塞 dataURL 会把嵌进作品的卡组 JSON 撑到几十 MB）。CardHologram 会解析该指针。
 * 上限 maxCount 张、单张失败不阻断其余（建模挂了卡本身还在）。
 */
export async function deriveCharacterModels(
  cards: Card[],
  maxCount = 2,
  onProgress?: (status: string) => void,
): Promise<void> {
  const targets = cards.filter((c) => c.type === "character" && !c.modelUrl).slice(0, maxCount);
  for (let i = 0; i < targets.length; i++) {
    const card = targets[i];
    try {
      onProgress?.(`为「${card.name}」铸造 3D 建模 ${i + 1}/${targets.length}…`);
      const url = await generate3dModel(card.cover, (s) => onProgress?.(`「${card.name}」${s}`));
      onProgress?.(`「${card.name}」建模下载解包中…`);
      const blob = await glbFromArkZip(url);
      const key = `model3d:${card.id}`;
      if (!(await idbSet(key, blob))) throw new Error("建模落库失败（存储配额？）");
      card.modelUrl = `idb:${key}`;
    } catch (e) {
      console.warn(`[ai] 角色卡「${card.name}」建模失败（跳过）:`, e);
    }
  }
}

/**
 * 设定图（分镜首/尾帧）按要求改图：Seedream 图生图，保持构图与画风只改要求之处。
 * 方案卡里"选帧改图"、剪辑页"圈选修改"都走这里（后者把红圈标注画进参考图，
 * 提示词里指明按标注处理并抹掉标记）。
 */
export async function refineFrame(req: string, refDataUrl: string): Promise<string> {
  return await genImageAsDataUrl(
    `在参考图基础上修改这张视频分镜帧：${req}。除要求之外保持人物、构图、光线与整体画风完全一致。高细节，无文字无水印。横版 16:9 画面。`,
    [refDataUrl],
    FRAME_SIZE,
  );
}

/**
 * 剪辑页单段重生成：沿用该段首尾帧，把用户的修改要求并进提示词重拍。
 * 返回新视频 URL 与真实尾帧（供展示/后续合并）。
 */
export async function regenSegment(
  seg: { plot: string; firstFrame: string; lastFrame: string; durationSec: number; videoTier?: string },
  extraReq: string,
  onProgress?: (status: string) => void,
): Promise<{ url: string; lastFrame?: string }> {
  const tier = tierOf(seg.videoTier);
  const prompt = `${seg.plot.slice(0, 320)}。修改要求（必须满足）：${extraReq.slice(0, 160)}`;
  const url = await generateVideo(prompt, await shrinkFrameFor720p(seg.firstFrame), {
    durationSec: seg.durationSec,
    lastFrameUrl: tier.flf ? await shrinkFrameFor720p(seg.lastFrame) : undefined,
    model: tier.model,
    onProgress: (s) => onProgress?.(`${tier.label}档 · ${s}`),
  });
  let lastFrame: string | undefined;
  try {
    onProgress?.("捕获真实尾帧…");
    lastFrame = await captureVideoTail(url);
  } catch (e) {
    console.warn("[ai] 重生成段尾帧捕获失败:", e);
  }
  return { url, lastFrame };
}

/** 封面工坊：按用户要求出封面。refDataUrl 给了就是"改当前封面"（Seedream 图生图，
 *  2026-08-06 实测 base64 dataURL 参考图可用，约 27s）；不给就是文生图全新生成。 */
export async function generateCover(req: string, refDataUrl?: string): Promise<string> {
  const prompt = refDataUrl
    ? `在参考图的基础上修改这张视频封面：${req}。除要求之外保持主体、构图与整体风格不变。高细节，氛围光，无文字无水印。横版 16:9 画面。`
    : `视频封面图：${req}。高细节，电影感构图，氛围光，无文字无水印。横版 16:9 画面。`;
  return await genImageAsDataUrl(prompt, refDataUrl ? [refDataUrl] : undefined, FRAME_SIZE);
}

/** 单段合成结果：url 缺席时 error 说明原因；firstFrame/lastFrame 带回"真实"帧
 *  （占位帧重画、尾帧续作的真实结尾）供草稿/节点同步 */
export interface SegmentResult {
  url?: string;
  error?: string;
  firstFrame?: string;
  lastFrame?: string;
}

/**
 * 帧压到 720p 再喂 Seedance：输出就是 720p，2560×1440 的 dataURL（1-1.5MB/张）
 * 白白撑大创建请求体——慢网上行时 2-3MB 的 POST 会超时挂死（2026-08-07 实测）。
 * 压后单帧 ~200KB，画质对 720p 输出无损失。非 dataURL / 压缩失败原样返回。
 */
async function shrinkFrameFor720p(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    if (img.width <= 1280) return dataUrl;
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = Math.round((img.height * 1280) / img.width);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

/**
 * 取生成视频的真实最后一帧（经 /api/asset 代理拿 blob，避免 TOS 域画布污染）。
 * 为什么必须捕获而不是信"设定尾帧"：极速档（pro-fast）不支持尾帧锁定，视频真实
 * 结尾和 Seedream 画的设定尾帧必然有偏差；哪怕 flf2v 也只是"逼近"。下一段若从
 * 设定尾帧起拍，段间就会跳变（2026-08-07《发条镇小骑士》用户实测发现）。
 */
async function captureVideoTail(videoUrl: string): Promise<string> {
  const res = await fetch(`/api/asset?url=${encodeURIComponent(videoUrl)}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`取视频失败 ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = blobUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("视频元数据加载失败"));
    });
    video.currentTime = Math.max(0, video.duration - 0.05);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("视频 seek 失败"));
      setTimeout(() => reject(new Error("视频 seek 超时")), 15_000);
    });
    const c = document.createElement("canvas");
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * 合成：逐段用 Seedance 首尾帧图生视频。段间串行（免费额度并发有限），
 * 单段失败不阻断整片——该段回退首尾帧渐变播放，但失败原因必须带回给 UI 播报
 * （此前只 console.warn，用户拿到一堆渐变还以为是"生成好的视频"）。
 * degraded 段（当时 Seedream 没出图、帧是本地占位图）先重画真帧再合成——
 * 拿占位渐变图去让 Seedance 动起来，产出的"视频"与剧情毫无关系。
 */
export async function composeSegments(
  segments: Array<{
    plot: string;
    firstFrame: string;
    lastFrame: string;
    durationSec: number;
    degraded?: boolean;
    /** 该段选用的 Seedance 档位（data/economy VIDEO_TIERS 的 id）；缺省=标准档 */
    videoTier?: string;
  }>,
  onProgress?: (done: number, total: number, status: string) => void,
): Promise<SegmentResult[]> {
  const out: SegmentResult[] = [];
  // 衔接判定要对照"原始设定帧"：后面会用真实尾帧顶替首帧，不能拿改过的值比
  const origFirst = segments.map((s) => s.firstFrame);
  const origLast = segments.map((s) => s.lastFrame);
  // 上一段视频的真实结尾帧：本段承接上一段时用它顶替设定首帧（视频级无缝衔接）
  let carryTail: string | null = null;
  for (let i = 0; i < segments.length; i++) {
    const sg = segments[i];
    const res: SegmentResult = {};
    let first = sg.firstFrame;
    let last = sg.lastFrame;
    const prevTail = carryTail;
    carryTail = null;
    try {
      if (sg.degraded) {
        onProgress?.(i, segments.length, "首尾帧此前未出图，正在重画…");
        const prompts = framePrompts(sg.plot, false);
        [first, last] = await Promise.all([
          genImageAsDataUrl(prompts.first, undefined, FRAME_SIZE),
          genImageAsDataUrl(prompts.last, undefined, FRAME_SIZE),
        ]);
        res.firstFrame = first;
        res.lastFrame = last;
      }
      // 尾帧续作：本段设定首帧 = 上一段设定尾帧（承接关系）时，改用上一段视频的
      // 真实结尾起拍——设定尾帧只是分镜蓝图，视频（尤其极速档）不一定拍到那儿。
      // 用户上传过自定义开头帧（首帧≠上段设定尾帧）则尊重用户，不顶替。
      if (prevTail && i > 0 && origFirst[i] === origLast[i - 1]) {
        first = prevTail;
        res.firstFrame = prevTail;
      }
      onProgress?.(i, segments.length, "任务创建中…");
      const tier = tierOf(sg.videoTier);
      const url = await generateVideo(sg.plot.slice(0, 400), await shrinkFrameFor720p(first), {
        durationSec: sg.durationSec,
        // 极速档（pro-fast）不支持首尾帧任务（实测 400 task_type flf2v）——只给首帧起拍
        lastFrameUrl: tier.flf ? await shrinkFrameFor720p(last) : undefined,
        model: tier.model,
        onProgress: (s) => onProgress?.(i, segments.length, `${tier.label}档 · ${s}`),
      });
      // 视频较大（数 MB），存 URL 而非 dataURL——localStorage 放不下 base64 视频；
      // 方舟 URL 24h 有效，超时后播放器自动回退首尾帧渐变
      res.url = url;
      // 捕获真实尾帧：回填节点/草稿（卡面显示真实结尾），并作为下一段的起拍帧
      try {
        onProgress?.(i, segments.length, "捕获本段真实尾帧…");
        const tail = await captureVideoTail(url);
        res.lastFrame = tail;
        carryTail = tail;
      } catch (e2) {
        console.warn(`[ai] 第 ${i + 1} 段真实尾帧捕获失败（下一段沿用设定帧）:`, e2);
      }
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
      console.warn(`[ai] 第 ${i + 1} 段视频失败，回退首尾帧:`, e);
    }
    out.push(res);
  }
  onProgress?.(segments.length, segments.length, "完成");
  return out;
}

export { makeCover };
