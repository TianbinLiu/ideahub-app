package com.ideahub.branchvideo;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.modelmsg.SendAuth;
import com.tencent.mm.opensdk.modelmsg.SendMessageToWX;
import com.tencent.mm.opensdk.modelmsg.WXMediaMessage;
import com.tencent.mm.opensdk.modelmsg.WXWebpageObject;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 微信登录 + 微信好友分享（开放平台 OpenSDK）。
 *
 * 与 QQLoginPlugin 同一套架构判断（移动应用没有回调地址栏，网页 OAuth 走不通，
 * 只能原生 SDK 拿一次性 code 交服务端换身份），差异在**回执的路**：
 *   QQ  —— 回到 MainActivity.onActivityResult，转发给插件；
 *   微信 —— 回到**固定路径**的 wxapi/WXEntryActivity（<包名>.wxapi.WXEntryActivity，
 *          包名派生、一个字母都不能错，错了微信静默回不来，没有任何报错）。
 *          那个 Activity 只做一件事：把 resp 转给本类的静态 handleResp，然后立刻 finish。
 *
 * ★★ 登录与分享对"回执"的性情完全不同，处理方式刻意不同：
 *   · 登录（SendAuth）**一定**有回执（同意/取消/拒绝都有）→ pending 单槽等它。
 *   · 分享（SendMessageToWX）在新版微信上**取消不回执**（官方行为变更：用户在微信里
 *     按返回，什么都不会发回来）→ 绝不能挂 pending 等，否则这一槽永远占着，
 *     后面所有登录都被"上一次操作还没结束"挡死。所以分享是**发出即成功**：
 *     sendReq 返回 true 就 resolve，迟到的回执一律当噪音丢弃。
 *
 * ★ 分享卡片的缩略图必须是**字节**（thumbData ≤ 32KB），微信不帮你拉 URL —— 与 QQ
 *   收 imageUrl 的口味相反。所以这里在 IO 线程下载封面、缩到 200px、JPEG 质量往下压
 *   直到 ≤ 32KB；拉不到就不带图（分享照发，别为一张缩略图把整个动作弄失败）。
 */
@CapacitorPlugin(name = "WeChat")
public class WeChatPlugin extends Plugin {

    private static WeChatPlugin instance;

    private IWXAPI api;
    /** 只给登录用的 pending 单槽（分享发出即成功，不占槽——理由见类注释） */
    private PluginCall pendingLogin;
    /** 本次登录请求的防伪标记：回执的 state 对不上就不是我们这一单 */
    private String loginState = "";

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        instance = this;
    }

    private IWXAPI ensureApi() {
        if (api == null) {
            api = WXAPIFactory.createWXAPI(getContext().getApplicationContext(), BuildConfig.WX_APP_ID, true);
            api.registerApp(BuildConfig.WX_APP_ID);
        }
        return api;
    }

    /** WXEntryActivity 也要建 IWXAPI 来 handleIntent，从这里拿同一份配置 */
    public static IWXAPI apiFor(android.content.Context ctx) {
        IWXAPI a = WXAPIFactory.createWXAPI(ctx.getApplicationContext(), BuildConfig.WX_APP_ID, true);
        a.registerApp(BuildConfig.WX_APP_ID);
        return a;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("wechatInstalled", ensureApi().isWXAppInstalled());
        call.resolve(ret);
    }

    /** 起授权。成功 resolve {code}，其余（取消/拒绝/未装微信）一律 reject（铁律八）。 */
    @PluginMethod
    public void login(PluginCall call) {
        if (pendingLogin != null) {
            call.reject("上一次微信登录还没结束");
            return;
        }
        IWXAPI wx = ensureApi();
        if (!wx.isWXAppInstalled()) {
            call.reject("这台手机上没有安装微信");
            return;
        }

        // state 是防 CSRF 的一次性标记；回执带回来对不上就不认
        byte[] rnd = new byte[12];
        new SecureRandom().nextBytes(rnd);
        StringBuilder sb = new StringBuilder("qimeng_");
        for (byte b : rnd) sb.append(String.format("%02x", b));
        loginState = sb.toString();

        SendAuth.Req req = new SendAuth.Req();
        // 只要昵称头像这一档。snsapi_base 拿不到 userinfo，别省这一级
        req.scope = "snsapi_userinfo";
        req.state = loginState;

        pendingLogin = call;
        if (!wx.sendReq(req)) {
            pendingLogin = null;
            call.reject("微信授权页没能打开（请稍后重试）");
        }
    }

    /**
     * 分享网页卡片到微信好友会话。**发出即成功**（理由见类注释）；
     * thumb 在 IO 线程下载压缩，拉不到就无图发。
     */
    @PluginMethod
    public void share(PluginCall call) {
        IWXAPI wx = ensureApi();
        if (!wx.isWXAppInstalled()) {
            call.reject("这台手机上没有安装微信");
            return;
        }
        String title = call.getString("title", "");
        String targetUrl = call.getString("targetUrl", "");
        if (title == null || title.isEmpty() || targetUrl == null || targetUrl.isEmpty()) {
            call.reject("缺少标题或链接");
            return;
        }
        String summary = call.getString("summary", "");
        String imageUrl = call.getString("imageUrl", "");

        io.execute(() -> {
            byte[] thumb = imageUrl == null || imageUrl.isEmpty() ? null : fetchThumb(imageUrl);

            WXWebpageObject page = new WXWebpageObject();
            page.webpageUrl = targetUrl;
            WXMediaMessage msg = new WXMediaMessage(page);
            msg.title = title;
            msg.description = summary == null ? "" : summary;
            if (thumb != null) msg.thumbData = thumb;

            SendMessageToWX.Req req = new SendMessageToWX.Req();
            req.transaction = "share" + System.currentTimeMillis();
            req.message = msg;
            req.scene = SendMessageToWX.Req.WXSceneSession;

            if (wx.sendReq(req)) {
                call.resolve(new JSObject());
            } else {
                call.reject("没能拉起微信分享");
            }
        });
    }

    /**
     * 封面 → 缩略图字节。缩到 200px 短边后从 85 质量往下压，直到 ≤ 32KB。
     * 任何一步失败都返回 null（无图分享），不抛 —— 缩略图是装饰，不是分享的前提。
     */
    private byte[] fetchThumb(String url) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            byte[] raw;
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                // 封面最多读 5MB，再大不像封面像事故
                while ((n = in.read(buf)) > 0 && bo.size() < 5 * 1024 * 1024) bo.write(buf, 0, n);
                raw = bo.toByteArray();
            }
            Bitmap src = BitmapFactory.decodeByteArray(raw, 0, raw.length);
            if (src == null) return null;
            int w = src.getWidth(), h = src.getHeight();
            float scale = 200f / Math.min(w, h);
            if (scale < 1f) {
                src = Bitmap.createScaledBitmap(src, Math.round(w * scale), Math.round(h * scale), true);
            }
            for (int q = 85; q >= 30; q -= 15) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                src.compress(Bitmap.CompressFormat.JPEG, q, out);
                if (out.size() <= 32 * 1024) return out.toByteArray();
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /** WXEntryActivity 收到回执后转进来。只认登录回执；分享的迟到回执一律丢弃。 */
    public static void handleResp(BaseResp resp) {
        WeChatPlugin self = instance;
        if (self == null) return;
        if (!(resp instanceof SendAuth.Resp)) return; // 分享回执：发出即成功，不在这儿收

        PluginCall call = self.pendingLogin;
        self.pendingLogin = null;
        if (call == null) return;

        SendAuth.Resp auth = (SendAuth.Resp) resp;
        if (auth.errCode == BaseResp.ErrCode.ERR_OK) {
            if (self.loginState.isEmpty() || !self.loginState.equals(auth.state)) {
                call.reject("微信回执与本次请求不匹配，请重试");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("code", auth.code == null ? "" : auth.code);
            call.resolve(ret);
        } else if (auth.errCode == BaseResp.ErrCode.ERR_USER_CANCEL) {
            call.reject("已取消微信登录");
        } else if (auth.errCode == BaseResp.ErrCode.ERR_AUTH_DENIED) {
            call.reject("微信拒绝了授权请求");
        } else {
            call.reject("微信授权失败（" + auth.errCode + "）");
        }
    }
}
