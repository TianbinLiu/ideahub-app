// 编码归一（docs/03 §2）：UTF-8 无 BOM、LF、Unicode NFC。导入时一律先归一再算校验和 ——
// 否则 Windows 上 CRLF 检出的同一份文件校验和就对不上（主仓 CLAUDE.md 坑表「Windows 上构建过之后 git status 报 M」同源）。

export function normalizeText(text) {
  if (typeof text !== "string") throw new TypeError("normalizeText: 只收字符串");
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // BOM
  t = t.replace(/\r\n?/g, "\n");
  return t.normalize("NFC");
}

/** 正文的规范形：去掉末尾多余空行，保证恰好一个结尾换行。checksum 与渲染都用它，两边才能对上。 */
export function canonicalBody(body) {
  return normalizeText(body).replace(/[ \t]+$/gm, "").replace(/\n*$/, "") + "\n";
}
