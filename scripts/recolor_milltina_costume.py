# Milltina Costume 贴图重着色：灰紫女仆装 → 深绿+金滚边（魔法书房色板 app/design/npc-palette.svg）。
# 蒙版来自 PSD 分层（psd-tools），逐层 alpha 加权、自上而下认领防重复上色；
# 只改 H/S 保留 V——画师的褶皱/阴影/高光全在明度里，原设计完整保留。
# 产物进 assets-private/textures/（gitignore，购入资产衍生物不进公开仓）。
import numpy as np
from psd_tools import PSDImage
from PIL import Image
import os

BASE = r"C:/Users/tliu7/Downloads/Milltina_ミルティナ__ver1.01.1/Milltina(ミルティナ)_ver1.01.1"
PSD = BASE + "/PSD/Milltina_Costume.psd"
PNG = BASE + "/PNG/Milltina_Costume.png"
OUT = r"C:/Users/tliu7/ideahub/app/assets-private/textures/Milltina_Costume_greengold.png"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# ── 向量化 HSV（0-1 域）──
def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-8
    idx = m & (mx == r)
    h[idx] = ((g - b)[idx] / d[idx]) % 6
    idx = m & (mx == g) & (mx != r)
    h[idx] = (b - r)[idx] / d[idx] + 2
    idx = m & (mx == b) & (mx != r) & (mx != g)
    h[idx] = (r - g)[idx] / d[idx] + 4
    h /= 6
    s = np.where(mx > 1e-8, d / np.maximum(mx, 1e-8), 0)
    return h, s, mx

def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6) % 6
    f = h * 6 - np.floor(h * 6)
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    r = np.select([i == 0, i == 1, i == 2, i == 3, i == 4], [v, q, p, p, t], v)
    g = np.select([i == 0, i == 1, i == 2, i == 3, i == 4], [t, v, v, q, p], p)
    b = np.select([i == 0, i == 1, i == 2, i == 3, i == 4], [p, p, t, v, v], q)
    return np.stack([r, g, b], -1)

# ── 三种变换（输入/输出 0-1 RGB；V 一律保留）──
def to_green(rgb):
    """暗灰紫主布料 → 深绿 #123C2A 系：饱和度随明度递减（高光留缎面感）。
    H 用 160 而非 147：引擎 look.tint 0xbfb2a4 的 B 通道×0.64 会把祖母绿压成草绿，
    贴图侧预偏蓝绿补偿（渲染实测 H121→回到 ~147）；V×0.85 压深对齐桌面毡"""
    _, s, v = rgb_to_hsv(rgb)
    h = np.full_like(v, 160 / 360)
    s2 = np.clip(0.62 - 0.25 * v + s * 0.15, 0.18, 0.68)
    return hsv_to_rgb(h, s2, v * 0.85)

def to_gold_white(rgb):
    """白色蕾丝/荷叶边 → 香槟金 #D6B26A 系：高光近白、褶皱阴影金色加深"""
    _, s, v = rgb_to_hsv(rgb)
    h = np.full_like(v, 38 / 360)
    s2 = np.clip(0.16 + (1 - v) * 0.85 + s * 0.1, 0.14, 0.55)
    return hsv_to_rgb(h, s2, v * 0.985)

def to_gold_metal(rgb):
    """暗色纽扣 → 黄铜金属：唯一提亮 V 的变换（小面积点缀）"""
    _, s, v = rgb_to_hsv(rgb)
    h = np.full_like(v, 42 / 360)
    v2 = np.clip(v * 1.55 + 0.10, 0, 0.92)
    s2 = np.clip(0.62 - 0.30 * v2, 0.25, 0.62)
    return hsv_to_rgb(h, s2, v2)

def to_gold_lace(rgb):
    """胸口蕾丝衬（bra，无围裙形态下可见）粉紫→金：微提亮读作香槟蕾丝，
    玫瑰刺绣同映射保留花纹（金线刺绣感）"""
    _, s, v = rgb_to_hsv(rgb)
    h = np.full_like(v, 40 / 360)
    v2 = np.clip(v * 0.92 + 0.10, 0, 0.95)
    s2 = np.clip(0.30 + (1 - v) * 0.35 + s * 0.1, 0.2, 0.6)
    return hsv_to_rgb(h, s2, v2)

def to_green_gold_split(rgb):
    """Tail slit 专用：银灰锥体+白色滚边（V>0.55 占 47%）走金、暗部走绿——
    整层套绿会把银色高光染成薄荷绿"""
    _, _, v = rgb_to_hsv(rgb)
    t = np.clip((v - 0.45) / (0.60 - 0.45), 0, 1)
    w = (t * t * (3 - 2 * t))[..., None]
    return to_green(rgb) * (1 - w) + to_gold_white(rgb) * w

# 层名（组内路径）→ 变换；未列出的层认领区域但保持原色（内衣/袜/鞋垫/金属扣）
RULES = {
    "/dress/dress": to_green,
    "/dress/buttons": to_gold_metal,
    "/skirt/black": to_green,
    "/skirt/white": to_gold_white,
    "/collar": to_gold_white,
    "/wrist cuffs/wrist cuffs": to_gold_white,
    "/wrist cuffs/buttons": to_gold_metal,
    "/neck ribbon": to_green,
    "/hair ribbon": to_green,
    "/tail ribbon": to_green,
    "/Tail slit": to_green_gold_split,
    "/hat": to_gold_white,
    "/shoes/shoes": to_green,
    "/apron": to_gold_white,  # 模型已去围裙，贴图一并处理保持一致
    # 胸口蕾丝衬在对话构图里直接可见——粉紫与深绿撞色，归入金系
    "/bra/bra base": to_gold_lace,
    "/bra/bra straps": to_gold_lace,
    "/bra/rose": to_gold_lace,
}

psd = PSDImage.open(PSD)
flat = np.asarray(Image.open(PNG).convert("RGB")).astype(np.float32) / 255.0
H, W = flat.shape[:2]

grp = next(l for l in psd if l.name == "costume")

def leaves(g, path=""):
    for l in g:
        nm = f"{path}/{l.name}"
        if l.is_group():
            yield from leaves(l, nm)
        else:
            yield nm, l

out = flat.copy()
remaining = np.ones((H, W), np.float32)
# psd-tools 迭代自下而上；认领必须自上而下（上层像素归上层）
for nm, layer in reversed(list(leaves(grp))):
    arr = layer.numpy()
    if arr is None or arr.shape[2] < 4:
        continue
    x0, y0, x1, y1 = layer.bbox
    alpha = arr[..., 3].astype(np.float32)
    rem = remaining[y0:y1, x0:x1]
    eff = alpha * rem
    fn = RULES.get(nm)
    if fn is not None and eff.max() > 0:
        sub = flat[y0:y1, x0:x1]
        out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - eff[..., None]) + fn(sub) * eff[..., None]
    remaining[y0:y1, x0:x1] = rem * (1 - alpha)
    print(f"{'重着色' if fn else '保留'}: {nm}")

img = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
img.save(OUT)
print("SAVED:", OUT, os.path.getsize(OUT), "bytes")
