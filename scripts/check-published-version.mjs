// 源码里的版本号，到底发出去了没有。
//
// ★★ 为什么值得单独查一遍：**改 versionCode 和"发一版"是两件事**，而漏掉后者
//    没有任何症状 —— 你本地装的是新的，CI 是绿的，仓库看着也没问题；
//    唯一的受害者是所有已经装了 App 的人：他们的「检查更新」一直查不到新版，
//    而那个失败是**静默的**（查不到就当没有新版，不打扰用户）。
//
//    真事（2026-08）：1.8 与 1.9 只提交了版本号，从未打 tag、从未建 Release。
//    直到有人问"官网下载页怎么还是 1.7"才发现，那时线上已经落后三版，
//    而这中间所有版本的改动，没有一个用户拿到过。
//
// ★ 只提醒、**不阻断**：源码领先线上是开发期间的正常状态（改完还没发很正常）。
//   一旦阻断，每个 PR 都是红的，人会立刻学会无视它 —— 那这道闸门就白写了。
//   所以这里永远 exit 0，只往 PR 的检查页面上打 warning 和摘要。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
/** 权威的"已发布"那份：发版脚本保证这个地址永远指向最新一版 */
const MANIFEST_URL = "https://github.com/TianbinLiu/ideahub-app/releases/latest/download/latest.json";

/** 往 PR 的检查页面上写（本地跑时这两个环境变量不存在，就只打印） */
function report(level, message, summary) {
  console.log(`::${level}::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }
}

function readVersion() {
  const g = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  const code = /versionCode\s+(\d+)/.exec(g);
  const name = /versionName\s+"([^"]+)"/.exec(g);
  if (!code || !name) return null;
  return { versionCode: Number(code[1]), versionName: name[1] };
}

const src = readVersion();
if (!src) {
  // 读不出来不该把 PR 弄红：这一步是提醒，不是门禁
  report("notice", "build.gradle 里读不出版本号，跳过发布状态检查", "ℹ️ 跳过发布状态检查（读不出版本号）");
  process.exit(0);
}

let live = null;
try {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  const res = await fetch(`${MANIFEST_URL}?cb=${Date.now()}`, { redirect: "follow", signal: ctl.signal });
  clearTimeout(timer);
  if (res.ok) live = await res.json();
} catch {
  /* 网络不通不该把 PR 弄红 */
}

if (!live || typeof live.versionCode !== "number") {
  report("notice", "拉不到线上清单，跳过发布状态检查", "ℹ️ 拉不到线上清单，跳过发布状态检查");
  process.exit(0);
}

const behind = src.versionCode - live.versionCode;
if (behind > 0) {
  const msg =
    `源码是 ${src.versionName}(${src.versionCode})，但线上已发布的最新版还是 ` +
    `${live.versionName}(${live.versionCode}) —— 有 ${behind} 个版本号没发出去。` +
    `已经装了 App 的用户收不到这些改动（他们的检查更新是静默失败的）。` +
    `要发就跑：npm run apk:release && npm run aab && npm run release`;
  report("warning", msg, [
    "### ⚠️ 有版本没发出去",
    "",
    "| | 版本 |",
    "|---|---|",
    `| 源码 \`android/app/build.gradle\` | **${src.versionName}** (versionCode ${src.versionCode}) |`,
    `| 线上已发布的最新版 | ${live.versionName} (versionCode ${live.versionCode}) |`,
    "",
    `差 **${behind}** 个版本号。已安装用户拿不到这中间的任何改动，而他们那边的「检查更新」失败是**静默的** —— 不会有人来报。`,
    "",
    "发版：`npm run apk:release && npm run aab && npm run release`（别忘了先写 `RELEASE_NOTES.md`）。",
  ].join("\n"));
} else if (behind === 0) {
  report("notice", `版本号与线上一致：${live.versionName}(${live.versionCode})，没有漏发`,
    `✅ 已发布到最新：${live.versionName} (versionCode ${live.versionCode})`);
} else {
  // 线上比源码还新：多半是有人发版时没把版本号提交回来
  report("warning",
    `线上是 ${live.versionName}(${live.versionCode})，比源码里的 ${src.versionName}(${src.versionCode}) 还新 —— 发版时的版本号可能没提交回仓库`,
    `⚠️ 线上（${live.versionName}）比源码（${src.versionName}）还新，发版时的版本号可能没提交回来`);
}
