// 铸卡师的候选嗓子。全部是**火山官方预置音色**，voice_type 逐个核对过
// 官方《音色列表》（docs.volcengine.com/docs/6561/1257544，2026-08-09 抓取）。
//
// 三条选型原则，写下来免得以后有人顺手加错：
//
// ① **只收 1.0 音色**（moon_bigtts / mars_bigtts）。/api/tts 走的是 V1 HTTP 非流式
//    接口，官方文档白纸黑字写着"不支持豆包语音合成模型2.0的音色（如
//    zh_female_vv_uranus_bigtts）"，传了会回 code 3050「音色不存在」。
//    2.0 那批（ICL_uranus_* / *_uranus_*）音质更好也更便宜，但要另接 V3
//    chunked/SSE 通路——那是下一步的事。
//
// ② **绝不收「IP仿音」与「趣味口音」里的明星仿音**。火山对那一档的用词从头到尾是
//    "仿音"而不是"授权"，从内部 voice_type 命名（…_yangmi_… / …_linzhiling_… /
//    …_leidian_… / …_zhoujielun_…）就能看出模仿对象，而授权性质官方从未正面说明。
//    更要命的是它们的**可识别性最高**——北京互联网法院殷某某案（判赔 25 万）的
//    认定标准正是"相关领域普通听众能否识别出是谁"。这条线不要试探。
//
// ③ 一律中文音色。台词全是中文，英文嗓子念汉字只会得到静音或拼读。
export interface PresetVoice {
  /** 官方展示名 */
  name: string;
  /** voice_type，直接进 /api/tts 的 body */
  id: string;
  /** 为什么适合铸卡师 */
  why: string;
  /** 支持的情感（多情感音色才有）。key 是我们的语义，值是官方 emotion 参数 */
  emotions?: Record<"happy" | "excited" | "sad" | "cold", string>;
}

export const VOICES: PresetVoice[] = [
  {
    name: "爽快思思（多情感）",
    id: "zh_female_shuangkuaisisi_emo_v2_mars_bigtts",
    // ★ 默认选它：唯一一个情感档位能对上 store 里 mood 字段的
    //   （出炉时笑意拉满 → 激动；素材不合格收敛 → 冷漠）。中英混也念得住，
    //   台词里有 "AI"/"Seedance" 这类词时不会卡壳
    why: "干脆利落，会跟着铸卡师的心情变语气（推荐）",
    emotions: { happy: "happy", excited: "excited", sad: "sad", cold: "coldness" },
  },
  { name: "邻家女孩", id: "zh_female_linjianvhai_moon_bigtts", why: "亲切不做作，长台词听着不腻" },
  { name: "开朗姐姐", id: "zh_female_kailangjiejie_moon_bigtts", why: "明亮外放，开场白很吃这个" },
  { name: "甜美小源", id: "zh_female_tianmeixiaoyuan_moon_bigtts", why: "偏甜，短句好听" },
  { name: "甜美悦悦", id: "zh_female_tianmeiyueyue_moon_bigtts", why: "比小源稳一点的甜" },
  { name: "亲切女声", id: "zh_female_qinqienvsheng_moon_bigtts", why: "最中性的保底选择" },
  {
    name: "爽快思思 / Skye",
    id: "zh_female_shuangkuaisisi_moon_bigtts",
    why: "同一把嗓子的无情感版，中英双语",
  },
  { name: "呆萌川妹", id: "zh_female_daimengchuanmei_moon_bigtts", why: "四川口音，想要反差萌就选它" },
  { name: "湾湾小何", id: "zh_female_wanwanxiaohe_moon_bigtts", why: "台湾口音，软一些" },
];

export const DEFAULT_VOICE = VOICES[0].id;

const KEY = "ideahub-app.voiceId";

export function currentVoice(): PresetVoice {
  try {
    const id = localStorage.getItem(KEY);
    return VOICES.find((v) => v.id === id) ?? VOICES[0];
  } catch {
    return VOICES[0]; // 隐私模式
  }
}

export function setVoice(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 隐私模式下存不住，本次会话仍按默认走 */
  }
}

/**
 * 心情 → 官方 emotion 参数。只有多情感音色吃这个，普通音色传了会被忽略。
 * mood 的量纲见 studioStore：出炉/入组是 +1，素材不合格是 -0.6。
 */
export function emotionFor(voice: PresetVoice, mood: number, active: boolean): string | undefined {
  if (!voice.emotions || !active) return undefined;
  if (mood > 0.55) return voice.emotions.excited;
  if (mood > 0) return voice.emotions.happy;
  if (mood < -0.3) return voice.emotions.cold;
  return undefined;
}
