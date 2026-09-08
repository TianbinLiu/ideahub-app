package com.ideahub.branchvideo;

import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.AbsoluteSizeSpan;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Handler;
import android.media.MediaMetadataRetriever;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.ChannelMixingAudioProcessor;
import androidx.media3.common.audio.ChannelMixingMatrix;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.common.OverlaySettings;
import androidx.media3.effect.Presentation;
import androidx.media3.effect.StaticOverlaySettings;
import androidx.media3.effect.TextOverlay;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.common.collect.ImmutableList;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 成片合并（把 N 段按时间轴拼成一条），用**系统硬件编解码器**。
 *
 * ★★ 为什么要有它（2026-09-07 主人点名"以系统硬件编解码器为剪辑功能的核心"）：
 *   此前这件事在 WebView 里用 `canvas.captureStream(30)` + `MediaRecorder` **实时录屏**做 ——
 *   那是"够不到系统接口时的替代品"，代价一条都躲不掉：耗时恒等于片长、把已经压过一次的素材
 *   再编一遍、机器一忙就掉帧（本机实测同一次合并比墙钟短 26%）、切后台就废，
 *   而且 MediaRecorder 出来的 WebM **没有 Duration 元素**，全 app 没有任何消费者能从文件本身
 *   问出时长（2026-09-06 那次"前 12 秒全黑、后 12 秒播不到"的一半就是它）。
 *   手机剪辑软件从来不这么做：它们走 MediaCodec / AVFoundation，解码→处理→编码，
 *   速度由芯片决定，通常快于实时。我们是 Capacitor，壳子本身就是原生 App，够得到。
 *
 * ★ 这一层只做**机制**，不做**政策**：叠不叠标识、叠多久由 Web 侧按 `badge` 参数决定
 *   （合规口径会变，而它变的时候不该来动原生代码）。
 * ★ 输入直接收 https 地址：段落在出片那一刻就转存到图床了，让 Media3 自己流式取，
 *   不必先整条下载到手机再喂进去。
 * ★ 失败一律 reject 整句人话（铁律八）——这条路的产物直接进发布页，静默失败最贵。
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "VideoMerge")
public class VideoMergePlugin extends Plugin {

    /** logcat tag：真机复盘时 `adb logcat -s VideoMerge` 一条命令就能把合成那一段捞出来 */
    private static final String TAG = "VideoMerge";

    /** 同一时刻只允许一炉（与 Web 侧那道防重入闸同义，两边都拦一次） */
    private Transformer running;
    private PluginCall runningCall;
    private File runningOut;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** 这台设备到底支不支持（浏览器里没有这个插件，Web 侧靠 Capacitor.isNativePlatform 判） */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", true);
        o.put("engine", "media3-transformer");
        call.resolve(o);
    }

    /**
     * 把一份 base64 落成临时文件，回一个 file:// 地址。
     * ★ 只为**本地挑的 BGM**存在：那条在 Web 侧是 `blob:` 地址，原生这边根本打不开
     *   （blob 活在 WebView 的内存里，MediaCodec 看不见）。段落视频不走这里 —— 它们是 https，
     *   让 Media3 自己流式取，别在手机上多搬一趟几十兆。
     */
    @PluginMethod
    public void stageFile(PluginCall call) {
        String b64 = call.getString("base64", "");
        String ext = call.getString("ext", "bin");
        if (b64 == null || b64.isEmpty()) {
            call.reject("没有内容可落盘", "BAD_INPUT");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "staged");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("建不了暂存目录", "IO");
                return;
            }
            File f = new File(dir, "staged-" + System.currentTimeMillis() + "." + ext.replaceAll("[^A-Za-z0-9]", ""));
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            try (java.io.FileOutputStream os = new java.io.FileOutputStream(f)) {
                os.write(bytes);
            }
            JSObject o = new JSObject();
            o.put("uri", Uri.fromFile(f).toString());
            o.put("path", f.getAbsolutePath());
            call.resolve(o);
        } catch (Exception e) {
            call.reject("暂存失败：" + brief(e), "IO");
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            if (running != null) {
                running.cancel();
                running = null;
            }
            if (runningCall != null) {
                runningCall.reject("已取消合并", "CANCELLED");
                runningCall = null;
            }
            call.resolve();
        });
    }

    /**
     * clips: [{ url, startSec?, endSec? }]（1~24 段）
     * width / height: 输出画幅（会取偶）
     * bitrate: 可选，缺省按边长估
     * audio: { url, volume } 可选 —— BGM，短于成片时循环补齐
     * badge: { text, mode: "none"|"head"|"always", headSec? } 可选 —— 显式标识
     */
    @PluginMethod
    public void merge(PluginCall call) {
        if (running != null) {
            call.reject("已经有一炉在合并了", "BUSY");
            return;
        }
        JSArray clipsArr = call.getArray("clips");
        if (clipsArr == null || clipsArr.length() == 0) {
            call.reject("没有可合并的片段", "BAD_INPUT");
            return;
        }
        int w = even(call.getInt("width", 720));
        int h = even(call.getInt("height", 1280));

        final List<EditedMediaItem> items = new ArrayList<>();
        try {
            JSONArray raw = clipsArr;
            for (int i = 0; i < raw.length(); i++) {
                JSONObject c = raw.getJSONObject(i);
                String url = c.optString("url", "");
                if (url.isEmpty()) {
                    call.reject("第 " + (i + 1) + " 段没有地址", "BAD_INPUT");
                    return;
                }
                long startMs = Math.round(c.optDouble("startSec", 0) * 1000);
                double endSec = c.optDouble("endSec", -1);
                MediaItem.ClippingConfiguration.Builder clip = new MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(Math.max(0, startMs));
                // ★ endSec 缺省 / <=start 时**不设**结束点：设成 0 会得到一段空片，
                //   而空片在成片里是"这一段整个不见了"，零报错
                if (endSec > 0 && Math.round(endSec * 1000) > startMs) {
                    clip.setEndPositionMs(Math.round(endSec * 1000));
                }
                MediaItem mi = new MediaItem.Builder()
                        .setUri(Uri.parse(url))
                        .setClippingConfiguration(clip.build())
                        .build();
                items.add(new EditedMediaItem.Builder(mi).build());
            }
        } catch (Exception e) {
            call.reject("片段清单读不出来：" + brief(e), "BAD_INPUT");
            return;
        }

        // 画幅归一：拼接要求各段尺寸一致，横竖混排靠它按短边裁到同一个框
        List<androidx.media3.common.Effect> videoEffects = new ArrayList<>();
        videoEffects.add(Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP));

        JSObject badge = call.getObject("badge");
        if (badge != null) {
            String mode = badge.getString("mode", "none");
            String text = badge.getString("text", "");
            if (!"none".equals(mode) && !text.isEmpty()) {
                double headSec = badge.optDouble("headSec", 2.5);
                double ratio = badge.optDouble("minSideRatio", 0.055);
                long untilUs = "head".equals(mode) ? Math.round(headSec * 1_000_000d) : -1;
                // ★ 字高按**画面最短边**算，不是高：GB 45438-2025 要求 ≥ 最短边 5%（见 data/aigcLabel 的 ②）。
                //   按高算的话竖屏会偏大、横屏会偏小 —— 横屏那头就直接不合规了。
                int minSide = Math.min(w, h);
                videoEffects.add(new OverlayEffect(
                        ImmutableList.of(new BadgeOverlay(text, untilUs, minSide, ratio))));
            }
        }

        Effects effects = new Effects(ImmutableList.of(), ImmutableList.copyOf(videoEffects));
        // 逐段套同一组效果：Presentation 必须每段都有，否则尺寸不一致会被整发拒
        List<EditedMediaItem> withEffects = new ArrayList<>();
        for (EditedMediaItem it : items) {
            withEffects.add(it.buildUpon().setEffects(effects).build());
        }

        // ★★★ 异构音轨：**多段时必须开 forceAudioTrack，否则整条合并当场抛**（2026-09-07 反编译
        //   media3 1.11.0 的 SequenceAssetLoader 定的案，那句报错在字节码里逐字存在）：
        //     "The preceding MediaItem does not contain any audio track. If the sequence starts with
        //      an item without audio track (like images), followed by items with audio tracks, then
        //      EditedMediaItemSequence.Builder.experimentalSetForceAudioTrack() needs to be set to true."
        //   机理：**轨道集合由第一段定死** —— 后面的段冒出首段没有的轨型时，
        //   sampleConsumersByTrackType.get(trackType) 拿到 null，checkNotNull 当场炸。
        //   而本 app 里这条流水线**再正常不过**：白模复刻段天生无音轨
        //   （ai/arkClient.BLOCKOUT_TASK 钉着 generate_audio:false），hd/ultra 档的普通段真发
        //   generate_audio:true —— 「第 1 段白模 + 第 2 段普通段」就会整发失败。
        //   ⚠ 反过来（有声段在前、无声段在后）不会炸：消费者已经建好，media3 自己补静音。
        //
        // ★ 为什么**只在多段时**开，而不是一律开：开了之后输出**一定**带一条音轨（没得混就是静音的），
        //   于是 ExportResult.audioMimeType 恒非 null ⇒ 下面那个 hasAudio 就会对一条哑片报"有声音"，
        //   而它正是用来当面告诉用户「这条成片没有声音」的（骗人比不说更坏）。
        //   单段不可能异构 ⇒ 不必开 ⇒ 那一位仍然可信。多段则如实回报"不知道"（见 onCompleted）。
        final boolean multi = withEffects.size() > 1;
        EditedMediaItemSequence videoSeq = new EditedMediaItemSequence.Builder(withEffects)
                .experimentalSetForceAudioTrack(multi)
                .build();
        List<EditedMediaItemSequence> sequences = new ArrayList<>();
        sequences.add(videoSeq);

        JSObject audio = call.getObject("audio");
        // 我们自己送没送进去一条音轨（BGM / 模板原声）—— onCompleted 判 hasAudio 要用
        boolean bgmSupplied = false;
        // 送来的这条"音轨"其实是无声的 —— 要如实告诉用户（它多半是 App 自己预置的，用户没选过）
        String bgmSkipped = "";
        if (audio != null) {
            String aUrl = audio.getString("url", "");
            if (aUrl != null && !aUrl.isEmpty()) {
                // ★★★ 先探一次这条源里到底有没有音轨（2026-09-07 核查抓到的自伤）：
                //   剪辑页会**自动**把白模模板的 refVideo.url 当「原视频音轨」预置进来，
                //   而**白模化生成的模板存的是方舟白模产物**（server branchTemplate.routes.js:1099
                //   的 blockout.transferToCloudinary(verdict.videoUrl) → :1292 refVideo.url），
                //   那份产物自己就是无声的（BLOCKOUT_TASK 的 generate_audio:false）。
                //   配上下面那句 setRemoveVideo(true)，这条 EditedMediaItem 就成了**零轨道输入** ——
                //   往 Composition 里塞一条什么都不出的序列，轻则白解一路、重则整发抛。
                //   ⚠ 就算不抛也一样是错的：那一栏写着「原视频音轨」，而它根本发不出声 —— 文案在骗人。
                // ★ 只探**这一条**（不是每个片段）：一次网络读，还带超时；探不出来就当它有，
                //   宁可按老样子走，也不要因为探测本身失败而把用户的配乐悄悄丢掉。
                Boolean aud = probeHasAudio(aUrl);
                if (Boolean.FALSE.equals(aud)) {
                    bgmSkipped = "选的那条音轨本身没有声音（多半是白模模板的原片，它自己就是无声的）——这一条按无声合成了";
                    Log.w(TAG, "BGM 源没有音轨，跳过：" + aUrl);
                    aUrl = "";
                }
            }
            if (aUrl != null && !aUrl.isEmpty()) {
                bgmSupplied = true;
                float vol = (float) audio.optDouble("volume", 1.0);
                ChannelMixingAudioProcessor mixer = new ChannelMixingAudioProcessor();
                mixer.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(1, 1).scaleBy(vol));
                mixer.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(2, 2).scaleBy(vol));
                EditedMediaItem bgm = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(aUrl)))
                        .setEffects(new Effects(ImmutableList.<AudioProcessor>of(mixer), ImmutableList.of()))
                        // ★★ 只要声音，画面丢掉。这不是优化，是**正确性**：这条音轨的来源
                        //   常常是一个 **mp4**（白模模板的原片 refVideo.url —— 白模成片自己
                        //   是无声的，声音全靠它混进来）。多序列合成里画面只该由第一条序列出，
                        //   把第二条的画面也喂进去等于让合成器多解一路视频，还要去猜谁盖谁。
                        .setRemoveVideo(true)
                        .build();
                // ★ BGM 短于成片时循环补齐；isLooping 的序列不决定成片长度（由视频那条定）
                sequences.add(new EditedMediaItemSequence.Builder(bgm).setIsLooping(true).build());
            }
        }

        Composition composition = new Composition.Builder(sequences).build();

        final File out;
        try {
            File dir = new File(getContext().getCacheDir(), "merged");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("建不了输出目录", "IO");
                return;
            }
            out = new File(dir, "merged-" + System.currentTimeMillis() + ".mp4");
        } catch (Exception e) {
            call.reject("建不了输出文件：" + brief(e), "IO");
            return;
        }

        call.setKeepAlive(true);
        runningCall = call;
        runningOut = out;

        // lambda 要捕获 ⇒ 定格成 final（上面那两个是可变的）
        final boolean bgmFinal = bgmSupplied;
        final String bgmSkippedFinal = bgmSkipped;
        // ★ Transformer 要在有 Looper 的线程上起（主线程），回调也回主线程
        main.post(() -> {
            try {
                Transformer.Builder b = new Transformer.Builder(getContext())
                        .setVideoMimeType(MimeTypes.VIDEO_H264)
                        .setAudioMimeType(MimeTypes.AUDIO_AAC);
                Transformer t = b.addListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(@NonNull Composition c, @NonNull ExportResult result) {
                        running = null;
                        PluginCall cc = runningCall;
                        runningCall = null;
                        if (cc == null) return;
                        JSObject o = new JSObject();
                        o.put("path", out.getAbsolutePath());
                        o.put("uri", Uri.fromFile(out).toString());
                        o.put("sizeBytes", out.length());
                        o.put("durationSec", result.durationMs > 0 ? result.durationMs / 1000d : 0);
                        o.put("width", result.width);
                        o.put("height", result.height);
                        // ★★ 成片到底有没有声音，只有合成器答得准（2026-09-07 主人真机
                        //   「原本有声音的又没声音了」）：源片有没有音轨、BGM 有没有真的混进去，
                        //   Web 侧一概看不见 —— 而"没有声音"在界面上**不构成任何报错**
                        //   （音轨本来就是可选的），于是一条哑片会一路走到发布页都没人吭声。
                        //   audioMimeType 为 null = 输出里一条音轨都没有。
                        //   ★★ 三态，**拿不准就不报**（Web 侧 undefined = 不知道，什么都不说）：
                        //     · 我们自己送了 BGM ⇒ 一定有声，报 true；
                        //     · 单段（没开 forceAudioTrack）⇒ 合成器的答案可信，照报；
                        //     · 多段且没送 BGM ⇒ 强行补的那条静音轨会让 audioMimeType 恒非 null，
                        //       这一位就不可信了 —— **宁可不说**。骗人比不说更坏。
                        //   ⚠ 剩下的缺口（多段 + 无 BGM + 素材全哑 = 哑片却不吭声）今天没堵：
                        //     要堵得逐段探一次音轨（MediaMetadataRetriever 的 METADATA_KEY_HAS_AUDIO，
                        //     每段一次网络读），代价与收益不成比例 —— 预置修好之后这条路很少走到。
                        if (!bgmSkippedFinal.isEmpty()) o.put("bgmSkipped", bgmSkippedFinal);
                        if (bgmFinal) o.put("hasAudio", true);
                        else if (!multi) o.put("hasAudio", result.audioMimeType != null);
                        cc.resolve(o);
                    }

                    @Override
                    public void onError(@NonNull Composition c, @NonNull ExportResult result, @NonNull ExportException e) {
                        running = null;
                        PluginCall cc = runningCall;
                        runningCall = null;
                        //noinspection ResultOfMethodCallIgnored
                        out.delete();
                        if (cc == null) return;
                        // ★ 全栈进 logcat：`brief` 只留得下 220 字，真机复盘要的是栈
                        Log.e(TAG, "合成失败 errorCode=" + e.errorCode, e);
                        // ★ 这里**不加**「合并失败：」前缀 —— CutPage 的 catch 已经加了一次，
                        //   加两次屏幕上就是「合并失败：合并失败：…」（2026-09-07 真机拍到）
                        cc.reject(brief(e), "EXPORT_FAILED");
                    }
                }).build();
                running = t;
                t.start(composition, out.getAbsolutePath());
                pollProgress(t);
            } catch (Exception e) {
                running = null;
                PluginCall cc = runningCall;
                runningCall = null;
                Log.e(TAG, "合成起不来", e);
                if (cc != null) cc.reject("起不来（" + brief(e) + "）", "START_FAILED");
            }
        });
    }

    /** 进度：Transformer 只给"问"的接口，自己每 500ms 问一次，抄给 Web 侧 */
    private void pollProgress(Transformer t) {
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (running != t) return; // 换炉了 / 结束了
                ProgressHolder holder = new ProgressHolder();
                int state = t.getProgress(holder);
                if (state != Transformer.PROGRESS_STATE_NOT_STARTED) {
                    JSObject e = new JSObject();
                    e.put("percent", holder.progress);
                    notifyListeners("mergeProgress", e);
                }
                main.postDelayed(this, 500);
            }
        }, 500);
    }

    /**
     * 这条地址里有没有音轨。`null` = 没探出来（网络/格式问题），调用方**按"有"处理**。
     *
     * ★ 为什么带执行器与超时：MediaMetadataRetriever 对网络地址没有超时旋钮，
     *   卡住就是整条合并卡住 —— 而这只是一次锦上添花的探测，不值得让它挡路。
     */
    private static Boolean probeHasAudio(String url) {
        ExecutorService ex = Executors.newSingleThreadExecutor();
        try {
            Future<Boolean> f = ex.submit(() -> {
                MediaMetadataRetriever r = new MediaMetadataRetriever();
                try {
                    r.setDataSource(url, new HashMap<>());
                    return "yes".equals(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO));
                } finally {
                    try { r.release(); } catch (Exception ignored) { }
                }
            });
            return f.get(12, TimeUnit.SECONDS);
        } catch (Exception e) {
            Log.w(TAG, "探不出这条有没有音轨（按有处理）：" + brief(e));
            return null;
        } finally {
            ex.shutdownNow();
        }
    }

    private static int even(int v) {
        int x = Math.max(16, v);
        return x % 2 == 0 ? x : x + 1;
    }

    /**
     * 把一条异常压成一句人话。
     *
     * ★★ **必须走整条 cause 链**（2026-09-07 补，补之前它只取最外层的 getMessage）：
     *   media3 的 `ExportException` 最外层永远只是一句分类词 —— 角标那次是
     *   "Video frame processing error"，真因（IllegalArgumentException: width and height
     *   must be > 0）藏在第二层。只报最外层等于**把唯一有用的那句话扔了**，屏幕上、
     *   logcat 里、错误回执里三处同时查不到原因。
     */
    private static String brief(Throwable e) {
        StringBuilder sb = new StringBuilder();
        Throwable t = e;
        for (int depth = 0; t != null && depth < 4; depth++) {
            String m = t.getMessage();
            if (m == null || m.isEmpty()) m = t.getClass().getSimpleName();
            else if (depth > 0) m = t.getClass().getSimpleName() + ": " + m;
            if (sb.length() > 0) sb.append(" ← ");
            sb.append(m);
            if (t.getCause() == t) break;
            t = t.getCause();
        }
        String s = sb.toString();
        return s.length() > 220 ? s.substring(0, 220) : s;
    }

    /**
     * 显式标识角标。
     * ★ 「只在开头露一段」不是靠调透明度，而是**过了时间就换成一段画不出任何东西的文本**。
     *
     * ⚠⚠ 那段文本**必须是一个空格，不能是空串**（2026-09-07 真机实测的根因，代价是整条合并）：
     *   media3 的 `TextOverlay.getBitmap()` 拿 `getText()` 的结果去量宽度再建位图 ——
     *     measureText("") = 0 → StaticLayout 宽 0 → `Bitmap.createBitmap(0, h, ARGB_8888)`
     *     → IllegalArgumentException("width and height must be > 0")
     *   GL 线程上抛出来的它被 Transformer 包成 `ExportException`，message 只有一句
     *   **"Video frame processing error"**，真因全在 cause 里（这也是下面 `brief` 现在要打
     *   整条 cause 链的理由）。
     *   ⚠ 更坏的是它**不在第 0 帧发作**：前 headSec 秒文本非空，一切正常；硬件转码跑得飞快，
     *   20.7 秒的片子约 0.6 秒就越过 2.5 秒那条线，然后当场炸 —— 屏幕上表现为「刚开始就失败」，
     *   与角标毫无关联，我是靠反编译 media3 的 TextOverlay 字节码才把它对上的。
     *   空格 measureText > 0，位图非零且全透明（StaticLayout 画一个空格什么都不留），
     *   合规上也等价于"不显示"。
     */
    private static final class BadgeOverlay extends TextOverlay {
        private final SpannableString shown;
        /** 见类注释：**一个空格**，不是空串 —— 空串会让 media3 建 0 宽位图并抛 IAE */
        private final SpannableString empty = new SpannableString(" ");
        private final long untilUs; // <0 = 全程
        private final StaticOverlaySettings settings;

        BadgeOverlay(String text, long untilUs, int minSide, double ratio) {
            this.untilUs = untilUs;
            SpannableString s = new SpannableString(text);
            int end = s.length();
            s.setSpan(new ForegroundColorSpan(Color.WHITE), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            s.setSpan(new BackgroundColorSpan(Color.argb(110, 0, 0, 0)), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            s.setSpan(new StyleSpan(Typeface.BOLD), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            // 字号按**最短边**的比例给（国标下限 5%）。写死像素的话竖屏与横屏必然一头不合规。
            s.setSpan(new AbsoluteSizeSpan(Math.max(18, (int) Math.round(minSide * ratio))), 0, end,
                    Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            this.shown = s;
            // 贴右下角：国标要求位于起始画面的**边或角**（见 data/aigcLabel 的 ②），右下角合规且最不挡主体
            this.settings = new StaticOverlaySettings.Builder()
                    .setOverlayFrameAnchor(1f, -1f)
                    .setBackgroundFrameAnchor(0.94f, -0.90f)
                    .build();
        }

        @NonNull
        @Override
        public SpannableString getText(long presentationTimeUs) {
            if (untilUs >= 0 && presentationTimeUs > untilUs) return empty;
            return shown;
        }

        @NonNull
        @Override
        public OverlaySettings getOverlaySettings(long presentationTimeUs) {
            return settings;
        }
    }
}
