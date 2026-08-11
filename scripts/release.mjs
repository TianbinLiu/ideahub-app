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
//   四件事全靠人记，迟早漏一件；而漏了之后**你不会知道**——你手上的 App 是好的，
//   坏的是所有已经装了旧版的人。所以这里逐条检查，最后再从公网**真的拉一遍**清单核对。
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

async function main() {
  const bt = buildTools();
  const { versionCode, versionName } = readVersion();
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

  if (DRY) {
    console.log("\n--dry：检查全部通过，没有发布。\n");
    return;
  }

  // ── 6. 发布 ──────────────────────────────────────────────
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
      "--notes", notes || `启梦 ${versionName}`,
      "--repo", REPO]);
  }

  // ── 7. ★ 回头验证：从公网真的拉一遍，确认老用户能看到、能下 ──
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
    process.stdout.write(`  等服务端缓存过期…（${(i + 1) * 10}s）`);
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

  const head = await fetch(app.apkUrl, { method: "HEAD", redirect: "follow" });
  if (!head.ok) die(`清单里的 apkUrl 下不动（HTTP ${head.status}）：${app.apkUrl}`);
  const len = Number(head.headers.get("content-length") || 0);
  if (len && len !== manifest.sizeBytes) {
    die(`apkUrl 指向的文件大小对不上（清单 ${manifest.sizeBytes} / 实际 ${len}）`);
  }
  if (check.sha256 !== manifest.sha256) die("线上清单里的 sha256 和刚发的包对不上");

  console.log(`\n✅ ${tag} 发布完成，更新链已验证：`);
  console.log(`   清单 ${MANIFEST_URL} → ${check.versionName}(${check.versionCode})`);
  console.log(`   安装包 ${check.apkUrl}`);
  console.log(`   已装 ${live ? live.versionName : "旧版"} 的用户下次打开 App 就会收到提示。\n`);
}

main().catch((e) => die(e?.message || String(e)));
