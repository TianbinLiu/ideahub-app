// 发一版：核对 → 写清单 → 传 GitHub Release → **回头验证整条更新链真的通了**。
//
// ★★ 为什么要有这个脚本，而不是"照着文档手动做四步"：
//   已经装了 App 的人能不能收到这次更新，取决于四件**互相独立、错了都不报错**的事：
//     ① 签名和上一版一致        —— 不一致：用户点了更新，装到最后只说"应用未安装"
//     ② versionCode 比上一版大  —— 不涨：所有人的更新检查都判不出有新版，等于没发
//     ③ Release 里有个叫 latest.json 的资产，且这个 Release 不是 draft/pre-release
//                              —— 缺一样：/releases/latest/download/latest.json 404，
//                                 客户端安静地什么都不做
//     ④ **App 实际打的那个清单地址**（服务端转的那份）也指到了新版
//                              —— 只验上游等于验了一条没人走的路：服务端没部署/挂了/
//                                 缓存没过期，照样"发布成功"，而所有人收不到更新
//     ⑤ 清单里的 sha256 与 apkUrl 和真实文件对得上
//                              —— 对不上：下完校验不过被丢弃，用户看到"更新失败"
//     ⑥ 镜像上的安装包在清单指向它**之前**就已经完整落位
//                              —— 先发清单再传包：传到一半被人下走的半截包会被 Cloudflare
//                                 按 immutable 缓存一年，这一版对那批用户永久更新不了
//   （下面四条是 2026-10-15 教材人格评审补的：原来写在 docs 里让人 unzip / git log 对一眼，人迟早漏）
//     ⑦ 出包的源码就是 origin/main 上那一份、工作区干净（第 0 步）
//                              —— tag 建在远端 main 的 HEAD 上、包是本地 HEAD 出的，对不上就是「tag 指着一份源码、用户装的是另一份」
//     ⑧ 包里的内容是本次构建的、受保护模型只有自有那几个、权限表没漂、入仓的 jar 有来源、原生模块是锁文件那一版（第 2b～2e 步）
//                              —— 版本号对而内容旧不报错；第三方模型随包发出去不报错；插件偷带的权限不报错
//     ⑨ GitHub Release 上那份 APK 与清单逐字节相同（第 7b 步）
//                              —— 它是强制更新弹层上「镜像也下不动」时唯一的备用下载源，原来三份产物只验了两份
//     ⑩ 撤回过的版本（pre-release）也要被这一版的 versionCode 压过（第 4c 步）
//                              —— 撤回让 /latest 退回上一版，可已经装上坏版的人只认更大的 versionCode
//   这几件事全靠人记，迟早漏一件；而漏了之后**你不会知道**——你手上的 App 是好的，
//   坏的是所有已经装了旧版的人。所以这里逐条检查，最后再从公网**真的拉一遍**清单与整个包核对。
//
// 用法（仓库根目录）：
//   npm run release            出包 + 发布
//   npm run release -- --dry   只检查不发布（改完 versionCode 想先看一眼时用）
//   npm run release -- --min-version-code=75
//                              这一版起**强制更新**：versionCode < 75 的包一打开就只能更新（清单的 minVersionCode，见 parseMinFlag 的 ★★）。
//                              不传 = 沿用上一版清单里的值（没有就是不强制）。也可以用环境变量 RELEASE_MIN_VERSION_CODE=75。
//                              `--min-version-code 75`（空格隔开）也认；认不出的参数一律当场停（见 parseArgs 的 ★★）。
//   npm run release -- --withdraw v2.63
//                              **发错了，止血**：把那一版标成 pre-release，/latest 当场退回上一版（见 withdraw 的 ★★ 与
//                              docs/app-distribution.md「发错了」）。只做这一步，并把它做不到的三件事当面说出来。单独用，不与别的参数搭。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { apkPermissions, entryJsOf, inspectWebBundle, jarProvenance, manifestPermissions, nativeModuleDrift, permissionDiff } from "./lib/app-package.mjs";
import { OWN_PROTECTED_MODELS, PROTECTED_DIR } from "./lib/protected-models.mjs";
import { changesOf } from "./worktree-changes.mjs";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

/**
 * 命令行参数 —— 只认这几种写法：`--dry`、`--min-version-code=N`、`--min-version-code N`、`--withdraw <tag>`；**别的一律当场停**。
 *
 * ★★ 为什么要严（2026-10-10 评审抓到）：原来只认 `--min-version-code=N` 这一种写法，其余写法**被悄悄忽略**：
 *   · `npm run release -- --min-version-code 76`（空格）→ 没认出来 → 沿用上一版的门槛（多半是 0）→ 强制更新悄悄没发出去；
 *   · `npm run release --min-version-code=76`（少了 `--`）→ npm 把它吞成自己的配置（环境变量 npm_config_min_version_code），
 *     脚本根本收不到，结局同上。`npm run release --dry` 同理：npm 吞掉 `--dry`，脚本**照常正式发布**。
 *   全程只多一行「✓ 不强制更新」，发完的核对也照着那个沿用的数核、一路全绿；而同一个版本号发出去就改不了（重跑不许改门槛），
 *   要补只能再涨一版。所以：认不出就停；npm 吞掉的那两个从它的环境变量里捡回来，并当面说一句。
 * ★ `--withdraw`（2026-10-15 教材人格评审）同一条纪律：被 npm 吞掉而没认出来的后果是**照常发一版**，比没发更坏，所以也从
 *   npm_config_withdraw 里捡；它与 --dry / --min-version-code 不搭 —— 撤回不出包、不发布。
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let dry = false;
  /** @type {string | undefined} */
  let minRaw;
  let minFrom = "";
  /** @type {string | undefined} */
  let withdraw;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") dry = true;
    else if (a.startsWith("--min-version-code=")) {
      minRaw = a.slice("--min-version-code=".length);
      minFrom = a;
    } else if (a === "--min-version-code") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) die("--min-version-code 后面要跟一个整数（versionCode），例：--min-version-code=76");
      minRaw = v;
      minFrom = `${a} ${v}`;
      i++;
    } else if (a.startsWith("--withdraw=")) {
      withdraw = a.slice("--withdraw=".length);
    } else if (a === "--withdraw") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) die("--withdraw 后面要跟要撤回的 tag（v<versionName>），例：--withdraw v2.63");
      withdraw = v;
      i++;
    } else {
      die(`不认识的参数「${a}」。只认：--dry、--min-version-code=N（或 --min-version-code N）、--withdraw <tag>。\n` +
          `写错的参数不会被悄悄忽略 —— 那正是强制更新没发出去、却一路显示成功的那种错。`);
    }
  }
  // npm 吞掉的写法（少了 `--`）：值在 npm_config_* 里。捡回来，但要说出来 —— 下次照着文档写 `npm run release -- …`
  // ★ `--dry` 会被 npm 按缩写认成它自己的 `--dry-run`（npm 11 实测：npm_config_dry_run=true，npm_config_dry 不出现），两个都看。
  //   `--min-version-code 76`（少了 `--`、空格隔开）npm 会把 76 当成位置参数传进来 —— 上面那条「不认识的参数」会停在它上面
  const truthy = (v) => v !== undefined && v !== "" && v !== "false";
  if (truthy(process.env.npm_config_dry) || truthy(process.env.npm_config_dry_run)) {
    console.log("⚠ 看到 npm 吞掉的 --dry（写成了 npm run release --dry，少了 `--`）—— 按「只检查不发布」跑。下次写 npm run release -- --dry");
    dry = true;
  }
  const npmWithdraw = process.env.npm_config_withdraw;
  if (truthy(npmWithdraw)) {
    // `npm run release --withdraw=v2.63` → 值在这里；`--withdraw v2.63`（空格）→ 这里是 "true"、v2.63 成了位置参数（上面已经停在它上面）
    if (!/^v[\w.-]+$/.test(npmWithdraw)) die("--withdraw 被 npm 吞掉了（少了 `--`）：写成 npm run release -- --withdraw v2.63");
    if (withdraw !== undefined && withdraw !== npmWithdraw) die(`两处给了不同的 --withdraw：${withdraw} 与 npm 吞掉的 ${npmWithdraw}。只给一处。`);
    console.log(`⚠ 看到 npm 吞掉的 --withdraw=${npmWithdraw}（少了 \`--\`）—— 照它办。下次写 npm run release -- --withdraw ${npmWithdraw}`);
    withdraw = npmWithdraw;
  }
  if (withdraw !== undefined && (dry || minRaw !== undefined)) die("--withdraw 单独用：撤回不出包、不发布，与 --dry / --min-version-code 不搭。");
  const npmMin = process.env.npm_config_min_version_code;
  if (npmMin !== undefined && npmMin !== "") {
    if (minRaw !== undefined && minRaw.trim() !== npmMin.trim()) {
      die(`两处给了不同的 min-version-code：${minFrom} 与 npm 吞掉的那一个（${npmMin}）。只给一处。`);
    }
    if (minRaw === undefined) {
      console.log(`⚠ 看到 npm 吞掉的 --min-version-code=${npmMin}（少了 \`--\`）—— 照它算。下次写 npm run release -- --min-version-code=${npmMin}`);
      minRaw = npmMin;
      minFrom = `npm_config_min_version_code=${npmMin}`;
    }
  }
  const envMin = process.env.RELEASE_MIN_VERSION_CODE;
  if (envMin !== undefined && envMin !== "") {
    if (minRaw !== undefined && minRaw.trim() !== envMin.trim()) {
      die(`两处给了不同的 min-version-code：${minFrom} 与环境变量 RELEASE_MIN_VERSION_CODE=${envMin}。只给一处。`);
    }
    if (minRaw === undefined) {
      minRaw = envMin;
      minFrom = `RELEASE_MIN_VERSION_CODE=${envMin}`;
    }
  }
  return { dry, minRaw, withdraw };
}

const ARGS = parseArgs();
const DRY = ARGS.dry;

/**
 * 这一次**显式**要的 minVersionCode（命令行 / npm 吞掉的那一个 / 环境变量 RELEASE_MIN_VERSION_CODE，收集在 parseArgs）；
 * 没给 = undefined（沿用上一版的）。
 *
 * ★★ 为什么要有这一格（2026-10-10，方舟 11-24 下线那一批）：清单里的 minVersionCode = 「比它老的包必须先更新才能接着用」
 *   （App 侧 AppUpdaterPlugin.check 算 mandatory，弹层关不掉、不认「以后再说」）。它是一把**只能往上拧**的锁：
 *   · 只在显式要求时才写新值 —— 默认沿用上一版清单里的那个数。顺手发一版就把它丢了 = 悄悄取消了强制更新，
 *     而还没更新的老包就此又能一直用下去，全程没人知道；
 *   · 不许比上一版的小（同一个理由，往回降要有人当面改清单，不该是脚本的一个默认值）；
 *   · 不许比这一版的 versionCode 大 —— 那等于连刚发的这一版也被判成「必须更新」，所有人锁在一张关不掉的弹层前面、无版可装。
 * ★ 0 = 不强制（清单里就不写这一格，老清单本来就没有它）。
 */
function parseMinFlag() {
  const raw = ARGS.minRaw;
  if (raw === undefined || raw === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) die(`--min-version-code 只收非负整数（versionCode），收到的是「${raw}」`);
  return Number(raw.trim());
}
/** 一开跑就核对写法（写错了别等到出完包、拉完清单才停） */
const ASKED_MIN = parseMinFlag();

/**
 * 签名证书指纹。★ 钉死在这里是**故意的**：它是"老用户还能不能装上这次更新"的唯一保证。
 * 换了 keystore（哪怕只是重新生成了一把同名的）这个值就会变，脚本会当场停下 ——
 * 而不是让你发出去之后，从所有老用户那里收到"应用未安装"。
 * 真要换签名（例如上架 Play 启用了 Play App Signing），改这个值之前先想清楚：
 * 老用户必须卸载重装，你得先通知他们。
 */
const EXPECTED_CERT_SHA256 = "6e8cb908797eb3ebb9f75b1de191ab9087a71a70cef588bbcb55dbad6b3ea461";

const REPO = "TianbinLiu/ideahub-app";
/** 上游清单（发布产物本身）。这是**权威**那一份 */
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
/**
 * App 里实际写死的清单地址（.env.production 的 VITE_UPDATE_MANIFEST）。
 * ★ 必须**也验它**：用户的 App 打的是这个地址，不是上面那个。
 *   只验 GitHub 而不验这里，等于验了一条没人走的路 —— 服务端挂了/没部署/缓存没过期，
 *   照样"发布成功"，而所有人收不到更新。
 */
const APP_MANIFEST_URL = "https://api.ideahubs.org/api/app/latest.json";
/**
 * 安装包镜像（国内下载走这条）。
 *
 * ★★ 2026-08-30 线上事故：国内用户点「本地更新」报「GitHub 无法连接」。清单本身没问题
 *   （它走这台服务器），断的是**下载** —— 清单里的 apkUrl 原样透传了 GitHub Releases，
 *   83MB 的包国内基本下不动。所以发版**必须**把包也传一份到自家服务器，并让服务端把
 *   apkUrl 改写过去（server 的 APP_APK_BASE）。
 * ★ GitHub Release 仍然发（它是权威产物与归档），只是不再是用户下载的那条路。
 * ⚠ 镜像文件必须与 Release 资产**逐字节相同**：App 侧会校验清单里的 sha256，
 *   不一致时插件会丢弃并报「校验不通过」—— 那种失败比下不动更难查。
 */
const APK_MIRROR_HOST = process.env.APK_MIRROR_HOST || "deploy@8.217.8.225";
const APK_MIRROR_DIR_DEFAULT = "/var/www/ideahub-server/releases";
const APK_MIRROR_DIR = process.env.APK_MIRROR_DIR || APK_MIRROR_DIR_DEFAULT;
/**
 * 镜像对外的地址前缀 = 服务端的 APP_APK_BASE（`GET /api/app/file/:name`，经 Cloudflare）。
 * 发完之后从这里把**整个包**拉一遍比 sha256 —— 用户下的就是这条路。
 */
const APK_MIRROR_PUBLIC = "https://api.ideahubs.org/api/app/file";

const APK = path.join(root, "android/app/build/outputs/apk/sideload/release/app-sideload-release.apk");
const AAB = path.join(root, "android/app/build/outputs/bundle/playRelease/app-play-release.aab");
/** AAB 是 protobuf 清单、aapt2 读不了：上架那份的权限表看同一次 gradle 跑出来的合并清单 */
const PLAY_MERGED_MANIFEST = path.join(root, "android/app/build/intermediates/merged_manifests/playRelease/processPlayReleaseManifest/AndroidManifest.xml");
/** 手工入仓的第三方 jar（QQ 互联 SDK），来源与 sha256 记在同目录 README.md 的表里 */
const LIBS_DIR = path.join(root, "android/app/libs");
const DIST_INDEX = path.join(root, "dist/index.html");

/**
 * 两个渠道的权限允许表（2026-10-15 教材人格评审，owasp-security-4）。整表相等才过：多一条、少一条都停。
 *
 * ★★ 为什么钉成表、而不是「grep 一下有没有 INSTALL」：插件的 manifest 是合并进来的，你不会提前知道它想加哪一条 ——
 *   2026-09-07 换 media3 硬件合成器时 WAKE_LOCK 与 ACCESS_NETWORK_STATE 就这么漂进来了，而 docs 的期望表停在三条；
 *   按那份文档逐条比的人分不出「意料之中的漂移」与「某个插件偷带的 CAMERA / READ_MEDIA_*」。表在这里一处，
 *   docs/play-store-checklist.md 的期望表照抄这里（来源也写在那边）。
 * ★ 每一条是谁要的：INTERNET / RECORD_AUDIO（按住说话）/ MODIFY_AUDIO_SETTINGS（录音路由）是 src/main 自己声明的；
 *   ACCESS_NETWORK_STATE / WAKE_LOCK 来自 androidx.media3:media3-exoplayer（normal 级，Play 不需申报）；
 *   com.ideahub.branchvideo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION 由 androidx.core 自动生成（签名级、本应用自己声明并使用）；
 *   REQUEST_INSTALL_PACKAGES 只在 sideload（自更新，src/sideload/ 声明、src/play/ 用 tools:node="remove" 摘掉）；
 *   com.android.vending.BILLING 只在 play（Play Billing，有意为之；sideload 渠道走别的支付）。
 */
const SIDELOAD_PERMISSIONS = [
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.RECORD_AUDIO",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.WAKE_LOCK",
  "com.ideahub.branchvideo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
];
const PLAY_PERMISSIONS = [
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.RECORD_AUDIO",
  "android.permission.WAKE_LOCK",
  "com.android.vending.BILLING",
  "com.ideahub.branchvideo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
];

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

// 列前 10 条：真改动可能成百上千条，全倒出来就把那句话淹了（与 land.mjs 同一个写法）
const listOf = (paths) =>
  [...paths.slice(0, 10), ...(paths.length > 10 ? [`…还有 ${paths.length - 10} 条`] : [])].map((p) => `    ${p}`).join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 清单里的最低可用版本（没写 / 不是正整数 = 0 = 不强制） */
const minOf = (m) => (Number.isInteger(m?.minVersionCode) && m.minVersionCode > 0 ? m.minVersionCode : 0);

/** Android SDK 的 build-tools（apksigner / aapt2）。允许用 ANDROID_BUILD_TOOLS 覆盖 */
function buildTools() {
  if (process.env.ANDROID_BUILD_TOOLS) return process.env.ANDROID_BUILD_TOOLS;
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || process.env.HOME || "", "Android/Sdk");
  const dir = path.join(home, "build-tools");
  if (!fs.existsSync(dir)) die(`找不到 Android build-tools（试过 ${dir}）。设 ANDROID_BUILD_TOOLS 指过去`);
  const versions = fs.readdirSync(dir).sort();
  return path.join(dir, versions[versions.length - 1]);
}

function run(cmd, args) {
  // ★ Windows 上 apksigner 是个 .bat：Node 20 起不允许直接 spawn 批处理文件（EINVAL），
  //   必须过 shell。过 shell 就得自己加引号——路径里有 "Program Files" 这种空格。
  const isBat = cmd.endsWith(".bat") || cmd.endsWith(".cmd");
  if (isBat) {
    const q = (x) => `"${x}"`;
    return execFileSync(q(cmd), args.map(q), { encoding: "utf8", shell: true, maxBuffer: 32 * 1024 * 1024 });
  }
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** 过 shell 跑（gh 这类在 Windows 上是 .cmd 包装） */
function runShell(cmd, args) {
  return execFileSync(cmd, args.map((x) => `"${x}"`), { encoding: "utf8", shell: true, maxBuffer: 32 * 1024 * 1024 });
}

/** 本仓的 git：stdout 原样回；失败抛一句（stderr 第一行）—— 调用方决定是停还是只提醒 */
function git(...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(String(e.stderr || e.message || e).trim().split("\n")[0]);
  }
}

/**
 * 更新弹窗里的「这一版改了什么」—— 从 RELEASE_NOTES.md 里**只取这一版**那两节（2026-10-30 起）。
 *
 * ★★ 为什么不再整份塞进清单：2.75 发版后在模拟器上看到弹窗里是 2.62 起全部 14 版、约 19,700 字塞在一个小滚动框里，
 *   每一版都中文在前，英文手机上要翻到第二屏才看到自己的语言。同类 App 的更新说明全都只写当前这一版、几十到一百多字
 *   （抖音 / 微信 / 快手 / TikTok / CapCut 的商店页逐条看过），Google Play 与华为应用市场对这段文字的上限都是每种语言 500 字；
 *   NN/g 的意见是「What's new 要关得掉、以后找得回」—— 找得回那一半交给 history（App 设置页「更新记录」）。
 * ★ 清单上三格一起写：`notes`（老 App 只认它：这一版的中英两节，与从前同形）、`notesByLang`（新 App 按界面语言只画一种）、
 *   `history`（最近 HISTORY_MAX 版：新 App 的「你跳过的几版」+「更新记录」）。老包、服务端（`withApkBase` 原样展开 body）都不用认识新的两格。
 * ★ 这一版在文件里没有自己那一节就当场停：发版说明忘了写不该等用户在弹窗里看到上一版的话才发现（--dry 也走这里）。
 * ★ 每种语言超过 500 字只提醒不拦：那是商店的上限，我们的弹窗是滚动框；提醒是因为同类都写得比这短得多。
 * 文件的形状：`启梦 X.YZ` / `QiMeng X.YZ` 两种标题行各起一节，新版在上。
 */
const HISTORY_MAX = 8;
const NOTES_SOFT_MAX = 500;
function releaseNotesFor(text, versionName, versionCode) {
  const sections = new Map(); // versionName → { zh, en }（按文件顺序，新版在前）
  let cur = null;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^(启梦|QiMeng)\s+(\d+\.\d+)\s*$/.exec(raw);
    if (m) {
      const key = m[2];
      if (!sections.has(key)) sections.set(key, { zh: "", en: "" });
      cur = { key, lang: m[1] === "启梦" ? "zh" : "en" };
      continue;
    }
    if (cur) sections.get(cur.key)[cur.lang] += raw + "\n";
  }
  for (const s of sections.values()) {
    s.zh = s.zh.trim();
    s.en = s.en.trim();
  }
  const mine = sections.get(versionName);
  if (!mine || !mine.zh) die(`RELEASE_NOTES.md 里没有「启梦 ${versionName}」这一节 —— 先把这一版的更新说明写上（中英各一节）`);
  if (!mine.en) console.log(`⚠ RELEASE_NOTES.md 里没有「QiMeng ${versionName}」—— 英文界面的更新弹窗会退回中文`);
  for (const [lang, s] of Object.entries(mine)) {
    if (s.length > NOTES_SOFT_MAX) console.log(`⚠ ${versionName} 的 ${lang} 更新说明 ${s.length} 字，超过 ${NOTES_SOFT_MAX}（同类 App 都在 200 字以内）`);
  }
  const notes = [`启梦 ${versionName}`, "", mine.zh, "", `QiMeng ${versionName}`, "", mine.en].join("\n").trim();
  const history = [];
  for (const [name, s] of sections) {
    if (history.length >= HISTORY_MAX) break;
    let code = name === versionName ? versionCode : 0;
    let date = name === versionName ? new Date().toISOString().slice(0, 10) : "";
    if (name !== versionName) {
      // 老版本的号与日期从 tag 上读；tag 不在（历史上漏打过的）就留空，App 那边按名字排、不拿 0 去比
      try {
        code = Number(/versionCode\s+(\d+)/.exec(git("show", `v${name}:android/app/build.gradle`))?.[1] ?? 0);
        date = git("log", "-1", "--format=%cs", `v${name}`).trim();
      } catch {
        /* 没这个 tag */
      }
    }
    history.push({ versionName: name, versionCode: code, date, zh: s.zh, en: s.en });
  }
  return { notes, notesByLang: { zh: mine.zh, en: mine.en }, history };
}

/** build-tools 里的 aapt2；不在就 null（第 2c 步只提醒不拦：核不了 ≠ 漂了，但要当面说） */
function aapt2Bin(bt) {
  for (const n of ["aapt2", "aapt2.exe"]) {
    const p = path.join(bt, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 第 0 步：出包的源码就是 origin/main 上那一份、工作区干净（2026-10-15 教材人格评审，humble-delivery-7）。
 *
 * ★★ 为什么：tag 由 gh 建在**远端默认分支的 HEAD** 上，包是**本地 HEAD** 出的 —— 两者之间原来没有任何核对，守住它的是 CLAUDE.md
 *   「出包前 git log -1 对一眼」那句人工纪律（近 8 版实查都对上了，但靠的是人）。对不上的后果零报错：tag 指着一份源码、
 *   用户装的是另一份，之后按 tag 回溯 bug 看的就是错的代码。
 * ★ 比**树**不比提交：本地 HEAD 可能是刚 land 完的分支提交（与 main 树相同、提交不同），那也是同一份源码。
 * ★ 「干净」按**内容**判（worktree-changes.changesOf）、不用 git status：Windows autocrlf 下刚构建完 .po 只差行尾，
 *   porcelain 会把每一次发版都拦在这一步（CLAUDE.md 坑表第 4 行、land.mjs 同一道闸）。只差 stat 的不算脏。
 * ★ 远端已经有这个 tag（Release 发过 = 重跑；或者人先手工 push 了 tag —— 那时 gh 的 --target 会被 GitHub 忽略）：
 *   不比 main，改验「这个 tag 指着的源码 == 本地 HEAD」—— 重跑要站在发那一版时的源码上。
 * ★ --dry 只警告不停：它的用途就是「改完 versionCode 先看一眼」，那一刻改动多半还没提交。正式跑一律停。
 */
function assertSourceState(tag, exists) {
  const soft = (msg) => (DRY ? console.log(`⚠ ${msg}\n  正式跑会停在这一步。`) : die(msg));
  let fetched = false;
  try {
    git("fetch", "--quiet", "origin", "main");
    fetched = true;
  } catch (e) {
    soft(`git fetch origin main 没成（${e.message}）—— 核对不了出包的提交是不是 main 上那一个。修好网络 / 远端再来。`);
  }
  const headTree = git("rev-parse", "HEAD^{tree}").trim();
  let remoteTag = "";
  try {
    remoteTag = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`).trim();
  } catch (e) {
    soft(`git ls-remote 没成（${e.message}）—— 看不到远端有没有 ${tag}。`);
  }
  if (remoteTag) {
    try {
      git("fetch", "--quiet", "--no-tags", "origin", `+refs/tags/${tag}:refs/tags/${tag}`);
      const tagTree = git("rev-parse", `${tag}^{tree}`).trim();
      if (tagTree !== headTree) {
        soft(`远端已经有 ${tag}，而本地 HEAD 的源码与它不是同一份（树 ${headTree.slice(0, 12)}… ≠ ${tagTree.slice(0, 12)}…）。\n` +
             (exists
               ? `  重跑只是把上次那一版验证完，得站在发它时的源码上：git checkout ${tag} 之后重新出包、重跑；真要发新内容就涨版本号。`
               : `  tag 是人先 push 上去的，建 Release 时 --target 不起作用、就按它 —— 要么 git checkout ${tag} 重新出包，要么删掉远端这个 tag 再来。`));
      } else {
        console.log(`✓ 本地源码与远端 ${tag} 指向的提交一致（树相同）${exists ? "" : "—— tag 已由人先 push，建 Release 时按它"}`);
      }
    } catch (e) {
      soft(`取不到远端的 tag ${tag}（${e.message}）—— 核对不了本地源码是不是它指着的那份。`);
    }
  } else if (fetched) {
    const mainTree = git("rev-parse", "origin/main^{tree}").trim();
    if (headTree !== mainTree) {
      soft(`出包的提交不是 origin/main 上那一个（HEAD 的树 ${headTree.slice(0, 12)}… ≠ origin/main 的树 ${mainTree.slice(0, 12)}…）。\n` +
           `  tag 会建在 main 的 HEAD 上，而包是本地这份源码出的 —— 两边不同就是「tag 指着一份源码、用户装的是另一份」。\n` +
           `  → 先 npm run land（或把这次改动合进 main 并推上去），站在那个提交上重新出包，再重跑 npm run release。`);
    } else {
      console.log("✓ 出包的源码与 origin/main 一致（树相同）");
    }
  }
  if (exists && !remoteTag) soft(`${tag} 的 Release 在、远端却没有这个 tag —— 去 GitHub 看一眼这个 Release（多半是 draft，或者 tag 被人删了）。`);
  const { real, stale } = changesOf(root);
  if (real.length) {
    soft(`工作区还有没提交的改动（按内容判，不是 .po 行尾那种假阳性）：\n${listOf(real)}\n` +
         `  → 先提交并合进 main（npm run land），站在那个提交上重新出包。发出去的包要能按 tag 找回同一份源码。`);
  } else {
    console.log(`✓ 工作区干净${stale.length ? `（${stale.length} 个文件只差索引里的 stat、内容没变）` : ""}`);
  }
}

/** 第 2c 步：一份权限表与允许表逐条比，不等就停、并说清下一步 */
function assertPermissions(label, got, want) {
  const { extra, missing } = permissionDiff(got, want);
  if (!extra.length && !missing.length) {
    console.log(`✓ ${label}：权限表与允许表一致（${want.length} 条）`);
    return;
  }
  die(`${label} 的权限表与允许表不一致：` +
      (extra.length ? `\n  多了 ${extra.join("、")}` : "") +
      (missing.length ? `\n  少了 ${missing.join("、")}` : "") +
      `\n  权限多半是哪个插件的 manifest 合并进来的（media3 带进 WAKE_LOCK / ACCESS_NETWORK_STATE 就是这么来的），你不会提前知道它想加哪一条。\n` +
      `  → 先弄清这一条是谁带进来的、为什么要（android/app/build/outputs/logs/ 里的 manifest-merger 报告写着来源）；\n` +
      `    该要的：加进 scripts/release.mjs 的 SIDELOAD_PERMISSIONS / PLAY_PERMISSIONS，并把 docs/play-store-checklist.md 的期望表改成同一份；\n` +
      `    不该要的（CAMERA / READ_MEDIA_* 这类）：去掉带进它的插件，或在 src/main/AndroidManifest.xml 用 tools:node="remove" 摘掉，重新出包。`);
}

/** dist/index.html 引的入口 js（本次构建的那份）；没有 dist 就停 —— 首次发布要核「包里的是本次 dist 的」 */
function distEntryJs() {
  if (!fs.existsSync(DIST_INDEX)) die(`dist/index.html 不存在 —— 没法核对包里的 web 资产是不是本次构建的。先 npm run apk:release 与 npm run aab（它们会先 build）。`);
  const entry = entryJsOf(fs.readFileSync(DIST_INDEX, "utf8"));
  if (!entry) die("dist/index.html 里读不出入口 js（assets/index-*.js）—— vite 的产物形状变了？同步改 scripts/lib/app-package.mjs 的 entryJsOf");
  return entry;
}

/**
 * 第 4c 步要用：撤回过的版本（标成了 pre-release 的 Release）各自的 versionCode。
 * ★ 本仓没有 beta 那种 pre-release —— pre-release 只有一个含义：发错了、被 --withdraw 撤下来的那一版（docs「发错了」）。
 *   列不出 / 清单拉不到只提醒不拦（与第 4 步拉不到线上清单同一个口径），但要当面说。
 */
async function withdrawnVersions() {
  let list;
  try {
    list = JSON.parse(runShell("gh", ["release", "list", "--repo", REPO, "--limit", "30", "--json", "tagName,isPrerelease,isDraft"]));
  } catch (e) {
    console.log(`⚠ 列不出 GitHub 的 Release（${String(e.message).split("\n")[0]}）—— 核对不了有没有撤回过的版本要压过`);
    return [];
  }
  const out = [];
  for (const r of list.filter((x) => x.isPrerelease && !x.isDraft)) {
    const m = await readManifest(`https://github.com/${REPO}/releases/download/${r.tagName}/latest.json`);
    if (m && Number.isInteger(m.versionCode)) out.push({ tag: r.tagName, versionCode: m.versionCode, versionName: m.versionName });
    else console.log(`⚠ 撤回过的 ${r.tagName} 的清单拉不到，它的 versionCode 没法比`);
  }
  return out;
}

/** 顺着跳转拿到最终那一跳的 Content-Length（只看头，不收正文）；非 2xx 回 NaN */
async function remoteLength(u) {
  const res = await fetch(u, { redirect: "follow" });
  const len = Number(res.headers.get("content-length"));
  await res.body?.cancel();
  return res.ok ? len : Number.NaN;
}

/**
 * 第 7b 步：GitHub Release 上那份 APK 与清单逐字节相同（2026-10-15 教材人格评审，humble-delivery-2）。
 * ★★ 为什么：它是强制更新弹层上「镜像也下不动」时唯一的备用下载源（src/data/appUpdate.githubApkUrl），而原来三份产物只验了两份
 *   （镜像整包下一遍、两份清单比 sha），GitHub 那份只在收尾打印一个地址 —— 上传半截、事后被人手工 --clobber 换过都没人发现，
 *   弹层上「GitHub 上的同一个包」那句承诺没有任何机器背书。GitHub 现在对资产回 digest（sha256:…），核对代价是一次 API 调用。
 * ★ 老 Release 不回 digest：退回「大小 + 顺着跳转看一次 Content-Length」—— 看得到长度看不到内容，照实说。
 */
async function assertGithubAsset(tag, name, manifest) {
  let assets;
  try {
    assets = JSON.parse(runShell("gh", ["release", "view", tag, "--repo", REPO, "--json", "assets"])).assets ?? [];
  } catch (e) {
    die(`读不到 ${tag} 的资产列表（${String(e.message).split("\n")[0]}）—— GitHub 上那份备用安装包核不了。修好 gh 重跑 npm run release。`);
  }
  const fix = `→ gh release upload ${tag} android/app/build/outputs/${name} --clobber --repo ${REPO}，传完重跑 npm run release 验证`;
  const a = assets.find((x) => x.name === name);
  if (!a) die(`GitHub Release ${tag} 上没有 ${name} 这个资产 —— 强制更新弹层上「GitHub 上的同一个包」那条备用路是空的。\n${fix}`);
  if (a.size !== manifest.sizeBytes) die(`GitHub 上的 ${name} 大小 ${a.size} ≠ 清单 ${manifest.sizeBytes} 字节（多半上传了半截）。\n${fix}`);
  if (typeof a.digest === "string" && a.digest) {
    if (a.digest !== `sha256:${manifest.sha256}`) {
      die(`GitHub 上的 ${name} 内容与清单不同（digest ${a.digest.slice(0, 19)}… / 清单 sha256:${manifest.sha256.slice(0, 12)}…）—— 事后被 --clobber 换过？\n${fix}`);
    }
    console.log(`✓ GitHub 上的 ${name} 与清单逐字节相同（digest 一致）`);
    return;
  }
  const len = await remoteLength(a.url);
  if (len !== manifest.sizeBytes) die(`GitHub 没回 ${name} 的 digest，退回比大小：拉到 Content-Length ${len}，清单 ${manifest.sizeBytes}。\n${fix}`);
  console.log(`⚠ GitHub 没回这个资产的 digest，只核了大小（${len} 字节，与清单一致）—— 内容没法核`);
}

/**
 * `--withdraw <tag>`：发错了，止血 —— 把那一版标成 pre-release，/releases/latest 当场退回上一版（GitHub 几秒到一分钟内，
 * 服务端那份缓存 60 秒跟上），新装 / 还没更新的人不再拿到坏包（2026-10-15 教材人格评审，humble-delivery-6）。
 *
 * ★★ 为什么要有一条命令：2.51–2.55（2026-09-25 → 09-30）连发五版都是坏包（worktree 里没有受保护模型、一进工坊整页白屏），
 *   每一版照常进 /latest、照常推给老用户 —— 当时「撤回」只在失败清单里作为一种故障出现，没有一个地方写发错了先做什么。
 *   止血应当是一条命令，不是一段回忆。
 * ★ 它只做这一步。另外三件它做不到、要当面说（见末尾）：已更新的人退不回、强制更新的门槛跟着退回、镜像上的坏包不删。
 * ★ 下一次正常发版：第 4 步按退回后的 /latest 比，第 4c 步另外要求 versionCode 也压过每一个撤回过的版本（已装坏版的人只认更大的数）。
 */
async function withdraw(tag) {
  if (!/^v[\w.-]+$/.test(tag)) die(`--withdraw 后面要跟 tag（v<versionName>，例：--withdraw v2.63），收到的是「${tag}」`);
  const vName = tag.slice(1);
  let view;
  try {
    view = JSON.parse(runShell("gh", ["release", "view", tag, "--repo", REPO, "--json", "tagName,isPrerelease,isDraft,isLatest"]));
  } catch (e) {
    die(`GitHub 上没有 ${tag} 这个 Release（或 gh 没登录）：${String(e.message).split("\n")[0]}`);
  }
  if (view.isDraft) die(`${tag} 是 draft —— 它从来没进过 /latest，没什么可撤的。`);
  const before = await publishedManifest();
  console.log(`\n撤回 ${tag}（撤回前 /latest 是 ${before ? `${before.versionName}(${before.versionCode})` : "拉不到"}）\n`);
  if (view.isPrerelease) {
    console.log(`✓ ${tag} 已经是 pre-release 了（之前撤回过），下面只做验证`);
  } else {
    runShell("gh", ["release", "edit", tag, "--prerelease", "--repo", REPO]);
    console.log(`✓ ${tag} 已标成 pre-release（GitHub 的 /latest 会跳过它）`);
  }

  // 等 /latest 退回去：固定地址不该再回这一版
  let m = null;
  for (let i = 0; i < 12; i++) {
    m = await publishedManifest();
    if (m && m.versionName !== vName) break;
    process.stdout.write(`  等 /latest 退回上一版…（${(i + 1) * 5}s）\r`);
    await sleep(5000);
  }
  console.log("");
  if (!m) die(`撤回之后 /releases/latest/download/latest.json 拉不到了 —— ${tag} 之前可能没有别的正式版可退（首版？），或者网络不通。去 GitHub 的 Releases 页看一眼。`);
  if (m.versionName === vName) die(`等了 60 秒，/latest 还是 ${vName} —— 撤回没生效？去 GitHub 的 Releases 页看一眼 ${tag} 是不是 pre-release。`);
  console.log(`✓ /latest 现在是 ${m.versionName}(${m.versionCode})${before && before.versionName !== vName ? `（撤回前就不是 ${vName}：${tag} 本来也不是最新的那一版）` : ""}`);

  // App 实际打的那份（服务端转手、缓存 60 秒）也得退回去，否则还没更新的人照样拿到坏版
  let app = null;
  for (let i = 0; i < 12; i++) {
    app = await readManifest(APP_MANIFEST_URL);
    if (app && app.versionName !== vName) break;
    process.stdout.write(`  等服务端缓存过期…（${(i + 1) * 10}s）\r`);
    await sleep(10000);
  }
  console.log("");
  if (!app || app.versionName === vName) {
    die(`App 用的清单（${APP_MANIFEST_URL}）两分钟后还是 ${app ? app.versionName : "拉不到"} —— 服务端那份没跟上，还没更新的人仍会拿到坏版。查服务端 appRelease 那一跳。`);
  }
  console.log(`✓ App 用的清单也退回 ${app.versionName}(${app.versionCode})`);

  console.log(`\n✅ ${tag} 已撤回：新装 / 还没更新的人拿到的是 ${app.versionName}。撤回只止住了这一半，另外三件它做不到：\n` +
    `   ① 已经更新到 ${vName} 的人**退不回去**（Android 不装 versionCode 更低的包）。只能修好之后**涨版本号**重发（roll-forward），\n` +
    `      而且新版的 versionCode 要比 ${vName} 的还大 —— 下次 npm run release 的第 4c 步会核这一条（第 4 步只按退回后的 /latest 比）。\n` +
    `   ② ${vName} 要是带了新的 minVersionCode（强制更新），门槛跟着 /latest 一起退回上一版清单里的值（现在是 ${minOf(app) || "不强制"}）；\n` +
    `      想保住强制更新，重发的那一版再带一次 --min-version-code。\n` +
    `   ③ 镜像上的 qimeng-${vName}.apk 与 GitHub 上的资产**不删**：Cloudflare 那份是 immutable 缓存一年，删了源站边缘也还在；\n` +
    `      清单不再指向它就够了，留着还能当归档。${tag} 保持 pre-release，别删。\n`);
}

/** 从 build.gradle 读版本号 —— 以**源码**为准，不让人在命令行上另填一遍 */
function readVersion() {
  const g = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
  const code = /versionCode\s+(\d+)/.exec(g);
  const name = /versionName\s+"([^"]+)"/.exec(g);
  if (!code || !name) die("build.gradle 里读不出 versionCode / versionName");
  return { versionCode: Number(code[1]), versionName: name[1] };
}

async function readManifest(url) {
  try {
    // 加个随机串：GitHub 的 /latest 跳转与资产都走 CDN，不绕开缓存会读到上一版
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`, { redirect: "follow" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 第一次发布，或者网络不通 —— 都不该阻断，但下面会提示
  }
}

const publishedManifest = () => readManifest(MANIFEST_URL);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ── 安装包镜像（ssh / scp）──────────────────────────────────

/**
 * ★★ Git Bash 会改写以 / 开头的环境变量（2026-10-08 发 2.62 时踩到）：
 *   `APK_MIRROR_DIR=/var/www/… npm run release` 在 Git Bash 里，传到 node 手上已经是
 *   `C:/Program Files/Git/var/www/…` —— MSYS 把它当成"要交给 Windows 程序的本机路径"翻译了。
 *   远端 `mkdir -p` 于是在 deploy 的家目录里建出 `C:/Program`、`Files/Git/…` 两串空目录，
 *   scp 失败，而当时的脚本已经先把 Release 建好了。现在镜像排在 Release 之前，失败不再伤人，
 *   但仍要**当场**说清原因：对着一句 scp 报错，没人猜得到是 shell 改了变量。
 * ★ 顺带把路径限死在"不带空格、引号的绝对路径"：它要原样拼进远端那句 shell。
 */
function checkMirrorDir() {
  const d = APK_MIRROR_DIR;
  if (d.includes(":") || d.includes("\\") || /program files/i.test(d)) {
    die(`APK_MIRROR_DIR 被改写成了 Windows 路径：${d}\n` +
        `这是 Git Bash 的 MSYS 路径转换干的（以 / 开头的值会被当成本机路径翻译）。命令前面加 MSYS_NO_PATHCONV=1：\n` +
        `  MSYS_NO_PATHCONV=1 APK_MIRROR_DIR=${APK_MIRROR_DIR_DEFAULT} npm run release\n` +
        `（不设 APK_MIRROR_DIR 就用默认的 ${APK_MIRROR_DIR_DEFAULT}，那个值在 node 里，不会被改写。）`);
  }
  if (!/^\/[\w./-]+$/.test(d)) {
    die(`APK_MIRROR_DIR 只接受不带空格、引号的绝对路径（它要原样拼进远端 shell）：${d}`);
  }
}

/** 远端 shell 里的单引号字面量。调用方保证串里没有单引号（checkMirrorDir 与文件名校验） */
const rq = (s) => `'${s}'`;

/**
 * 在镜像机上跑一句 shell，返回 stdout。
 * ★ 不走 runShell：ssh / scp 在 Windows 上是真 .exe，用不着 cmd.exe；过 shell 等于
 *   在远端那句（单引号、分号、重定向）外面再套一层本地转义，两层叠着迟早出错。
 * ★ `-n`：别把本地 stdin 转发过去。口令提示走终端本身，不受影响。
 */
function ssh(remoteCmd, timeout = 120_000) {
  return execFileSync("ssh", ["-n", APK_MIRROR_HOST, remoteCmd], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 1024 * 1024,
  });
}

/**
 * 镜像上这个文件现在的 sha256；不存在回 null。
 * ★ 比 sha256 不比大小：同一个版本号换了内容的包，大小经常一字节不差（改一行字的那种）。
 */
function mirrorSha(file) {
  const out = ssh(`if [ -e ${rq(file)} ]; then sha256sum -- ${rq(file)}; else echo MISSING; fi`).trim();
  if (out === "MISSING") return null;
  const m = /^([0-9a-f]{64})\s/.exec(out);
  if (!m) throw new Error(`读不懂远端 sha256sum 的输出：${out.slice(0, 200)}`);
  return m[1];
}

/**
 * 把安装包**原子地**放上镜像：先传成 `<名字>.part`，远端 sha256 对上清单，才改成正名。
 *
 * ★★ 为什么不直接 scp 到正名（2.62 之前就是那么写的）：
 *   `GET /api/app/file/:name` 对**任何存在的** .apk 都回 `max-age=1y, immutable`，
 *   Cloudflare 照单缓存一年。scp 是在正名上就地写 —— 写到一半有人来下，拿到的是半截包，
 *   边缘把这半截存一年；每个从那个节点下的人都校验失败，唯一出路是涨版本号重发。
 *   旧顺序里清单还先一步翻到了新版（Release 先建），等于主动把人往半截包上送。
 * ★ `.part` 这个名字服务端**根本不给**（路由只认 `^[\w.-]+\.apk$`，这里结尾是 .part ⇒ 400），
 *   所以它在没写完、没校验之前对外不存在。
 * ★ 改名用 `ln` + `rm` 而不是 `mv`：`mv` 会**静默覆盖**已存在的正名，而一个已存在的正名
 *   可能已经被边缘缓存住；`ln` 遇到已存在的目标直接失败。同一个目录 = 同一个文件系统，
 *   硬链接是一次原子的目录项操作，正名一出现就是完整的那份。
 */
function uploadMirror(localFile, file, expectSha) {
  const part = `${file}.part`;
  ssh(`mkdir -p ${rq(APK_MIRROR_DIR)}`);
  // stdio 接到终端上：几十 MB 传到香港要几分钟，scp 自己的进度条得让人看得见
  execFileSync("scp", [localFile, `${APK_MIRROR_HOST}:${part}`], { stdio: "inherit", timeout: 60 * 60_000 });
  const got = mirrorSha(part);
  if (got !== expectSha) {
    try { ssh(`rm -f -- ${rq(part)}`); } catch { /* 删不掉也无妨：.part 对外不可见，下次会被覆盖 */ }
    throw new Error(`传完的 .part 校验不过（远端 ${got ? got.slice(0, 12) + "…" : "没有这个文件"} / 清单 ${expectSha.slice(0, 12)}…），` +
      `已删掉 .part，正名没有动`);
  }
  ssh(`ln -- ${rq(part)} ${rq(file)} && rm -f -- ${rq(part)}`);
  if (mirrorSha(file) !== expectSha) {
    throw new Error(`改名之后读回来的 sha256 不对：${APK_MIRROR_HOST}:${file} —— 正名上现在这份来路不明，先 ssh 上去查清、删掉它`);
  }
}

/**
 * 经 Cloudflare 把镜像上的包**整个**下一遍，边下边算 sha256。
 * ★ 不加 cb= 之类的随机串（与读清单那里正相反）：要验的正是**边缘缓存里那一份**——
 *   用户拿到的就是它，而它一旦存错就是一年。顺带也把这一份完整的包预热进了离你最近的边缘。
 * ⚠ 只验得到离这台机器最近的那个边缘节点。别的节点上的那份靠的是 uploadMirror 那条：
 *   正名出现之前内容已经完整，而清单要到那之后才指过去 —— 不是靠这次下载。
 * ★ 按"多久没收到一个字节"判卡死，不按总时长：整包几十 MB，网速差别能差出一个数量级。
 */
async function downloadSha(url, expectBytes) {
  const STALL_MS = 60_000;
  const ctl = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(new Error(`${STALL_MS / 1000} 秒没收到一个字节`)), STALL_MS);
  };
  arm();
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctl.signal });
    const meta = {
      status: res.status,
      type: res.headers.get("content-type") || "",
      cache: res.headers.get("cf-cache-status") || "（没有 cf-cache-status = 没经过 CF 缓存）",
    };
    if (!res.ok) {
      await res.body?.cancel();
      return meta;
    }
    const h = createHash("sha256");
    let bytes = 0;
    let shown = -1;
    for await (const chunk of res.body) {
      h.update(chunk);
      bytes += chunk.length;
      arm();
      const pct = expectBytes ? Math.floor((bytes / expectBytes) * 100) : 0;
      if (pct !== shown) {
        shown = pct;
        process.stdout.write(`  下载中 ${(bytes / 1048576).toFixed(1)}MB（${pct}%）\r`);
      }
    }
    process.stdout.write("\n");
    return { ...meta, bytes, sha: h.digest("hex") };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // 最先查：纯本地、不花时间，--dry 也要拦住（不然要等正式跑到上传那一步才露馅）
  checkMirrorDir();
  const bt = buildTools();
  const { versionCode, versionName } = readVersion();
  // 文件名要原样拼进远端 shell 与 URL —— 只放行这几种字符
  if (!/^[\w.-]+$/.test(versionName)) die(`versionName 里有文件名不该有的字符：${versionName}`);
  const tag = `v${versionName}`;
  console.log(`\n准备发布 ${tag}（versionCode ${versionCode}）\n`);

  // ── 0. 这个 tag 发过没有（好几步都按它分叉：重跑 = 把上次那一版验证完，不是发新版）──
  let exists = false;
  try {
    runShell("gh", ["release", "view", tag, "--repo", REPO]);
    exists = true;
  } catch {
    /* 不存在 */
  }

  // ── 0b. 出包的源码就是 origin/main 上那一份、工作区干净（见 assertSourceState 的 ★★）──
  assertSourceState(tag, exists);

  // ── 1. 产物在不在 ────────────────────────────────────────
  for (const [label, f] of [["直装 APK", APK], ["上架 AAB", AAB]]) {
    if (!fs.existsSync(f)) die(`${label} 不存在：${f}\n先跑 npm run apk:release 与 npm run aab`);
  }

  // ── 2. 产物里的版本号，必须和源码一致 ───────────────────
  //    （改了 build.gradle 却忘了重新出包，是最容易发生的一种"发了个旧包"）
  const badging = run(path.join(bt, "aapt2"), ["dump", "badging", APK]).split("\n")[0];
  const apkCode = Number(/versionCode='(\d+)'/.exec(badging)?.[1]);
  const apkName = /versionName='([^']*)'/.exec(badging)?.[1];
  if (apkCode !== versionCode || apkName !== versionName) {
    die(`APK 里是 ${apkName}(${apkCode})，源码里是 ${versionName}(${versionCode}) —— 包是旧的，重新出包`);
  }

  // ── 2b. 开包看内容：入口 js 是本次 dist 的、受保护模型恰好是白名单（2026-10-15 教材人格评审，humble-delivery-1）──
  //    ★★ 为什么：第 2 步只比版本号，而「版本号对、内容旧」不报错（2026-08-16 差点发出一个 2.8 号 2.7 内容的包：
  //      直接跑 gradle 跳过了 cap sync，打进去的是上一次 sync 的 web 资产）；prune-app-assets 的裁剪表是黑名单，
  //      新丢进 protected/ 的 .glbx 默认随包发（第三方素材的授权不含分发）。这两条原来写在 docs 里让人 unzip 看，现在机器看。
  //    ★ 入口 js 只在首次发布核：重跑是「失败后不重新出包、直接重跑」的恢复路，那时 worktree 里的 dist 可能已经是别的构建，
  //      照核会把恢复路堵死。白名单每次都核（重跑核出第三方模型 = 发出去的那份就是坏的，该撤回）。
  //    ★ AAB 同样带 assets/public/（前缀 base/）：上架那份也不许夹第三方模型，一起核。
  const distEntry = exists ? null : distEntryJs();
  for (const [label, f, prefix] of [["直装 APK", APK, "assets/public/"], ["上架 AAB", AAB, "base/assets/public/"]]) {
    const got = await inspectWebBundle(f, prefix);
    if (!got.hasIndex) die(`${label} 里没有 ${prefix}index.html —— web 资产没打进去（cap sync 没跑？）。重跑 npm run apk:release 与 npm run aab`);
    const extra = got.protectedFiles.filter((n) => !OWN_PROTECTED_MODELS.includes(n));
    const missing = OWN_PROTECTED_MODELS.filter((n) => !got.protectedFiles.includes(n));
    if (extra.length || missing.length) {
      die(`${label} 里 ${prefix}${PROTECTED_DIR}/ 不是恰好白名单那几个：` +
          (extra.length ? `多了 ${extra.join("、")}（第三方版权素材不许随包发）` : "") +
          (extra.length && missing.length ? "；" : "") +
          (missing.length ? `少了 ${missing.join("、")}（默认铸卡师不在 = 一进工坊整页白屏）` : "") +
          `\n  白名单只有一处：scripts/lib/protected-models.mjs（出包闸 prune-app-assets 核的也是它）。这包不能发：重跑 npm run build:app 出包` +
          (exists ? `；${tag} 已经发出去了 —— 先 npm run release -- --withdraw ${tag} 止血，再涨版本号重发` : ""));
    }
    if (distEntry) {
      if (!got.entryJs || !got.hasEntryFile) die(`${label} 的 index.html 里读不出入口 js（或那个文件不在包里）—— web 资产残缺，重跑 npm run build:app 出包`);
      if (got.entryJs !== distEntry) {
        die(`${label} 里的 web 资产不是本次构建的：包里引的是 ${got.entryJs}，dist/index.html 是 ${distEntry}。\n` +
            `  多半是绕过 npm run build:app 直接跑了 gradle（cap sync 没跑，android/ 里还是上一次同步的资产），或者出包之后又 build 了一次。\n` +
            `  → 重跑 npm run apk:release 与 npm run aab（都从 build:app 起），再来。`);
      }
    }
    console.log(`✓ ${label}：${PROTECTED_DIR}/ 只有 ${OWN_PROTECTED_MODELS.join("、")}${distEntry ? `，入口 ${got.entryJs} 与本次 dist 一致` : ""}`);
  }

  // ── 2c. 权限表没漂（见 SIDELOAD_PERMISSIONS 的 ★★）──
  //    APK 问 aapt2（看的是包本身）；AAB 是 protobuf 清单、aapt2 读不了，看同一次 gradle 跑出来的合并清单。
  //    两份工具 / 文件不在时只提醒不拦：核不了 ≠ 漂了，但要当面说，并指去 docs 手工比。
  const aapt2 = aapt2Bin(bt);
  if (aapt2) assertPermissions("直装 APK", apkPermissions(run, aapt2, APK), SIDELOAD_PERMISSIONS);
  else console.log("⚠ build-tools 里找不到 aapt2，直装 APK 的权限表没核 —— 照 docs/play-store-checklist.md 手工 dump 一遍再发");
  if (fs.existsSync(PLAY_MERGED_MANIFEST)) assertPermissions("上架 AAB（合并清单）", manifestPermissions(PLAY_MERGED_MANIFEST), PLAY_PERMISSIONS);
  else console.log("⚠ 没有 playRelease 的合并清单（android/app/build/intermediates/merged_manifests/…）—— AAB 的权限表没核，上传 Play 前照 docs/play-store-checklist.md 手工比一遍");

  // ── 2d. 手工入仓的 jar 有来源、sha256 对得上（2026-10-15 教材人格评审，humble-delivery-8）──
  //    QQ 登录 SDK 是手工下载进 android/app/libs/ 的，经 fileTree(include: ['*.jar']) 进包，处理的是登录；
  //    来源与校验值记在同目录 README.md 的表里（机读那两格）。表里没有的 jar = 来路不明，当场停。
  {
    const jars = jarProvenance(LIBS_DIR, sha256);
    for (const line of jars.ok) console.log(`✓ ${line}`);
    if (jars.problems.length) die(`android/app/libs/ 里的 jar 核不过：\n  ${jars.problems.join("\n  ")}`);
  }

  // ── 2e. 编进包里的原生模块就是锁文件记的那一版（2026-10-21，见 nativeModuleDrift 的 ★）──
  //    ★ 只在首次发布核：重跑时 node_modules 可能已经换过，与发出去的那份包无关（与 2b 的入口 js 同一个口径）。
  if (!exists) {
    const mods = nativeModuleDrift(root);
    if (mods.problems.length) die(`原生模块的版本对不上：\n  ${mods.problems.join("\n  ")}`);
    console.log(`✓ 原生模块与 package-lock.json 一致：${mods.ok.join("、")}`);
  }

  // ── 3. 签名必须还是那一把 ────────────────────────────────
  const certs = run(path.join(bt, process.platform === "win32" ? "apksigner.bat" : "apksigner"),
    ["verify", "--print-certs", APK]);
  const got = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(certs)?.[1];
  if (!got) die("读不出 APK 的签名证书 —— 这个包大概没签名（android/keystore/ 缺失？）");
  if (got !== EXPECTED_CERT_SHA256) {
    die(`签名证书变了！\n  期望 ${EXPECTED_CERT_SHA256}\n  实得 ${got}\n` +
        `用这个包发布，所有老用户更新时都会看到"应用未安装"，只能卸载重装。\n` +
        `确认是有意换签名的话，改 scripts/release.mjs 里的 EXPECTED_CERT_SHA256，并**先通知用户**。`);
  }
  console.log(`✓ 签名与历史版本一致`);

  // ── 4. versionCode 必须比线上那版大 ─────────────────────
  //    ★ 例外：这个 tag 已经发过了（上次跑到一半失败，这次是原地重跑；第 0 步查的）——
  //      那就不是"要发一个新版"，而是"把上次那一版验证完"，不该被递增检查挡住。
  const live = await publishedManifest();
  if (exists) {
    console.log(`✓ ${tag} 已经发过了 —— 本次是重跑，只做验证`);
  } else if (live) {
    console.log(`✓ 线上当前是 ${live.versionName}(${live.versionCode})`);
    if (versionCode <= live.versionCode) {
      die(`versionCode ${versionCode} 不大于线上的 ${live.versionCode} —— 发出去也没人会收到更新。\n` +
          `先改 android/app/build.gradle 再重新出包。`);
    }
  } else {
    console.log("⚠ 拉不到线上清单（首次发布，或者网络不通）—— 跳过版本号递增检查");
  }

  // ── 4c. 撤回过的版本也要压过（2026-10-15 教材人格评审：--withdraw 带来的洞）────────
  //    撤回 = 把坏版标成 pre-release，/latest 退回上一版；上面第 4 步于是按退回后的 live 比 —— 可已经装上坏版的人
  //    只认 versionCode 更大的包（Android 不装更低的）。这一版的 versionCode 必须也比每一个撤回过的版本大。
  if (!exists) {
    const withdrawn = await withdrawnVersions();
    const blocking = withdrawn.filter((w) => w.versionCode >= versionCode);
    if (blocking.length) {
      die(`versionCode ${versionCode} 没压过撤回过的 ${blocking.map((w) => `${w.tag}(${w.versionCode})`).join("、")} —— ` +
          `已经更新到那一版的人收不到这次更新（Android 不装 versionCode 更低或相同的包）。\n` +
          `先把 android/app/build.gradle 的 versionCode 改到比它大，重新出包。`);
    }
    if (withdrawn.length) console.log(`✓ 压过了撤回过的 ${withdrawn.map((w) => `${w.tag}(${w.versionCode})`).join("、")}`);
  }

  // ── 4b. 最低可用版本（强制更新）—— 只往上拧（见 parseMinFlag 的 ★★）─────────
  const asked = ASKED_MIN;
  const liveMin = live && Number.isInteger(live.minVersionCode) && live.minVersionCode > 0 ? live.minVersionCode : 0;
  let minVersionCode;
  if (exists) {
    // 重跑：清单早就随 Release 发出去了（这一步不会再传 latest.json），只能沿用线上那份；显式要一个不同的数 = 改不了，别假装改了
    if (!live) die(`${tag} 已经发过了，可线上清单拉不到 —— 不知道它的 minVersionCode，先把网络修好再重跑`);
    if (asked !== undefined && asked !== liveMin) {
      die(`${tag} 已经发过了，它的清单里 minVersionCode 是 ${liveMin || "（没写，不强制）"}，重跑改不了它。\n` +
          `要换强制更新的门槛，涨一档版本号重新出包，再带 --min-version-code 发。`);
    }
    minVersionCode = liveMin;
  } else if (asked !== undefined) {
    if (!live) console.log(`⚠ 拉不到线上清单：核对不了 ${asked} 是不是比上一版的 minVersionCode 小（只能往上拧）`);
    else if (asked < liveMin) {
      die(`--min-version-code=${asked} 比上一版清单里的 ${liveMin} 小 —— 强制更新的门槛只能往上拧。\n` +
          `真要放宽（让更老的包也能接着用），先想清楚为什么，再手工改清单；不要靠发版脚本的一个参数。`);
    }
    minVersionCode = asked;
  } else if (live) {
    minVersionCode = liveMin;
  } else {
    // 拉不到上一版清单又没显式给：写不写都可能错 —— 不写就把上一版的门槛丢了（悄悄取消强制更新）
    if (!DRY) {
      die(`拉不到线上清单，不知道上一版的 minVersionCode。照这样发，清单里就没有这一格 = 取消了强制更新。\n` +
          `修好网络重跑；或者显式带上 --min-version-code=N（N = 0 表示确实不强制）。`);
    }
    console.log("⚠ 拉不到线上清单，也没给 --min-version-code —— 正式跑会停在这一步");
    minVersionCode = 0;
  }
  if (minVersionCode > versionCode) {
    die(`minVersionCode ${minVersionCode} 比这一版的 versionCode ${versionCode} 还大 —— 刚发的这一版也会被判成「必须更新」，\n` +
        `所有人都被锁在一张关不掉的弹层前面、却没有版本可装。最大只能是 ${versionCode}。`);
  }
  // ★ 「这个数是显式给的，还是沿用的」要说出来：想发强制更新却写错了参数时，这一行是唯一的线索（parseArgs 的 ★★）
  const carried = exists || (asked === undefined && !!live);
  console.log(minVersionCode > 0
    ? `✓ minVersionCode = ${minVersionCode}：versionCode < ${minVersionCode} 的包打开后只能更新${carried ? "（沿用线上清单里的值）" : ""}`
    : `✓ 不强制更新（清单里不写 minVersionCode）${carried ? "—— 没带 --min-version-code，沿用上一版（它也不强制）" : ""}`);

  // ── 5. 写清单 ────────────────────────────────────────────
  const apkBuf = fs.readFileSync(APK);
  const notesFile = path.join(root, "RELEASE_NOTES.md");
  const { notes, notesByLang, history } = releaseNotesFor(
    fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : "",
    versionName,
    versionCode,
  );
  // ⚠ tag（v<versionName>）与这个资产名 App 里也照着拼了一份：强制更新时的 GitHub 备用下载（src/data/appUpdate.githubApkUrl）——
  //   清单经服务端转手时 apkUrl 被改写成镜像地址，App 拿不到下面这个原值。这里改名，那边一起改
  const apkAsset = `qimeng-${versionName}.apk`;
  const manifest = {
    versionCode,
    versionName,
    apkUrl: `https://github.com/${REPO}/releases/download/${tag}/${apkAsset}`,
    sizeBytes: apkBuf.length,
    sha256: sha256(apkBuf),
    notes,
    notesByLang,
    history,
    // 0 = 不强制：不写这一格（与老清单同形，老包、服务端都不用认识它）
    ...(minVersionCode > 0 ? { minVersionCode } : {}),
  };
  const out = path.join(root, "android/app/build/outputs");
  fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // 资产名要带版本号：GitHub 同名资产不能共存，而 apkUrl 是按 tag+文件名拼的
  fs.copyFileSync(APK, path.join(out, apkAsset));
  fs.copyFileSync(AAB, path.join(out, `qimeng-${versionName}-play-store.aab`));
  console.log(`✓ 清单已生成（${(apkBuf.length / 1048576).toFixed(0)}MB，sha256 ${manifest.sha256.slice(0, 12)}…）`);

  // ── 5b. 同名重发：内容变了就不许发（2026-09-01 加，发版前复核抓到）────────
  // ★★ 为什么到今天才需要这道闸：APK 直到 2026-08-31 才**真的**被 Cloudflare 缓存住
  //   （在那之前全局 CORS 的 `Vary: Origin` 让 CF 一律不缓存这条路，所以"同名换内容"
  //   一直碰巧能用）。现在镜像那条是 `max-age=1y, immutable` —— 同一个文件名换了内容，
  //   边缘上那份**一年不变**。后果不是"慢一点"，是**这一版的更新对这批用户永久下不动**：
  //   客户端按清单里的 sha 校验整个文件 → 对不上 → 删残包 → 报「校验不通过（可能没下完
  //   或被中间人改过）」→ 再点还是同一份缓存。屏幕上那句话还指向一个不存在的原因。
  // ★ 触发它的正是本仓自己新写的纪律「复核发现问题、改完必须重新出包」：出包本身安全
  //   （还没上传过），**发布之后**再改同一个版本号才致命。所以闸只拦"已经发过 + 内容不同"。
  if (exists && live && live.sha256 && live.sha256 !== manifest.sha256) {
    die(`${tag} 已经发过了，而这次的包与线上那一份**内容不同**` +
        `（线上 ${live.sha256.slice(0, 12)}… / 本次 ${manifest.sha256.slice(0, 12)}…）。
` +
        `同一个版本号不能发第二份内容：镜像上的 ${apkAsset} 在 Cloudflare 是 immutable 缓存一年，
` +
        `已经取到过旧包的用户会永远校验失败、永远更新不了这一版。
` +
        `→ 改 android/app/build.gradle 涨一档 versionName/versionCode 重新出包（推荐）；
` +
        `  或者先去 Cloudflare 清掉 /api/app/file/${apkAsset} 那条缓存，再回来重跑。`);
  }

  // ── 5c. 镜像上这个文件名现在是什么（只读；--dry 也查）────────────
  //    ★ 第 5b 步只比得了 GitHub 那一份；镜像是**另一个**文件，可以单独错 ——
  //      最常见的是上一次没跑完：包已经传上去了，Release 没建成，然后又重新出了一次包。
  //      同一个文件名换内容的后果与 5b 一样（immutable 一年），所以同样当场拒。
  const mirrorFile = `${APK_MIRROR_DIR}/${apkAsset}`;
  let mirrorHave;
  try {
    mirrorHave = mirrorSha(mirrorFile);
  } catch (e) {
    if (!DRY) {
      die(`连不上安装包镜像 ${APK_MIRROR_HOST}（${e.message}）。\n` + (exists
        ? `${tag} 的 Release 早就建好了，镜像上有没有这一份现在查不到 —— 修好 ssh 重跑，把镜像与验证做完。`
        : `这一步排在建 Release 之前，线上什么都还没变 —— 修好 ssh 再重跑。`));
    }
    console.log(`⚠ 连不上安装包镜像 ${APK_MIRROR_HOST}（${e.message}）\n` +
      `  正式跑会停在这一步${exists ? "" : "（那时还什么都没发布）"}—— 先把 ssh 修好。`);
  }
  if (mirrorHave && mirrorHave !== manifest.sha256) {
    die(exists
      ? `镜像上的 ${apkAsset} 与已经发布的这一版**内容不同**` +
        `（镜像 ${mirrorHave.slice(0, 12)}… / 本次 ${manifest.sha256.slice(0, 12)}…）。\n` +
        `用户下的正是镜像那份，校验必然失败；而它在 Cloudflare 上是 immutable 缓存一年，光换服务器上的文件不够。\n` +
        `→ 涨一档 versionName/versionCode 重新出包重发（推荐）；\n` +
        `  或者把镜像换成正确的那份，再去 Cloudflare 清掉 /api/app/file/${apkAsset} 的缓存，回来重跑本脚本验证。`
      : `镜像上已经有一份同名但**内容不同**的 ${apkAsset}` +
        `（镜像 ${mirrorHave.slice(0, 12)}… / 本次 ${manifest.sha256.slice(0, 12)}…），多半是上一次没跑完留下的。\n` +
        `同一个文件名不能换内容（理由同第 5b 步：Cloudflare 上 immutable 一年）。\n` +
        `→ 涨一档 versionName/versionCode 重新出包（推荐）；\n` +
        `  或者确认这一版从没发布过（清单从没指向它），ssh 上去删掉 ${mirrorFile}、\n` +
        `  再去 Cloudflare 清掉 /api/app/file/${apkAsset} 的缓存（文件名猜得到，可能被人拉过），回来重跑。`);
  }
  if (mirrorHave === manifest.sha256) console.log(`✓ 镜像上已经有这一份（sha256 一致），不用再传`);
  else if (mirrorHave === null) console.log(`✓ 镜像上还没有 ${apkAsset}，${DRY ? "正式跑时" : "下面"}先传上去（在建 Release 之前）`);

  if (DRY) {
    console.log(mirrorHave === undefined
      ? "\n--dry：没有发布。其余检查都通过了，但镜像没查成（见上面的 ⚠）。\n"
      : "\n--dry：检查全部通过，没有发布。\n");
    return;
  }

  // ── 6. 先把安装包放上镜像（国内下载源）——**在建 Release 之前** ──────────
  //    ★★ 顺序就是这条修复本身（2026-10-08 发 2.62 时定位）：建 Release 的那一刻，
  //      /releases/latest/download/latest.json 立刻翻到新版，服务端那份 60 秒内跟上，
  //      App 与官网下载页随即开始去拿镜像上的包。包要是这之后才传，那几分钟里来的人
  //      拿到的是 404 或者**半截包**——半截的那份会被 Cloudflare 存一年（见 uploadMirror）。
  //      反过来，包先在、清单后指：任何时候按清单去拿，拿到的都是完整的那份。
  //    ★ 重跑（tag 已存在）也走这里：镜像上已有同一份就跳过，缺了就照样原子地补上。
  if (mirrorHave !== manifest.sha256) {
    console.log(`\n上传安装包镜像（先传 .part，远端 sha256 对上才改成正名）…`);
    try {
      uploadMirror(path.join(out, apkAsset), mirrorFile, manifest.sha256);
    } catch (e) {
      // ★ 话要按 Release 在不在分开说：重跑时清单早就指着这个文件了，"线上什么都没变"是假话
      die(`安装包镜像没传上去（${e.message}）。\n` + (exists
        ? `${tag} 的 Release 早就建好了、清单正指着这个文件，镜像上却还没有它 —— 这段时间用户点更新拿到的是 404，尽快修好重跑 npm run release。`
        : `这一步排在建 Release 之前，清单还没指向这个文件 —— 修好再重跑 npm run release。`));
    }
    console.log(`✓ 已传到 ${APK_MIRROR_HOST}:${mirrorFile}（sha256 已在远端核对）`);
  }

  // ── 7. 发布 ──────────────────────────────────────────────
  //    tag 已存在就跳过创建直接去验证（第 4 步算过了）
  if (exists) {
    console.log(`\n${tag} 已存在，跳过创建，直接验证`);
  } else {
    console.log(`\n正在发布 ${tag}…`);
    // ★ --target 钉到 origin/main 的那个提交（第 0b 步刚核过它的树 == 本地 HEAD 的树）：不带的话 tag 落在「那一刻」远端默认分支的
    //   HEAD 上 —— 有人在这几分钟里往 main 推了一笔，tag 就指到了一份没出过包的源码。远端已有同名 tag 时 GitHub 忽略它（第 0b 步按 tag 核过）
    const target = git("rev-parse", "origin/main").trim();
    runShell("gh", ["release", "create", tag,
      path.join(out, apkAsset),
      path.join(out, `qimeng-${versionName}-play-store.aab`),
      path.join(out, "latest.json"),
      "--title", `启梦 ${versionName}`,
      "--target", target,
      // ★ notes 走 --notes-file 而不是 --notes 内联（2026-08-24 发 2.25 时炸出来的）：
      //   runShell 是 shell:true + 外包一层双引号，notes 里出现英文双引号就把参数
      //   当场截断，后半段被 shell 当 glob 炸掉（v2.24 的 notes 恰好全用「」没踩到）。
      //   发布文案里迟早会出现 " ` $ 之类字符——传文件路径就没有转义问题。
      ...(fs.existsSync(notesFile) ? ["--notes-file", notesFile] : ["--notes", `启梦 ${versionName}`]),
      "--repo", REPO]);
  }

  // ── 7b. GitHub 上那份 APK 与清单逐字节相同（见 assertGithubAsset 的 ★★）——重跑也核：发过的那份就该是对的 ──
  await assertGithubAsset(tag, apkAsset, manifest);

  // ── 8. ★ 回头验证：从公网真的拉一遍，确认老用户能看到、能下 ──
  //    这一步才是这个脚本存在的意义 —— 前面每一条都可能"看着对但线上是错的"。
  console.log("\n验证更新链…");
  // ★ 重试而不是"睡 3 秒看一眼"：GitHub 把 /latest 指到新 Release 要几秒到几十秒。
  //   一次就判失败的话，每次发版都会"自检失败但其实是好的" —— 人很快会开始无视
  //   这个检查，那它就白写了。最多等 60 秒，仍不对才是真出事。
  let check = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    check = await publishedManifest();
    if (check?.versionCode === versionCode) break;
    process.stdout.write(`  等 /latest 指过来…（${(i + 1) * 5}s）\r`);
  }
  console.log("");
  if (!check) die("发完了，但 /releases/latest/download/latest.json 拉不到 —— 老用户收不到这次更新");
  if (check.versionCode !== versionCode) {
    die(`等了 60 秒，固定地址返回的还是 ${check.versionName}(${check.versionCode})。\n` +
        `多半是这个 Release 被标成了 draft 或 pre-release（/latest 会跳过它们），\n` +
        `或者漏传了 latest.json 这个资产。`);
  }
  // ★★ 再验一遍**用户实际会打的那个地址**（服务端转发的那份，缓存 60 秒）。
  //    只验上游等于验了一条没人走的路。
  console.log("验证 App 实际访问的清单地址…");
  let app = null;
  for (let i = 0; i < 12; i++) {
    app = await readManifest(APP_MANIFEST_URL);
    if (app?.versionCode === versionCode) break;
    process.stdout.write(`  等服务端缓存过期…（${(i + 1) * 10}s）
`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.log("");
  if (!app) die(`App 用的清单地址拉不到：${APP_MANIFEST_URL}
服务端是不是没部署这个端点？`);
  if (app.versionCode !== versionCode) {
    die(`App 用的清单地址还停在 ${app.versionName}(${app.versionCode})。
` +
        `服务端缓存最多 60 秒，等了两分钟还没变说明它拉不到上游。`);
  }

  // ★★ 下载源必须**不是 GitHub**（2026-08-30 事故的那条断言）：
  //   这个脚本的全部意义是「这次更新能不能到老用户手里」，而它一直跑在**能连 GitHub
  //   的机器上** —— 于是 apkUrl 指着 github.com 时下面那次下载照样绿灯，国内用户却
  //   一个都下不动。机器连得上 ≠ 用户连得上，这条得显式判。
  if (new URL(app.apkUrl).hostname.toLowerCase().endsWith("github.com")) {
    die(
      `清单里的下载地址还指着 GitHub：${app.apkUrl}
国内用户下不动（2026-08-30 就是这么出的事）。检查服务端的 APP_APK_BASE 配了没有，
以及这一版的包有没有传到镜像目录（${APK_MIRROR_DIR}）。`,
    );
  }

  if (check.sha256 !== manifest.sha256) die("线上清单里的 sha256 和刚发的包对不上");
  // App 拿来校验下载结果的是**服务端转的那份**里的 sha256，所以它也得对
  if (app.sha256 !== manifest.sha256) die(`App 用的清单（${APP_MANIFEST_URL}）里的 sha256 和刚发的包对不上`);
  // ★ 强制更新的门槛也得原样到了 App 手里：服务端那一跳是 `{ ...body, apkUrl }` 透传，哪天改成逐字段重建就会把它丢掉 —— 零报错，强制更新悄悄失效
  if (minOf(check) !== minVersionCode) die(`线上清单里的 minVersionCode 是 ${minOf(check)}，本次要的是 ${minVersionCode}`);
  if (minOf(app) !== minVersionCode) {
    die(`App 用的清单（${APP_MANIFEST_URL}）里的 minVersionCode 是 ${minOf(app)}，本次要的是 ${minVersionCode} —— ` +
        `服务端转清单时把这一格丢了（server src/routes/appRelease.routes.js），强制更新不会生效`);
  }

  // ★ 清单指的必须正是本脚本刚喂过的那个镜像：指到别处的话，用户下的那份不是我们放的，
  //   上面那一串「先传 .part、核对、再改名」就保不到它
  const mirrorUrl = `${APK_MIRROR_PUBLIC}/${apkAsset}`;
  if (app.apkUrl !== mirrorUrl) {
    die(`清单里的下载地址不是本脚本上传的那个镜像：\n  清单 ${app.apkUrl}\n  镜像 ${mirrorUrl}\n` +
        `服务端的 APP_APK_BASE 改过的话，这里的 APK_MIRROR_PUBLIC / APK_MIRROR_HOST / APK_MIRROR_DIR 要一起改。`);
  }

  // ★★ 把整个包经 Cloudflare 下一遍比 sha256（2.62 之前只发一个 HEAD）：
  //   HEAD 只看得到大小，而这里要回答的是「用户下到手的那份能不能过校验」——
  //   边缘缓存里只要存的不是这一份，就是一年的校验失败，这件事只有真下一遍才知道。
  //   只有"没下成"（断线、卡住、非 2xx）才重来；**下完了**（服务器说多长就收了多长）
  //   而长度或 sha256 不对，一次就够定案、不重来：边缘那份是缓存住的，再下还是它。
  //   ⚠ 别把"比清单短"当成网络问题去重试 —— 那恰恰是边缘缓存了一个半截包的样子
  //     （它的 Content-Length 就是半截的长度，传输本身完整无误）。中途真断了 fetch 会抛。
  console.log(`经 Cloudflare 下载整个安装包核对 sha256：${mirrorUrl}`);
  let dl = null;
  let why = "";
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 10_000));
    try {
      dl = await downloadSha(mirrorUrl, manifest.sizeBytes);
    } catch (e) {
      why = e?.cause?.message || e?.message || String(e);
      console.log(`  第 ${i + 1} 次没下完：${why}`);
      dl = null;
      continue;
    }
    if (dl.status >= 200 && dl.status < 300) break;
    why = `HTTP ${dl.status}`;
    console.log(`  第 ${i + 1} 次：${why}`);
  }
  if (!dl || dl.status < 200 || dl.status >= 300) {
    die(`经 Cloudflare 下不动镜像上的包（${why}）：${mirrorUrl}\n` +
        `镜像机上的文件刚才已经在远端核对过 sha256。` +
        `HTTP 404 的话多半是边缘缓存了更早的一次 404（重跑时补传的那种），过几分钟重跑 npm run release；\n` +
        `其他情况先自己 curl 一遍这个地址看看。`);
  }
  if (dl.bytes !== manifest.sizeBytes || dl.sha !== manifest.sha256) {
    die(`经 Cloudflare 下到的 ${apkAsset} 与清单**对不上**` +
        `（下到 ${dl.bytes} 字节 / sha256 ${dl.sha.slice(0, 12)}…，清单 ${manifest.sizeBytes} 字节 / ${manifest.sha256.slice(0, 12)}…；cf-cache-status ${dl.cache}）。\n` +
        `镜像机上的文件刚才在远端核对过，所以坏的是边缘缓存那份 —— 它是 immutable 一年，所有从那里下的人都会「校验不通过」。\n` +
        `→ 立刻去 Cloudflare 清掉 ${mirrorUrl} 的缓存（Caching → Purge by URL），清完重跑 npm run release 验证；\n` +
        `  清不干净就涨一档版本号重发。`);
  }
  if (!/^application\/vnd\.android\.package-archive\b/i.test(dl.type)) {
    console.log(`⚠ 安装包的 Content-Type 是「${dl.type}」，不是 apk 的类型 —— 官网下载页上有些机型会存成装不了的文件`);
  }

  console.log(`\n✅ ${tag} 发布完成，更新链已验证：`);
  console.log(`   清单 ${APP_MANIFEST_URL} → ${app.versionName}(${app.versionCode})`);
  console.log(`   安装包 ${mirrorUrl}（整包 sha256 已核对，cf-cache-status ${dl.cache}）`);
  console.log(`   GitHub 归档 / 备用下载 ${check.apkUrl}（第 7b 步已核对与清单一致）`);
  console.log(`   已装 ${live ? live.versionName : "旧版"} 的用户下次打开 App 就会收到提示。`);
  console.log(minVersionCode > 0
    ? `   强制更新：versionCode < ${minVersionCode} 的包打开后只能更新（2.63 之前的包不认这一格，照旧是可以跳过的提示）。`
    : "   不强制更新。");
  console.log(`   发错了：npm run release -- --withdraw ${tag}（止血，见 docs/app-distribution.md「发错了」）。\n`);
}

(ARGS.withdraw !== undefined ? withdraw(ARGS.withdraw) : main()).catch((e) => die(e?.message || String(e)));
