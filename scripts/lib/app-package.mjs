// 开包看：安装包（APK / AAB）里的 web 资产、权限表、入仓 jar 的来源 —— scripts/release.mjs 第 2b～2d 步用（2026-10-15 教材人格评审）。
//
// ★ 为什么单独抽成一个模块：release.mjs 一 import 就跑 main()，没法拿真的安装包单独验这几个函数；抽出来之后
//   `node --input-type=module -e` 对着 android/app/build/outputs 里的包就能跑一遍（写的时候就是这么验的）。
// ★ 这里只**读**：回答「包里有什么」，判「该不该有」在 release.mjs（允许表 / 白名单都在那边或 ./protected-models.mjs）。
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { PROTECTED_DIR } from "./protected-models.mjs";

/**
 * 安装包里的 web 资产：受保护模型有哪几个、index.html 引的入口 js 叫什么、那个 js 在不在包里。
 * @param {string} zipPath APK 或 AAB
 * @param {string} prefix web 资产在包里的前缀：APK 是 `assets/public/`，AAB 是 `base/assets/public/`（Capacitor 把 dist/ 整个拷到那儿）
 */
export async function inspectWebBundle(zipPath, prefix) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const dir = `${prefix}${PROTECTED_DIR}/`;
  const protectedFiles = names.filter((n) => n.startsWith(dir)).map((n) => n.slice(dir.length)).sort();
  const html = zip.file(`${prefix}index.html`);
  const entryJs = html ? entryJsOf(await html.async("string")) : null;
  return {
    hasIndex: !!html,
    entryJs,
    hasEntryFile: !!entryJs && !!zip.file(`${prefix}${entryJs}`),
    protectedFiles,
  };
}

/** index.html 里引的入口脚本（`assets/index-<hash>.js`，vite 每次构建换 hash）；读不出回 null */
export function entryJsOf(html) {
  return /<script[^>]*\bsrc="\/?(assets\/index-[^"]+\.js)"/.exec(html)?.[1] ?? null;
}

/**
 * APK 的 uses-permission 整表（`aapt2 dump permissions`，看的是包本身）。
 * 输出里另有 `permission: …`（本应用**声明**的权限，androidx.core 生成的那条）—— 不算，只收 uses-permission。
 * @param {(cmd: string, args: string[]) => string} run 跑命令的函数（release.mjs 的 run：Windows 上 .bat 要过 shell）
 */
export function apkPermissions(run, aapt2, apk) {
  const out = run(aapt2, ["dump", "permissions", apk]);
  return [...out.matchAll(/^uses-permission(?:-sdk-23)?: name='([^']+)'/gm)].map((m) => m[1]).sort();
}

/**
 * 合并清单（gradle 的 intermediates/merged_manifests/<variant>/…/AndroidManifest.xml）里的 uses-permission 整表。
 * ★ AAB 是 protobuf 清单，aapt2 读不了；同一次 gradle 跑出来的合并清单就是打进 bundle 的那份。
 */
export function manifestPermissions(xmlPath) {
  const xml = fs.readFileSync(xmlPath, "utf8");
  return [...xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*\bandroid:name="([^"]+)"/g)].map((m) => m[1]).sort();
}

/** 两张权限表的差（给报错用） */
export function permissionDiff(got, want) {
  const g = new Set(got);
  const w = new Set(want);
  return { extra: got.filter((p) => !w.has(p)), missing: want.filter((p) => !g.has(p)) };
}

/**
 * 入仓 jar 的来源核对：`android/app/libs/` 下每个 *.jar 都要在同目录 README.md 的表里有一行（文件名与 sha256 两格用反引号包着，
 * 机读的就是这两格），而且文件的 sha256 要与表里的一致。表里没有的 jar = 来路不明。
 * @returns {{ ok: string[], problems: string[] }}
 */
export function jarProvenance(libsDir, sha256) {
  const readme = path.join(libsDir, "README.md");
  const ok = [];
  const problems = [];
  if (!fs.existsSync(readme)) return { ok, problems: [`${libsDir} 里没有 README.md —— 入仓 jar 的来源与 sha256 没处核`] };
  const table = new Map();
  for (const m of fs.readFileSync(readme, "utf8").matchAll(/^\|\s*`([^`]+\.jar)`\s*\|.*\|\s*`([0-9a-f]{64})`\s*\|\s*$/gim)) table.set(m[1], m[2].toLowerCase());
  const jars = fs.readdirSync(libsDir).filter((n) => n.toLowerCase().endsWith(".jar")).sort();
  for (const jar of jars) {
    const want = table.get(jar);
    if (!want) {
      problems.push(`${jar} 不在 android/app/libs/README.md 的表里 —— 来路不明的 jar 不进包：记下它从哪下的、哪天下的、sha256 是多少，再发`);
      continue;
    }
    const got = sha256(fs.readFileSync(path.join(libsDir, jar)));
    if (got !== want) problems.push(`${jar} 的 sha256 ${got.slice(0, 12)}… 与 README.md 里记的 ${want.slice(0, 12)}… 不一致 —— 文件被换过？先弄清是谁换的、从哪下的，再改表`);
    else ok.push(`${jar} 的 sha256 与 android/app/libs/README.md 一致`);
  }
  for (const name of table.keys()) if (!jars.includes(name)) problems.push(`README.md 里记着 ${name}，libs/ 里却没有这个文件`);
  return { ok, problems };
}
