// WAV 封装与"抓 PCM → 24k 单声道 WAV"的共用件。
//
// ★ 唯一实现（铁律六）：VideoCardAnnotator（从视频抓音）与 VoiceRecorder（麦克风跟读）
//   都产 Seedance 参考音频，格式必须一致 —— 各写一份编码器，哪天采样率/位深改了就会
//   一边能用一边被方舟拒，且拒的那边零线索。
// ★ 为什么是 WAV 不是 MediaRecorder 的 webm/opus：方舟参考音频只收 mp3/wav
//   （素材硬门），且 decodeAudioData 对 webm 的支持面没人保证。PCM 进来就是裸数据。

/** Seedance 参考音频用的采样率。16k 就够电话级，24k 留了余量（体积 15s ≈ 720KB） */
export const VOICE_SAMPLE_RATE = 24000;

/** 16-bit 单声道 WAV 封装（44 字节头 + PCM）→ dataURL */
export function wavDataUrl(samples: Float32Array, rate: number): string {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const ws = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i));
  };
  ws(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  ws(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ws(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  let bin = "";
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return "data:audio/wav;base64," + btoa(bin);
}

/**
 * 任意采样率的单声道 Float32 → 重采样到 VOICE_SAMPLE_RATE → WAV dataURL。
 * OfflineAudioContext 做重采样：浏览器自带的插值比手写线性插值靠谱。
 */
export async function pcmToVoiceWav(flat: Float32Array, srcRate: number): Promise<string> {
  const out = VOICE_SAMPLE_RATE;
  const off = new OfflineAudioContext(1, Math.ceil((flat.length / srcRate) * out), out);
  const ab = off.createBuffer(1, flat.length, srcRate);
  // copyToChannel 的类型要求 ArrayBuffer 背底；ScriptProcessor 抓来的可能标为 ArrayBufferLike
  ab.copyToChannel(flat as Float32Array<ArrayBuffer>, 0);
  const node = off.createBufferSource();
  node.buffer = ab;
  node.connect(off.destination);
  node.start();
  const rendered = await off.startRendering();
  return wavDataUrl(rendered.getChannelData(0), out);
}
