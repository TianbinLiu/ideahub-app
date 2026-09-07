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
import android.os.Looper;

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
import java.util.List;

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
                double headSec = badge.optDouble("headSec", 3);
                long untilUs = "head".equals(mode) ? Math.round(headSec * 1_000_000d) : -1;
                videoEffects.add(new OverlayEffect(ImmutableList.of(new BadgeOverlay(text, untilUs, h))));
            }
        }

        Effects effects = new Effects(ImmutableList.of(), ImmutableList.copyOf(videoEffects));
        // 逐段套同一组效果：Presentation 必须每段都有，否则尺寸不一致会被整发拒
        List<EditedMediaItem> withEffects = new ArrayList<>();
        for (EditedMediaItem it : items) {
            withEffects.add(it.buildUpon().setEffects(effects).build());
        }

        EditedMediaItemSequence videoSeq = new EditedMediaItemSequence.Builder(withEffects).build();
        List<EditedMediaItemSequence> sequences = new ArrayList<>();
        sequences.add(videoSeq);

        JSObject audio = call.getObject("audio");
        if (audio != null) {
            String aUrl = audio.getString("url", "");
            if (aUrl != null && !aUrl.isEmpty()) {
                float vol = (float) audio.optDouble("volume", 1.0);
                ChannelMixingAudioProcessor mixer = new ChannelMixingAudioProcessor();
                mixer.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(1, 1).scaleBy(vol));
                mixer.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(2, 2).scaleBy(vol));
                EditedMediaItem bgm = new EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(aUrl)))
                        .setEffects(new Effects(ImmutableList.<AudioProcessor>of(mixer), ImmutableList.of()))
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
                        cc.reject("合并失败：" + brief(e), "EXPORT_FAILED");
                    }
                }).build();
                running = t;
                t.start(composition, out.getAbsolutePath());
                pollProgress(t);
            } catch (Exception e) {
                running = null;
                PluginCall cc = runningCall;
                runningCall = null;
                if (cc != null) cc.reject("合并起不来：" + brief(e), "START_FAILED");
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

    private static int even(int v) {
        int x = Math.max(16, v);
        return x % 2 == 0 ? x : x + 1;
    }

    private static String brief(Throwable e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        return m.length() > 120 ? m.substring(0, 120) : m;
    }

    /**
     * 显式标识角标。
     * ★ 「只在开头露一段」不是靠调透明度，而是**过了时间就返回空文本** —— 空文本什么都不画，
     *   比动 OverlaySettings 的 alpha 少一层依赖，行为也更好预测。
     */
    private static final class BadgeOverlay extends TextOverlay {
        private final SpannableString shown;
        private final SpannableString empty = new SpannableString("");
        private final long untilUs; // <0 = 全程
        private final StaticOverlaySettings settings;

        BadgeOverlay(String text, long untilUs, int frameHeight) {
            this.untilUs = untilUs;
            SpannableString s = new SpannableString(text);
            int end = s.length();
            s.setSpan(new ForegroundColorSpan(Color.WHITE), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            s.setSpan(new BackgroundColorSpan(Color.argb(110, 0, 0, 0)), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            s.setSpan(new StyleSpan(Typeface.BOLD), 0, end, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            // 字号跟着画幅走：写死像素的话竖屏 1080 与横屏 720 上一个太小一个太大
            s.setSpan(new AbsoluteSizeSpan(Math.max(18, Math.round(frameHeight * 0.030f))), 0, end,
                    Spanned.SPAN_INCLUSIVE_INCLUSIVE);
            this.shown = s;
            // 贴右下角：overlay 的右下角对齐画面的右下角，再往内缩一点
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
