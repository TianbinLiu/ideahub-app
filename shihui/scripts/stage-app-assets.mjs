// 出安卓包前把 dist/clips 换成压缩版（.clips-packed）。
//
// ★ 为什么要换：`vite build` 会把 public/ 整个拷进 dist/，其中 public/clips 是 419MB 的
//   **母版**。直接打包 = 一个 400MB 的 APK（装不下也没人愿意下）。压缩版 38.6MB，
//   画质肉眼无差（CRF30，抽帧比对过）。
// ★ 为什么不让 vite 少拷一次：dev 服务器要靠 public/clips 提供 /clips/*，
//   把它挪出 public 就得另写一套 dev 中间件——为省 10 秒构建时间多一套实现不划算（铁律六）。
// ★ 没有压缩版就**响亮地失败**：静默打一个 400MB 的包出去，等发现时它已经在别人手机上了。
import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKED = path.join(ROOT, ".clips-packed");
const DIST_CLIPS = path.join(ROOT, "dist", "clips");

try {
  await stat(path.join(PACKED, "manifest.json"));
} catch {
  console.error("没有压缩版内容库——先跑 node scripts/pack-clips.mjs");
  process.exit(1);
}

await rm(DIST_CLIPS, { recursive: true, force: true });
await cp(PACKED, DIST_CLIPS, { recursive: true });

// 报一下实际体积：APK 大小的绝大部分就是它，值得每次打包都看见
let bytes = 0;
const { readdir } = await import("node:fs/promises");
for (const d of await readdir(DIST_CLIPS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of await readdir(path.join(DIST_CLIPS, d.name))) {
    bytes += (await stat(path.join(DIST_CLIPS, d.name, f))).size;
  }
}
console.log(`内容库已换成压缩版：${(bytes / 1024 / 1024).toFixed(1)}MB`);
