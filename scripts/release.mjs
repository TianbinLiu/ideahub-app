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
//   这几件事全靠人记，迟早漏一件；而漏了之后**你不会知道**——你手上的 App 是好的，
//   坏的是所有已经装了旧版的人。所以这里逐条检查，最后再从公网**真的拉一遍**清单与整个包核对。
//
// 用法（仓库根目录）：
//   npm run release            出包 + 发布
//   npm run release -- --dry   只检查不发布（改完 versionCode 想先看一眼时用）
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

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

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

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
  //    ★ 例外：这个 tag 已经发过了（上次跑到一半失败，这次是原地重跑）——
  //      那就不是"要发一个新版"，而是"把上次那一版验证完"，不该被递增检查挡住。
  let exists = false;
  try {
    runShell("gh", ["release", "view", tag, "--repo", REPO]);
    exists = true;
  } catch {
    /* 不存在 */
  }
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

  // ── 5. 写清单 ────────────────────────────────────────────
  const apkBuf = fs.readFileSync(APK);
  const notesFile = path.join(root, "RELEASE_NOTES.md");
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8").trim() : "";
  if (!notes) console.log("⚠ 没有 RELEASE_NOTES.md —— 更新弹窗里将没有「这一版改了什么」");
  const apkAsset = `qimeng-${versionName}.apk`;
  const manifest = {
    versionCode,
    versionName,
    apkUrl: `https://github.com/${REPO}/releases/download/${tag}/${apkAsset}`,
    sizeBytes: apkBuf.length,
    sha256: sha256(apkBuf),
    notes,
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
    runShell("gh", ["release", "create", tag,
      path.join(out, apkAsset),
      path.join(out, `qimeng-${versionName}-play-store.aab`),
      path.join(out, "latest.json"),
      "--title", `启梦 ${versionName}`,
      // ★ notes 走 --notes-file 而不是 --notes 内联（2026-08-24 发 2.25 时炸出来的）：
      //   runShell 是 shell:true + 外包一层双引号，notes 里出现英文双引号就把参数
      //   当场截断，后半段被 shell 当 glob 炸掉（v2.24 的 notes 恰好全用「」没踩到）。
      //   发布文案里迟早会出现 " ` $ 之类字符——传文件路径就没有转义问题。
      ...(fs.existsSync(notesFile) ? ["--notes-file", notesFile] : ["--notes", `启梦 ${versionName}`]),
      "--repo", REPO]);
  }

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
  console.log(`   GitHub 归档 ${check.apkUrl}`);
  console.log(`   已装 ${live ? live.versionName : "旧版"} 的用户下次打开 App 就会收到提示。\n`);
}

main().catch((e) => die(e?.message || String(e)));
