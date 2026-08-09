// 混音样带：把两三把 1.0 嗓子按权重调和成一把新的，各出一条铸卡师台词。
//
// 用法（仓库根目录）：node design/tts-mix.mjs .
// 产物：design/tts-samples/mix__<配方名>.mp3（不入仓）
//
// ── 2026-08-09 实测结论，与官方文档有出入，照实记 ──
// · mix_speaker **只吃 1.0 音色**（*_moon_* / *_mars_*），2.0 的 uranus 一个都混不进去
//   （报 55000000 resource ID is mismatched with speaker related resource）
// · 本账号 seed-tts-1.0 **单音色调不动**（45000030 requested resource not granted），
//   但**混音调得动**——同一个 resource id、同一把钥匙，speaker 换成
//   "custom_mix_bigtts" 就通了。所以"1.0 没开通"不等于"混音用不了"。
//   这条很反直觉，别照着单音色的失败就断定混音也不行。
// · mix_factor **之和必须等于 1**。第三方 UI 上的滑杆通常是自动归一化的，
//   照抄滑杆读数（比如 0.8/0.82/0.28）会报错，要先自己归一化。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("用法: node design/tts-mix.mjs <仓库根目录>");
  process.exit(1);
}
const KEY = (readFileSync(resolve(ROOT, ".env.local"), "utf8").match(/^TTS_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("TTS_API_KEY 未配置");
  process.exit(1);
}

const LINE = "欢迎来到卡片工坊。把你的素材交给我，我为你炼成卡片；也可以逛逛市场，看看大家都在用什么。";

// ⚠ 音色 ID **逐个从官方列表核对过**，不要凭显示名推。踩过的坑：
//   · 后缀 moon / mars 没有规律，靠猜必错（知性女声是 mars，高冷御姐是 moon）
//   · 内部名与显示名会**对不上**——「柔美女友」内部叫 sajiaonvyou、
//     「撒娇学妹」内部叫 yuanqinvyou
//   · 传了不存在的 source_speaker，接口**不报错**，而是安静地回一段约 7KB
//     （≈0.9 秒）的残缺音频。所以"OK"不等于对，出来的字节数也要看。
const V = {
  御姐: "zh_female_gaolengyujie_moon_bigtts",
  女友: "zh_female_meilinvyou_moon_bigtts",
  知性: "zh_female_zhixingnvsheng_mars_bigtts",
  古风少御: "zh_female_gufengshaoyu_mars_bigtts",
  温柔淑女: "zh_female_wenroushunv_mars_bigtts",
  柔美女友: "zh_female_sajiaonvyou_moon_bigtts",
  俏皮女声: "zh_female_qiaopinvsheng_mars_bigtts",
  温柔小雅: "zh_female_wenrouxiaoya_moon_bigtts",
  顾姐: "zh_female_gujie_mars_bigtts",
};

/** 归一化到和为 1——这是接口的硬要求，不是建议 */
const norm = (pairs) => {
  const sum = pairs.reduce((a, [, w]) => a + w, 0);
  return pairs.map(([s, w]) => ({ source_speaker: s, mix_factor: +(w / sum).toFixed(3) }));
};

/**
 * 语速 0.8 倍。V3 的 speech_rate 是 [-50,100] 的线性刻度，0=1.0 倍、-50=0.5 倍，
 * 所以 0.8 倍 ≈ -20（(0.8-1)/0.5*50）。别把 V1 的 speed_ratio=0.8 直接搬过来。
 */
const SLOW = -20;

const RECIPES = [
  // 用户第二张截图能在火山实现的部分：调皮公主只有 2.0、混不进来，
  // 用 1.0 里气质最接近的「俏皮女声」顶上
  ["截图2近似_俏皮+御姐+女友", norm([[V.俏皮女声, 0.8], [V.御姐, 0.82], [V.女友, 0.28]])],
  ["御姐6_女友4", norm([[V.御姐, 6], [V.女友, 4]])],
  ["御姐5_知性3_女友2", norm([[V.御姐, 5], [V.知性, 3], [V.女友, 2]])],
  ["古风少御5_御姐5", norm([[V.古风少御, 5], [V.御姐, 5]])],
  ["古风少御4_知性4_柔美2", norm([[V.古风少御, 4], [V.知性, 4], [V.柔美女友, 2]])],
  ["御姐4_温柔淑女4_小雅2", norm([[V.御姐, 4], [V.温柔淑女, 4], [V.温柔小雅, 2]])],
];

async function synth(speakers, speechRate) {
  const res = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": KEY,
      "X-Api-Resource-Id": "seed-tts-1.0",
      "X-Api-Connect-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: "ideahub" },
      req_params: {
        text: LINE,
        // 用混音时 speaker 固定写这个魔法值，真正的音色在 mix_speaker 里
        speaker: "custom_mix_bigtts",
        audio_params: { format: "mp3", sample_rate: 24000, bit_rate: 64000, speech_rate: speechRate },
        mix_speaker: { speakers },
        additions: JSON.stringify({ aigc_watermark: true }),
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
    if (j.code && j.code !== 0) err = `${j.code} ${j.message ?? ""}`;
    if (typeof j.data === "string" && j.data) parts.push(Buffer.from(j.data, "base64"));
  }
  if (!parts.length) throw new Error(err || `无音频（HTTP ${res.status}）`);
  return Buffer.concat(parts);
}

const outDir = resolve(ROOT, "design/tts-samples");
mkdirSync(outDir, { recursive: true });
for (const [name, speakers] of RECIPES) {
  try {
    const buf = await synth(speakers, SLOW);
    writeFileSync(resolve(outDir, `mix__${name}.mp3`), buf);
    // <20KB 基本可以断定是"音色名不存在"导致的残缺音频（接口不报错）
    const flag = buf.length < 20000 ? " ⚠残缺，检查音色名" : "";
    console.log(`OK   ${name.padEnd(26)} ${Math.round(buf.length / 1024)}KB  ${speakers.map((s) => s.mix_factor).join("/")}${flag}`);
  } catch (e) {
    console.log(`FAIL ${name.padEnd(26)} ${e.message}`);
  }
}
