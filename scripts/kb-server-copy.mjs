#!/usr/bin/env node
// 客服知识库：app 正本（docs/support-knowledge-base.md）→ 服务端副本（server 仓 src/knowledge/support-kb.md）。
//
// ★ 为什么要有这个脚本（2026-10-15）：副本头注释里写着 5 条剥离规则，但生成它的脚本此前只活在某一次会话的 scratchpad 里，
//   每次发版都得重新凭规则写一个、再对上一版逐字节复现才敢用（memory support-kb-maintenance）。这里是那份脚本的正本：
//   2026-10-15 对「app de5fbaa → 服务端 2026-10-09 那份副本」逐字节复现过（equal: true）才入仓。
// ★ 规则（与副本头注释逐字相同；改规则两处一起改）：
//   ① 删掉开头两行讲「出处」的 > 引用行（文件头部提到「出处」的前两条引用行；「> 用途…」那条留着）；
//   ② 「文字 — `…`」（破折号 + 空格 + 反引号，破折号前至少有一个字）从**第一个**这样的破折号起整段删到行尾；
//   ③ 「（`含反斜杠的路径`）」整个括号删掉；④ 其余含反斜杠的行内代码删掉；⑤ 行尾去空白。
//   输出 = 头注释 + 空行 + 正文，末尾不带换行。
//   ⚠ 源文件里出处要写成「— `…`」才会被 ② 整段剥掉：写成「— 服务端 `config/…`」只会剥掉带反斜杠的那几段、留下半截
//     （所以服务端文件的出处也写成 `server\src\…`）。
//
// 用法：node scripts/kb-server-copy.mjs <服务端仓里的 src/knowledge/support-kb.md 路径> "<头注释第一行里的来源说明>"
//   例：node scripts/kb-server-copy.mjs ../server/src/knowledge/support-kb.md "app 仓 commit 1b401b6，分支 claude/persona-decisions-2.63，2026-10-15"
//   头注释的其余几行（规则、历史）从目标文件现有的头注释原样保留，只换「（…）剥掉代码出处后生成，生成日期 …」那一句。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const [outPath, stamp] = process.argv.slice(2);
if (!outPath || !stamp) {
  console.error('用法：node scripts/kb-server-copy.mjs <server/src/knowledge/support-kb.md> "<来源说明：app 仓 commit …，分支 …，日期>"');
  process.exit(1);
}

const text = fs.readFileSync(path.join(root, "docs/support-knowledge-base.md"), "utf8").replace(/\r\n/g, "\n");
let lines = text.split("\n");
let removed = 0;
lines = lines.filter((l) => {
  if (removed < 2 && /^> /.test(l) && l.includes("出处")) {
    removed++;
    return false;
  }
  return true;
});
const body = lines
  .map((l) => {
    const i = l.search(/— `/);
    if (i > 0) l = l.slice(0, i);
    l = l.replace(/（`[^`]*\\[^`]*`）/g, "");
    l = l.replace(/`[^`]*\\[^`]*`/g, "");
    return l.replace(/[ \t]+$/g, "");
  })
  .join("\n")
  .replace(/\n+$/, "");

// 头注释：沿用目标文件现有的那一段，只换来源那一句
let header = "";
if (fs.existsSync(outPath)) {
  const old = fs.readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
  const end = old.indexOf("-->\n");
  if (end > 0) header = old.slice(0, end + 4);
}
const today = new Date().toISOString().slice(0, 10);
const sourceLine = `<!-- 由 ideahub-app/docs/support-knowledge-base.md（${stamp}）剥掉代码出处后生成，生成日期 ${today}。改知识请改 app 仓的源文件后重新生成（app 仓 scripts/kb-server-copy.mjs），不要直接改这里`;
header = header
  ? header.replace(/^<!-- 由 ideahub-app\/docs\/support-knowledge-base\.md（[^）]*）剥掉代码出处后生成，生成日期 [^。]*。[^\n]*/, sourceLine)
  : `${sourceLine} -->\n`;
if (!header.startsWith("<!-- 由 ideahub-app")) {
  console.error("目标文件的头注释不是预期形状，没写：先看一眼它的第一行");
  process.exit(1);
}
fs.writeFileSync(outPath, header + "\n" + body);
console.log(`✓ 写出 ${outPath}（正文 ${lines.length} 行，剥掉 ${removed} 条出处引用行）`);
