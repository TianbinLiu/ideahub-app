// 【backlog 2.8-⑨ 初始模板全自产】官方白模模板的生产工具（一条龙，分阶段跑）。
//
// 路线（与产品自己的 V1 登记路完全同构，"要样板就发真的"——data/templates.ts:56 原话）：
//   gen     直接 t2v 出**纯白人偶**源视频（省掉 ¥9/条的白模化 edit：V1 路本来就是
//           "作者自带白模预演视频"，Blender 预演与 t2v 人偶是同一类东西）
//   register 以官方账号走真实登记链：签名直传 → createTemplate → PATCH category
//            → detect-roles（认序数位）→ 作者确认（PATCH roles，逐帧核对后跑）
//   trial   试炼：经 /api/ark 代理发 2.5 r2v cast（挂凛雪/玄墨形象图），代理轮询到
//            succeeded 时服务端置 provenAt —— 发布闸要它（坏模板坏在作者这一发）
//   publish PATCH publish ×N → GET /templates/shared 验收
//
// ★ 提示词全部自写并在此留档（苏州判例：能再现创作过程才攒得下"构成作品"的举证）。
//   迭代记录见每条模板的 PROMPT 注释。
// ★ 编舞纪律（读服务端 blockoutize.service 复盘得来）：一镜到底、左右站位**绝不交换**
//   （序数=站位，是套用侧"从左数第 k 个"的全部依据）、2~3 人（3 位历次全对，5 位从没全对）。
//
// 用法（仓库根目录；OUT 建议用会话 scratchpad）：
//   node design/gen-seed-templates.mjs gen <OUT>
//   node design/gen-seed-templates.mjs register <OUT> <API_BASE> <TOKEN>
//   node design/gen-seed-templates.mjs trial <OUT> <API_BASE> <TOKEN>
//   node design/gen-seed-templates.mjs publish <OUT> <API_BASE> <TOKEN>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const [, , PHASE, OUT = ".", API_BASE = "", TOKEN = ""] = process.argv;
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const AH = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };

/** 官方首批两条。id 兼作文件名与登记状态的键 */
const TEMPLATES = [
  {
    id: "rainy-umbrella",
    title: "雨夜递伞",
    category: "emotion",
    intro: "雨夜路灯下，右边的角色快步走近，把伞举到左边角色头顶——两个角色位，把你的两张人物卡挂上去，换成你们的故事。",
    roles: 2,
    // PROMPT 迭代记录：v1 直接成稿（编舞按"左右不交换"纪律写死；
    // "透明雨伞"是道具、保持实物——白模只管人）。
    prompt:
      "夜晚下着小雨的老城街道，暖黄色路灯。画面里只有两个完全相同的纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。左边的人偶站在路灯下淋着雨，微微低头；右边的人偶撑着一把透明雨伞从画面右侧快步走近，把伞举到左边人偶的头顶，左边人偶抬起头看向它。两个人偶始终一左一右，位置不交换。固定机位中景，竖屏构图，雨丝清晰，地面有水洼反光。",
    descs: ["左边·被递伞的（雨中低头站着，后抬头）", "右边·递伞的（撑透明伞快步走近）"],
  },
  {
    id: "triple-beat",
    title: "三连节拍",
    category: "fun",
    intro: "摄影棚三连动作：拍手→张臂→跳跃比胜利手势。三个角色位从左到右各做一拍，换上你的三张人物卡就是团体出道位。",
    roles: 3,
    // PROMPT 迭代记录：v1 直接成稿（三拍节奏逐位点名；摄影棚纯色底 = 认位最稳的画面）。
    prompt:
      "明亮的浅灰色摄影棚背景，灯光均匀。画面里站成一横排的三个完全相同的纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。节奏感强的三连动作：先是左边的人偶拍手一次，接着中间的人偶向前一步张开双臂摆出夸张的姿势，最后右边的人偶原地跳起比出胜利手势。三个人偶始终保持左、中、右的站位，位置不交换。固定机位全身景，竖屏构图。",
    descs: ["最左边·拍手的", "中间·向前张臂的", "最右边·跳起比胜利手势的"],
  },
  // ── 第二批（2026-08-29）：补齐其余四类 ──────────────────────────────
  {
    id: "alley-standoff",
    title: "巷口对峙",
    category: "story",
    intro: "深巷两端对峙：左边的角色缓缓拔出木剑指向对面，右边的角色抬手摆出迎战姿态。两个角色位，换上你的主角与对手。",
    roles: 2,
    // PROMPT 迭代记录：v1 直接成稿（武器是道具、保持实物；拔剑指向=单向动作，无位置交换）。
    prompt:
      "黄昏的窄巷，两侧是斑驳的砖墙，地面有薄雾。画面里只有两个完全相同的纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。左边的人偶从腰间缓缓拔出一把木剑，剑尖指向对面；右边的人偶双手抬起摆出迎战的姿态，微微后退半步。两个人偶始终一左一右，位置不交换。固定机位中景侧拍，竖屏构图，逆光剪影感。",
    descs: ["左边·拔木剑指向对面的", "右边·抬手迎战后退半步的"],
  },
  {
    id: "moonlight-morph",
    title: "月光变身",
    category: "morph",
    intro: "一转身，光尘环绕落定英雄站姿——单角色位变身模板，把你的角色卡挂上去出变身名场面。",
    roles: 1,
    // PROMPT 迭代记录：v1 直接成稿（光效属于画面、复刻时保留；单人=挂卡最稳的形态）。
    prompt:
      "深蓝色夜空背景，一轮明亮的满月。画面里只有一个纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。它站在画面中央，原地转身一圈，转身时周围升起一圈发光的金色光尘与流光环绕，随后光尘散开，它落定成一个挺拔的英雄站姿，单手向前伸出。人偶始终在画面中央。固定机位全身景，竖屏构图。",
    descs: ["画面中央·转身变身落定英雄站姿的"],
  },
  {
    id: "midautumn-lantern",
    title: "中秋提灯望月",
    category: "festival",
    intro: "屋檐下并肩望月，左边的角色提起暖光灯笼——中秋节的两人团圆位，换上你们两个。",
    roles: 2,
    // PROMPT 迭代记录：v1 直接成稿（灯笼/月亮/桂花瓣全是道具与环境，白模只管人；
    // 2026 中秋在 9 月下旬，提前一个月上架正合 ⑩ 的节奏）。
    prompt:
      "夜晚的中式屋檐下，天空挂着一轮巨大的金黄色满月，远处有桂花瓣缓缓飘落。画面里只有两个完全相同的纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。两个人偶并肩站着仰头望月，左边的人偶缓缓提起一盏发着暖橙色光的圆形纸灯笼，右边的人偶抬手指向月亮。两个人偶始终一左一右，位置不交换。固定机位中景，竖屏构图，月光清冷与灯笼暖光对比。",
    descs: ["左边·提暖光圆灯笼的", "右边·抬手指月亮的"],
  },
  {
    id: "product-reveal",
    title: "新品展示",
    category: "commerce",
    intro: "展示台前拿起产品递向镜头，光斑一闪——单角色位带货模板，主讲人换成你自己的角色。",
    roles: 1,
    // PROMPT 迭代记录：v1 直接成稿（产品瓶是道具、保持实物；镜头缓推=带货片的标准运镜）。
    prompt:
      "简洁的米白色展示间，画面中央一张浅色圆形展示台，台上放着一只磨砂玻璃小瓶。画面里只有一个纯白色人偶模特——没有头发、没有五官、没有服装，全身光滑的哑光白色塑料，关节处可见球形关节。它站在展示台后，双手拿起那只小瓶，递向镜头方向展示，瓶身闪过一道柔和的光斑。人偶始终在画面中央。镜头缓缓向前推近，竖屏构图，柔和棚光。",
    descs: ["展示台后·拿起产品递向镜头的"],
  },
];

async function jfetch(base, path, opts = {}) {
  const r = await fetch(`${base}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}
const ark = (path, body) => jfetch(ARK, path, { body, headers: AH });
const api = (path, opts = {}) => jfetch(API_BASE, path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.headers ?? {}) } });

async function waitArkTask(id, tag, fetchTask) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const j = await fetchTask(id);
    if (j.status === "succeeded") {
      console.log(`   ${tag} 完成 · usage=${JSON.stringify(j.usage)}`);
      return j.content?.video_url;
    }
    if (j.status === "failed") throw new Error(`${tag} 失败：${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    if (i % 5 === 0) console.log(`   ${tag} ${j.status}…`);
  }
  throw new Error(`${tag} 超时——任务号 ${id}`);
}

async function download(url, file) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(OUT, file), buf);
  return buf.length;
}

/** 登记状态落盘（各阶段接力用） */
const STATE_FILE = join(OUT, "state.json");
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── gen：t2v 出两条白模人偶源视频（直连方舟，¥1/条）─────────────────────
if (PHASE === "gen") {
  for (const t of TEMPLATES) {
    // 复跑守卫：已出过的源片不重烧（换构思就删掉对应 mp4 再跑）
    if (existsSync(join(OUT, `${t.id}.mp4`))) {
      console.log(`· ${t.title} 已有源片，跳过`);
      continue;
    }
    console.log(`① ${t.title}：创建 t2v 任务…`);
    const j = await ark("/contents/generations/tasks", {
      model: "doubao-seedance-2-0-mini-260615",
      content: [{ type: "text", text: t.prompt }],
      resolution: "720p",
      ratio: "9:16",
      duration: 5,
      generate_audio: false,
      watermark: false,
    });
    const url = await waitArkTask(j.id, t.title, (id) => ark(`/contents/generations/tasks/${id}`).catch(() => ({ status: "running" })));
    const sz = await download(url, `${t.id}.mp4`);
    console.log(`   已存 ${t.id}.mp4（${Math.round(sz / 1024)}KB）`);
  }
  console.log("gen 完成。抽帧检查人偶是否干净、站位是否分明，再走 register。");
}

// ── register：官方账号真实登记链（上传免费、认角色走钱包 vision）───────────
if (PHASE === "register") {
  for (const t of TEMPLATES) {
    const st = (state[t.id] ??= {});
    if (!st.publicId) {
      console.log(`① ${t.title}：签名直传…`);
      const ticket = await api("/api/uploads/template-video/sign", { body: {} });
      const buf = readFileSync(join(OUT, `${t.id}.mp4`));
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type: "video/mp4" }), `${t.id}.mp4`);
      for (const [k, v] of Object.entries(ticket.params)) fd.append(k, String(v));
      const up = await fetch(ticket.uploadUrl, { method: "POST", body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok || !uj.secure_url) throw new Error(`直传失败：${JSON.stringify(uj).slice(0, 300)}`);
      const receipt = await api("/api/uploads/template-video/confirm", { body: { publicId: ticket.publicId } });
      st.publicId = receipt.publicId;
      st.videoUrl = receipt.url;
      save();
      console.log(`   已传 ${st.publicId}（${receipt.durationSec}s ${receipt.width}x${receipt.height}）`);
    }
    if (!st.templateId) {
      console.log(`② ${t.title}：登记模板…`);
      const r = await api("/api/branch/templates", {
        body: {
          title: t.title,
          intro: t.intro,
          coverUrl: "",
          videoUrl: st.videoUrl,
          recipe: { styleHint: "", beats: [], durationSec: 5, videoTier: "ultra", aspect: "portrait", framePrompt: "" },
        },
      });
      st.templateId = r.template?.id ?? r.templates?.[0]?.id;
      if (!st.templateId) throw new Error(`登记回包里没有模板 id：${JSON.stringify(r).slice(0, 300)}`);
      save();
      console.log(`   模板 ${st.templateId}`);
      await api(`/api/branch/templates/${st.templateId}/category`, { method: "PATCH", body: { category: t.category } });
      console.log(`   分类 → ${t.category}`);
    }
    if (!st.rolesDetected) {
      console.log(`③ ${t.title}：认角色位（vision，走钱包）…`);
      const r = await api(`/api/branch/templates/${st.templateId}/detect-roles`, { body: {} });
      st.rolesDetected = r.template?.roles ?? [];
      st.markSlots = r.template?.markSlots ?? [];
      save();
      console.log(`   认出 ${st.rolesDetected.length} 位：${JSON.stringify(st.markSlots)}`);
    }
    if (!st.rolesConfirmed) {
      // 作者确认：label 用服务端认出的序数原样（不许改措辞），desc 换成我们写的人话。
      // ⚠ 跑这一步前先人工抽帧核对"从左数第 k 个"与 descs 对得上（脚本外做）。
      const labels = st.markSlots.length ? st.markSlots : st.rolesDetected.map((r) => r.label);
      if (labels.length !== t.roles) {
        console.log(`   ⚠ ${t.title} 认出 ${labels.length} 位（预期 ${t.roles}）——先人工核对 state.json 再重跑`);
        continue;
      }
      const roles = labels.map((label, i) => ({ label, desc: t.descs[i] ?? "" }));
      await api(`/api/branch/templates/${st.templateId}/roles`, { method: "PATCH", body: { roles } });
      st.rolesConfirmed = true;
      save();
      console.log(`④ ${t.title}：角色位已确认（${labels.join("、")}）`);
    }
  }
  console.log("register 完成。");
}

// ── castrefs：试炼用的三位测试角色形象图（Seedream，各 face+body；TOS 链接 24h）──
// ★ 特征全挑肉眼可判的（与 ab-bind-syntax 同一位凛雪保持连续性）；
//   试炼要验的是"这个模板换人换得动"，所以三位配色/剪影强区分。
const CAST_CHARS = [
  { name: "凛雪", look: "一位银白色长发、佩戴金色星星发饰的动漫女性角色，蓝绿色眼睛，深蓝色短披风与白色衬衫" },
  { name: "玄墨", look: "一位黑色短发束起、侧头佩戴红白狐狸面具的动漫男性角色，琥珀色眼睛，暗红色和服外套" },
  { name: "橙叶", look: "一位奶白色短卷发、戴圆框眼镜的动漫女性角色，暖棕色眼睛，橙黄色针织围巾与米色大衣" },
];
if (PHASE === "castrefs") {
  // 复用守卫：同一批 TOS 链接 24h 内有效，池子还在就不重烧（过期报 4xx 时删掉 _castPool 重跑）
  const urls = state._castPool ?? [];
  if (urls.length) console.log("· 复用上一次的形象图池（_castPool）");
  for (const c of urls.length ? [] : CAST_CHARS) {
    const mk = async (kind, prompt) => {
      const j = await jfetch(ARK, "/images/generations", {
        body: { model: "doubao-seedream-5-0-260128", prompt, size: "1764x2352", response_format: "url", watermark: false },
        headers: AH,
      });
      const u = j.data[0].url;
      await download(u, `cast-${c.name}-${kind}.jpg`);
      return u;
    };
    const f = await mk("face", `${c.look}的面部特写肖像：纯白色背景，头肩构图，五官清晰，二次元插画风。`);
    const b = await mk("body", `${c.look}的全身立绘：纯白色背景，全身完整可见，站姿自然，二次元插画风。`);
    urls.push([f, b]);
    console.log(`   ${c.name} face+body ✓`);
  }
  state._castPool = urls;
  // 按各模板的角色位数分配（前 N 位）。★ 只发给还没试炼过的条目：
  // 复跑时把已 trialDone 的重置掉 = 白白再烧一发 ¥9 的试炼
  for (const t of TEMPLATES) {
    const st = (state[t.id] ??= {});
    if (st.trialDone) continue;
    st.castRefs = urls.slice(0, t.roles);
    st.castNames = CAST_CHARS.slice(0, t.roles).map((c) => c.name);
  }
  save();
  console.log("castrefs 完成（TOS 链接 24h 内有效，尽快跑 trial）。");
}

// ── trial：经代理试炼（2.5 r2v cast，挂形象图；provenAt 由服务端轮询置位）────
if (PHASE === "trial") {
  for (const t of TEMPLATES) {
    const st = state[t.id];
    if (!st?.templateId) throw new Error(`${t.id} 还没登记`);
    if (st.trialDone) continue;
    if (!st.castRefs) throw new Error(`state.json 里缺 ${t.id}.castRefs——先跑 castrefs 阶段`);
    // ★ 参考视频地址以**服务端登记的那份**为准（resolveR2v 按 refVideo.url 等值反查，
    //   与 confirm 回执差一个字都会落到"未登记素材"分支被拒）
    const tplBack = await api(`/api/branch/templates/${st.templateId}`);
    st.videoUrl = tplBack.template?.refVideo?.url || st.videoUrl;
    const names = st.castNames ?? [];
    const labels = st.markSlots ?? [];
    // 套用句：升序序数逐位点名（第十四发验证的形态）+ 紧凑绑定句前置
    const bind = names.map((n, i) => `${n}=${(st.castRefs[i] ?? []).map((_, k) => `@图片${st.castRefs.slice(0, i).flat().length + k + 1}`).join("")}`).join("；");
    const pairs = labels.map((l, i) => `${l}=${names[i]}`).join("；");
    const prompt =
      `参考图：${bind}。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。` +
      `把视频中的白色人偶按下列对应替换：${pairs}。` +
      `其余画面、背景、道具、运镜与光影全部保持原样，不要出现任何水印、字幕或角标。`;
    console.log(`① ${t.title}：试炼 cast（${prompt.length} 字）…\n   ${prompt}`);
    const j = await api("/api/ark/contents/generations/tasks", {
      body: {
        model: "doubao-seedance-2-5-260628",
        content: [
          { type: "text", text: prompt },
          { type: "video_url", role: "reference_video", video_url: { url: st.videoUrl } },
          ...st.castRefs.flat().map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
        ],
        omni_reference_task_type: "edit",
        duration: -1,
        ratio: "adaptive",
        resolution: "720p",
        watermark: false,
      },
    });
    console.log(`   任务 ${j.id}，经代理轮询（服务端靠这条置 provenAt）…`);
    const url = await waitArkTask(j.id, t.title, (id) => api(`/api/ark/contents/generations/tasks/${id}`).catch(() => ({ status: "running" })));
    const sz = await download(url, `${t.id}-trial.mp4`);
    st.trialDone = true;
    save();
    console.log(`   试炼片已存 ${t.id}-trial.mp4（${Math.round(sz / 1024)}KB）——抽帧核对换人质量再 publish`);
  }
}

// ── publish：发布 + 市场验收 ─────────────────────────────────────────────
if (PHASE === "publish") {
  for (const t of TEMPLATES) {
    const st = state[t.id];
    if (!st?.templateId || !st.trialDone) {
      console.log(`· ${t.title} 还没走完试炼，跳过发布`);
      continue;
    }
    if (st.published) continue;
    await api(`/api/branch/templates/${st.templateId}/publish`, { method: "PATCH", body: {} });
    st.published = true;
    save();
    console.log(`${t.title} 已发布`);
  }
  const shared = await jfetch(API_BASE, "/api/branch/templates/shared");
  for (const t of TEMPLATES) {
    const row = (shared.templates ?? []).find((x) => x.title === t.title);
    console.log(`市场验收 ${t.title}：${row ? `✓ category=${row.category} roles=${row.roles?.length}` : "✗ 没找到"}`);
  }
}
