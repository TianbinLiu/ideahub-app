# 官方 Q 版看板娘头像（见 src/components/AvatarPicker.tsx）。
# 产物：public/avatars/mascot-*.webp + public/avatars/manifest.json
#
# 用法（仓库根目录）：
#   python design/gen-mascot-avatars.py
#
# ★ 为什么是从**已有精灵图里裁**，而不是再调一次方舟出图：
#   底栏那五张 createbtn 精灵图（design/gen-createbtn-sprites.mjs 的产物）就是
#   同一个人的 Q 版正脸，5 姿势 × 16 帧 = 80 张现成的表情，且**已经绿幕抠干净、
#   已经统一过取景框**。再生成一批新的只会有两个后果：多花一次生成费，
#   而且新出的脸和底栏那只宠物**不一定是同一个人**（同一套提示词也会漂）。
#   头像必须与宠物是同一个角色 —— 那正是"官方看板娘头像"这件事的全部意义。
#
# ★ 为什么这个脚本是 Python 而不是和邻居们一样的 .mjs：
#   design/ 下那几个 .mjs 走的是 sharp + ffmpeg-static（IMGTOOLS 那一套一次性工具），
#   因为它们要做绿幕抠像和视频抽帧。本脚本只做「裁剪 + 合成背景 + 编码 webp」，
#   Pillow 开箱即有，不需要任何额外安装。省掉一整套工具链的代价是换个语言，值。
#
# ★ 裁剪框是**手量的**，不是算出来的（每条注释里记了量法）：
#   试过按 alpha 包围盒的固定比例自动裁，peek/cheer 两套姿势的人物在画面里
#   更大更靠下，同一个比例下巴会被切掉；也试过认青色瞳孔定位，
#   薄荷色挑染那一缕会被一起认进来，闭眼帧则一个瞳孔都认不到。
#   80 帧里只挑 8 张，手量一遍最省事也最准。
from PIL import Image, ImageDraw, ImageFilter
import json
import os
import sys

# Windows 控制台默认还是 GBK，中文标签一 print 就 UnicodeEncodeError ——
# 而那时图**已经写完了**，看着像"生成失败"其实只是打印失败。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "createbtn")
DST = os.path.join(ROOT, "public", "avatars")
#: 清单同时写成一份 TS 模块。
#: ★ 不用 public/manifest.json + 运行时 fetch：那是一份**永远不会变**的静态清单，
#:   为它多一次网络往返毫无意义，而且真机上那一发失败就是"官方头像一张都不显示"，
#:   还查不出原因（Capacitor 对未命中路径回 200 + index.html，见 CLAUDE.md）。
TS = os.path.join(ROOT, "src", "data", "mascotAvatars.ts")

#: 精灵图单格宽度（createbtn 是 16 帧横排、单格 200px，见 public/createbtn/README.md）
FRAME_W = 200
#: 输出边长。个人页最大渲染到 92px，2 倍屏 184px —— 256 有余量又不至于让八张图占太多包体
SIZE = 256

# 一格 = 一个可选头像。
#   cx/cy/side  裁剪框（精灵图单格坐标系，像素）。side 是正方形边长，越界部分透明补齐。
#   c0/c1       背景竖向渐变的上/下端色。八格刻意各不相同 —— 选头像时这一格底色
#               就是最好的区分标记，全用品牌青会变成"八张一样的图"。
PICKS = [
    # idle 帧：安静微笑。头顶呆毛贴着画面上沿，chin 在 y≈115，取 side=150 正好留一点空气
    ("smile", "idle", 0, 98, 72, 150, (0x1D, 0x4E, 0x6B), (0x0B, 0x1C, 0x2E), "微笑"),
    # peek 帧：前倾姿势的人物更大更靠下（chin y≈130），side 要比 idle 大 15px 才不切下巴
    ("focus", "peek", 8, 100, 88, 165, (0x3B, 0x34, 0x70), (0x12, 0x10, 0x2A), "认真"),
    # wave 帧：左上角那只手要一起进框，所以裁剪框比脸的正中心偏左 10px
    ("hi", "wave", 12, 98, 74, 168, (0x1F, 0x5E, 0x5A), (0x0A, 0x1F, 0x22), "打招呼"),
    ("laugh", "wave", 15, 104, 74, 172, (0x6E, 0x2C, 0x48), (0x24, 0x10, 0x1C), "大笑"),
    ("wonder", "peek", 15, 100, 92, 172, (0x1C, 0x50, 0x3C), (0x08, 0x1C, 0x16), "好奇"),
    # cheer 帧：双手举过头顶，横向铺到 x=30..185，side 给到 180 才留得住两只手
    ("cheer", "cheer", 12, 105, 82, 180, (0x7A, 0x5A, 0x1E), (0x2A, 0x1C, 0x08), "欢呼"),
    ("joy", "cheer", 15, 105, 80, 178, (0x7A, 0x3A, 0x20), (0x2A, 0x12, 0x06), "庆祝"),
    # nap 帧：头顶那个白色小气泡在 x≈145 y≈25，side=162 刚好把它圈进来
    ("nap", "nap", 15, 96, 94, 162, (0x2A, 0x35, 0x60), (0x0D, 0x11, 0x22), "打盹"),
]


def frame(pose: str, index: int) -> Image.Image:
    sheet = Image.open(os.path.join(SRC, f"{pose}.webp")).convert("RGBA")
    return sheet.crop((index * FRAME_W, 0, (index + 1) * FRAME_W, sheet.size[1]))


def backdrop(top, bottom, size: int) -> Image.Image:
    """竖向渐变 + 中心一团柔光。
    没有那团光时银白色头发压在深色背景上会糊成一块，圆形裁切之后尤其明显。"""
    strip = Image.new("RGB", (1, size))
    px = strip.load()
    for y in range(size):
        t = y / (size - 1)
        px[0, y] = tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3))
    base = strip.resize((size, size))
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse([size * 0.12, size * 0.02, size * 0.88, size * 0.78], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    return Image.composite(Image.new("RGB", (size, size), (255, 255, 255)), base, glow).convert("RGBA")


def build(key, pose, index, cx, cy, side, c0, c1, label):
    art = frame(pose, index)
    # 先把画布四周垫出一整个 side 的透明边再裁：裁剪框允许越界（cheer 的手就顶到画面外），
    # 直接 crop 越界区域 Pillow 会补黑边，圆形头像上会出现一道黑月牙
    pad = Image.new("RGBA", (art.size[0] + 2 * side, art.size[1] + 2 * side), (0, 0, 0, 0))
    pad.paste(art, (side, side), art)
    half = side // 2
    box = (cx - half + side, cy - half + side, cx - half + side + side, cy - half + side + side)
    head = pad.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
    out = backdrop(c0, c1, SIZE)
    out.alpha_composite(head)
    path = os.path.join(DST, f"mascot-{key}.webp")
    out.convert("RGB").save(path, "WEBP", quality=88, method=6)
    return {"key": key, "label": label, "src": f"/avatars/mascot-{key}.webp", "bytes": os.path.getsize(path)}


TS_HEAD = """// 官方 Q 版看板娘头像清单。
//
// ★★ 本文件由 `python design/gen-mascot-avatars.py` **自动生成，不要手改** ——
//   改了下次重跑就没了。要增删头像去改那个脚本里的 PICKS 表。
//
// 图本身是从底栏宠物那五张精灵图里裁的（design/gen-mascot-avatars.py 开头有说明），
// 所以头像里的人和底栏上那只、工坊里的铸卡师是**同一个角色**。

export interface MascotAvatar {
  key: string;
  /** 选择器里显示的中文名（一个词，说清是什么表情） */
  label: string;
  /** 站内静态路径。走 <img src> 直接能用 */
  src: string;
}

export const MASCOT_AVATARS: MascotAvatar[] = [
"""


def write_ts(manifest):
    rows = "".join(
        f'  {{ key: "{m["key"]}", label: "{m["label"]}", src: "{m["src"]}" }},\n' for m in manifest
    )
    with open(TS, "w", encoding="utf-8", newline="\n") as f:
        f.write(TS_HEAD + rows + "];\n")


def main():
    os.makedirs(DST, exist_ok=True)
    manifest = [build(*p) for p in PICKS]
    with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    write_ts(manifest)
    total = sum(m["bytes"] for m in manifest)
    for m in manifest:
        print(f"  {m['src']:34s} {m['label']:4s} {m['bytes'] / 1024:6.1f} KB")
    print(f"共 {len(manifest)} 张，{total / 1024:.1f} KB")


if __name__ == "__main__":
    main()
