// 真实 AI 管线（火山方舟）：素材炼卡（Seedream 卡面/封面）+ 三方案推演
// （豆包写剧情 + Seedream 首尾帧，首帧用上一段尾帧作参考图承接色调）。
// 每个环节失败都回退到 mock 同款产物——AI 网络抖动不阻断工坊流程。
import { Card, CardType, Proposal, uid } from "../types";
import { makeCover, makeFrame } from "../mock/frames";
import type { MaterialFile, ProposalContext } from "../mock/ai";
import * as mock from "../mock/ai";
import { chat, generateImage } from "./arkClient";

/** 方舟返回的图片 URL 有时效（约 24h），落地成 dataURL 再入库（草稿存 localStorage） */
async function toDataUrl(url: string): Promise<string> {
  // 方舟产物在 TOS 域且无 CORS 头——经 dev 服务器同源代取（生产走后端）
  const res = await fetch(`/api/asset?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`取图失败 ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function genImageAsDataUrl(prompt: string, imageRefs?: string[]): Promise<string> {
  const url = await generateImage(prompt, { imageRefs });
  return await toDataUrl(url);
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

/** 三方案推演：豆包写三种走向的剧情 → Seedream 出首尾帧（首帧带上一段尾帧参考承接） */
export async function generateProposals(ctx: ProposalContext): Promise<Proposal[]> {
  const fallback = await mock.generateProposals(ctx);
  let plots: Array<{ title: string; plot: string; durationSec: number }>;
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
    return fallback;
  }

  return await Promise.all(
    plots.slice(0, 3).map(async (p) => {
      const id = uid("prop");
      const title = `第${ctx.index + 1}段 · ${p.title}`;
      const durationSec =
        ctx.durationMode === "manual" ? ctx.durationSec : Math.min(9, Math.max(4, p.durationSec || 5));
      try {
        const refs = ctx.prevFrameSeed?.startsWith("data:") ? [ctx.prevFrameSeed] : undefined;
        const [firstFrame, lastFrame] = await Promise.all([
          genImageAsDataUrl(
            `电影分镜首帧：${p.plot.slice(0, 100)}。${refs ? "延续参考图的色调与光线氛围。" : ""}${STYLE_SUFFIX.replace("竖版 3:4 卡面", "横版 16:9 画面")}`,
            refs,
          ),
          genImageAsDataUrl(
            `电影分镜尾帧（这段剧情的收束瞬间）：${p.plot.slice(-100)}。${STYLE_SUFFIX.replace("竖版 3:4 卡面", "横版 16:9 画面")}`,
          ),
        ]);
        return { id, title, plot: p.plot, firstFrame, lastFrame, durationSec };
      } catch (e) {
        console.warn("[ai] 首尾帧回退 mock:", e);
        return {
          id,
          title,
          plot: p.plot,
          firstFrame: makeFrame(`${id}#first`, `${title} · 首帧`, ctx.prevFrameSeed ?? `${id}#first`),
          lastFrame: makeFrame(`${id}#last`, `${title} · 尾帧`, `${id}#last`),
          durationSec,
        };
      }
    }),
  );
}

export { makeCover };
