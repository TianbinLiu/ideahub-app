// 读 woff2 里的 cmap（零依赖，只用 node:zlib 的 Brotli）—— 给 scripts/check-lobby-fonts.mjs 核对
// "这份子集到底有没有这些字形"。
//
// ★ 为什么值得手写这一小段：字体是"提交的二进制产物"，光看文件大小 / magic 证明不了覆盖；
//   而 CI 里没有 fontTools、也不该为了这一条装依赖。woff2 的结构是：
//   头部 48B → 表目录（每表 flags + UIntBase128 长度）→ 一整条 Brotli 流；
//   cmap 表**不做 glyf/loca 那套变换**，所以解压后按目录顺序累加长度就能定位它。
//   只解析 format 4 / 12 两种子表（现代字体一定有其中之一），别的格式当作不认识。
// ★ 解析不出来时抛错 —— 检查脚本据此判红（而不是静默放过一个坏文件）。
import zlib from "node:zlib";

/** woff2 规范里 flags 的 63 个已知 tag（顺序即编码） */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function readUIntBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[pos];
    if (byte === undefined) throw new Error("woff2: UIntBase128 越界");
    pos += 1;
    // 首字节 0x80 / 超过 5 字节 / 前导 0 → 规范禁止
    if (i === 0 && byte === 0x80) throw new Error("woff2: UIntBase128 前导 0");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, pos };
  }
  throw new Error("woff2: UIntBase128 超过 5 字节");
}

/** @returns {{ tag: string, offset: number, length: number }[]} 表在解压流里的偏移与长度 */
function readTables(buf) {
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error("woff2: 不是 wOF2");
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const raw = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos];
    pos += 1;
    let tag;
    const tagIndex = flags & 0x3f;
    if (tagIndex === 63) {
      tag = buf.subarray(pos, pos + 4).toString("latin1");
      pos += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex];
      if (!tag) throw new Error(`woff2: 未知 tag index ${tagIndex}`);
    }
    const orig = readUIntBase128(buf, pos);
    pos = orig.pos;
    const transformVersion = (flags >> 6) & 0x03;
    /** 有 transformLength 的只有被变换的表：glyf/loca（版本非 3）与 hmtx（版本 1） */
    const transformed =
      (tag === "glyf" || tag === "loca") ? transformVersion !== 3 : tag === "hmtx" ? transformVersion === 1 : false;
    if (transformed) {
      const trans = readUIntBase128(buf, pos);
      pos = trans.pos;
      raw.push({ tag, length: trans.value });
    } else {
      raw.push({ tag, length: orig.value });
    }
  }
  if (pos + compressedSize > buf.length) throw new Error("woff2: 压缩流越界");
  const stream = zlib.brotliDecompressSync(buf.subarray(pos, pos + compressedSize));
  let offset = 0;
  const tables = raw.map((t) => {
    const entry = { ...t, offset };
    offset += t.length;
    return entry;
  });
  if (offset !== stream.length) throw new Error(`woff2: 解压流长度对不上（目录 ${offset} vs 实际 ${stream.length}）`);
  return { tables, stream };
}

function codepointsOfFormat4(view, base) {
  const segCount = view.getUint16(base + 6) / 2;
  const endBase = base + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  const out = new Set();
  for (let i = 0; i < segCount; i += 1) {
    const end = view.getUint16(endBase + i * 2);
    const start = view.getUint16(startBase + i * 2);
    if (start > end) continue;
    const delta = view.getInt16(deltaBase + i * 2);
    const rangeOffset = view.getUint16(rangeBase + i * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const glyphPos = rangeBase + i * 2 + rangeOffset + (cp - start) * 2;
        glyph = view.getUint16(glyphPos);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
  return out;
}

function codepointsOfFormat12(view, base) {
  const nGroups = view.getUint32(base + 12);
  const out = new Set();
  for (let i = 0; i < nGroups; i += 1) {
    const g = base + 16 + i * 12;
    const start = view.getUint32(g);
    const end = view.getUint32(g + 4);
    const startGlyph = view.getUint32(g + 8);
    if (startGlyph === 0) continue;
    for (let cp = start; cp <= end; cp += 1) out.add(cp);
  }
  return out;
}

/** 读一份 woff2 的码点集合（format 4 + 12 子表并集） */
export function woff2Codepoints(buf) {
  const { tables, stream } = readTables(buf);
  const cmap = tables.find((t) => t.tag === "cmap");
  if (!cmap) throw new Error("woff2: 没有 cmap 表");
  const view = new DataView(stream.buffer, stream.byteOffset + cmap.offset, cmap.length);
  const numTables = view.getUint16(2);
  const out = new Set();
  let parsed = 0;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 4 + i * 8;
    const subtableOffset = view.getUint32(rec + 4);
    if (subtableOffset + 2 > view.byteLength) continue;
    const format = view.getUint16(subtableOffset);
    if (format === 4) {
      for (const cp of codepointsOfFormat4(view, subtableOffset)) out.add(cp);
      parsed += 1;
    } else if (format === 12) {
      for (const cp of codepointsOfFormat12(view, subtableOffset)) out.add(cp);
      parsed += 1;
    }
  }
  if (!parsed) throw new Error("woff2: cmap 里没有认识的子表（format 4 / 12）");
  return out;
}
