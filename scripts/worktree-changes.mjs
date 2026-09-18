// 「这个工作区里有没有真改动」—— 按**内容**判，不照搬 `git status --porcelain`。
// scripts/land.mjs 的三道「干净」闸（本分支开工前 / main 那边 / 构建之后的 src/locales）都问这里。
//
// ★★ 为什么不直接看 git status（2026-09-17 实测）：Windows 上 core.autocrlf=true，把 origin/main 合进分支之后，
//   合并检出的 src/locales/*.po 是 CRLF，构建里的 `lingui extract` 又把它们重写成 LF。这时
//   `git status --porcelain src/locales` 报 ` M`，可 `git diff` 为空、`git hash-object` 与 `HEAD:<path>` 逐位相同 ——
//   内容一个字没变，land 却被「extract 改了目录」那道闸拦下，手工 `git add` 那两个 .po 刷新索引后才过。
//   机理：索引里缓存的是检出那一刻（CRLF 版）的文件大小，**大小一变** git 就直接当它改过、不去读内容
//   （对照实测：只改 mtime、字节不变的文件，git status 自己按内容核过就刷掉了；大小变了的刷不掉）。
//   所以 `git update-index --refresh` 也救不了它（实测退出码 0、status 照旧报 M）；只有 porcelain 的 `git diff`
//   会把这种条目读出来、按 autocrlf 换算之后再比一遍内容。
// ★ 同一个假阳性还绊得住另外两道闸：构建过一次再跑 land（本分支开工前那道），以及 main 那边出过包之后
//   （出包也跑构建，main 那道）。main 那边光放行还不够：接下来的 `git merge --ff-only` 要改写这几个文件时，
//   git 同样只比 stat，会以「本地改动会被合并覆盖」整发拒绝（实测）。所以另给一个出口 refreshStat：
//   内容核过一样的，替它把 stat 刷进索引 —— 就是那次手工的 `git add`，只是先核过内容。
import { execFileSync } from "node:child_process";

// -z：路径不转义、不加引号 —— 下面拿两条命令的输出逐字相减，转义规则不同就对不上。
// core.safecrlf=false：只管 autocrlf 那句「LF 下次检出会换成 CRLF」的警告 / 拒绝，不改换算本身（按内容比的结果不变）。
//   要它是为了 refreshStat：safecrlf=true 的机器上，add 一个只差行尾的文件会被当场拒（实测
//   `fatal: LF would be replaced by CRLF`）；diff 那几条顺带不再往 stderr 攒警告（实测每个文件一句、约 125 字节）。
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "core.safecrlf=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\0")
    .filter(Boolean);

/**
 * cwd 须是工作区根目录（路径都按仓库根相对，pathspec 也一样）。
 * - real：提交之后内容会变的路径 —— 暂存了没提交的、工作区里按内容比真改了的、没跟踪的新文件。
 *   git status 会报的就是这几类，唯独少了下面那一类。
 * - stale：git status 报「改过」、按内容比却一个字没变的路径（只是索引里缓存的 stat 过期了）。
 */
export function changesOf(cwd, pathspec = []) {
  const spec = ["--", ...pathspec];
  const staged = git(cwd, "diff", "--cached", "--no-renames", "--name-only", "-z", ...spec);
  // ★ 按内容复核只有 porcelain 的 `git diff` 做，靠的是 diff.autoRefreshIndex（缺省开）。这里写死：
  //   实测把它关掉，这一条就把只差 stat 的 .po 也列出来了 —— 谁的全局配置关了它，闸就悄悄退回按 stat 判。
  const unstaged = git(cwd, "-c", "diff.autoRefreshIndex=true", "diff", "--no-renames", "--name-only", "-z", ...spec);
  const untracked = git(cwd, "ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory", "-z", ...spec);
  const byContent = new Set(unstaged);
  return {
    real: [...new Set([...staged, ...unstaged, ...untracked])],
    // plumbing 的 diff-files 只比 stat：它列出来、按内容比却没改的，就是 stale
    stale: git(cwd, "diff-files", "--name-only", "-z", ...spec).filter((p) => !byContent.has(p)),
  };
}

/**
 * 把 changesOf 给的 stale 刷进索引（重新 add 一遍，只更新缓存的 stat）。
 * ⚠ 只准喂 stale：内容已经核过一样，写进索引的还是同一个 blob、暂存区里什么都不会多；
 *   喂一条真改了的，就是把它暂存了。
 */
export function refreshStat(cwd, paths) {
  if (paths.length) git(cwd, "add", "--", ...paths);
}
