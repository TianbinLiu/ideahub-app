#!/usr/bin/env node
/**
 * design/ui-mockups/capture-game-hud.mjs —— 把 game-hud-variants.html 钉成截图。
 *
 * 产物（默认 C:\Users\tliu7\Downloads\game-hud\）：
 *   A-table-852.png / A-shop-852.png / A-bag-852.png / A-result-852.png
 *   A-table-1280.png …                                        3 方案 × 4 画面 × 2 尺寸 = 24 张
 *   _all.png                                                  总览（4 列 = 四个画面，上半 852 / 下半 1280）
 *
 * ★ 为什么截图脚本进 design/ 而不进 src：这一轮只出方案、不改 App。playwright 也**不进**
 *   package.json —— 它只给这个离线脚本用，CI 的 npm run build 不该为几张贴图多装一个浏览器。
 *   第一次用先在机器上装一次：
 *     npm i -g playwright && npx playwright install chromium
 *   然后：
 *     node design/ui-mockups/capture-game-hud.mjs        # 用机器上已装的 playwright（全局 / NODE_PATH 都认）
 *     # Windows PowerShell 换输出目录：
 *     $env:OUT = "D:\somewhere"; node design/ui-mockups/capture-game-hud.mjs
 *
 * ★ 852 出 dpr2（1704×696，6~8px 的小字看得清）；1280×720 出 1:1 —— 文件名里的数字就是 CSS 视口宽。
 * ★ 动效在截图里统一 `reducedMotion: reduce`：这一版几乎全是静态稿，只有拖拽那张卡带一点投影，
 *   停在基础态才不会每次截到的相位都不一样。
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, "game-hud-variants.html");
const OUT = path.resolve(process.env.OUT || "C:/Users/tliu7/Downloads/game-hud");
const VARIANTS = ["A", "B", "C"];
const SCREENS = [
  ["table", "对局主界面"],
  ["shop", "商店栏"],
  ["bag", "背包栏"],
  ["result", "结算小窗"],
];
const SIZES = [
  [852, 348],
  [1280, 720],
];

/** playwright 不在仓库依赖里：先认本地的，再认全局 npm 目录（Windows APPDATA / npm root -g）。 */
function loadChromium() {
  const tries = [
    () => require("playwright"),
    () => require(path.join(process.env.APPDATA || "", "npm", "node_modules", "playwright")),
    () => require(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")),
  ];
  for (const fn of tries) {
    try {
      return fn().chromium;
    } catch {
      /* 换下一个来源 */
    }
  }
  throw new Error("找不到 playwright。先装：npm i -g playwright && npx playwright install chromium");
}

const chromium = loadChromium();
const fileUrl = (v, s) => `file:///${HTML.replace(/\\/g, "/")}?v=${v}&s=${s}`;

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shots = [];
  for (let vi = 0; vi < VARIANTS.length; vi++) {
    for (const [screen] of SCREENS) {
      for (const [w, h] of SIZES) {
        const page = await browser.newPage({
          viewport: { width: w, height: h },
          // 852 是真机口径，按 dpr2 出（1704×696，看得到 6~8px 的小字）；
          // 1280×720 是桌面预览，按 1:1 出，文件名就是像素尺寸。
          deviceScaleFactor: w === 852 ? 2 : 1,
          reducedMotion: "reduce",
        });
        await page.goto(fileUrl(VARIANTS[vi].toLowerCase(), screen), { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(140);
        const name = `${VARIANTS[vi]}-${screen}-${w}.png`;
        const file = path.join(OUT, name);
        await page.screenshot({ path: file });
        shots.push({ name, file, v: vi + 1, variant: VARIANTS[vi], screen });
        console.log(`✓ ${name}`);
        await page.close();
      }
    }
  }
  await browser.close();

  // ── 总览：另开一张 HTML 把 24 张摆成对照表，再整页截下来 ──
  //    为什么用浏览器拼而不是 Pillow：中文字体/字重与稿子同一套，标题与细线不会跑版。
  const cell = (shot, w) => `
    <figure>
      <figcaption>${shot.variant} · ${SCREENS.find(([k]) => k === shot.screen)[1]}
        <span>${w === 852 ? "852×348 @2x" : "1280×720"}</span></figcaption>
      <img src="file:///${shot.file.replace(/\\/g, "/")}" style="width:852px;height:auto;display:block" />
    </figure>`;
  const block = (w) => `
    <section class="block">
      <h2>${w === 852 ? "真机基准 · 852×348 CSS（横屏）" : "桌面预览 · 1280×720（同一套布局，等比放大）"}</h2>
      <div class="cols">${SCREENS.map(([, label]) => `<div class="colhead">${label}</div>`).join("")}</div>
      ${VARIANTS.map((V) => {
        const row = SCREENS.map(([s]) => shots.find((x) => x.variant === V && x.screen === s && x.name.endsWith(`-${w}.png`)));
        return `<div class="cols row">${row.map((shot) => cell(shot, w)).join("")}</div>`;
      }).join("")}
    </section>`;
  const overview = `<!doctype html><meta charset="utf-8">
  <style>
    html,body{margin:0;background:#0e0e10;color:#e9e4da;font-family:"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif}
    .sheet{width:3560px;padding:32px 32px 40px}
    h1{margin:0 0 6px;font-size:26px;letter-spacing:.06em;font-weight:700}
    .lead{margin:0 0 26px;font-size:13px;letter-spacing:.06em;color:#8f897d;line-height:1.7}
    h2{margin:26px 0 10px;font-size:14px;letter-spacing:.2em;color:#cdbf9f;font-weight:600;border-top:1px solid #2a2723;padding-top:16px}
    .cols{display:grid;grid-template-columns:repeat(4,874px);gap:24px}
    .colhead{font-size:12px;letter-spacing:.22em;color:#8f897d}
    .row{margin-top:14px}
    figure{margin:0;width:874px;border:1px solid #2a2723;background:#131315;padding:10px}
    figcaption{font-size:12px;letter-spacing:.05em;color:#d9d2c2;margin-bottom:8px}
    figcaption span{color:#7d766a;margin-left:8px;letter-spacing:.02em}
    img{outline:1px solid #000}
  </style>
  <div class="sheet">
    <h1>工人坊 · 对局内 UI 三案（主界面 / 商店栏 / 背包栏 / 结算小窗）</h1>
    <p class="lead">
      A 克制极简（近乎无背景 / 只一层刻线 / 信息分层最陡） ·
      B 黄铜仪表盘（圆表 · 刻线盘 · 铜牌 · 铆钉导轨） ·
      C 全息织物（织带 · 缝线框 · 稀薄冷光）<br />
      同一间暗室 + 暖木 + 黄铜 + 织物；差别在"这局读起来像什么"，不在配色。截图脚本：design/ui-mockups/capture-game-hud.mjs
    </p>
    ${block(852)}
    ${block(1280)}
  </div>`;
  const overviewHtml = path.join(OUT, "_overview.html");
  fs.writeFileSync(overviewHtml, overview, "utf8");

  const b2 = await chromium.launch();
  const page = await b2.newPage({ viewport: { width: 3640, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`file:///${overviewHtml.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, "_all.png"), fullPage: true });
  await b2.close();
  fs.rmSync(overviewHtml);
  console.log(`✓ _all.png`);
  console.log(`\n输出目录：${OUT}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
