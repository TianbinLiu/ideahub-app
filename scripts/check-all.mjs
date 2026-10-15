#!/usr/bin/env node
// 一条命令跑全部构建检查（scripts/check-*.mjs），逐道汇总退出码（2026-10-15 教材人格评审，feathers-testing-6）。
//
// ★★ 为什么要有它：原来十八道检查只长在 package.json 的 build 串里，想单独跑一遍得连 tsc + lingui extract + vite build 一起跑；
//   改一条规则想看全部检查还绿不绿，没有一个动词能办。这里只跑检查、不构建。
// ★ 退出码一道都不吞（CLAUDE.md「管道吞掉测试失败」那格）：每一道都跑完（不在第一道红的地方停，一次看全），
//   有一道非零就非零退出，并把失败的脚本名与退出码列出来；被信号杀掉、起不来的也算失败。
// ★ 顺手核一条：新加的 check-*.mjs 有没有接进 build 串 —— 没接进去 = CI 与 land 里永远不跑，而这件事零症状。
//   （build 串仍然逐道明写，不改成调本脚本：那串是 CI 与 land 的门禁，谁跑了什么要一眼看得见；这里按目录 glob 是为了漏不掉。）
// ★ 不跑的两道：check-published-version.mjs（它是 PR 上的提醒、永远 exit 0、还要上网），以及本脚本自己。
//
// 用法：node scripts/check-all.mjs（= npm run check:all）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(root, "scripts");
const SKIP = new Set(["check-all.mjs", "check-published-version.mjs"]);

const scripts = fs
  .readdirSync(scriptsDir)
  .filter((n) => /^check-.*\.mjs$/.test(n) && !SKIP.has(n))
  .sort();

const build = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts?.build ?? "";
const notInBuild = scripts.filter((n) => !build.includes(`node scripts/${n}`));

const failed = [];
for (const n of scripts) {
  console.log(`\n▶ ${n}`);
  const r = spawnSync(process.execPath, [path.join(scriptsDir, n)], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) failed.push(`${n}（${r.status === null ? `没正常退出：${r.signal ?? r.error?.message ?? "?"}` : `退出码 ${r.status}`}）`);
}

console.log(`\n── 共 ${scripts.length} 道 ──`);
if (notInBuild.length) {
  console.error(`❌ 这几道没接进 package.json 的 build 串（CI 与 land 里永远不跑）：\n   ${notInBuild.join("\n   ")}\n   → 把 node scripts/<名字> 加进 "build"（与其它 check 并列）`);
}
if (failed.length) {
  console.error(`❌ ${failed.length} 道没过：\n   ${failed.join("\n   ")}`);
}
if (failed.length || notInBuild.length) process.exit(1);
console.log(`✓ 全部 ${scripts.length} 道检查通过`);
