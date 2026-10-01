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
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.audio.SpeedProvider;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.CanvasOverlay;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.common.OverlaySettings;
import androidx.media3.effect.Presentation;
import androidx.media3.effect.RgbMatrix;
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
import com.google.common.collect.ImmutableSet;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.ByteBuffer;
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
    /** 暂存文件的序号（见 stageFile 起名那一行的 ★） */
    private int stagedSeq = 0;

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
        // ★★ 分块续写（2026-09-08）：本地挑的 BGM 过 Capacitor 桥只能走 base64，而一条几十兆的
        //   音频编成一整条 base64 是 **1.33 倍体积的单个 JS 字符串** —— 慢，而且在低端机上
        //   有实打实的 OOM 面（JS 侧拼串、桥上再复制一遍、Java 侧还要整块 decode）。
        //   现在 Web 侧按 512KB 切片逐块送，`append` + `path` 让它们续写进同一个文件。
        //   ⚠ `path` 只接**我们自己上一拍回给它的那个**，而且必须落在 staged 目录里 ——
        //   直接拿调用方给的路径写文件等于开了一个任意写的口子。
        String append = call.getString("path", "");
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
            final boolean appending = append != null && !append.isEmpty();
            final File f;
            if (appending) {
                File cand = new File(append);
                // 只认自己那个目录下的文件（防越权写）
                if (!dir.equals(cand.getParentFile()) || !cand.isFile()) {
                    call.reject("续写的目标不对", "BAD_INPUT");
                    return;
                }
                f = cand;
            } else {
                // ★ 文件名带一个递增的序号：一次合成现在会连着落十几个文件（每句配音一个 + 配乐），只按毫秒起名的话
                //   两个落在同一毫秒里的会重名 —— 后一个把前一个盖掉，成片里某一句就念成了另一句，零报错
                f = new File(dir, "staged-" + System.currentTimeMillis() + "-" + (stagedSeq++) + "."
                        + ext.replaceAll("[^A-Za-z0-9]", ""));
            }
            byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            try (java.io.FileOutputStream os = new java.io.FileOutputStream(f, appending)) {
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
            // ★★ 整段包起来、`resolve` 放 finally：`Transformer.cancel()` 会把释放阶段的
            //   RuntimeException 重抛出来，而这里是主线程的 Runnable —— 抛出去就是**进程当场死**；
            //   就算侥幸不死，`call` 悬着 = Web 侧 `cancelNativeMerge()` 的 await 永远不回，
            //   而那一拍屏幕上正写着「正在停止…」。取消本身失败了也要让上层往下走。
            try {
                if (running != null) {
                    running.cancel();
                    running = null;
                }
                if (runningCall != null) {
                    runningCall.reject("已取消合并", "CANCELLED");
                    runningCall = null;
                }
            } catch (Throwable t) {
                Log.e(TAG, "取消时出错（已吞掉，不让它把进程带走）", t);
                running = null;
                runningCall = null;
            } finally {
                call.resolve();
            }
        });
    }

    /** 一个片段的参数（Web 侧 data/cutProject.compileTimeline 算好的那张表里的一行） */
    private static final class ClipSpec {
        MediaItem item;
        float speed = 1f;
        float volume = 1f;
        long outStartUs;
        long outDurUs;
        long fadeInUs;
        long fadeOutUs;
    }

    /**
     * clips: [{ url, startSec?, endSec?, speed?, volume?, outStartSec?, outDurSec?, fadeInSec?, fadeOutSec? }]（1~24 段）
     *        speed = 变速（画面与声音一起变）；volume = 这一段原声的音量（0 = 静音）；
     *        outStartSec / outDurSec = 这一段在**成片**里的起点与时长（变速之后的），fadeInSec / fadeOutSec = 段头从黑淡入 /
     *        段尾淡出到黑 —— 淡入淡出按成片时间轴算，所以要靠前两个数定位
     * width / height: 输出画幅（会取偶）
     * bitrate: 可选，缺省按边长估
     * audio: { url, volume } 可选 —— BGM，短于成片时循环补齐
     * badge: { text, mode: "none"|"head"|"always", headSec? } 可选 —— 显式标识
     * captions: { items: [{ startSec, endSec, lines: string[], kind?: "caption"|"title" }],
     *             sizeRatio?, bottomRatio?, maxWidthRatio?, titleScale?, titleTopRatio? } 可选 ——
     *        烧进画面的字幕；时间是成片时间轴上的绝对秒，**换行由 Web 侧算好**（预览那一面画的是同一批行），
     *        版式那几个比例也由 Web 侧给（cutProject.captionLayout）
     * voices: [{ url, atSec, durSec, volume? }] 可选 —— 配音，按成片时间轴上的起点摆
     * tailFadeSec + totalSec: 可选 —— 成片最后这么多秒整体声音淡出
     *
     * ★ 这些全是**机制**：哪一段变速、字幕写什么、配音摆在第几秒，都由 Web 侧的剪辑工程定（data/cutProject），
     *   原生不替它做任何决定。新参数全部可选 —— 一个都不带时，行为与加它们之前逐字相同。
     */
    @PluginMethod
    public void merge(PluginCall call) {
        if (running != null) {
            // ★ 这不是**失败** —— 那一炉好好地在跑。话要自带出路（上层见 BUSY 也不会加"合并失败"前缀）
            call.reject("已经有一炉在合并了，等它跑完就会带你去发布页", "BUSY");
            return;
        }
        JSArray clipsArr = call.getArray("clips");
        if (clipsArr == null || clipsArr.length() == 0) {
            call.reject("没有可合并的片段", "BAD_INPUT");
            return;
        }
        int w = even(call.getInt("width", 720));
        int h = even(call.getInt("height", 1280));

        final List<ClipSpec> specs = new ArrayList<>();
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
                ClipSpec cs = new ClipSpec();
                cs.item = new MediaItem.Builder()
                        .setUri(Uri.parse(url))
                        .setClippingConfiguration(clip.build())
                        .build();
                // ★ 变速收在 0.25~4：再往外声音处理器（Sonic）出来的东西已经没法听，而这个数是从 Web 侧来的不可信输入
                cs.speed = (float) Math.max(0.25, Math.min(4.0, c.optDouble("speed", 1.0)));
                cs.volume = (float) Math.max(0.0, Math.min(1.0, c.optDouble("volume", 1.0)));
                cs.outStartUs = Math.round(Math.max(0, c.optDouble("outStartSec", 0)) * 1_000_000d);
                cs.outDurUs = Math.round(Math.max(0, c.optDouble("outDurSec", 0)) * 1_000_000d);
                cs.fadeInUs = Math.round(Math.max(0, c.optDouble("fadeInSec", 0)) * 1_000_000d);
                cs.fadeOutUs = Math.round(Math.max(0, c.optDouble("fadeOutSec", 0)) * 1_000_000d);
                specs.add(cs);
            }
        } catch (Exception e) {
            call.reject("片段清单读不出来：" + brief(e), "BAD_INPUT");
            return;
        }

        // ★★ 从这里到 Composition.build() 整段包在 try 里（2026-09-08 补）：media3 一路都是
        //   checkArgument/checkState，而 Capacitor 的 Bridge 对插件方法抛出的异常是
        //   `throw new RuntimeException(ex)` 到它自己的线程 —— **进程当场死，JS 那边的 Promise
        //   永不 settle**（屏幕停在「合成中…」，连错误都没有）。今天没有已知的抛出路径，
        //   但代价是 3 行，而不包的代价是最坏那一类。
        // 这几位在 try 里赋值、try 之后还要用（catch 里 return，Java 能证明它们一定被赋过）
        final Composition composition;
        final boolean multi;
        final boolean bgmFinal;
        final String bgmSkippedFinal;
        try {
        // ── 叠在画面上的东西（显式标识 + 字幕）：一份清单，每一段的效果链末尾各挂一次 ──
        // ★ 效果器拿到的时间戳是**成片时间轴**上的（不是每段各自从 0 起，裁过头的片段也一样 ——
        //   2026-09-30 在模拟器上打日志量过：三段、首段从第 1 秒起裁，时间戳一路 0 → 10 秒单调走完）。
        //   所以「只在开头 2.5 秒露标识」「第 7 秒出这句字幕」都直接按成片的绝对时间写。
        final List<androidx.media3.effect.TextureOverlay> overlays = new ArrayList<>();
        int minSide = Math.min(w, h);
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
                overlays.add(new BadgeOverlay(text, untilUs, minSide, ratio));
            }
        }
        JSObject captions = call.getObject("captions");
        if (captions != null) {
            JSONArray capItems = captions.optJSONArray("items");
            if (capItems != null && capItems.length() > 0) {
                overlays.add(new CaptionOverlay(
                        capItems, w, h,
                        (float) captions.optDouble("sizeRatio", 0.05),
                        (float) captions.optDouble("bottomRatio", 0.28),
                        (float) captions.optDouble("maxWidthRatio", 0.58),
                        (float) captions.optDouble("titleScale", 1.5),
                        (float) captions.optDouble("titleTopRatio", 0.2)));
            }
        }

        // ── 逐段的效果链：画幅归一 →（闪黑）→ 叠加物；声音那一侧是这一段原声的音量 ──
        // ★ Presentation 必须每段都有，否则尺寸不一致会被整发拒（横竖混排靠它按短边裁到同一个框）
        // ★ 闪黑排在叠加物**前面**：变暗的只是画面本身，显式标识不跟着暗下去 ——
        //   第一段带淡入时，「起始画面要有标识」那一条照样成立（合规口径见 data/aigcLabel）
        List<EditedMediaItem> withEffects = new ArrayList<>();
        for (ClipSpec cs : specs) {
            List<androidx.media3.common.Effect> ve = new ArrayList<>();
            ve.add(Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP));
            if ((cs.fadeInUs > 0 || cs.fadeOutUs > 0) && cs.outDurUs > 0) {
                ve.add(new FadeRgb(cs.outStartUs, cs.outDurUs, cs.fadeInUs, cs.fadeOutUs));
            }
            if (!overlays.isEmpty()) ve.add(new OverlayEffect(ImmutableList.copyOf(overlays)));
            // 音量正好是 1 时一个处理器都不挂（与 BGM 那边同一条：少一环就少一处可能出事的地方）
            ImmutableList<AudioProcessor> ap = Math.abs(cs.volume - 1f) < 0.001f
                    ? ImmutableList.of()
                    : ImmutableList.of(new GainAudioProcessor(cs.volume));
            EditedMediaItem.Builder ib = new EditedMediaItem.Builder(cs.item)
                    .setEffects(new Effects(ap, ImmutableList.copyOf(ve)));
            if (Math.abs(cs.speed - 1f) > 0.001f) ib.setSpeed(new ConstSpeed(cs.speed));
            withEffects.add(ib.build());
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
        multi = withEffects.size() > 1;
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
                // ★★ 调音量走**自己写的增益处理器**（2026-09-08 换掉 ChannelMixingAudioProcessor）：
                //   media3 的 `ChannelMixingMatrix.createForConstantGain` 只实现了少数几种声道组合
                //   （字节码里那几句报错原文：「…->1 are not implemented.」「…->2 are not implemented.」），
                //   我们能安全登记的只有 1→1 与 2→2 ⇒ 一条 5.1／7.1 的配乐会因为"找不到对应的矩阵"
                //   被**整发拒**，屏幕上一句英文，而用户能做的只有把配乐删掉重来。
                //   而我们要的根本不是"混声道"，只是"乘一个系数" —— 那件事与声道数**无关**。
                // ★ 音量正好是 1 时仍然一个处理器都不挂（`isActive` 也会回 false，这里省一次构造）。
                ImmutableList<AudioProcessor> aps =
                        Math.abs(vol - 1f) < 0.001f
                                ? ImmutableList.of()
                                : ImmutableList.of(new GainAudioProcessor(vol));
                EditedMediaItem bgm = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(aUrl)))
                        .setEffects(new Effects(aps, ImmutableList.of()))
                        // ★★ 只要声音，画面丢掉。这不是优化，是**正确性**：这条音轨的来源
                        //   常常是一个 **mp4**（白模模板的原片 refVideo.url —— 白模成片自己
                        //   是无声的，声音全靠它混进来）。多序列合成里画面只该由第一条序列出，
                        //   把第二条的画面也喂进去等于让合成器多解一路视频，还要去猜谁盖谁。
                        .setRemoveVideo(true)
                        .build();
                // ★ BGM 短于成片时循环补齐；isLooping 的序列不决定成片长度（由视频那条定）
                // ⚠ 带循环配乐的合成收尾时，logcat 里会有一条吓人的
                //   `E ExoPlayerImplInternal: Playback error … IllegalStateException at AudioGraphInput.getInputBuffer`
                //   （2026-09-30 模拟器上看到，反编译对过：那一行是 checkState(!isReleased)）。它是循环那条序列的取样线程
                //   在混音总线释放之后又来要了一次缓冲 —— media3 自己的收尾先后，那一刻成片已经写完，onCompleted 照常回来，
                //   产物逐项量过是对的。真机复盘时别顺着这条日志去查。
                sequences.add(new EditedMediaItemSequence.Builder(bgm).setIsLooping(true).build());
            }
        }

        // ── 配音：一条**只出声音**的序列，各句按成片时间轴上的起点摆，句与句之间用空档垫到位 ──
        // ★ 这条序列用「声明轨型」的那个构造器（Set<轨型>）：只有它允许序列以空档开头 ——
        //   第一句配音几乎从来不在第 0 秒。
        // ★ 成片多长由画面那条序列定，配音不许把它撑长：起点落在片尾之后的整句不要，
        //   念到片尾还没完的在片尾掐掉（Web 侧排的时候本来就会拦，这里只是不信任输入）。
        double totalSec = call.getDouble("totalSec", 0.0);
        long totalUs = Math.round(Math.max(0, totalSec) * 1_000_000d);
        boolean voiceSupplied = false;
        JSArray voices = call.getArray("voices");
        if (voices != null && voices.length() > 0) {
            EditedMediaItemSequence.Builder vb =
                    new EditedMediaItemSequence.Builder(ImmutableSet.of(C.TRACK_TYPE_AUDIO));
            long cursorUs = 0;
            for (int i = 0; i < voices.length(); i++) {
                JSONObject v = voices.getJSONObject(i);
                String vUrl = v.optString("url", "");
                long atUs = Math.round(Math.max(0, v.optDouble("atSec", 0)) * 1_000_000d);
                long durUs = Math.round(Math.max(0, v.optDouble("durSec", 0)) * 1_000_000d);
                if (vUrl.isEmpty() || durUs <= 0) continue;
                // 与上一句重叠的往后顺（同一条序列里两句不可能叠着念）
                if (atUs < cursorUs) atUs = cursorUs;
                if (totalUs > 0 && atUs >= totalUs) break;
                if (atUs > cursorUs) vb.addGap(atUs - cursorUs);
                MediaItem.Builder mb = new MediaItem.Builder().setUri(Uri.parse(vUrl));
                long playUs = durUs;
                if (totalUs > 0 && atUs + durUs > totalUs) {
                    playUs = totalUs - atUs;
                    mb.setClippingConfiguration(new MediaItem.ClippingConfiguration.Builder()
                            .setEndPositionMs(Math.max(1, playUs / 1000)).build());
                }
                float vol = (float) Math.max(0.0, Math.min(1.0, v.optDouble("volume", 1.0)));
                ImmutableList<AudioProcessor> vps = Math.abs(vol - 1f) < 0.001f
                        ? ImmutableList.of()
                        : ImmutableList.of(new GainAudioProcessor(vol));
                vb.addItem(new EditedMediaItem.Builder(mb.build())
                        .setEffects(new Effects(vps, ImmutableList.of()))
                        .setRemoveVideo(true)
                        .build());
                cursorUs = atUs + playUs;
                voiceSupplied = true;
            }
            if (voiceSupplied) sequences.add(vb.build());
        }

        Composition.Builder cb = new Composition.Builder(sequences);
        // ── 片尾整体淡出：挂在**混好之后**的那条总线上（成片最后 tailFadeSec 秒，所有声音一起收）──
        // ★ 为什么不挂在 BGM 自己身上：BGM 那条序列是循环的，挂在它上面的处理器看到的时间每一圈都从头来，
        //   「最后一秒」无从说起；总线上的时间就是成片的时间。
        double tailFadeSec = call.getDouble("tailFadeSec", 0.0);
        if (tailFadeSec > 0.01 && totalUs > 0) {
            long fadeUs = Math.min(Math.round(tailFadeSec * 1_000_000d), totalUs);
            cb.setEffects(new Effects(
                    ImmutableList.of(new TailFadeAudioProcessor(totalUs - fadeUs, fadeUs)),
                    ImmutableList.of()));
        }
        composition = cb.build();
        // 配音与 BGM 一样算「我们自己送进去的声音」：有它成片就一定有声
        bgmFinal = bgmSupplied || voiceSupplied;
        bgmSkippedFinal = bgmSkipped;
        } catch (Throwable t) {
            // 见上面那段 ★★：不接住就是进程死 + JS 那边的 Promise 永不 settle
            Log.e(TAG, "组装合成任务时出错", t);
            call.reject("合成起不来（" + brief(t) + "）", "START_FAILED");
            return;
        }

        final File out;
        try {
            // ★★ 先扫一遍旧的（2026-09-08 补）：这个目录此前**只增不减** —— 成功的留一整份
            //   （几十 MB，而它同一时刻还被整份读进了 IndexedDB，等于同一条片子占两份盘）、
            //   取消的留半截，而 App 里那两个「清理缓存 / 已用 xx MB」只扫 IndexedDB，
            //   **够不到这里**：用户只会看到应用体积莫名地涨，而且没有任何把手能清。
            // ★ 在这一拍扫是安全的：`running != null` 已经挡住并发，所以此刻没有任何一炉在用它们；
            //   上一炉的产物要么早被 Web 侧读进了 idb、要么就是没人认得的孤儿。
            //   留 6 小时的余量，别把"刚合完还没读走"那份扫掉。
            sweepCache("merged", 6 * 60 * 60 * 1000L);
            sweepCache("staged", 6 * 60 * 60 * 1000L);
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
                    // ★★ 本地文件与网络地址要走**不同的重载**（2026-09-08 真机实测才发现）：
                    //   `setDataSource(String, Map)` 是**网络**那一版，喂 `file://` 会直接
                    //   `RuntimeException: setDataSource failed: status = 0xFFFFFFEA`。
                    //   本地挑的 BGM 正是先 stageFile 落盘、再以 file:// 送进来的 ⇒ 探测**永远失败**。
                    //   兜底是"按有处理"所以没出错，但那条路上的探测等于白跑，还每次刷一条警告 ——
                    //   将来真正的探测失败会被这堆噪音盖住。
                    if (url.startsWith("file:") || url.startsWith("/")) {
                        r.setDataSource(Uri.parse(url).getPath());
                    } else {
                        r.setDataSource(url, new HashMap<>());
                    }
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

    /**
     * 逐样本乘一个系数的增益处理器 —— **与声道数无关**。
     *
     * ★★ 为什么要自己写：media3 现成的 `ChannelMixingAudioProcessor` 是拿来**混声道**的，
     *   调音量只是它的副作用，而它的矩阵工厂只实现了 1→1 / 1→2 / 2→1 / 2→2 几种；
     *   一条 5.1／7.1 的配乐在那儿会因为"没有对应矩阵"把整条合并拒掉。
     *   而"把音量乘 0.6"这件事根本不关心有几个声道 —— 逐个 16-bit 样本乘一下就是了。
     * ★ 只接 16-bit PCM；别的编码 `onConfigure` 回 NOT_SET ⇒ `isActive()` 为假 ⇒ media3 直接跳过
     *   这一环（不是报错，是不参与），配乐照样出声，只是音量旋钮对它不起作用。
     * ★ 字节序跟着缓冲区自己走（media3 给的是 nativeOrder），别手写 `& 0xFF` 拼 —— 拼错了
     *   听感上是一片噪音，而不会有任何报错。
     */
    private static final class GainAudioProcessor extends BaseAudioProcessor {
        private final float gain;

        GainAudioProcessor(float gain) {
            this.gain = gain;
        }

        @Override
        protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat in) {
            if (in.encoding != C.ENCODING_PCM_16BIT) return AudioProcessor.AudioFormat.NOT_SET;
            return in; // 声道数、采样率原样透传：我们只动幅度
        }

        @Override
        public boolean isActive() {
            return super.isActive() && Math.abs(gain - 1f) > 0.001f;
        }

        @Override
        public void queueInput(ByteBuffer in) {
            ByteBuffer out = replaceOutputBuffer(in.remaining());
            while (in.remaining() >= 2) {
                int v = Math.round(in.getShort() * gain);
                if (v > Short.MAX_VALUE) v = Short.MAX_VALUE;
                if (v < Short.MIN_VALUE) v = Short.MIN_VALUE;
                out.putShort((short) v);
            }
            in.position(in.limit());
            out.flip();
        }
    }

    /** 恒定变速。media3 的变速接口收的是"随时间变的速度表"，我们只要一个不变的数 */
    private static final class ConstSpeed implements SpeedProvider {
        private final float speed;

        ConstSpeed(float speed) {
            this.speed = speed;
        }

        @Override
        public float getSpeed(long timeUs) {
            return speed;
        }

        @Override
        public long getNextSpeedChangeTimeUs(long timeUs) {
            return C.TIME_UNSET; // 之后不再变
        }
    }

    /**
     * 闪黑：这一段开头从黑里淡入、结尾淡出到黑（只动画面的亮度，不动透明度）。
     *
     * ★ 时间按**成片时间轴**算（见 merge 里叠加物那段 ★ 的实测）：所以构造时要知道这一段在成片里的起点与时长。
     * ★ 为什么是"乘亮度"而不是真的交叉溶解：media3 的序列里一段接一段，同一时刻只有一段在画面上，
     *   两段叠着溶要走双序列合成（实验性接口）。先黑一下再亮起来只需要一段自己的亮度随时间变 ——
     *   `RgbMatrix.getMatrix` 每帧都会来问一次。
     */
    private static final class FadeRgb implements RgbMatrix {
        /** 离算好的区间多远就不再信它（见 getMatrix 的 ★）。四分之一秒：比一次淡入淡出短，比时间戳的毛刺长 */
        private static final long SLACK_US = 250_000L;
        private final long startUs;
        private final long endUs;
        private final long fadeInUs;
        private final long fadeOutUs;

        FadeRgb(long outStartUs, long outDurUs, long fadeInUs, long fadeOutUs) {
            this.startUs = outStartUs;
            this.endUs = outStartUs + outDurUs;
            // 淡入 + 淡出不许比这一段还长：各自最多占一半
            this.fadeInUs = Math.min(fadeInUs, outDurUs / 2);
            this.fadeOutUs = Math.min(fadeOutUs, outDurUs / 2);
        }

        @Override
        public float[] getMatrix(long presentationTimeUs, boolean useHdr) {
            float k = 1f;
            // ★ 兜底（SLACK_US）：这一段在成片里的起止是 Web 侧**算**出来的。真要是算岔了（这一段实际比算的长得多 /
            //   开始得早得多），照公式走会把超出去的那一截画成全黑 —— 黑下去就再也亮不回来。离算好的区间太远的帧
            //   一律原样出：最坏是少一次淡入淡出，不是黑掉半条片子。
            if (presentationTimeUs < startUs - SLACK_US || presentationTimeUs > endUs + SLACK_US) {
                float[] id = new float[16];
                android.opengl.Matrix.setIdentityM(id, 0);
                return id;
            }
            if (fadeInUs > 0 && presentationTimeUs < startUs + fadeInUs) {
                k = Math.min(k, (presentationTimeUs - startUs) / (float) fadeInUs);
            }
            if (fadeOutUs > 0 && presentationTimeUs > endUs - fadeOutUs) {
                k = Math.min(k, (endUs - presentationTimeUs) / (float) fadeOutUs);
            }
            k = Math.max(0f, Math.min(1f, k));
            float[] m = new float[16];
            android.opengl.Matrix.setIdentityM(m, 0);
            android.opengl.Matrix.scaleM(m, 0, k, k, k);
            return m;
        }
    }

    /**
     * 片尾整体淡出：从 fadeStartUs 起，在 fadeUs 里把音量从 1 线性收到 0（挂在混好之后的总线上）。
     * ★ 同 GainAudioProcessor：只接 16-bit PCM，别的编码不参与（`onConfigure` 回 NOT_SET ⇒ media3 跳过这一环，
     *   声音照常出、只是片尾不淡出）—— 宁可少一个效果，不要因为它整发合不出来。
     */
    private static final class TailFadeAudioProcessor extends BaseAudioProcessor {
        private final long fadeStartUs;
        private final long fadeUs;
        private long framesSeen;
        private int sampleRate = 44100;
        private int channels = 2;

        TailFadeAudioProcessor(long fadeStartUs, long fadeUs) {
            this.fadeStartUs = Math.max(0, fadeStartUs);
            this.fadeUs = Math.max(1, fadeUs);
        }

        @Override
        protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat in) {
            if (in.encoding != C.ENCODING_PCM_16BIT) return AudioProcessor.AudioFormat.NOT_SET;
            sampleRate = in.sampleRate;
            channels = Math.max(1, in.channelCount);
            return in;
        }

        @Override
        protected void onFlush(AudioProcessor.StreamMetadata streamMetadata) {
            // 冲洗之后从哪个位置接着算：media3 把流里的起点告诉我们（正常导出就是 0）
            framesSeen = Math.max(0, streamMetadata.positionOffsetUs) * sampleRate / 1_000_000L;
        }

        @Override
        public void queueInput(ByteBuffer in) {
            ByteBuffer out = replaceOutputBuffer(in.remaining());
            long fadeStartFrame = fadeStartUs * sampleRate / 1_000_000L;
            long fadeFrames = Math.max(1, fadeUs * sampleRate / 1_000_000L);
            while (in.remaining() >= 2 * channels) {
                float k = 1f;
                if (framesSeen >= fadeStartFrame) {
                    k = Math.max(0f, 1f - (framesSeen - fadeStartFrame) / (float) fadeFrames);
                }
                for (int ch = 0; ch < channels; ch++) out.putShort((short) Math.round(in.getShort() * k));
                framesSeen++;
            }
            in.position(in.limit());
            out.flip();
        }
    }

    /**
     * 烧进画面的字幕（与片头标题）。
     *
     * ★ **换行不在这里算**：每条字幕带着 Web 侧已经断好的行（data/cutProject 的 paginateCaption），这里逐行居中画。
     *   预览那一面（剪辑页的 DOM 叠层）画的是同一批行 —— 两边各断各的，预览里两行的字幕合出来可能是三行。
     *   万一某一行在这台机器的字体下比安全宽度还宽，就把这一行的字号缩到放得下（只缩不断）。
     * ★ **只在"现在该显示哪几条"变了的时候重画**：CanvasOverlay 每一帧都会来调 onDraw，而画布一被画过，
     *   media3 就会把整张位图重新传一次纹理（BitmapOverlay.getTextureId 按位图的 generationId 判）。
     *   一条字幕通常挂几秒，这几秒里一笔都不画，纹理也就不重传。
     * ★ 字号按画面**最短边**的比例给（与显式标识同一把尺）；位置用高度的比例（bottomRatio = 最后一行的基线离底边多远，
     *   titleTopRatio = 标题第一行的基线离顶边多远），一行最宽用宽度的比例（maxWidthRatio）。
     *   这几个数是 Web 侧量出来的政策（要让开首页底缘那一摞界面、右侧操作栏与右下角的标识，见 cutProject.captionLayout），
     *   原生只照着画。
     */
    private static final class CaptionOverlay extends CanvasOverlay {
        private final long[] startUs;
        private final long[] endUs;
        private final String[][] lines;
        private final boolean[] isTitle;
        private final int w;
        private final int h;
        private final float textPx;
        private final float bottomRatio;
        private final float maxLinePx;
        private final float titleScale;
        private final float titleTopRatio;
        private final android.graphics.Paint fill = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private final android.graphics.Paint stroke = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        /** 上一次画的是哪几条（按位记；-1 = 还没画过 / 画布换过，下一帧必须重画） */
        private long lastKey = -1;
        private android.graphics.Canvas lastCanvas;

        CaptionOverlay(JSONArray items, int w, int h, float sizeRatio, float bottomRatio, float maxWidthRatio,
                       float titleScale, float titleTopRatio) throws org.json.JSONException {
            super(false);
            this.w = w;
            this.h = h;
            // 给 6% 的宽裕：Web 侧断行是按字宽**估**的，差一点点不必缩字；差得多才缩
            this.maxLinePx = w * Math.max(0.2f, Math.min(0.96f, maxWidthRatio)) * 1.06f;
            this.titleScale = Math.max(1f, Math.min(3f, titleScale));
            this.titleTopRatio = Math.max(0.05f, Math.min(0.8f, titleTopRatio));
            // 一次最多认 60 条（一位一条）：我们的片子是个位数段、一段一句，60 条绰绰有余；
            // 这个数也是 lastKey 那个 long 能记下的位数
            int n = Math.min(60, items.length());
            startUs = new long[n];
            endUs = new long[n];
            lines = new String[n][];
            isTitle = new boolean[n];
            for (int i = 0; i < n; i++) {
                JSONObject o = items.getJSONObject(i);
                startUs[i] = Math.round(o.optDouble("startSec", 0) * 1_000_000d);
                endUs[i] = Math.round(o.optDouble("endSec", 0) * 1_000_000d);
                JSONArray ls = o.optJSONArray("lines");
                int ln = ls == null ? 0 : Math.min(4, ls.length());
                lines[i] = new String[ln];
                for (int j = 0; j < ln; j++) lines[i][j] = ls.optString(j, "");
                isTitle[i] = "title".equals(o.optString("kind", "caption"));
            }
            int minSide = Math.min(w, h);
            this.textPx = Math.max(14f, minSide * Math.max(0.02f, Math.min(0.12f, sizeRatio)));
            this.bottomRatio = Math.max(0.03f, Math.min(0.9f, bottomRatio));
            fill.setColor(Color.WHITE);
            fill.setTypeface(Typeface.DEFAULT_BOLD);
            fill.setTextAlign(android.graphics.Paint.Align.CENTER);
            stroke.setColor(Color.argb(230, 0, 0, 0));
            stroke.setTypeface(Typeface.DEFAULT_BOLD);
            stroke.setTextAlign(android.graphics.Paint.Align.CENTER);
            stroke.setStyle(android.graphics.Paint.Style.STROKE);
            stroke.setStrokeJoin(android.graphics.Paint.Join.ROUND);
            setCanvasSize(w, h);
        }

        @Override
        public void onDraw(android.graphics.Canvas canvas, long presentationTimeUs) {
            long key = 0;
            for (int i = 0; i < startUs.length; i++) {
                if (presentationTimeUs >= startUs[i] && presentationTimeUs < endUs[i]) key |= (1L << i);
            }
            if (key == lastKey && canvas == lastCanvas) return;
            lastKey = key;
            lastCanvas = canvas;
            canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR);
            for (int i = 0; i < startUs.length; i++) {
                if ((key & (1L << i)) == 0) continue;
                // 标题比字幕大、从上方的安全线往下排；字幕贴着下方的安全线往上叠
                float size = isTitle[i] ? textPx * titleScale : textPx;
                float lineH = size * 1.3f;
                String[] ls = lines[i];
                float lastBaseline = isTitle[i]
                        ? h * titleTopRatio + (ls.length - 1) * lineH
                        : h * (1f - bottomRatio);
                for (int j = 0; j < ls.length; j++) {
                    String s = ls[j];
                    if (s == null || s.isEmpty()) continue;
                    float px = size;
                    fill.setTextSize(px);
                    float width = fill.measureText(s);
                    float maxW = maxLinePx;
                    if (width > maxW && width > 0) px = px * maxW / width;
                    fill.setTextSize(px);
                    stroke.setTextSize(px);
                    stroke.setStrokeWidth(Math.max(2f, px * 0.16f));
                    float y = lastBaseline - (ls.length - 1 - j) * lineH;
                    canvas.drawText(s, w / 2f, y, stroke);
                    canvas.drawText(s, w / 2f, y, fill);
                }
            }
        }

        @Override
        public void release() throws androidx.media3.common.VideoFrameProcessingException {
            super.release();
            // 每一段的效果链各用各放（这份叠加物是所有段共用的）：下一段接手时必须重画一次
            lastKey = -1;
            lastCanvas = null;
        }
    }

    /** 扫掉 cache 子目录里过了 `keepMs` 的文件。失败只记一笔 —— 清理不成不该挡住合并 */
    private void sweepCache(String name, long keepMs) {
        try {
            File dir = new File(getContext().getCacheDir(), name);
            File[] fs = dir.listFiles();
            if (fs == null) return;
            long cut = System.currentTimeMillis() - keepMs;
            int n = 0;
            for (File f : fs) {
                if (f.isFile() && f.lastModified() < cut && f.delete()) n++;
            }
            if (n > 0) Log.i(TAG, "清掉 " + name + " 里 " + n + " 个旧文件");
        } catch (Throwable t) {
            Log.w(TAG, "清 " + name + " 时出错（不影响合并）：" + brief(t));
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
