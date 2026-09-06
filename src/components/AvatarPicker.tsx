// 换头像：先列官方 Q 版看板娘，最后一格虚线框上传本地图（带圆形裁切）。
//
// ★ 为什么不直接沿用"点头像 → 系统相册"那一步：新用户装完 App 手里没有合适的头像，
//   而这个 app 本来就有一个到处露脸的角色。给一排现成的官方头像，一秒钟就能有个
//   像样的脸；想用自己的图那条路一格都没少。
//
// ★ 两种来源在数据层是**同一件事**：都被 utils/image 归一成 256px 的 SquareImage，
//   再交给 account.setAvatarImage 走同一条上传/落库路径。官方头像不走"存个站内路径"
//   的捷径 —— 那个字符串 PUT 给服务端之后，别的客户端拿到的就是一张坏图
//   （理由写在 urlToSquareImage 的注释里）。
import { useEffect, useRef, useState } from "react";
import { CloseButton } from "./IconTapButton";
import { createPortal } from "react-dom";
import { MASCOT_AVATARS } from "../data/mascotAvatars";
import { setAvatarImage } from "../data/account";
import { cropSquareImage, decodeImageFile, urlToSquareImage } from "../utils/image";
import Avatar from "./Avatar";
import Icon from "./Icon";

/** 裁切框边长（CSS px）。方框套一个同径的圆罩：圆之外的部分不会进头像 */
const CROP_BOX = 264;
/** 最大放大倍数（相对"刚好铺满裁切框"的那一档）。再大就是在放大马赛克 */
const MAX_ZOOM = 4;

export default function AvatarPicker({
  name,
  current,
  onClose,
  onError,
}: {
  /** 当前用户名，只用来渲染没有头像时的字母底 */
  name: string;
  current?: string;
  onClose: () => void;
  /** 失败要说出来：头像换不上而界面一声不吭，用户只会反复点同一个格子 */
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  /** 选了本地图之后进入裁切态；null = 还在选头像那一屏。
   *  bitmap 用来算尺寸和最后导出，url 只用来给 <img> 预览 —— 两者都从**同一张
   *  已经按 EXIF 摆正的位图**来（见 makePreview），预览和成品不会一个正一个躺。 */
  const [cropping, setCropping] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);

  // 位图和 objectURL 都不归 GC 管，换图/卸载都要显式释放，否则连开几次就是几十 MB
  useEffect(
    () => () => {
      cropping?.bitmap.close?.();
      if (cropping) URL.revokeObjectURL(cropping.url);
    },
    [cropping],
  );

  async function apply(run: () => Promise<{ dataUrl: string; blob: Blob }>, label: string) {
    setBusy(label);
    try {
      await setAvatarImage(await run());
      onClose();
    } catch (e) {
      console.warn("[avatar] 更换失败:", e);
      // 上传失败时 setAvatarImage 已经把本地那份换上了，所以话要说准：
      // 不是"没换成"，是"这台设备上换了、服务器上还没有"
      onError(e instanceof Error ? e.message : "头像更换失败，本机仍会显示新头像");
      onClose();
    } finally {
      setBusy("");
    }
  }

  if (cropping) {
    return (
      <Shell onClose={onClose}>
        <CropStage
          bitmap={cropping.bitmap}
          previewUrl={cropping.url}
          busy={busy}
          onCancel={() => setCropping(null)}
          onDone={(crop) => void apply(() => cropSquareImage(cropping.bitmap, crop), "处理中…")}
        />
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-100">选个头像</h3>
        <CloseButton size={20} align="end" tone="text-slate-400" onClick={onClose} />
      </div>

      <div className="grid grid-cols-4 gap-x-3 gap-y-4">
        {MASCOT_AVATARS.map((a) => (
          <button
            key={a.key}
            disabled={!!busy}
            onClick={() => void apply(() => urlToSquareImage(a.src), "换头像…")}
            className="flex flex-col items-center gap-1.5 disabled:opacity-50"
          >
            <img
              src={a.src}
              alt={a.label}
              /* 选中态用一圈品牌色环。current 存的是**上传后的那份**（dataURL 或
                 Cloudinary URL），和这里的站内路径永远不相等，所以刻意不做"当前选中"
                 的高亮 —— 画一个永远不亮的选中态，比没有更让人困惑 */
              /* 刻意**不加** loading="lazy"：八张加起来才 98KB，而懒加载在
                 "抽屉刚滑出来还没落位"这一瞬间会判定它们不在视口里，于是整格
                 空着等下一次滚动——用户看到的是一排空白圆圈。省这点流量不值 */
              className="h-14 w-14 rounded-full object-cover ring-1 ring-slate-700 transition active:scale-95"
            />
            <span className="text-[11px] text-slate-400">{a.label}</span>
          </button>
        ))}

        {/* 最后一格：虚线框 = 空位，点它从相册选。位置放在官方头像**之后**，
            因为大多数人是来挑一个现成的，自定义是少数路径 */}
        <button
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center gap-1.5 disabled:opacity-50"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-slate-600 text-slate-500 transition active:scale-95">
            <Icon name="plus" size={22} strokeWidth={2.5} />
          </span>
          <span className="text-[11px] text-slate-400">自定义</span>
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-700/70 bg-panel px-3 py-2.5">
        <Avatar name={name} src={current} size={40} />
        <span className="text-[11px] leading-relaxed text-slate-500">
          {busy || "当前头像。换成官方看板娘或自己的照片都行"}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 清掉，否则选同一张图第二次不触发 change
          if (!f) return;
          // ★ 大照片解码 + 按 EXIF 摆正要一两秒，这期间得让人看见（2026-09-05 主人点名"没有上传中的反馈"）
          setBusy("读取图片…");
          try {
            const bitmap = await decodeImageFile(f);
            setCropping({ bitmap, url: await makePreview(bitmap) });
          } catch (err) {
            onError(err instanceof Error ? err.message : "这张图片打不开");
          } finally {
            setBusy("");
          }
        }}
      />
    </Shell>
  );
}

/**
 * 圆形裁切。
 *
 * ★ 交互只有**拖动 + 双指捏合 + 滑杆**三样，没有旋转没有滤镜：头像是 40px 的小圆点，
 *   多一个控件都是在给一件三秒钟的事加仪式。
 * ★ 缩放的下限是"刚好铺满裁切框"，位移也夹在同一条约束里 —— 圆里永远不会露出
 *   一块空白。放任用户拖出边界，然后在导出时补透明，是最常见也最难看的一种实现。
 */
function CropStage({
  bitmap,
  previewUrl,
  busy,
  onCancel,
  onDone,
}: {
  bitmap: ImageBitmap;
  previewUrl: string;
  busy: string;
  onCancel: () => void;
  onDone: (crop: { x: number; y: number; side: number }) => void;
}) {
  /** 铺满裁切框所需的最小缩放（源图像素 → CSS px） */
  const min = CROP_BOX / Math.min(bitmap.width, bitmap.height);
  const [zoom, setZoom] = useState(1); // 相对 min 的倍数
  const [pan, setPan] = useState({ x: 0, y: 0 }); // 图心相对框心的位移（CSS px）
  /** 按下的手指。两根时进入捏合 */
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const scale = min * zoom;
  const dispW = bitmap.width * scale;
  const dispH = bitmap.height * scale;

  /** 把位移夹回"图还盖得住整个框"的范围内 */
  function clampPan(p: { x: number; y: number }, s: number) {
    const mx = Math.max(0, (bitmap.width * s - CROP_BOX) / 2);
    const my = Math.max(0, (bitmap.height * s - CROP_BOX) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }

  function setZoomClamped(z: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setPan((p) => clampPan(p, min * next));
  }

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function move(e: React.PointerEvent) {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size >= 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) setZoomClamped((pinch.current.zoom * d) / pinch.current.dist);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setPan((p) => clampPan({ x: p.x + dx, y: p.y + dy }, scale));
  }

  function up(e: React.PointerEvent) {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
  }

  /** 框 → 源图像素。框心对应的源图坐标 = 图心 − 位移/缩放 */
  function crop() {
    const side = CROP_BOX / scale;
    return {
      x: bitmap.width / 2 - pan.x / scale - side / 2,
      y: bitmap.height / 2 - pan.y / scale - side / 2,
      side,
    };
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onCancel} className="text-sm text-slate-400">
          返回
        </button>
        <h3 className="text-base font-bold text-slate-100">调整头像</h3>
        <button
          onClick={() => onDone(crop())}
          disabled={!!busy}
          className="text-sm font-bold text-brand disabled:text-slate-600"
        >
          {busy ? "处理中…" : "完成"}
        </button>
      </div>

      <div className="flex justify-center">
        <div
          className="relative touch-none overflow-hidden bg-black"
          style={{ width: CROP_BOX, height: CROP_BOX }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <img
            src={previewUrl}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none select-none"
            /* 只用 transform 摆位（合成层）：拖动时每帧都在改，动 left/top 会重排 */
            style={{
              width: dispW,
              height: dispH,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)`,
            }}
          />
          {/* 圆罩：外面压暗一层，圆环描白边。用 box-shadow 铺满四周，
              比再套四个 div 拼一个"洞"省事也不会漏缝 */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/80"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,.6)" }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Icon name="search" size={16} className="flex-none text-slate-500" />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoomClamped(Number(e.target.value))}
          className="h-1 w-full flex-1 accent-brand"
          aria-label="缩放"
        />
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">拖动移动位置，双指或滑杆缩放</p>
    </>
  );
}

/**
 * ImageBitmap 没法直接喂给 <img>，转一张 objectURL 出来给预览用。
 *
 * ★ 为什么绕道 canvas，而不是直接 URL.createObjectURL(file)：EXIF。
 *   位图是用 imageOrientation:"from-image" 解的（已摆正），而 <img> 认不认 EXIF
 *   要看浏览器。两边一旦不一致，预览是正的、裁出来是躺的 —— 用户看到的和拿到的
 *   不是一张图，这种 bug 找起来能找一整天。从**同一张已摆正的位图**再画一遍，
 *   两者必然一致。
 * ★ objectURL 而不是 dataURL：手机相册随手一张就是 4000×3000，
 *   dataURL 是一串十几 MB 的字符串，还要一直挂在内存里。
 */
async function makePreview(bitmap: ImageBitmap): Promise<string> {
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext("2d")?.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("这张图片打不开");
  return URL.createObjectURL(blob);
}

/** 底部抽屉外壳。★ portal 到 body：TabBar 是 z-40 且是页面的兄弟节点，
 *  留在页面里的抽屉底部那排按钮会被底栏盖住点不到（ProfilePage 的 Sheet 同因）。 */
function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
