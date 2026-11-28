#!/usr/bin/env python3
"""穿行尽头那张背景贴图（夜＝月 / 昼＝云海）—— 2026-11-27 `feat/gs-tunnel-depth`。

素材：`~/Downloads/window-edit/out-2.png` / `out-3.png`（1536²，窗洞圆心 (768,768)、半径 339）。
只取**窗洞里那幅画**（月亮 + 夜空 / 海天 + 云），做三件事：

1) **补掉画上去的十字窗棂 + 中心圆钉**（out-N 是把 AI 图按窗洞蒙版贴回原图合成的，notes.md §3 记过
   "棂/圆钉带内保留原图像素"）—— 否则穿行尽头会挂着一扇窗。
2) **按 CONTENT 缩到画面中央、圆外用"边环颜色的角向延长"补满**：四边形贴图的四角也是同一片天，
   不会出现"一张画浮在黑底上"的硬边。贴图是 **2:1 宽幅**（2048×1024）：穿行只发生在横屏大厅
   （竖屏两边都不挂），宽幅才铺得满 1.7~2.2 的屏幕而不把月亮拉成椭圆。
3) **烤进 alpha 与雾**：R>VIGNETTE 起 alpha 渐隐、颜色向 FOG 混，到贴图边缘已经与"远处的暗"接上 ——
   这一层就是任务书要的"轻微雾把接缝藏住"。运行时 shader 只再加一点辉光（`flyBackdrop.ts`）。

输出：`public/models/study/tex/fly-backdrop-{night,day}.webp`（2048×1024 RGBA，≤500 KB/张）。

用法：
  python design/gen-fly-backdrop.py
  python design/gen-fly-backdrop.py --src-dir "C:/Users/tliu7/Downloads/window-edit" --out public/models/study/tex
"""
import argparse
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 窗洞在 1536² 源图上的几何（design/gs-window-shot 量出来的那份：圆心 768,768、半径 678/2=339）。
SRC_SIZE = 1536
SRC_CX = SRC_CY = SRC_SIZE / 2
# 只取"画面"本体：实测 out-2/out-3 的金属内圈从 r≈330~338 开始（沿 45° 采样，r=340 已是 (77,82,86) 的框），
# 取 315 保证整张裁图都在窗外画面里 —— 339 会把那圈金属框带进贴图，在背景里读成"一圈亮边"。
SRC_R = 315.0
# 十字窗棂 / 交点圆钉是 MoonWindow.tsx 的几何，但 out-N 把它们印在了画上（见文件头）。半宽 9 px、圆钉 26 px。
CROSS_HALF = 9
PIN_R = 26

# 输出 2:1 宽幅（横屏大厅）。CONTENT = 窗洞内容圆的半径占**半高**的多少。
# 夜：0.62 ⇒ 月盘半径 = 0.62×0.905 = 0.56 半高 = 14.0°（fov 50、竖直）⇒ 月盘直径占屏高 56%。
# 昼：0.98 ⇒ 海天/云铺满整幅（不留可见的内容圆边）；代价是镜头拉近时只剩贴图中央那条地平线，
#   读作"低空的海天/雾" —— 这一档的观感偏软，已知风险见 docs/gs-tunnel-log.md §5。
#   （试过 0.62：整幅窗画缩在中央，四周补出来的蓝和画之间会有一圈可见的圆边 —— 接缝藏不住，弃。）
CONTENT = {"night": 0.62, "day": 0.98}
# 雾/渐隐半径（以内容圆半径为 1）：R>=VIGNETTE 起向 FOG 混色并掉 alpha，到 1 完全透明。
VIGNETTE = {"night": 0.78, "day": 0.92}
# 雾色（sRGB 0..1）：夜=深蓝黑，昼=低空冷白（海天线那层雾）
FOG = {"night": (0.012, 0.018, 0.035), "day": (0.56, 0.70, 0.80)}
# 圆外的压暗（夜）/ 提亮（昼）
RIM_GAIN = {"night": 0.55, "day": 1.06}
OUT_W, OUT_H = 2048, 1024
SEED = 20261127


def inpaint_cross(img: Image.Image) -> Image.Image:
    """把画上去的十字窗棂 + 中心圆钉补掉（线性插值跨过窄带，再只在带内轻糊一次）。

    out-N 的窗棂是原图像素（notes.md §3 "十字雨带内改动像素 2528/20184"），宽度约 12~14 px@1536²；
    圆钉是中心 26 px 半径的金属件。窗外画面在这几处都是低频的月面/云，跨带插值看不出来。
    """
    a = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w = a.shape[:2]
    cx = int(round(SRC_CX))
    cy = int(round(SRC_CY))
    ys, xs = np.mgrid[0:h, 0:w]
    W = CROSS_HALF
    vb = np.abs(xs - cx) <= W
    hb = np.abs(ys - cy) <= W
    pin = ((xs - cx) ** 2 + (ys - cy) ** 2) <= PIN_R * PIN_R
    out = a.copy()
    # 竖直带：同一行上左右两侧（带外 3 px）线性插值
    lx, rx = cx - W - 3, cx + W + 3
    t = np.clip((np.arange(w) - (cx - W)) / (2.0 * W), 0, 1)[None, :, None]
    vfill = a[:, lx][:, None, :] * (1 - t) + a[:, rx][:, None, :] * t
    out[vb] = np.broadcast_to(vfill, a.shape)[vb]
    # 水平带：同一列上下两侧
    ty, by = cy - W - 3, cy + W + 3
    s = np.clip((np.arange(h) - (cy - W)) / (2.0 * W), 0, 1)[:, None, None]
    hfill = a[ty][None, :, :] * (1 - s) + a[by][None, :, :] * s
    out[hb] = hfill[hb]
    # 圆钉：26 px 半径的黑盘，靠"角向环平均"补（四周月面是低频的；直接模糊只会得到一团黑）
    ang = np.arctan2(ys - cy, xs - cx)
    ring = ((xs - cx) ** 2 + (ys - cy) ** 2 >= (PIN_R + 6) ** 2) & (
        (xs - cx) ** 2 + (ys - cy) ** 2 <= (PIN_R + 18) ** 2
    )
    n_ang = 256
    idx = ((ang[ring] + np.pi) / (2 * np.pi) * n_ang).astype(int) % n_ang
    acc = np.zeros((n_ang, 3))
    cnt = np.zeros(n_ang)
    np.add.at(acc, idx, out[ring])
    np.add.at(cnt, idx, 1)
    prof = acc / np.maximum(cnt, 1)[:, None]
    k = np.hanning(17)
    k /= k.sum()
    pad = np.concatenate([prof[-8:], prof, prof[:8]], axis=0)
    prof = np.stack([np.convolve(pad[:, c], k, mode="same") for c in range(3)], axis=1)[8:8 + n_ang]
    pin_idx = ((ang[pin] + np.pi) / (2 * np.pi) * n_ang).astype(int) % n_ang
    out[pin] = prof[pin_idx]
    # 带内再糊 1.2 px，消掉插值留下的折线
    soft = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float64)
    mask = vb | hb | pin
    out[mask] = soft[mask]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def crop_circle(img: Image.Image, r: float = SRC_R) -> Image.Image:
    """把窗洞内容裁成 (2r)² 的方图（四角是窗框内缘之外的像素，后面只取圆内）。"""
    x0 = int(round(SRC_CX - r))
    y0 = int(round(SRC_CY - r))
    d = int(round(2 * r))
    return img.crop((x0, y0, x0 + d, y0 + d))


def angular_profile(rgba: np.ndarray, n: int = 2048, blur_k: int = 85) -> np.ndarray:
    """圆边一圈（r=0.955~1）按角度平均 + 角向模糊 —— 圆外那一圈就按它延长。
    `blur_k` 越大，延长区越平滑、但接缝越明显（边缘的亮纱帘 vs 平均色的差）；夜 85、昼 25。"""
    h, w = rgba.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    cx = cy = (w - 1) / 2
    dx = (xx - cx) / (w / 2)
    dy = (yy - cy) / (h / 2)
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    band = (r > 0.955) & (r <= 1.0)
    idx = ((ang[band] + np.pi) / (2 * np.pi) * n).astype(int) % n
    acc = np.zeros((n, 3))
    cnt = np.zeros(n)
    np.add.at(acc, idx, rgba[band][:, :3])
    np.add.at(cnt, idx, 1)
    cnt = np.maximum(cnt, 1)
    prof = acc / cnt[:, None]
    half = blur_k // 2
    k = np.hanning(blur_k)
    k = k / k.sum()
    pad = np.concatenate([prof[-half:], prof, prof[:half]], axis=0)
    blurred = np.stack([np.convolve(pad[:, c], k, mode="same") for c in range(3)], axis=1)[half:half + n]
    return blurred


def build(src: Image.Image, skin: str) -> Image.Image:
    content = CONTENT[skin]
    # 0) 先补掉画上去的十字棂/圆钉，再裁圆
    src = inpaint_cross(src)
    # 1) 圆心内容：圆的直径 = content × 贴图**高度**，居中
    crop = crop_circle(src)
    side = int(round(content * OUT_H))
    crop = crop.resize((side, side), Image.LANCZOS)
    canvas = Image.new("RGB", (OUT_W, OUT_H), (0, 0, 0))
    canvas.paste(crop, ((OUT_W - side) // 2, (OUT_H - side) // 2))
    # 2) 圆外：角向 profile 延长（用 crop 自己的边环算，与贴进来的那张同源）
    arr = np.asarray(crop.convert("RGB")).astype(np.float64) / 255.0
    prof = angular_profile(arr, blur_k=85 if skin == "night" else 25)
    yy, xx = np.mgrid[0:OUT_H, 0:OUT_W]
    # 归一化：以**半高**为 1（宽幅贴图的 x 会到 ±2）
    X = (xx - (OUT_W - 1) / 2) / (OUT_H / 2)
    Y = (yy - (OUT_H - 1) / 2) / (OUT_H / 2)
    R = np.hypot(X, Y) / content  # 以"内容圆的半径"为 1
    ang = np.arctan2(Y, X)
    pi = ((ang + np.pi) / (2 * np.pi) * prof.shape[0]).astype(int) % prof.shape[0]
    ext = prof[pi]  # HxWx3
    base = np.asarray(canvas.convert("RGB")).astype(np.float64) / 255.0
    outside = R > 1.0
    t = np.clip((R - 1.0) / 1.6, 0.0, 1.0)[..., None]
    if skin == "night":
        ext = ext * (1.0 - 0.55 * t)
        # 补星：圆外（内容之外）稀疏星点，让"延长出去的天"不是一块糊色
        rng = np.random.default_rng(SEED)
        stars = np.zeros((OUT_H, OUT_W))
        n_star = 1500
        xsn = rng.integers(0, OUT_W, n_star)
        ysn = rng.integers(0, OUT_H, n_star)
        lum = rng.uniform(0.25, 0.85, n_star)
        inner = np.hypot((xsn - OUT_W / 2) / (OUT_H / 2), (ysn - OUT_H / 2) / (OUT_H / 2)) / content > 1.02
        for x, y, l in zip(xsn[inner], ysn[inner], lum[inner]):
            stars[y, x] = max(stars[y, x], l)
            if x + 1 < OUT_W:
                stars[y, x + 1] = max(stars[y, x + 1], l * 0.6)
            if y + 1 < OUT_H:
                stars[y + 1, x] = max(stars[y + 1, x], l * 0.6)
        stars = np.asarray(Image.fromarray((stars * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float64) / 255.0
        ext = ext + stars[..., None] * np.array([0.75, 0.85, 1.0]) * 0.9
    else:
        # 昼：圆外不是"一块雾"——用角向 profile 与"上天下海"的竖直渐变混一半，
        # 再叠一层低频云纹（截图上才读得成"窗外还是天和海"，而不是贴纸外面一圈灰）。
        sky = np.array([0.56, 0.72, 0.86])
        sea = np.array([0.30, 0.66, 0.68])
        vg = (0.5 + 0.5 * np.clip(Y, -1.2, 1.2))[..., None]
        grad = sea * (1 - vg) + sky * vg
        ext = ext * 0.42 + grad * 0.58
        ext = ext * RIM_GAIN[skin]
        rng = np.random.default_rng(SEED)
        noise = rng.normal(0, 1, (OUT_H // 8, OUT_W // 8))
        noise = np.asarray(
            Image.fromarray(((noise - noise.min()) / (noise.max() - noise.min()) * 255).astype(np.uint8)).resize((OUT_W, OUT_H), Image.BICUBIC)
        ).astype(np.float64) / 255.0
        ext = ext * (0.94 + 0.10 * noise[..., None])
    out = np.where(outside[..., None], np.clip(ext, 0, 2.0), base)
    # 3) 雾 + 渐变 alpha（贴图边缘不再有边）
    fog = np.array(FOG[skin])
    fogK = np.clip((R - VIGNETTE[skin]) / max(1e-3, 1.0 - VIGNETTE[skin]), 0, 1)
    out = out * (1.0 - fogK[..., None]) + fog * fogK[..., None]
    alpha = 1.0 - np.clip((R - VIGNETTE[skin]) / max(1e-3, 1.0 - VIGNETTE[skin]), 0, 1) ** 1.6
    # 内容圆的边（R≈1）做 6 px 软边，藏住"贴上去的方图四角"
    alpha = alpha * np.clip((1.0 - R) / 0.03, 0, 1) ** 0.35
    rgba = np.concatenate([np.clip(out, 0, 1), alpha[..., None]], axis=2)
    return Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-dir", default=os.path.join(os.path.expanduser("~"), "Downloads", "window-edit"))
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "models", "study", "tex"))
    args = ap.parse_args()
    for skin, name in (("night", "out-2.png"), ("day", "out-3.png")):
        src = Image.open(os.path.join(args.src_dir, name)).convert("RGB")
        assert src.size == (SRC_SIZE, SRC_SIZE), f"{name} 不是 1536²：{src.size}"
        img = build(src, skin)
        dst = os.path.join(args.out, f"fly-backdrop-{skin}.webp")
        img.save(dst, "WEBP", quality=84, method=6)
        kb = os.path.getsize(dst) / 1024
        print(f"[backdrop] {name} -> {os.path.relpath(dst, ROOT)}  {img.size[0]}x{img.size[1]}  {kb:.0f} KB")
        assert kb <= 500, f"{dst} 超过 500 KB"
        prev = img.convert("RGB").resize((1024, 512), Image.LANCZOS)
        prev.save(os.path.join(ROOT, ".tmp-gs-depth", f"backdrop-{skin}-preview.png"))


if __name__ == "__main__":
    main()
