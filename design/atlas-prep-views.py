#!/usr/bin/env python3
# Atlas 多视角重建前的「曝光 + 白平衡归一」：12 张 AI 伪多视角 → 11 张（剔除 view-11）。
#
# 为什么需要这一步（数值来自 ~/Downloads/workshop-views12/notes.md）：
#   · 12 张是 Seedream 逐张重绘的同一间房，帧间整体亮度实测 27.8~45.3（约 0.7 档），
#     白平衡也逐张略有漂移；Atlas 的 images2PosedRGBD 假设"stable lighting"，先归一
#     能少喂一点不一致给位姿估计和 splats 的 refinement。
#   · view-11 是 18mm 全景（唯一一张换镜头的），桶形/拉伸最考验位姿估计，也是 notes.md
#     列的第一风险项 —— 本轮直接不用它，剩 11 张全部 24mm。
#
# 做法（不重采样、不裁切、不改构图）：
#   1. 在 sRGB 8-bit 域里做通道缩放（等同于图像编辑器里的 Levels / 曝光+色阶）：
#      每个通道一条 256 项 LUT，out = clamp(round(v * gain_c))。
#   2. 白平衡：gain_c = median_12(通道 c 的整图均值) / 本张通道 c 的整图均值。
#      即把 12 张的通道均值都拉到同一个"中性"目标（gray-world），gain 夹在 [0.75, 1.33]，
#      夹到的写在报告里 —— 夹只是为了不被个别极端帧带跑，正常不会碰到。
#   3. 曝光：在 WB 之后解一个标量 k，使整图平均亮度（Rec.709 luma 的逐像素均值，
#      与 notes.md 里 27.8~45.3 同一口径）等于 12 张的中位数。求解用**直方图**做，
#      不反复重采样图片：mean = Σ hist[v] * LUT(v) / N，二分 60 次，误差 < 0.01 灰阶，
#      保证归一后每张与目标差 < 0.1%（要求 ±2%）。
#   4. 只输出 11 张（view-11 不输出），1280×720 JPEG quality=92 / 4:2:0 / progressive，
#      与 workshop-views12-convert.py 生成 atlas/ 那一档完全同参数（不二次缩放，
#      源图本来就是 1280×720，避免重采样引入的软边）。
#
# 用法（仓库根目录 app/）：
#   python design/atlas-prep-views.py                    默认读 ~/Downloads/workshop-views12/atlas
#   python design/atlas-prep-views.py --dry              只量不写（打印 12 张的均值与目标）
#   python design/atlas-prep-views.py --target=median11  目标改成 11 张的中位数（默认 median12）
#   python design/atlas-prep-views.py --src=... --out=... 改输入/输出目录
#
# 产物：
#   <out>/view-XX.jpg            11 张归一后的 Atlas 输入
#   <out>/normalize-report.json  每张前后的均值/增益、汇总（±2% 校验结果）
import argparse
import json
import statistics
import sys
from pathlib import Path

from PIL import Image

ATLAS_SIZE = (1280, 720)
LUMA = (0.2126, 0.7152, 0.0722)  # Rec.709（sRGB 原色），与 notes.md 的平均亮度同口径


def load_views(src: Path) -> list[tuple[int, Path, Image.Image]]:
    files = sorted(src.glob("view-*.jpg"))
    if not files:
        raise SystemExit(f"no view-*.jpg under {src}")
    views = []
    for p in files:
        try:
            n = int(p.stem.split("-")[1])
        except (IndexError, ValueError):
            continue
        im = Image.open(p).convert("RGB")
        if im.size != ATLAS_SIZE:
            # 不偷偷改尺寸：这一步的契约是"不改构图"，尺寸不对说明上游档位错了。
            print(f"WARN {p.name}: {im.size} != {ATLAS_SIZE[0]}x{ATLAS_SIZE[1]}", file=sys.stderr)
        views.append((n, p, im))
    return views


def channel_means_and_luma(im: Image.Image) -> tuple[list[float], float, int]:
    # ImageStat 的 mean 是每个通道的整图算术平均；luma 是通道均值的加权和
    # （逐像素加权平均 == 通道均值加权，线性运算可交换，省一遍全图遍历）。
    h = im.histogram()  # RGB 拼成 768 项
    n = im.width * im.height
    means = [sum(i * h[c * 256 + i] for i in range(256)) / n for c in range(3)]
    luma = sum(w * m for w, m in zip(LUMA, means))
    return means, luma, n


def lut_for_gain(gain: float) -> list[int]:
    return [min(255, max(0, int(round(v * gain)))) for v in range(256)]


def mean_after_lut(hist: list[int], lut: list[int], n: int) -> float:
    return sum(hist[v] * lut[v] for v in range(256)) / n


def solve_exposure(hists: list[list[int]], wb: list[float], n: int, target_luma: float) -> float:
    """在 WB 增益之上解一个标量曝光 k，使 luma 均值 = target（直方图求值 + 二分）。"""
    def luma_at(k: float) -> float:
        total = 0.0
        for c in range(3):
            lut = lut_for_gain(wb[c] * k)
            hist_c = hists[c * 256:(c + 1) * 256]
            total += LUMA[c] * mean_after_lut(hist_c, lut, n)
        return total

    lo, hi = 0.05, 8.0
    # 极端情况下（整张接近纯白/纯黑）目标可能够不到；这两个哨兵值只用于报告。
    if luma_at(lo) > target_luma:
        return lo
    if luma_at(hi) < target_luma:
        return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if luma_at(mid) < target_luma:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def main() -> None:
    here = Path(__file__).resolve().parent
    default_src = Path.home() / "Downloads" / "workshop-views12" / "atlas"
    ap = argparse.ArgumentParser(description="Atlas 输入图的曝光/白平衡归一（12→11，剔除 view-11）")
    ap.add_argument("--src", type=Path, default=default_src)
    ap.add_argument("--out", type=Path, default=None, help="默认 <src>/../norm")
    ap.add_argument("--exclude", type=int, nargs="*", default=[11], help="不输出的视角（默认 11）")
    ap.add_argument("--target", choices=["median12", "median11"], default="median12",
                    help="亮度目标取 12 张还是 11 张（被剔除那张）的中位数；默认 12")
    ap.add_argument("--dry", action="store_true", help="只测量并打印，不写文件")
    args = ap.parse_args()

    src: Path = args.src
    out: Path = args.out or (src.resolve().parent / "norm")
    views = load_views(src)
    if len(views) != 12:
        print(f"WARN: expected 12 views, got {len(views)}", file=sys.stderr)

    stats = []
    for n, p, im in views:
        means, luma, npix = channel_means_and_luma(im)
        stats.append({"n": n, "path": str(p), "size": list(im.size), "means": means,
                      "luma": luma, "hists": im.histogram(), "npix": npix, "im": im})

    kept = [s for s in stats if s["n"] not in args.exclude]
    dropped = [s for s in stats if s["n"] in args.exclude]
    if not kept:
        raise SystemExit("every view excluded")

    pool = stats if args.target == "median12" else kept
    target = statistics.median(s["luma"] for s in pool)
    # WB 目标：目标池里每张的三个通道均值分别取中位数，合成一个"中性"目标色。
    wb_target = [statistics.median(s["means"][c] for s in pool) for c in range(3)]

    print(f"target luma ({args.target}) = {target:.3f}  (0..255)")
    print(f"wb target (median channel means) = R {wb_target[0]:.2f}  G {wb_target[1]:.2f}  B {wb_target[2]:.2f}")
    print(f"{'view':>5} {'before':>8} {'after':>8} {'d%':>7}  {'gR':>6} {'gG':>6} {'gB':>6}  {'note'}")
    print("-" * 78)

    results = []
    for s in kept:
        wb = []
        clamped = False
        for c in range(3):
            g = wb_target[c] / max(s["means"][c], 1e-6)
            g_clamped = min(1.33, max(0.75, g))
            if abs(g_clamped - g) > 1e-9:
                clamped = True
            wb.append(g_clamped)
        k = solve_exposure(s["hists"], wb, s["npix"], target)
        luts = [lut_for_gain(wb[c] * k) for c in range(3)]
        after_means = [mean_after_lut(s["hists"][c * 256:(c + 1) * 256], luts[c], s["npix"])
                       for c in range(3)]
        after_luma = sum(w * m for w, m in zip(LUMA, after_means))
        dev = (after_luma - target) / target * 100 if target else 0.0
        tag = "clamped" if clamped else ""
        print(f"{s['n']:>5} {s['luma']:>8.2f} {after_luma:>8.2f} {dev:>+6.2f}%  "
              f"{wb[0]:>6.3f} {wb[1]:>6.3f} {wb[2]:>6.3f}  {tag}")
        results.append({
            "view": s["n"], "src": s["path"], "before_luma": round(s["luma"], 3),
            "after_luma": round(after_luma, 3), "deviation_pct": round(dev, 3),
            "wb_gain": [round(g, 4) for g in wb], "exposure_k": round(k, 4),
            "total_gain": [round(wb[c] * k, 4) for c in range(3)],
            "before_channel_means": [round(m, 3) for m in s["means"]],
            "after_channel_means": [round(m, 3) for m in after_means],
            "wb_clamped": clamped,
            "out": str(out / f"view-{s['n']:02d}.jpg"),
            "luts": luts,
        })

    before = [s["luma"] for s in kept]
    after = [r["after_luma"] for r in results]
    worst = max(abs(r["deviation_pct"]) for r in results)
    summary = {
        "src": str(src), "out": str(out), "target": args.target,
        "target_luma": round(target, 3),
        "median_before_12": round(statistics.median(s["luma"] for s in stats), 3),
        "median_before_11": round(statistics.median(before), 3),
        "kept": [s["n"] for s in kept],
        "excluded": [s["n"] for s in dropped],
        "before_min": round(min(before), 3), "before_max": round(max(before), 3),
        "before_median": round(statistics.median(before), 3),
        "after_min": round(min(after), 3), "after_max": round(max(after), 3),
        "after_median": round(statistics.median(after), 3),
        "max_abs_deviation_pct": round(worst, 3),
        "within_2pct": worst <= 2.0,
    }
    print("-" * 78)
    print(f"before 11: {summary['before_min']:.2f} .. {summary['before_max']:.2f} "
          f"(median {summary['before_median']:.2f})")
    print(f"after  11: {summary['after_min']:.2f} .. {summary['after_max']:.2f} "
          f"(median {summary['after_median']:.2f})  max |dev| {worst:.3f}%  "
          f"{'OK' if summary['within_2pct'] else 'FAIL'}")

    if args.dry:
        print("dry run: nothing written")
        return

    out.mkdir(parents=True, exist_ok=True)
    for r in results:
        s = next(x for x in kept if x["n"] == r["view"])
        im = s["im"].point(r["luts"][0] + r["luts"][1] + r["luts"][2])
        p = Path(r["out"])
        im.save(p, quality=92, subsampling=2, optimize=True, progressive=True)
        r["out_bytes"] = p.stat().st_size
        del r["luts"]
    report = {"summary": summary, "views": results,
              "excluded_views": [{"view": s["n"], "src": s["path"],
                                  "before_luma": round(s["luma"], 3)} for s in dropped]}
    rp = out / "normalize-report.json"
    rp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(results)} jpg + {rp}")


if __name__ == "__main__":
    main()
