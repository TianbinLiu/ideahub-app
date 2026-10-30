// 块级抽文本（docs/05 §4.2、docs/02 1.12）：页 → 块 → 块指纹。**Node 与浏览器共用这一份**（只用 WebCrypto 与纯函数），
// 服务端切块与阅读面的文字层必须是同一种切法，两边的块 hash 才对得上 —— 抄一份必然分叉，锚点就钉不回去。
// ★ 块 hash = sha256(规范化文本) 前 12 位；规范化 = NFC + 去掉全部空白（与 anchors.fold 同口径：不同抽取器抽出的空白不同，指纹不能跟着变）。
// ★ 阈值是量出来的初值（AGENTS.md 第 6 条，先量再定）：本仓 fixture 的幻灯 PDF 由 Chromium 打印，行距 1.5 倍字高、段距 ≥ 2.2 倍字高；
//   同一行判定 0.5 倍字高是 pdf.js 自己的 textLayer 合行口径。换一批真实教材后要拿命中率复核（docs/06 §3.5 最后一行）。
import { normalizeText } from "../format/normalize.js";

export const HASH_LEN = 12;
export const PAGE_BREAK = "\f";

/** 指纹与查找共用的折叠：NFC + 去掉全部空白。 */
export function fold(text) {
  return normalizeText(String(text ?? "")).replace(/\s+/g, "");
}

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function blockHash(text) {
  return (await sha256Hex(fold(text))).slice(0, HASH_LEN);
}

/**
 * 在一段文本里找短引（忽略空白差异）。返回原文里的 [start, end)（码点下标）或 null。
 * 浏览器那一侧拿文字层的文本节点拼成一串再调它，把 start/end 映射回节点即可。
 */
export function findQuote(text, quote) {
  const q = fold(quote);
  if (!q) return null;
  const src = normalizeText(String(text ?? ""));
  const map = [];
  let folded = "";
  for (let i = 0; i < src.length; i++) {
    if (/\s/.test(src[i])) continue;
    map.push(i);
    folded += src[i];
  }
  const at = folded.indexOf(q);
  if (at < 0) return null;
  return { start: map[at], end: map[at + q.length - 1] + 1, foldedStart: at, foldedEnd: at + q.length };
}

const LINE_TOL = 0.5; // 同一行：基线差 < 0.5 × 字高
const BLOCK_GAP = 1.8; // 断块：相邻行基线差 > 1.8 × 字高（正文行距 1.2～1.6 倍不断，段距 / 标题与正文之间断）
const WORD_GAP = 0.25; // 同一行两个 item 之间的水平空隙 > 0.25 × 字高 补一个空格（拉丁 / 公式）；中文 item 之间空隙为 0 不补

/**
 * pdf.js `getTextContent().items` → 块。items: { str, transform:[a,b,c,d,e,f], width, height }，坐标是 PDF 用户空间（原点左下，y 向上）。
 * @param {object[]} items
 * @param {number} pageHeight 页高（用户单位），用来把 bbox 翻成「顶部为 0」的坐标（与 CSS 同向）
 * @returns {{ text: string, bbox: number[], fontSize: number }[]} bbox = [x, yTop, w, h]，四舍五入到 0.1
 */
export function blocksFromPdfItems(items, pageHeight) {
  const lines = [];
  for (const it of items) {
    if (typeof it?.str !== "string" || !it.str.trim() || !Array.isArray(it.transform)) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || it.height || 10;
    const w = it.width || 0;
    let line = lines.find((l) => Math.abs(l.y - y) < LINE_TOL * Math.max(h, l.h));
    if (!line) { line = { y, h, items: [] }; lines.push(line); }
    line.items.push({ x, w, h, str: it.str });
    line.h = Math.max(line.h, h);
  }
  lines.sort((a, b) => b.y - a.y || 0);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  const groups = [];
  let cur = null;
  let prev = null;
  for (const l of lines) {
    if (!cur || prev.y - l.y > BLOCK_GAP * Math.max(prev.h, l.h)) { cur = []; groups.push(cur); }
    cur.push(l);
    prev = l;
  }
  return groups.map((g) => {
    const text = g.map((l) => joinLine(l.items)).join("\n").trim();
    const xs = g.flatMap((l) => l.items.map((i) => i.x));
    const xe = g.flatMap((l) => l.items.map((i) => i.x + i.w));
    const top = Math.max(...g.map((l) => l.y + l.h));
    const bottom = Math.min(...g.map((l) => l.y - 0.25 * l.h));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xe);
    return { text, bbox: [r1(x0), r1(pageHeight - top), r1(x1 - x0), r1(top - bottom)], fontSize: r1(Math.max(...g.map((l) => l.h))) };
  }).filter((b) => b.text);
}

function joinLine(items) {
  let out = "";
  let prev = null;
  for (const it of items) {
    if (prev && it.x - (prev.x + prev.w) > WORD_GAP * Math.max(it.h, prev.h) && !out.endsWith(" ") && !it.str.startsWith(" ")) out += " ";
    out += it.str;
    prev = it;
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

const r1 = (n) => Math.round(n * 10) / 10;

/** 标题启发：第一块字号 ≥ 页内中位字号 × 1.3 且 ≤ 60 字 —— 幻灯与讲义的页标题都是这个样子；猜不中就没有标题，不硬给。 */
export function titleOf(blocks) {
  if (!blocks.length) return undefined;
  const sizes = blocks.map((b) => b.fontSize).filter((n) => n > 0).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const first = blocks[0];
  const t = first.text.replace(/\s+/g, " ");
  return first.fontSize >= median * 1.3 && t.length <= 60 && !t.includes("\n") ? t : undefined;
}

/** 纯文本（md / txt / docx / 幻灯里的段落）→ 块：空行分段；Markdown 标题行自成一块。 */
export function paragraphsToBlocks(text) {
  const out = [];
  let buf = [];
  const flush = () => { const t = buf.join("\n").trim(); if (t) out.push({ text: t }); buf = []; };
  for (const line of normalizeText(String(text ?? "")).split("\n")) {
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(line)) { flush(); out.push({ text: line.trim() }); continue; }
    buf.push(line.trimEnd());
  }
  flush();
  return out;
}

/** 给每一块算 hash，去掉空块；返回新数组（不改入参）。 */
export async function hashPages(pages) {
  const out = [];
  for (const p of pages) {
    const blocks = [];
    for (const b of p.blocks) {
      if (!b.text || !fold(b.text)) continue;
      const { fontSize, ...rest } = b;
      void fontSize;
      blocks.push({ hash: await blockHash(b.text), ...rest });
    }
    out.push({ idx: p.idx, ...(p.title ? { title: p.title } : {}), blocks });
  }
  return out;
}

/** 页 → 一整段文本：块之间空一行、页之间换页符（锚点页码靠数它，anchors.js）。 */
export function pagesToText(pages) {
  return pages.map((p) => p.blocks.map((b) => b.text).join("\n\n")).join(`\n${PAGE_BREAK}\n`);
}

/** 教材文件 sha256 → 锚点里的 12 位 material 指纹 */
export function shortSha(sha) {
  return String(sha).replace(/^sha256:/, "").slice(0, HASH_LEN);
}
