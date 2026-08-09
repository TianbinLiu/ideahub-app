// 铸卡师的候选嗓子。全部是**火山官方预置音色**，voice_type 逐个核对过
// 官方《音色列表》（docs.volcengine.com/docs/6561/1257544，2026-08-09 抓取），
// 并且**每一个都真的合成过一条铸卡师的台词**（design/tts-samples.mjs）。
//
// 人设定调：工坊里的铸卡师是**成熟、冷静**的二次元角色（银发双马尾、红瞳、
// 神情淡漠），不是元气系。所以"撒娇学妹""元气甜妹"那一类一概不收——
// 声音和立绘对不上，比没有声音更出戏。
//
// 三条硬约束，写下来免得以后有人顺手加错：
//
// ① **只收 2.0 音色**（*_uranus_*）。/api/tts 走 V3，X-Api-Resource-Id 决定用哪代
//    模型、也决定计费商品，两代要在控制台**各自开通**。本账号实测
//    seed-tts-1.0 未开通（45000030 requested resource not granted）、
//    seed-tts-2.0 可用，所以 1.0 那批（*_moon_* / *_mars_*）现在一个都调不动。
//
// ② **绝不收「IP仿音」**（玲玲姐姐 2.0、春日部姐姐 2.0、女雷神、双节棍小哥…）。
//    火山对那一档的用词自始至终是"仿音"而不是"授权"，从内部命名就能看出模仿
//    对象，而授权性质官方从未正面说明。更要命的是它们**可识别性最高**——北京
//    互联网法院殷某某案（判赔 25 万）的认定标准正是"相关领域普通听众能否识别
//    出是谁"。这条线不要试探。
//
// ③ 一律中文音色。台词全是中文，英文嗓子念汉字只会得到静音或拼读。
export interface PresetVoice {
  /** 官方展示名 */
  name: string;
  /** voice_type，直接进 /api/tts 的 body（req_params.speaker） */
  id: string;
  /** 为什么适合铸卡师 */
  why: string;
  /** 支持的情感（多情感音色才有）。key 是我们的语义，值是官方 emotion 参数 */
  emotions?: Record<"happy" | "excited" | "sad" | "cold", string>;
}

export const VOICES: PresetVoice[] = [
  {
    name: "高冷御姐 2.0",
    id: "zh_female_gaolengyujie_uranus_bigtts",
    // ★ 默认：名字就写着"高冷"，是清单里最贴"成熟冷静"的一个
    why: "清冷疏离，最贴铸卡师的神情（推荐）",
  },
  { name: "知性女声 2.0", id: "zh_female_zhixingnv_uranus_bigtts", why: "沉稳讲道理的口吻，长台词稳得住" },
  { name: "知性灿灿 2.0", id: "zh_female_cancan_uranus_bigtts", why: "角色扮演档里最有人味的知性音" },
  { name: "魅力苏菲 2.0", id: "zh_female_sophie_uranus_bigtts", why: "成熟偏低的音域，气质更重" },
  { name: "温柔淑女 2.0", id: "zh_female_wenroushunv_uranus_bigtts", why: "冷静但不硬，想要柔一点选它" },
  { name: "清新女声 2.0", id: "zh_female_qingxinnvsheng_uranus_bigtts", why: "干净中性，最不抢戏的保底" },
  { name: "小何 2.0", id: "zh_female_xiaohe_uranus_bigtts", why: "自然口语感，像真人在说话" },
  { name: "古风少御 2.0", id: "zh_female_gufengshaoyu_uranus_bigtts", why: "少女与御姐之间，古风底子，二次元感最强" },
  { name: "Vivi 2.0", id: "zh_female_vv_uranus_bigtts", why: "2.0 旗舰嗓，自然度最高，可配方言" },
  { name: "顾姐 2.0", id: "zh_female_gujie_uranus_bigtts", why: "更硬的姐系，压得住场" },
  { name: "魅力女友 2.0", id: "zh_female_meilinvyou_uranus_bigtts", why: "低音域，气声偏多" },
  { name: "TVB女声 2.0", id: "zh_female_tvbnv_uranus_bigtts", why: "港剧配音腔，端着的成熟感" },
];

export const DEFAULT_VOICE = VOICES[0].id;

/**
 * 语调指令（2.0 音色专属的 context_texts）。一句自然语言就能改演绎方式，
 * **调节幅度比换音色大得多**——同一把嗓子加上"用成熟冷静克制的语气"之后，
 * 出来的音频与原味逐字节不同（2026-08-09 md5 对照确认，不是心理作用）。
 *
 * 所以"预置音色都不对味"时，**第一个该拧的旋钮是这里，不是换音色**。
 * 官方示例："你能用骄傲的语气来说话吗？"、"你可以说慢一点吗？"
 * 该字段不计费；只对 2.0 音色生效，1.0 音色收到会忽略。
 */
export const DEFAULT_INSTRUCT =
  "请用成熟、冷静、克制的语气说话，语速放慢一些，像一位手艺人在平静地陈述事实，不要活泼，不要上扬的尾音。";

const INSTRUCT_KEY = "ideahub-app.voiceInstruct";

export function currentInstruct(): string {
  try {
    return localStorage.getItem(INSTRUCT_KEY) ?? DEFAULT_INSTRUCT;
  } catch {
    return DEFAULT_INSTRUCT;
  }
}

export function setInstruct(v: string) {
  try {
    localStorage.setItem(INSTRUCT_KEY, v);
  } catch {
    /* 隐私模式 */
  }
}

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
