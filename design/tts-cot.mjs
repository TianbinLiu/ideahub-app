// 2.0「表现力增强 + 语音标签 cot」实验台：把心理活动/细腻表情写进台词，听差别。
//
// 用法（仓库根目录）：node design/tts-cot.mjs .
// 产物：design/tts-samples/cot__<用例名>.mp3（不入仓）
//
// 两个 2.0 专属的旋钮（1.0 与混音都吃不到）：
//
// ① req_params.model = "seed-tts-2.0-expressive"
//    官方原话："表现力增强版本，支持语音指令QA和语音标签Cot能力，**存在效果抽卡
//    的情况**"。对应的 "seed-tts-2.0-standard" 是默认值，延时更优但**不支持** cot。
//    所以不显式传 expressive，下面的 cot 标签会被当成普通文本或直接忽略。
//
// ② req_params.additions.use_tag_parser = true + 文本里写 <cot text=描述>台词</cot>
//    描述部分**不会被念出来**，只影响这一句的语速/情绪。官方限制：
//    "单句的 text 字符长度最好小于 64（cot 标签也计算在内）"、"cot 能力生效的
//    范围是单句"——所以长台词要拆成几句、每句各挂各的标签，不能一个标签罩全段。
//
// 另有 ③ context_texts（语音指令）：一句自然语言描述整体演绎方式，与 cot 可叠加。
// 三者的分工：context_texts 定"这个角色平时怎么说话"，cot 定"这一句此刻什么情绪"。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("用法: node design/tts-cot.mjs <仓库根目录>");
  process.exit(1);
}
const KEY = (readFileSync(resolve(ROOT, ".env.local"), "utf8").match(/^TTS_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("TTS_API_KEY 未配置");
  process.exit(1);
}

const VOICE = "ICL_uranus_zh_female_bingjiaojiejie_tob"; // 病娇姐姐 2.0

/** 平铺的对照句：不带任何标记 */
const PLAIN = "这张卡，你确定要交给我？我会记住它原来的样子的。";

/** 带 cot 的版本：每句单独挂标签，且每句连标签一起控制在 64 字以内 */
const COT =
  "<cot text=声音压低，像在耳边低语>这张卡，你确定要交给我？</cot>" +
  "<cot text=语速放慢，尾音微微拖长，带一点占有欲>我会记住它原来的样子的。</cot>";

/** 语音指令：定这个角色平时怎么说话 */
const INSTRUCT =
  "你是一位对卡片有病态执念的铸卡师，语气温柔平静，底下压着占有欲；说话慢，尾音略微拖长，像在耳边低语，不要活泼。";

const CASES = [
  ["1_原味", { text: PLAIN }],
  ["2_仅expressive", { text: PLAIN, model: "seed-tts-2.0-expressive" }],
  ["3_仅语音指令", { text: PLAIN, instruct: INSTRUCT }],
  ["4_expressive+指令", { text: PLAIN, model: "seed-tts-2.0-expressive", instruct: INSTRUCT }],
  ["5_cot无expressive", { text: COT, tag: true }],
  ["6_cot+expressive", { text: COT, model: "seed-tts-2.0-expressive", tag: true }],
  ["7_全开", { text: COT, model: "seed-tts-2.0-expressive", tag: true, instruct: INSTRUCT }],
];

async function synth({ text, model, tag, instruct }) {
  const res = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": KEY,
      "X-Api-Resource-Id": "seed-tts-2.0",
      "X-Api-Connect-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "ideahub" },
      req_params: {
        text,
        speaker: VOICE,
        ...(model ? { model } : {}),
        audio_params: { format: "mp3", sample_rate: 24000, bit_rate: 64000, speech_rate: -15 },
        additions: JSON.stringify({
          aigc_watermark: true,
          ...(tag ? { use_tag_parser: true } : {}),
          ...(instruct ? { context_texts: [instruct] } : {}),
        }),
      },
    }),
  });
  const sse = await res.text();
  const parts = [];
  let err = "";
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let j;
    try {
      j = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (j.code && j.code !== 0) err = `${j.code} ${j.message ?? ""}`;
    if (typeof j.data === "string" && j.data) parts.push(Buffer.from(j.data, "base64"));
  }
  if (!parts.length) throw new Error(err || `无音频（HTTP ${res.status}）`);
  return Buffer.concat(parts);
}

const outDir = resolve(ROOT, "design/tts-samples");
mkdirSync(outDir, { recursive: true });
const { createHash } = await import("node:crypto");
for (const [name, cfg] of CASES) {
  try {
    const buf = await synth(cfg);
    writeFileSync(resolve(outDir, `cot__${name}.mp3`), buf);
    // 用 md5 判"参数到底生效没有"——字节数相同不代表内容相同（CBR 下同长即同大小），
    // 但 md5 相同就是**真的一模一样**，说明那个参数被忽略了
    const md5 = createHash("md5").update(buf).digest("hex").slice(0, 8);
    const warn = /cot/.test(cfg.text) && buf.length < 20000 ? " ⚠残缺" : "";
    console.log(`OK   ${name.padEnd(20)} ${String(Math.round(buf.length / 1024)).padStart(3)}KB  md5=${md5}${warn}`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(20)} ${e.message}`);
  }
}
