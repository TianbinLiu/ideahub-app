#!/usr/bin/env node
// 把当前分支「落回」main —— 单主干纪律的可执行版（2026-08-29 主人点名：
// "新 session 开的分支，任务完成后自动和主分支合并，保持以单个分支为主"）。
//
// 为什么要有这个脚本，而不是只在 CLAUDE.md 里写一句"记得合回去"：
// ★★ 这个仓库同时开着十几个 worktree，各自出包、各自涨 versionCode。2026-08-29 真出过
//   一次事故：主人手机上装的是 A 分支的 44，而当时正在验的是 B 分支的改动 —— 用户看到的
//   是"功能不见了、改动回退了"，查了一圈才发现两条分支在互相覆盖手机上的包。合流慢一天，
//   就多一天这种"查半天原来是装错包"。
// ★ 门禁在合之前跑（tsc && vite build）：main 是出包的那条线，合进去才发现构建挂了，
//   下一个 session 一开工就撞墙。
//
// 用法（在自己的 worktree 里）：
//   npm run land              合回 main 并推（远端 main 受保护时自动改走 PR）
//   npm run land -- --keep    合完不删本地分支
//   npm run land -- --dry     只做检查，不动任何东西
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { changesOf, refreshStat } from "./worktree-changes.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const dry = args.includes("--dry");
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
// 列前 10 条：真改动可能成百上千条，全倒出来就把那句话淹了
const listOf = (paths) =>
  [...paths.slice(0, 10), ...(paths.length > 10 ? [`…还有 ${paths.length - 10} 条`] : [])].map((p) => `    ${p}`).join("\n");

// ★ 三道「干净」闸只有这一处实现：按**内容**判，不照搬 git status —— Windows autocrlf 下构建把 .po 的行尾
//   改写之后，git status 会把一个字没变的文件报成改过（2026-09-17 实测，全过程见 worktree-changes.mjs 头上）。
//   真改动一律拦下、原话照说；只差 stat 的替它刷新索引（不刷的话 main 那边接下来的合并会被 git 拒掉），
//   dry-run 只报不动。
const assertClean = (where, cwd, pathspec, msg) => {
  const { real, stale } = changesOf(cwd, pathspec);
  if (real.length) die(`${msg}\n${listOf(real)}`);
  if (!stale.length) return;
  if (dry) {
    console.log(`（${where}：${stale.length} 个文件内容没变、只是索引里缓存的 stat 对不上，真跑时会刷新索引）\n${listOf(stale)}`);
    return;
  }
  refreshStat(cwd, stale);
  console.log(`▶ ${where}：${stale.length} 个文件内容没变、只是索引里缓存的 stat 过期了（多半是构建改写了行尾），已刷新索引\n${listOf(stale)}`);
};

const branch = sh("git rev-parse --abbrev-ref HEAD");
if (branch === "main") die("已经在 main 上，没什么可落的。");
if (branch === "HEAD") die("当前是游离 HEAD（没有分支），先 git switch -c <名字>。");

// ★ 未提交的改动一律拦下：合并会把它们带进 main 的工作区，或者被 checkout 冲掉。
//   这是"帮你收拾"和"把你的活弄丢"之间那条线 —— 站在不弄丢那一侧。
//   （按内容判：先跑过一次 npm run build 再来落，.po 就只差行尾 —— 原来这里照 git status 判，会被它拦下）
assertClean("本分支", ".", [], "工作区还有没提交的改动，先提交（或收进 WIP 提交）再落。");

// main 在哪个 worktree 里（本仓 main 常年被主目录占着，别的 worktree 切不过去）
const wt = sh("git worktree list --porcelain")
  .split("\n\n")
  .map((b) => Object.fromEntries(b.split("\n").map((l) => [l.split(" ")[0], l.slice(l.indexOf(" ") + 1)])))
  .find((w) => w.branch === "refs/heads/main");
if (!wt) die("找不到 main 所在的 worktree（git worktree list 里没有 refs/heads/main）。");
const MAIN = wt.worktree;
// main 那边出过包（出包也跑构建）之后同样只差行尾：放行之外还得刷新索引，下面的 merge --ff-only 才不会被拒
assertClean("main", MAIN, [], `main 那边（${MAIN}）工作区不干净，先去收拾一下再落。`);

console.log(`▶ 落分支：${branch} → main（${MAIN}）`);

// ① 门禁：构建过不了不许进 main
if (!dry) {
  if (!existsSync("node_modules")) die("先 npm install。");
  console.log("▶ 构建门禁 tsc && vite build …");
  run("npm run build");
  // ★ 构建里那步 `lingui extract` 会改写 src/locales 的 .po：上面那道「工作区干净」的检查在构建**之前**，
  //   构建改出来的目录留在工作区、不会合进 main —— main 上的目录会悄悄落后于代码，出包时英文界面冒中文。
  // ★ 按内容判：extract 每次都把 .po 写成 LF，而合并检出的是 CRLF（autocrlf），照 git status 判的话
  //   一个 msgid 没变也拦（2026-09-17 实测误拦）。新增 msgid、新语言的目录这类真改动照拦。
  assertClean("本分支", ".", ["src/locales"], "构建里的 lingui extract 改了 src/locales 的目录，先提交它们再落。");
}

// ② 先把 main 拉到最新，再把自己的分支合进去（冲突就停下交给人）
if (dry) {
  const ahead = sh(`git rev-list --count main..${branch}`);
  const behind = sh(`git rev-list --count ${branch}..main`);
  console.log(`✓ dry-run：领先 main ${ahead} 条、落后 ${behind} 条；工作区干净、main 干净。`);
  process.exit(0);
}
run(`git -C "${MAIN}" fetch origin main --quiet`);
run(`git -C "${MAIN}" merge --ff-only origin/main`, { stdio: "inherit" });
try {
  run(`git -C "${MAIN}" merge --no-edit ${branch}`);
} catch {
  die(`合并有冲突，已停在 main 的工作区（${MAIN}）。解完 git add + git commit，再跑一次 npm run land。`);
}

// ③ 推 main；远端 main 受保护（本仓开着 ruleset：必须走 PR + build 门禁）时改走 PR
let pushed = false;
try {
  run(`git -C "${MAIN}" push origin main`);
  pushed = true;
} catch {
  console.log("▶ 直推 main 被仓库规则拒绝（分支保护），改走 PR …");
  const tmp = `land/${branch.replace(/[^\w.-]+/g, "-")}`;
  run(`git -C "${MAIN}" push -f origin HEAD:refs/heads/${tmp}`);
  try {
    run(`gh pr create --base main --head ${tmp} --title "chore: 落 ${branch} 回 main" --body "npm run land 自动开的 PR。构建门禁已在本地跑过。"`, { cwd: MAIN });
  } catch {
    console.log("（PR 可能已存在，继续）");
  }
  console.log(`▶ PR 已开：等 CI 绿了 gh pr merge --merge（分支 ${tmp}）`);
}

// ④ 收尾：分支已经在 main 里了，本地那条就没用了
if (!keep && pushed) {
  try {
    run(`git -C "${MAIN}" branch -d ${branch}`);
    run(`git push origin --delete ${branch}`);
  } catch {
    console.log("（分支删除没成——多半是它还被别的 worktree 占着，手动删即可）");
  }
}
console.log(`\n✓ ${branch} 已落回 main${pushed ? "（已推）" : "（等 PR 合）"}。`);
