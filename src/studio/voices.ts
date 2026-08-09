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
  /**
   * 混音配方：把 2~3 把 **1.0** 嗓子按权重调和成一把新的。给了它就忽略 id。
   * 权重不必自己归一化——发出去之前会归一（接口硬要求和为 1）。
   */
  mix?: Array<{ id: string; w: number }>;
  /** 语速。V3 的 speech_rate 是 [-50,100] 线性刻度：0=1.0 倍、-50=0.5 倍、100=2.0 倍 */
  rate?: number;
  /** 音高。post_process.pitch 范围 [-12,12]，负值压低音域 = 更低沉 */
  pitch?: number;
  /**
   * 支持"表现力增强版 + 语音标签"。只有 2.0 的 **ICL_** 那一档（角色扮演）有；
   * 通用场景的 *_uranus_bigtts 与全部 1.0/混音都没有。
   * 开了之后台词里可以写 `<cot text=心理活动>这一句</cot>`——描述不会被念出来，
   * 只影响这一句怎么说。**没开却写了标签，标签会被原样念出来**（实测）。
   */
  expressive?: boolean;
}

/** 1.0 音色 ID。**逐个从官方列表核对过，别凭显示名推**——后缀 moon/mars 没有规律
 *  （知性女声是 mars、高冷御姐是 moon），内部名还会和显示名对不上
 *  （「柔美女友」内部叫 sajiaonvyou、「撒娇学妹」内部叫 yuanqinvyou）。 */
const M = {
  御姐: "zh_female_gaolengyujie_moon_bigtts",
  女友: "zh_female_meilinvyou_moon_bigtts",
  知性: "zh_female_zhixingnvsheng_mars_bigtts",
  古风少御: "zh_female_gufengshaoyu_mars_bigtts",
  温柔淑女: "zh_female_wenroushunv_mars_bigtts",
  柔美女友: "zh_female_sajiaonvyou_moon_bigtts",
  俏皮女声: "zh_female_qiaopinvsheng_mars_bigtts",
  温柔小雅: "zh_female_wenrouxiaoya_moon_bigtts",
};

export const VOICES: PresetVoice[] = [
  // ── 混音配方（把几把 1.0 嗓子调和成一把新的）──
  // 放最前面是因为它们**调不出来的味道单音色给不了**：单音色是别人调好的成品，
  // 混音才是你自己那一把。语速统一给 -20（≈0.8 倍），成熟感主要来自慢。
  {
    name: "混音 · 御姐+知性+女友",
    id: "mix-yujie-zhixing-nvyou",
    why: "冷底子 + 讲道理的口吻 + 一点气声（推荐先听这个）",
    mix: [{ id: M.御姐, w: 5 }, { id: M.知性, w: 3 }, { id: M.女友, w: 2 }],
    rate: -20,
  },
  {
    name: "混音 · 古风少御+御姐",
    id: "mix-gufeng-yujie",
    why: "二次元底子最重的一版，古风味 + 清冷",
    mix: [{ id: M.古风少御, w: 5 }, { id: M.御姐, w: 5 }],
    rate: -20,
  },
  {
    name: "混音 · 古风少御+知性+柔美",
    id: "mix-gufeng-zhixing-roumei",
    why: "同上再柔一档，不那么拒人",
    mix: [{ id: M.古风少御, w: 4 }, { id: M.知性, w: 4 }, { id: M.柔美女友, w: 2 }],
    rate: -20,
  },
  {
    name: "混音 · 御姐+温柔淑女+小雅",
    id: "mix-yujie-shunv-xiaoya",
    why: "成熟但收着，适合长台词",
    mix: [{ id: M.御姐, w: 4 }, { id: M.温柔淑女, w: 4 }, { id: M.温柔小雅, w: 2 }],
    rate: -20,
  },
  {
    name: "混音 · 俏皮+御姐+女友",
    id: "mix-qiaopi-yujie-nvyou",
    // 用户找来的第二套组合的火山近似版：调皮公主只有 2.0、混不进来，
    // 用 1.0 里气质最接近的「俏皮女声」顶上
    why: "偏活泼一档（你找的那套组合的近似版）",
    mix: [{ id: M.俏皮女声, w: 0.8 }, { id: M.御姐, w: 0.82 }, { id: M.女友, w: 0.28 }],
    rate: -20,
  },

  // ── 单音色（2.0）──
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

  // ── 角色扮演档（ICL_uranus_*_tob）──
  // ★ 这一档才是二次元人设音色的正经产地：名字直接写着人设（清冷高雅/成熟姐姐/
  //   邪魅女王…），而不是"通用场景"那种按用途命名的播音腔。之前几轮我一直在
  //   「通用场景」里翻，找错了地方——是用户发来的一张第三方混音截图里出现了
  //   「病娇姐姐」才把我指到这儿的。
  { name: "清冷高雅 2.0", id: "ICL_uranus_zh_female_qinglenggaoya_tob", expressive: true, pitch: -6, rate: -20, why: "名字就是清冷，气质最贴铸卡师" },
  { name: "成熟姐姐 2.0", id: "ICL_uranus_zh_female_chengshujiejie_tob", expressive: true, pitch: -6, rate: -20, why: "年龄感更足，压得住场" },
  { name: "成熟温柔 2.0", id: "ICL_uranus_zh_female_chengshuwenrou_tob", expressive: true, pitch: -6, rate: -20, why: "成熟但不冷，留一点温度" },
  { name: "理性圆子 2.0", id: "ICL_uranus_zh_female_lixingyuanzi_tob", expressive: true, pitch: -6, rate: -20, why: "讲道理的口吻，最像手艺人" },
  { name: "邪魅女王 2.0", id: "ICL_uranus_zh_female_xiemeinvwang_tob", expressive: true, pitch: -6, rate: -20, why: "更强的气场，偏危险感" },
  { name: "温柔女神 2.0", id: "ICL_uranus_zh_female_wenrounvshen_tob", expressive: true, pitch: -6, rate: -20, why: "端庄柔和" },
  { name: "病娇姐姐 2.0", id: "ICL_uranus_zh_female_bingjiaojiejie_tob", expressive: true, pitch: -6, rate: -20, why: "低语感强，适合演绎「她知道你不知道的事」" },
];

/**
 * 关于**混音**（把两三把嗓子按权重调和成一把新的）——2026-08-09 实测两条路都堵死：
 *   · 拿 2.0 音色混 → 55000000 "resource ID is mismatched with speaker related resource"
 *   · 拿 1.0 音色混 → 45000030 "requested resource not granted"（本账号 1.0 未开通）
 * 官方参数表也写着 mix_speaker「仅适用于豆包语音合成模型1.0的音色」。
 * 所以想用混音必须先在控制台开通「大模型语音合成」(1.0)，且只能混 1.0 音色
 * ——2.0 这批（本文件里全部）一个都混不了。
 *
 * 真要混的话调用形态是：req_params.speaker = "custom_mix_bigtts"，
 * 另给 req_params.mix_speaker.speakers = [{source_speaker, mix_factor}, …]，
 * 最多 3 个，**mix_factor 之和必须等于 1**（第三方 UI 上的滑杆通常是自动归一化的，
 * 照抄滑杆读数会报错）。
 */

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
  "你的语气要没有情绪：平铺直叙，像在读一份清单，不做任何抑扬顿挫，句尾一律下沉不上扬，音色低沉、气息稳，不要亲切、不要热情、不要笑意。";

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
