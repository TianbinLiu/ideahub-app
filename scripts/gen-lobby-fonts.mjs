#!/usr/bin/env node
// 生成对局大厅 B 案的两份 woff2 子集（2026-11-28，feat/ui-fonts-hud-fixes）。
//
// ★★ 为什么是"生成脚本 + 提交产物"：构建机与 CI 不联网、也不该在每次 build 时下载字体；
//   字体文件本身进仓库（约 35KB 两份），`scripts/check-lobby-fonts.mjs` 在构建里核对
//   体积 / 覆盖清单 / preload / font-face —— 但**不会**重新下载。
//
// ★ 用法（只有改了 B 案文案、需要补字时才跑）：
//     node scripts/gen-lobby-fonts.mjs
//   需要能访问 fonts.googleapis.com / fonts.gstatic.com。字体许可：
//     · Noto Serif SC —— SIL Open Font License 1.1
//     · Ma Shan Zheng  —— SIL Open Font License 1.1
//   OFL 全文见 public/fonts/OFL-*.txt（随包分发，OFL 要求声明保留）。
//
// ★★ 子集化由 Google Fonts 的 `text=` 参数完成（服务端只切这几个字；它比本地 pyftsubset
//   少一步"下载 20MB 全字库"）。收字清单只有一份：scripts/lib/lobby-font-chars.mjs。
//   每份文件的验收上限（每份 ≤120KB、合计 ≤300KB）写在那份 lib 里，超了这里直接失败。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { FONT_LIMITS, FONT_SPECS, uniqueChars } from "./lib/lobby-font-chars.mjs";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "fonts");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function fetchSubset(spec) {
  const chars = uniqueChars(spec.text);
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${spec.query}&display=swap` +
    `&text=${encodeURIComponent(chars.join(""))}`;
  const cssRes = await fetch(cssUrl, { headers: { "User-Agent": UA } });
  if (!cssRes.ok) throw new Error(`${spec.family}: CSS 请求失败 ${cssRes.status}`);
  const css = await cssRes.text();
  const m = css.match(/src:\s*url\((https:[^)]+)\)/);
  if (!m) throw new Error(`${spec.family}: CSS 里没有 src url\n${css}`);
  const fontRes = await fetch(m[1], { headers: { "User-Agent": UA } });
  if (!fontRes.ok) throw new Error(`${spec.family}: 字体请求失败 ${fontRes.status}`);
  const buf = Buffer.from(await fontRes.arrayBuffer());
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
    throw new Error(`${spec.family}: 下载到的不是 woff2（头 ${buf.subarray(0, 8).toString("hex")}）`);
  }
  return { chars, buf, css };
}

fs.mkdirSync(outDir, { recursive: true });
const done = {};
for (const [key, spec] of Object.entries(FONT_SPECS)) {
  const { chars, buf, css } = await fetchSubset(spec);
  fs.writeFileSync(path.join(outDir, spec.file), buf);
  done[key] = { file: spec.file, family: spec.family, chars, bytes: buf.length, css };
  console.log(`${key}: ${spec.file}  ${chars.length} chars  ${(buf.length / 1024).toFixed(1)}KB`);
}

const total = Object.values(done).reduce((n, d) => n + d.bytes, 0);
fs.writeFileSync(
  path.join(outDir, "lobby-subset.json"),
  JSON.stringify(
    {
      note: "对局大厅 B 案自带字体子集（生成脚本 scripts/gen-lobby-fonts.mjs，字符清单 scripts/lib/lobby-font-chars.mjs）",
      fonts: Object.fromEntries(
        Object.entries(done).map(([key, d]) => [
          key,
          { file: d.file, family: d.family, chars: d.chars, bytes: d.bytes },
        ]),
      ),
      totalBytes: total,
      limits: FONT_LIMITS,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

const over = Object.entries(done).filter(([, d]) => d.bytes > FONT_LIMITS.perFile);
if (over.length) {
  throw new Error(`有字体超过单份上限 ${FONT_LIMITS.perFile}B：${over.map(([k, d]) => `${k}=${d.bytes}`).join(", ")}`);
}
if (total > FONT_LIMITS.total) throw new Error(`两份合计 ${total}B 超过上限 ${FONT_LIMITS.total}B`);
console.log(`total: ${(total / 1024).toFixed(1)}KB（上限 ${(FONT_LIMITS.total / 1024).toFixed(0)}KB）`);
