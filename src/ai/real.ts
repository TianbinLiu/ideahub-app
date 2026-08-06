// 真实 AI 管线（火山方舟）：素材炼卡（Seedream 卡面/封面）+ 三方案推演
// （豆包写剧情 + Seedream 首尾帧，首帧用上一段尾帧作参考图承接色调）。
// 每个环节失败都回退到 mock 同款产物——AI 网络抖动不阻断工坊流程。
import { Card, CardType, Proposal, uid } from "../types";
import { makeCover, makeFrame } from "../mock/frames";
import type { MaterialFile, ProposalContext } from "../mock/ai";
import * as mock from "../mock/ai";
import { FRAME_SIZE, chat, generateImage, generateVideo } from "./arkClient";

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
  const refs = ctx.prevFrameSeed?.startsWith("data:") ? [ctx.prevFrameSeed] : undefined;
  // 顺序固定为 [方案0首帧, 方案0尾帧, 方案1首帧, …]，与最终 results[pi*2] 取值对应
  const jobs = three.flatMap((p) => (["first", "last"] as const).map((which) => ({ p, which })));
  let doneCount = 0;
  onProgress?.(`剧情就绪，绘制首尾帧 0/${jobs.length}…`);
  const results = await mapLimit(jobs, 3, async ({ p, which }) => {
    const prompts = framePrompts(p.plot, !!refs && which === "first");
    const prompt = which === "first" ? prompts.first : prompts.last;
    const useRefs = which === "first" ? refs : undefined;
    let frame: string | null = null;
    try {
      frame = await genImageAsDataUrl(prompt, useRefs, FRAME_SIZE);
    } catch {
      try {
        // 带参考图失败可能是参考图本身不被受理——去掉参考图再试一次
        frame = await genImageAsDataUrl(which === "first" ? framePrompts(p.plot, false).first : prompt, undefined, FRAME_SIZE);
      } catch (e2) {
        console.warn(`[ai] ${p.title} ${which} 帧两次失败:`, e2);
      }
    }
    doneCount++;
    onProgress?.(`绘制首尾帧 ${doneCount}/${jobs.length}…`);
    return frame;
  });

  return three.map((p, pi) => {
    const title = `第${ctx.index + 1}段 · ${p.title}`;
    const firstFrame = results[pi * 2];
    const lastFrame = results[pi * 2 + 1];
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

/** 单段合成结果：url 缺席时 error 说明原因；修复过占位帧时带回新帧供草稿/节点同步 */
export interface SegmentResult {
  url?: string;
  error?: string;
  firstFrame?: string;
  lastFrame?: string;
}

/**
 * 合成：逐段用 Seedance 首尾帧图生视频。段间串行（免费额度并发有限），
 * 单段失败不阻断整片——该段回退首尾帧渐变播放，但失败原因必须带回给 UI 播报
 * （此前只 console.warn，用户拿到一堆渐变还以为是"生成好的视频"）。
 * degraded 段（当时 Seedream 没出图、帧是本地占位图）先重画真帧再合成——
 * 拿占位渐变图去让 Seedance 动起来，产出的"视频"与剧情毫无关系。
 */
export async function composeSegments(
  segments: Array<{ plot: string; firstFrame: string; lastFrame: string; durationSec: number; degraded?: boolean }>,
  onProgress?: (done: number, total: number, status: string) => void,
): Promise<SegmentResult[]> {
  const out: SegmentResult[] = [];
  for (let i = 0; i < segments.length; i++) {
    const sg = segments[i];
    const res: SegmentResult = {};
    let first = sg.firstFrame;
    let last = sg.lastFrame;
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
      onProgress?.(i, segments.length, "任务创建中…");
      const url = await generateVideo(sg.plot.slice(0, 400), first, {
        durationSec: sg.durationSec,
        lastFrameUrl: last,
        onProgress: (s) => onProgress?.(i, segments.length, s),
      });
      // 视频较大（数 MB），存 URL 而非 dataURL——localStorage 放不下 base64 视频；
      // 方舟 URL 24h 有效，超时后播放器自动回退首尾帧渐变
      res.url = url;
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
