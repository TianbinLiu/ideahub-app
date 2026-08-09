// 音色试听样带：拿铸卡师的真实台词，把候选音色各合成一条 mp3，摆在一起对比。
//
// 用法（仓库根目录）：node design/tts-samples.mjs .  [音色id,...]
// 产物：design/tts-samples/<音色id>.mp3（**不入仓**，听完就删；见 .gitignore）
//
// 为什么要有这个脚本：音色只能靠耳朵选，而控制台的试听用的是官方示范句，
// 跟"铸卡师说自己的台词"完全是两回事——同一个音色念广告词好听、念这句可能出戏。
//
// 协议是 V3 SSE，2026-08-09 实测确认（不是照文档猜的）：
//   POST https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse
//   headers: X-Api-Key / X-Api-Resource-Id
//   响应是 text/event-stream，每帧两行：
//     event: 352                      ← TTSResponse（音频）；153 = SessionFailed
//     data: {"code":0,"message":"","data":"<base64 mp3 分片>","sentence":…}
//   把所有帧的 data 按序 base64 解码后首尾相接就是完整 mp3。
//   实测一条 25 字的台词回 18 帧、约 49KB。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("用法: node design/tts-samples.mjs <仓库根目录> [音色id,...]");
  process.exit(1);
}
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^TTS_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("TTS_API_KEY 未配置（.env.local）");
  process.exit(1);
}

/** 铸卡师的开场白——工坊里 initGreet 真正会说的那一句 */
const LINE = "欢迎来到卡片工坊。把你的素材交给我，我为你炼成卡片；也可以逛逛市场，看看大家都在用什么。";

const DEFAULT_IDS = [
  "zh_female_gaolengyujie_uranus_bigtts",
  "zh_female_zhixingnv_uranus_bigtts",
  "zh_female_cancan_uranus_bigtts",
  "zh_female_wenroushunv_uranus_bigtts",
  "zh_female_sophie_uranus_bigtts",
  "zh_female_qingxinnvsheng_uranus_bigtts",
  "zh_female_xiaohe_uranus_bigtts",
];

const ids = (process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_IDS);
/** 第 4 个参数：语音指令；第 5 个：pitch。产物文件名会带上后缀便于 A/B */
const INSTRUCT = process.argv[4] || "";
const PITCH = Number(process.argv[5] || 0) || 0;
const suffix = (INSTRUCT ? "__instructed" : "") + (PITCH ? `__pitch${PITCH}` : "");

/**
 * 语音指令（2.0 专属）。一句自然语言就能改演绎方式，比换音色的调节幅度大得多——
 * 官方示例是 "你可以用特别特别痛心的语气说话吗?"、"你能用骄傲的语气来说话吗？"。
 * 这是"预置音色都不对味"时**第一个该试的杠杆**，不是换音色。
 * ⚠ 只对 2.0 音色生效，且只有列表第一个值有效；该字段不计费。
 */
async function synth(speaker, instruct, pitch) {
  // 1.0 音色（moon/mars）与 2.0 音色（uranus）是**两个计费商品、两个 resource id**，
  // 各自要在控制台单独开通。本账号实测 1.0 未开通（45000030 requested resource not granted）
  const resourceId = /uranus/.test(speaker) ? "seed-tts-2.0" : "seed-tts-1.0";
  const res = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": KEY,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Connect-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "ideahub" },
      req_params: {
        text: LINE,
        speaker,
        audio_params: { format: "mp3", sample_rate: 24000, bit_rate: 64000 },
        // additions 的类型是 jsonstring（不是 object），传错会被忽略
        additions: JSON.stringify({
          aigc_watermark: true,
          ...(instruct && /uranus/.test(speaker) ? { context_texts: [instruct] } : {}),
          // pitch 范围 [-12,12]，负值压低音域 = 更成熟
          ...(pitch ? { post_process: { pitch } } : {}),
        }),
      },
    }),
  });
  const text = await res.text();
  const parts = [];
  let err = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let j;
    try {
      j = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (j.code && j.code !== 0) err = `code=${j.code} ${j.message ?? ""}`;
    if (typeof j.data === "string" && j.data) parts.push(Buffer.from(j.data, "base64"));
  }
  if (!parts.length) throw new Error(err || `无音频（HTTP ${res.status}）`);
  return Buffer.concat(parts);
}

const outDir = resolve(ROOT, "design/tts-samples");
mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  try {
    const buf = await synth(id, INSTRUCT, PITCH);
    writeFileSync(resolve(outDir, `${id}${suffix}.mp3`), buf);
    console.log(`OK   ${id}  ${Math.round(buf.length / 1024)}KB`);
  } catch (e) {
    console.log(`FAIL ${id}  ${e.message}`);
  }
}
