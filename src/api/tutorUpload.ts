/**
 * App 内建课的教材上传（M4，tutor 仓 docs/06 §6.1「App 内先只支持 md/txt」）：
 *   本机切块 + 块 hash（src/tutor/shared，与服务端 / 官网**同一份**切法，锚点才钉得回去）→ 按 sha256 问一句去重 → sign 领票
 *   → putDirect 推给 Cloudinary（与成片 / 模板视频 / Live2D 包**同一份**直传实现，api/uploads.ts）→ confirm 送 pages。
 * ★ pdf / pptx / docx 不在这条路上：解析器（pdf.js / JSZip / mammoth）不进 APK，WebView 里跑 pdfjs 的内存与时长没量过
 *   （tutor 仓 docs/06 §6.4「先量再定」）—— 页面上引导去网页端传。相册里的图片同理：v1 不做 OCR（docs/08 #10），一张图抽不出一个字。
 */
import { t } from "@lingui/core/macro";
import { ApiError } from "./client";
import { putDirect } from "./uploads";
import { confirmMaterial, materialExists, signMaterial, type LicenseSource, type MaterialEntry, type Page } from "./tutor";
import { fold, hashPages, pagesToText, paragraphsToBlocks } from "../tutor/shared/materials/blocks.js";

export const TEXT_EXTS = [".md", ".txt"] as const;
export type TextExt = (typeof TEXT_EXTS)[number];
/** 单文件字数上限（与官网 extract/index.ts 的 MAX_TOTAL_CHARS 同值：一本厚教材；超过让用户拆文件） */
export const MAX_TEXT_CHARS = 2_000_000;

export type Extracted = { sha256: string; name: string; ext: TextExt; mime: string; bytes: number; pages: Page[]; chars: number; warnings: string[] };

export const extOf = (name: string): string => {
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : "";
};
export const isTextExt = (name: string): name is `${string}${TextExt}` => (TEXT_EXTS as readonly string[]).includes(extOf(name));

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** md / txt → 一页多块（空行分段、Markdown 标题自成一块）+ 每块 hash；纯文本没有页的概念，全文算第 1 页（与官网抽取器同一口径） */
export async function extractText(file: File): Promise<Extracted> {
  const ext = extOf(file.name);
  if (!isTextExt(file.name)) throw new ApiError(t`App 里只收 .md / .txt（这份是「${ext || "?"}」）。PDF / PPTX / DOCX 请去网页端传。`, 400, "UNSUPPORTED_EXT");
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  const text = new TextDecoder("utf-8").decode(buf);
  const pages = (await hashPages([{ idx: 1, blocks: paragraphsToBlocks(text) }])) as Page[];
  const chars = fold(pagesToText(pages)).length;
  if (chars === 0) throw new ApiError(t`这份文件里没有文字，换一份再传。`, 400, "EMPTY");
  if (chars > MAX_TEXT_CHARS) throw new ApiError(t`这份文件有 ${chars} 字，超过单文件 ${MAX_TEXT_CHARS} 字上限，请拆成几份再传。`, 400, "TOO_LONG");
  return { sha256, name: file.name, ext: ext as TextExt, mime: ext === ".md" ? "text/markdown" : "text/plain", bytes: buf.byteLength, pages, chars, warnings: [] };
}

export type UploadPhase = "check" | "sign" | "put" | "confirm" | "done";

/**
 * 去重 → 领票 → 直传 → 验收。同一份文件第二次传直接回 duplicate（服务端按 sha 认）。
 * onProgress 的 frac 只在 put 阶段有意义（0~1），其余阶段传 0 / 1。
 */
export async function uploadTextMaterial({ courseId, file, extracted, license, onProgress, signal }: { courseId: string; file: File; extracted: Extracted; license: LicenseSource; onProgress?: (phase: UploadPhase, frac: number) => void; signal?: AbortSignal }): Promise<{ material: MaterialEntry; duplicate: boolean }> {
  onProgress?.("check", 0);
  const ex = await materialExists(courseId, extracted.sha256);
  if (ex.exists && ex.material) {
    onProgress?.("done", 1);
    return { material: ex.material, duplicate: true };
  }
  onProgress?.("sign", 0);
  const ticket = await signMaterial({ courseId, format: extracted.ext.slice(1), bytes: file.size, name: file.name });
  onProgress?.("put", 0);
  // ★ 票的字段名与成片那张不同（putUrl / maxBytes），换个壳交给同一份 putDirect：分块 / 停摆判定 / 同块重试都不另写
  await putDirect({ uploadUrl: ticket.putUrl, publicId: ticket.publicId, params: ticket.params, chunkBytes: ticket.chunkBytes, maxSizeBytes: ticket.maxBytes }, file, (frac) => onProgress?.("put", frac), signal);
  onProgress?.("confirm", 1);
  const conf = await confirmMaterial({ ticket: ticket.ticket, courseId, sha256: extracted.sha256, name: file.name, mime: extracted.mime, bytes: file.size, license: { source: license }, pages: extracted.pages, warnings: extracted.warnings });
  onProgress?.("done", 1);
  return { material: conf.material, duplicate: conf.duplicate };
}
