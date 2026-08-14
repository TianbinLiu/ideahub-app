// 发布「诗绘」安装包：生成清单 → 建 GitHub Release → **回头从公网验一遍**。
//
//   node scripts/release.mjs        发布
//   node scripts/release.mjs --dry  只检查不发布
//
// ★★ 为什么要有这个脚本，而不是手动 gh release create：下面这几件事**互相独立、
//    错了都不报错**，而且漏了之后你不会知道 —— 你手上的 App 是好的，坏的是所有
//    已经装了旧版的人（启梦 2026-08 真出过：连续三版只改了版本号从未发布，
//    直到有人问"官网怎么还是 1.7"）：
//      ① APK 里的版本号 == 源码里的     不查 → 改了 build.gradle 但忘了重新出包
//      ② 签名指纹 == 上一版             不查 → 老用户装到最后只说「应用未安装」
//      ③ versionCode > 线上那版         不涨 → 所有人的更新检查都判不出有新版
//      ④ 发布**之后**再从公网拉一遍清单  不查 → 标成 draft/pre-release 就 404
//      ⑤ 清单里的 sha256/大小与真实文件一致
//
// ★ 为什么诗绘的 Release 单开一个仓库（ideahub-shihui）而不是发在 ideahub-app：
//   GitHub 的 /releases/latest 是**全仓库**最新的正式 release。诗绘发在 app 仓会顶掉
//   启梦的位置，而诗绘的 release 里没有 latest.json 这个资产 → 每个启梦用户的
//   更新检查从此 404，**且是静默的**。两个 App 各有各的 /releases/latest 才互不干扰。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPO = "TianbinLiu/ideahub-shihui";
/** 启梦的仓库：发版后要确认诗绘的 tag **没有**跑到这里去（见下方事故注释） */
const APP_REPO = "TianbinLiu/ideahub-app";
const DRY = process.argv.includes("--dry");
const APK = path.join(ROOT, "android/app/build/outputs/apk/sideload/release/app-sideload-release.apk");
/** App 自更新与官网下载页实际访问的地址（经服务端转一手，见 server 的 appRelease.routes.js） */
const APP_MANIFEST_URL = "https://api.ideahubs.org/api/app/shihui/latest.json";
const UPSTREAM = `https://github.com/${REPO}/releases/latest/download/latest.json`;

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
/**
 * ★ Windows 上 apksigner 是个 .bat：Node 20 起不允许直接 spawn 批处理文件（EINVAL，
 *   CVE-2024-27980 的修复）。走 shell 并把每个参数原样加引号 —— 与主 App 的
 *   scripts/release.mjs 同一处理，别在这重新发明一遍。
 */
const q = (s) => `"${s}"`;
const sh = (cmd, args) =>
  execFileSync(q(cmd), args.map(q), {
    encoding: "utf8",
    shell: true,
    maxBuffer: 1 << 26,
    // ★★ GH_REPO 是硬绑定：gh 在 --repo 不可用时（例如目标仓库还是空仓库）会
    //   **回退到当前目录的 git remote**，而这个脚本恰恰跑在 ideahub-app 的工作区里。
    //   2026-08-14 就这么把诗绘的 release 发进了 ideahub-app，顶掉启梦的 /releases/latest，
    //   启梦全部已安装用户的更新检查当场返回诗绘的清单（15 分钟后发现并删除）。
    //   --repo 只是"请求"，GH_REPO 才是"规定"。两个都留着。
    env: { ...process.env, GH_REPO: REPO },
  });

function readVersion() {
  const g = fs.readFileSync(path.join(ROOT, "android/app/build.gradle"), "utf8");
  const code = /versionCode\s+(\d+)/.exec(g);
  const name = /versionName\s+"([^"]+)"/.exec(g);
  if (!code || !name) die("build.gradle 里读不出 versionCode / versionName");
  return { versionCode: Number(code[1]), versionName: name[1] };
}

const buildTool = () => {
  const dir = path.join(process.env.LOCALAPPDATA || "", "Android/Sdk/build-tools");
  const vers = fs.readdirSync(dir).sort();
  return path.join(dir, vers[vers.length - 1]);
};

async function readManifest(url) {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const { versionCode, versionName } = readVersion();
const tag = `v${versionName}`;
console.log(`\n准备发布诗绘 ${tag}（versionCode ${versionCode}）到 ${REPO}\n`);

if (!fs.existsSync(APK)) die(`没有安装包：${APK}\n先跑 npm run apk:release`);

// ── ① APK 里的版本号必须与源码一致（防"改了版本号但发的是旧包"）──
const bt = buildTool();
const badging = sh(path.join(bt, "aapt2.exe"), ["dump", "badging", APK]);
const apkCode = Number(/versionCode='(\d+)'/.exec(badging)?.[1]);
const apkName = /versionName='([^']*)'/.exec(badging)?.[1];
if (apkCode !== versionCode || apkName !== versionName) {
  die(`APK 里是 ${apkName}(${apkCode})，源码里是 ${versionName}(${versionCode}) —— 包是旧的，重新出包`);
}
console.log(`✓ APK 版本号与源码一致`);

// ── ② 签名指纹必须与上一版相同（换过 keystore 老用户装不上）──
const certs = sh(path.join(bt, "apksigner.bat"), ["verify", "--print-certs", APK]);
const fp = /SHA-256 digest:\s*([0-9a-f]+)/i.exec(certs)?.[1];
if (!fp) die("读不出 APK 签名指纹 —— 这个包没签名？");
const fpFile = path.join(ROOT, ".release-signer-sha256");
if (fs.existsSync(fpFile)) {
  const prev = fs.readFileSync(fpFile, "utf8").trim();
  if (prev !== fp) {
    die(`签名指纹变了：\n  上一版 ${prev}\n  这一版 ${fp}\n` +
        `老用户点更新会装到最后提示「应用未安装」，只能卸载重装。确认要换 keystore 的话删掉 ${fpFile} 再跑。`);
  }
  console.log("✓ 签名指纹与上一版一致");
} else {
  console.log(`（首次发布，记下签名指纹 ${fp.slice(0, 16)}…）`);
}

// ── ③ versionCode 必须比线上那版大 ──
const live = await readManifest(UPSTREAM);
if (live) {
  console.log(`✓ 线上当前是 ${live.versionName}(${live.versionCode})`);
  if (versionCode <= live.versionCode) {
    die(`versionCode ${versionCode} 不大于线上的 ${live.versionCode} —— 发出去也没人会收到更新。\n` +
        `改 android/app/build.gradle 的 versionCode 再重新出包。`);
  }
} else {
  console.log("⚠ 拉不到线上清单（首次发布，或网络不通）—— 跳过版本号递增检查");
}

// ── ④ 写清单 ──
const apkBuf = fs.readFileSync(APK);
const notesFile = path.join(ROOT, "RELEASE_NOTES.md");
const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8").trim() : "";
if (!notes) console.log("⚠ 没有 RELEASE_NOTES.md —— 更新弹窗与下载页里将没有「这一版改了什么」");
// 资产名带版本号：GitHub 同名资产不能共存，而 apkUrl 是按 tag+文件名拼的
const apkAsset = `shihui-${versionName}.apk`;
const manifest = {
  versionCode,
  versionName,
  apkUrl: `https://github.com/${REPO}/releases/download/${tag}/${apkAsset}`,
  sizeBytes: apkBuf.length,
  sha256: createHash("sha256").update(apkBuf).digest("hex"),
  notes,
};
const out = path.join(ROOT, "android/app/build/outputs");
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.copyFileSync(APK, path.join(out, apkAsset));
console.log(`✓ 清单已生成（${(apkBuf.length / 1048576).toFixed(1)}MB，sha256 ${manifest.sha256.slice(0, 12)}…）`);

if (DRY) {
  console.log("\n--dry：检查全部通过，没有发布。\n");
  process.exit(0);
}

// ── ⑤ 发布 ──
const existing = (() => {
  try {
    sh("gh", ["release", "view", tag, "--repo", REPO]);
    return true;
  } catch {
    return false;
  }
})();
// ★ 建 release 与传资产**分开**：原来写成"已存在就整个跳过"，于是
//   "release 建好了但资产没传上去"这种半成品状态永远修不好——重跑一次照样跳过，
//   而清单地址 404 是静默的。现在无论如何都 --clobber 覆盖上传一遍。
if (existing) {
  console.log(`\n${tag} 已存在，直接更新资产`);
} else {
  console.log(`\n正在发布 ${tag}…`);
  sh("gh", ["release", "create", tag,
    "--title", `诗绘 ${versionName}`,
    "--notes", notes || `诗绘 ${versionName}`,
    "--repo", REPO]);
}
sh("gh", ["release", "upload", tag,
  path.join(out, apkAsset), path.join(out, "latest.json"),
  "--clobber", "--repo", REPO]);
console.log("✓ 安装包与清单已上传");

// ★ 发完立刻确认它**落在了正确的仓库**，并且没有污染启梦那个仓库。
//   这条检查是 2026-08-14 事故的产物：当时 release 发进了 ideahub-app，
//   而脚本毫不知情，一路跑到"验证更新链"才因为拉不到清单而失败——
//   报的是"老用户收不到更新"，真正的病因（发错仓库）一个字都没提到。
try {
  sh("gh", ["api", `repos/${REPO}/releases/tags/${tag}`]);
} catch {
  die(`${tag} 没有出现在 ${REPO} —— 发错仓库了？检查 gh auth 与 GH_REPO`);
}
try {
  sh("gh", ["api", `repos/${APP_REPO}/releases/tags/${tag}`]);
  die(`⚠ ${APP_REPO} 里也出现了 ${tag} —— 这会顶掉启梦的 /releases/latest，\n` +
      `启梦所有已安装用户的更新检查会拿到诗绘的清单。立刻删除：\n` +
      `  gh release delete ${tag} --repo ${APP_REPO} --yes --cleanup-tag`);
} catch (e) {
  if (String(e.message).includes("顶掉启梦")) throw e; // 上面 die 抛的，别被这层 catch 吞掉
  // 404 = 正常：启梦仓库里不该有这个 tag
}

// ── ⑥ ★ 回头验证：从公网真拉一遍。前面每一条都可能"看着对但线上是错的" ──
console.log("\n验证更新链…");
// 重试而不是"睡 3 秒看一眼"：GitHub 把 /latest 指到新 Release 要几秒到几十秒。
// 一次就判失败的话，每次发版都"自检失败但其实是好的"，人很快会开始无视它
let check = null;
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  check = await readManifest(UPSTREAM);
  if (check?.versionCode === versionCode) break;
  process.stdout.write(`  等 /latest 指过来…（${(i + 1) * 5}s）\r`);
}
console.log("");
if (!check) die("发完了，但 /releases/latest/download/latest.json 拉不到 —— 老用户收不到这次更新");
if (check.versionCode !== versionCode) {
  die(`等了 60 秒，固定地址返回的还是 ${check.versionName}(${check.versionCode})。\n` +
      `多半是这个 Release 被标成了 draft 或 pre-release（/latest 会跳过它们），或漏传了 latest.json。`);
}
console.log("✓ 上游清单已就位");
fs.writeFileSync(fpFile, `${fp}\n`);

// 服务端那份（App 与官网下载页实际访问的地址）。服务端还没接诗绘时这里会一直拿不到，
// 属预期内 —— 提示一句而不是判失败，别把"服务端还没部署"说成"发版失败"
const app = await readManifest(APP_MANIFEST_URL);
if (app?.versionCode === versionCode) {
  console.log("✓ 服务端转发的清单也已是这一版");
} else {
  console.log(`⚠ ${APP_MANIFEST_URL} 还不是这一版 —— 服务端若尚未接入诗绘通道，属预期内`);
}

console.log(`\n发布完成：\n  安装包 https://github.com/${REPO}/releases/download/${tag}/${apkAsset}\n  清单   ${UPSTREAM}\n`);
