// 角色表情系统：把"高兴/难过/思考…"这种场景语义翻译成各模型自己的形键权重。
//
// 为什么要抽出来：两个角色的形键**名字和粒度完全不同**——玩家 Tsumire 的脸带 96 个
// VRC 形键（あ/い/う/え/お、笑顔、ジト目、眉寄せ、涙、頬染め…），NPC Milltina 只有 22 个
// （visemes + eye_joy/eye_nagomi/brow_nagomi）。业务侧不该知道这些名字，也不该因为换了
// 个模型就改一遍调用点。这里定义一套与模型无关的表情词汇，每个模型给一张配方表。
//
// **形键是模型自带的，不是我们雕的。** 两个模型都由作者按 VRC 规范导出，morph target
// 在 glTF 里是稀疏访问器——玩家档 812 个访问器只占 3.18MB、NPC 档更小。所以"加表情"
// 这件事不需要回 Blender 造资产，缺的一直是运行时驱动：老代码只写了 blink/mouthOpen/
// smile 三个键，96 个里用了 3 个。
//
// 一个必须遵守的实现细节（老注释里已有血泪）：VRC 模型的脸常按材质拆成多个 primitive
// （面部本体 + 睫毛/眼线 alpha 层），**同名形键在每个 primitive 上各自独立**。只写其一
// 的后果是眼线层单独闭合、盖在睁开的眼睛上——就是那个"黑眼影圈"。所以按名字广播到
// 所有含该键的网格。
import * as THREE from "three";

/** 与模型无关的表情词汇。配方里没给的表情自动退回 neutral（模型表达力不够就别硬凑） */
export type Expression =
  | "neutral"
  | "smile"
  | "joy"
  | "gentle"
  | "sad"
  | "angry"
  | "surprise"
  | "think"
  | "wink";

/** 口型：只用五个元音档，辅音 viseme（pp/ff/th…）在没有真实音素流时纯属噪声 */
export type Viseme = "aa" | "ih" | "ou" | "e" | "oh" | "sil";

export interface FaceRecipe {
  /** 眨眼形键（可多个；同时闭合的眼线/睫毛层各是一个键） */
  blink: string[];
  /** 口型形键。缺省的档位说话时自动跳过 */
  visemes: Partial<Record<Viseme, string>>;
  /** 表情 → 形键权重。**不必给全九种**，缺的退回 neutral */
  expr: Partial<Record<Expression, Record<string, number>>>;
  /** 常驻基线（角色的"底色"气质）。表情表里同名的键会覆盖它 */
  rest?: Record<string, number>;
}

// ── 玩家 Tsumire（BOOTH 购入 VRC 档，96 个脸部形键）─────────────
// 键名是日文原名，直接用作者的命名不做翻译层：多一层映射就多一处会和模型版本失配的
// 地方，而这些名字只出现在这张表里。
export const TSUMIRE_FACE: FaceRecipe = {
  blink: ["Blink", "まばたき"],
  visemes: { aa: "vrc.v_aa", ih: "vrc.v_ih", ou: "vrc.v_ou", e: "vrc.v_e", oh: "vrc.v_oh", sil: "vrc.v_sil" },
  // 常态留一点笑意和垂眼，纯 rest 的脸在特写下像木偶
  rest: { 笑顔: 0.16, たれ目: 0.12 },
  expr: {
    smile: { 笑顔: 0.62, 口角上げ: 0.45, たれ目: 0.2 },
    joy: { 笑顔: 1, "><": 0.75, 口角上げ: 0.8, 頬染め: 0.35 },
    gentle: { たれ目: 0.5, 笑顔: 0.35, まゆ下げ: 0.3 },
    sad: { まゆ下げ: 0.7, 口角下げ: 0.6, たれ目: 0.45, 涙: 0.3, 笑顔: 0 },
    angry: { 眉寄せ: 0.85, つり目: 0.6, 口角下げ: 0.4, 笑顔: 0 },
    surprise: { まゆ上げ: 0.8, o: 0.65, 瞳孔小: 0.45, 笑顔: 0 },
    // 思考：半眯的ジト目 + 眉微压 + ω 嘴，配合选卡组时的抱臂姿势
    think: { ジト目: 0.5, まゆ下げ: 0.28, ω: 0.3, 笑顔: 0.1 },
    wink: { ウインク_L: 1, 笑顔: 0.65, 口角上げ: 0.5 },
  },
};

// ── NPC Milltina（22 个脸部形键）──────────────────────────────
// ⚠ 表达力明显小一圈：**没有眉毛上挑/嘴角形状的键**，所以 angry/surprise 给不出来——
// 配方里就不写，让它们退回 neutral，而不是拿 eye_close 之类硬凑出一个怪表情。
// blink 键名 "vrc.blink " 结尾带一个空格（作者笔误，已随模型固化），查表时统一 trim。
export const MILLTINA_FACE: FaceRecipe = {
  blink: ["vrc.blink", "eye_close"],
  visemes: { aa: "vrc.v_aa", ih: "vrc.v_ih", ou: "vrc.v_ou", e: "vrc.v_e", oh: "vrc.v_oh", sil: "vrc.v_sil" },
  rest: { eye_nagomi_1: 0.22 },
  expr: {
    smile: { eye_nagomi_1: 0.55 },
    joy: { eye_joy: 0.9 },
    gentle: { eye_nagomi_2: 0.7, brow_nagomi: 0.45 },
    sad: { brow_nagomi: 0.9, eye_nagomi_1: 0.5 },
    think: { eye_nagomi_1: 0.4, brow_nagomi: 0.25 },
    wink: { eye_close_L: 1, eye_nagomi_1: 0.4 },
  },
};

// ── 自产 Tripo 模型（我们自己雕的三个键）───────────────────────
export const TRIPO_FACE: FaceRecipe = {
  blink: ["blink"],
  visemes: { aa: "mouthOpen" },
  rest: { smile: 0.22, blink: 0.22 },
  expr: {
    smile: { smile: 0.5 },
    joy: { smile: 0.95 },
    gentle: { smile: 0.35 },
    sad: { smile: 0 },
    think: { smile: 0.15 },
  },
};

const norm = (s: string) => s.trim().toLowerCase();

/** 每帧把目标权重推给形键。一个角色一个实例，在模型加载完成后构造。 */
export class FaceDriver {
  /** 形键名（归一化）→ 所有拥有它的 (网格, 下标)。一次解析，之后只做数组写入 */
  private slots = new Map<string, Array<[THREE.Mesh, number]>>();
  private cur = new Map<string, number>();
  private expr: Expression = "neutral";
  /** 眨眼调度：next=下次闭眼的时刻，double=这次要不要连眨两下 */
  private blinkAt = { next: 1.5, phase: 0, double: false };
  private viseme: Viseme = "sil";
  private visemeAt = 0;

  constructor(root: THREE.Object3D, private recipe: FaceRecipe) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      // 描边反壳是复制出来的壳，没有 morph 也不该被写
      if (!m.isMesh || !m.morphTargetDictionary || m.userData.__isOutline) return;
      for (const [name, idx] of Object.entries(m.morphTargetDictionary)) {
        const k = norm(name);
        const arr = this.slots.get(k);
        if (arr) arr.push([m, idx]);
        else this.slots.set(k, [[m, idx]]);
      }
    });
  }

  /** 这个模型到底认识几个形键（0 = 没有表情能力，调用方可据此跳过） */
  get size(): number {
    return this.slots.size;
  }

  /** 配方点名了但模型里没有的形键。低画质档会裁掉用不上的形键（见 design/make-lod.mjs），
   *  裁多了的表现是"某个表情悄悄没效果"——不报错、不崩，只是脸不动。这个自查把它
   *  变成 DEV 控制台里一条明确的告警。 */
  missingKeys(): string[] {
    const want = new Set<string>(this.recipe.blink);
    for (const n of Object.values(this.recipe.visemes)) if (n) want.add(n);
    for (const m of Object.values(this.recipe.expr)) for (const k of Object.keys(m)) want.add(k);
    for (const k of Object.keys(this.recipe.rest ?? {})) want.add(k);
    return [...want].filter((k) => !this.slots.has(norm(k)));
  }

  setExpression(e: Expression) {
    this.expr = e;
  }

  /** 配方里没给这个表情时退回 neutral——宁可没表情，也不要拿别的键硬凑出怪脸 */
  private weightsFor(e: Expression): Record<string, number> {
    return { ...(this.recipe.rest ?? {}), ...(this.recipe.expr[e] ?? {}) };
  }

  /**
   * @param dt 帧间隔（秒）
   * @param t  连续时间（秒），眨眼/口型的相位源
   * @param speaking 正在说话 → 走 viseme 口型；否则闭嘴
   */
  update(dt: number, t: number, speaking: boolean) {
    const want = this.weightsFor(this.expr);
    // 表情切换要有过渡：瞬切在特写下像跳帧。0.18s 左右到位
    const k = Math.min(1, dt * 5.5);
    for (const name of new Set([...Object.keys(want), ...this.cur.keys()])) {
      const to = want[name] ?? 0;
      const from = this.cur.get(name) ?? 0;
      const v = from + (to - from) * k;
      // 收敛到 0 就从表里删掉，免得每帧遍历一堆早已归零的键
      if (Math.abs(v) < 1e-3 && to === 0) this.cur.delete(name);
      else this.cur.set(name, v);
    }

    // ── 眨眼：伪随机间隔 + 偶发双眨（按次数哈希，确定性可复现）──
    const bp = this.blinkAt;
    let blink = 0;
    if (t >= bp.next) {
      const ph = t - bp.next;
      if (ph < 0.28) blink = Math.sin((ph / 0.28) * Math.PI);
      else if (bp.double) {
        bp.double = false;
        bp.next = t + 0.25;
      } else {
        bp.phase++;
        const h = Math.abs(Math.sin(bp.phase * 12.9898) * 43758.5453) % 1;
        bp.next = t + 2.2 + h * 3.6;
        bp.double = h > 0.78;
      }
    }

    // ── 口型：说话时按伪随机序列切元音 ──
    // 老实现是 mouthOpen 走一条 sin，观感是机械地开合。真实说话是元音在变，
    // 换 viseme 才有"在说话"的感觉；没有音素流所以用确定性哈希造节奏。
    const VOWELS: Viseme[] = ["aa", "ih", "ou", "e", "oh"];
    if (speaking) {
      if (t >= this.visemeAt) {
        const h = Math.abs(Math.sin(t * 78.233) * 43758.5453) % 1;
        this.viseme = VOWELS[Math.floor(h * VOWELS.length)];
        this.visemeAt = t + 0.075 + h * 0.075; // 75~150ms 一个音
      }
    } else {
      this.viseme = "sil";
    }

    this.flush(blink, speaking);
  }

  private flush(blink: number, speaking: boolean) {
    // 先按表情权重写，再叠眨眼与口型——这两者是"盖在表情之上"的瞬时动作
    for (const [name, v] of this.cur) this.write(name, v);

    for (const b of this.recipe.blink) {
      // 取 max 而不是覆盖：eye_joy 这种本身就闭眼的表情，眨眼不该把它拉回睁眼
      const base = this.cur.get(b) ?? this.recipe.rest?.[b] ?? 0;
      this.write(b, Math.max(base, blink));
    }

    for (const [v, name] of Object.entries(this.recipe.visemes)) {
      if (!name) continue;
      const on = speaking ? (v === this.viseme ? 0.75 : 0) : v === "sil" ? 0 : 0;
      // 口型也要平滑：直接跳变会让嘴每 100ms 硬切一次形状
      const key = " vis:" + v; // 前缀避免与表情键重名
      const from = this.cur.get(key) ?? 0;
      const nv = from + (on - from) * 0.35;
      if (nv < 1e-3 && on === 0) this.cur.delete(key);
      else this.cur.set(key, nv);
      this.write(name, nv);
    }
  }

  private write(name: string, v: number) {
    const slots = this.slots.get(norm(name));
    if (!slots) return;
    for (const [mesh, idx] of slots) mesh.morphTargetInfluences![idx] = v;
  }
}

/** 场景状态 → 表情。两个角色共用这条映射的"情绪"部分，各自补自己的状态位。 */
export function moodExpression(mood: number, active: boolean): Expression | null {
  if (!active) return null;
  if (mood > 0.55) return "joy";
  if (mood > 0) return "smile";
  if (mood < -0.3) return "sad";
  return null;
}
