// â˜…â˜… çª—æ™¯çš„**ä¸¤å¥—è£…æ‰®**ï¼ˆ2026-11-27ï¼Œ`feat/gs-window-daynight`ï¼‰ï¼š
//   Â· night = **å¤œé—´æœˆï¼ˆè–„æ¶‚ï¼‰** `window-moon.webp` / `window-moon.spz`ï¼ˆout-2ï¼‰
//   Â· day   = **æ˜Žäº®æµ·å¤©ï¼ˆåŽšæ¶‚ï¼‰** `window-sea.webp` / `window-sea.spz`ï¼ˆout-3ï¼‰
//   ä¸¤å¥—æŒ‰**è®¾å¤‡æœ¬åœ°æ—¶é—´**è‡ªåŠ¨åˆ‡ï¼ˆåˆ¤å®šåªåœ¨ `windowSkin.ts` ä¸€å¤„ï¼‰ï¼Œåˆ‡æ¢ 0.8 s äº¤å‰æ·¡å…¥ã€‚
//
// è¿™ä¸ªæ–‡ä»¶è´Ÿè´£"çª—é‡Œè¯¥æ˜¯ä»€ä¹ˆæ ·"ï¼Œ**çª—æ¡† / å†…äº®è¾¹ / åå­—æ£‚ / åœ†é’‰ / é“†é’‰ä¸€å¾‹ä¸åŠ¨**ï¼š
//   é‚£äº›å‡ ä½•è¿˜åœ¨ `MoonWindow.tsx` é‡Œï¼ˆä¸€ä¸ªå­—æ²¡æ”¹ï¼‰ï¼Œå®ƒåªæŠŠè¿™ä¸€å±‚æŒ‚è¿›åŽ»ã€‚
//
// â˜… å››å±‚ï¼ŒæŒ‰ renderOrder æŽ’é˜Ÿï¼ˆæˆ¿é—´ splat æ˜¯ 10ï¼Œçª—æ¡†æ˜¯ 22/23 â€”â€” è§ MoonWindow æ–‡ä»¶å¤´ï¼‰ï¼š
//   18  å¤œé‡Œçš„çª—æ´žç”»é¢ï¼ˆå¹³è´´å›¾ï¼‰
//   19  ç™½å¤©çš„çª—æ´žç”»é¢ï¼ˆå¹³è´´å›¾ï¼‰â€”â€” ä»»åŠ¡ä¹¦è¦æ±‚çš„"åŒä¸€ä¸ª renderOrder 19"ï¼Œè§ä¸‹é¢ PAINT_ORDER çš„æ³¨é‡Š
//   20  å¢™é¢äº®æ™•ï¼ˆ**åªåœ¨ç™½å¤©**ï¼ŒåŠ è‰²ï¼›splat ä¸åƒç¯ï¼Œæ‰€ä»¥åªèƒ½æ˜¯å‡æ™•ï¼‰
//   21  æœˆäº®ç›˜ï¼ˆç¨‹åºåŒ–çš„é‚£ä¸€æžšï¼šåªåœ¨ç©¿çª—ä¹‹åŽæ‰çœ‹å¾—è§ï¼Œå¤œé‡Œç”¨ï¼‰
//   11  çª—æ™¯ splatï¼ˆè‹¥ ml-sharp çš„ spz åœ¨ï¼‰â€”â€” ç´§è´´çª—æ´žï¼Œå¹³è´´å›¾ç•™åœ¨å®ƒä¸‹é¢å…œåº•
//
// â˜… äº¤å‰æ·¡å…¥æ€Žä¹ˆåšåˆ°"ä¸çž¬åˆ‡"ï¼š
//   å¹³è´´å›¾è¿™ä¸€å±‚æ˜¯**ä¸¤å¼ åœ†å½¢å¹³é¢å ç€ç”»**ï¼Œ`å¤œ = ä¸é€æ˜Žåº•è‰²`ã€`æ˜¼ = æŒ‰æƒé‡æ·¡å…¥çš„ç™½çº¸`ï¼š
//   ä¸¤å±‚éƒ½æ˜¯æ™®é€šæ··åˆã€å…ˆåŽæœ‰ renderOrder å®šæ­» â‡’ å±å¹•ä¸Šå°±æ˜¯ `(1âˆ’t)Â·å¤œ + tÂ·æ˜¼`ï¼Œ
//   ä¸éœ€è¦ç»™è´´å›¾åš alpha é€šé“ã€ä¹Ÿä¸éœ€è¦åœ¨ä¸­é—´å¸§é‡å»ºæè´¨ã€‚
//   splat è¿™ä¸€å±‚ç”¨ `SplatMesh.opacity`ï¼ˆSpark çš„å…¨å±€ alpha ä¹˜æ•°ï¼‰è·ŸåŒä¸€ä¸ªæƒé‡ã€‚
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WINDOW, moonDisc, skyDome } from "./moonGeometry";
import { WINSKIN_GLOW, WINSKIN_LIGHT } from "./windowSkin";
import { FLY_U } from "./flyTimeline";
import { useMatchCam } from "./matchCam";

const WindowSplat = lazy(() => import("./WindowSplat"));
/** ç‚¹äº‘å»Šï¼ˆåŒä¸€ä»½çª—æ™¯ splat å¤åˆ¶ N å±‚ï¼›è§ flyCorridor.tsï¼‰ã€‚ä¹Ÿæ˜¯æ‡’åŠ è½½ï¼šå®ƒ import sparkã€‚ */
const FlyCloud = lazy(() => import("./FlyCloud"));
/** ç©¿è¡Œå°½å¤´é‚£å¼ èƒŒæ™¯ï¼ˆå¤œ=æœˆäº® / æ˜¼=äº‘æµ·ï¼‰ã€‚ä¸ import spark â‡’ é™æ€æŒ‚ï¼ˆè´´å›¾ 90 KBã€ä¸€ä¸ª meshï¼‰ã€‚ */
import BackdropPlane from "./BackdropPlane";

/** ä¸¤å¥—çª—æ™¯çš„è´´å›¾ï¼ˆ1024Â² webpï¼Œå„ ~100 KBï¼›æºå›¾çª—æ´žåªæœ‰ 678Â²ï¼Œå†å¤§æ²¡æœ‰ä¿¡æ¯ï¼‰ */
export const WINDOW_TEX = {
  night: "/models/study/tex/window-moon.webp",
  day: "/models/study/tex/window-sea.webp",
} as const;

/** ä¸¤å¥—çª—æ™¯çš„ 3D ç‰ˆï¼ˆml-sharp äº§å‡ºï¼Œ12 ä¸‡ç‚¹ / å•å¼  ~1.3 MBï¼‰ã€‚
 *  â˜… 2026-11-27ï¼ˆ`feat/gs-scene-split`ï¼‰ï¼šè¿™ä¸¤ä»½ spz ä¸Žä¸¤å¼  webp çŽ°åœ¨**éƒ½è¿›ä»“åº“ã€éƒ½è¿› APK**
 *    ï¼ˆ`.gitignore` åªæŽ’é™¤æˆ¿é—´é‡Œé‚£å‡ ä»½å¤§ spzï¼‰ï¼›å®ƒä»¬åªåœ¨å¤§åŽ…/åŒ¹é…é¡µé‚£ä¸€å¥—é‡ŒæŒ‚ï¼Œ
 *    è¿›æˆ¿é—´åŽçª—æ´žåªç”¨å¹³è´´å›¾ï¼ˆ`MoonWindow splat={false}`ï¼‰ã€‚
 *  â˜… æ–‡ä»¶ä»ç„¶å¯èƒ½ä¸åœ¨ï¼ˆè€åŒ… / è¢«è£è¿‡ï¼‰ï¼š`initialized` çš„ reject ç”± `onState("failed")` æŽ¥ä½ï¼Œ
 *    é‚£ä¸€æ¡£è‡ªåŠ¨å›žé€€åˆ°ä¸Šé¢é‚£ä¸¤å¼ å¹³è´´å›¾ï¼Œä¸æŠ›é”™ã€‚ */
export const WINDOW_SPZ = {
  night: "/models/study/gs/window-moon-full.spz",
  day: "/models/study/gs/window-sea-full.spz",
} as const;

/** å¹³è´´å›¾æè´¨ + "åŒ–ç‚¹"æ³¨å…¥ï¼ˆ2026-11-27ï¼Œ`feat/gs-flythrough-dissolve`ï¼‰ã€‚
 *
 *  ä¸»äººè¦çš„ 0~0.6 sï¼š**å…ˆçœ‹è§é‚£å¼ å¹³è´´å›¾ï¼Œç„¶åŽå®ƒæ¸è¿›åœ°æ•£æˆé«˜æ–¯ç‚¹** â€”â€” è´´å›¾è¿™ä¸€åŠçš„"é€€åœº"ä¸æ˜¯
 *  æ•´å±‚æ·¡å‡ºï¼ˆé‚£æ ·åªä¼šå æˆä¸€å›¢ï¼‰ï¼Œè€Œæ˜¯**é€å—æ¶ˆå¤±**ï¼šæ¯ä¸ªåƒç´ æŒ‰ä¸¤çº§ç½‘ç‚¹ hash å®šä¸€ä¸ªéšæœºé˜ˆå€¼ï¼Œ
 *  `uFlyDissolve` æŽ¨è¿‡åŽ»æ—¶å…ˆæŽ‰å¤§å—ã€å†æŽ‰ç¢Žç‚¹ã€‚çª—æ™¯ splat çš„æ¯ç‚¹ stagger ç”¨åŒä¸€æ¡è¿›åº¦
 *  ï¼ˆWindowSplat çš„ objectModifierï¼‰ï¼Œä¸¤è¾¹åŒä¸€æ‹ â‡’ è¯»èµ·æ¥æ˜¯"å›¾åƒè‡ªå·±æ•£æˆç‚¹"ã€‚
 *
 *  â˜… ä¸é£žçš„æ—¶å€™ `uFlyDissolve = 0`ï¼š`smoothstep(-0.04, 0.04, h)` å¯¹ä»»ä½• h âˆˆ [0,1) éƒ½ â‰¥ 0.5â€¦â€¦
 *    ä¸å¯¹ï¼Œè§ä¸‹ï¼šé˜ˆå€¼ç”¨ `step(uFlyDissolve, h)` çš„è½¯åŒ–ç‰ˆï¼ŒuFlyDissolve=0 æ—¶ hâ‰¥0 æ’çœŸ â‡’ alpha ä¹˜ 1ã€‚
 *  â˜… æ³¨å…¥èµ° `onBeforeCompile`ï¼ˆè€Œä¸æ˜¯æ¢æˆ ShaderMaterialï¼‰ï¼šMeshBasicMaterial çš„é¢œè‰²ç©ºé—´ /
 *    toneMapped / sRGB é‡‡æ ·ç”± three è‡ªå·±ç®¡ï¼Œé‡å†™ä¸€ä¸ª ShaderMaterial å¾ˆå®¹æ˜“æŠŠé¢œè‰²æžåã€‚ */
function makePaintMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFlyDissolve = FLY_U.dissolve;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uFlyDissolve;")
      .replace(
        "#include <map_fragment>",
        // ä¸¤çº§ç½‘ç‚¹ï¼šå¤§å—å…ˆæŽ‰ï¼ˆ120 æ ¼ï¼‰ã€ç¢Žç‚¹åŽæŽ‰ï¼ˆ260 æ ¼ï¼‰ï¼Œæ··ä¸€åŠ â€”â€” åªä¸€çº§ä¼šè¯»æˆ"è§„åˆ™ç½‘æ ¼"ã€‚
        // uFlyDissolve=0 æ—¶ smoothstep å¯¹ä»»ä½• hâˆˆ[0,1) éƒ½è¿”å›ž â‰¥0.5â€¦â€¦ ä¸å¯¹ï¼Œæ˜¯ â‰¥1 çš„ä¸‹ç•Œï¼š
        // uFlyDissolve=0 â‡’ é˜ˆå€¼åŒºé—´ [-0.06,0.02]ï¼Œhâ‰¥0.02 æ—¶æ’ 1ã€hâˆˆ[0,0.02) æœ‰ä¸€æ®µè½¯è¾¹
        // ï¼ˆåˆ»æ„ç•™çš„ï¼šdissolve åˆšèµ·æ­¥æ—¶ä¸è¦"å•ª"åœ°æŽ‰ä¸€æ•´ç‰‡ï¼Œç¬¬ä¸€å¸§å‡ ä¹Žé€åƒç´ ä¸å˜ï¼‰ã€‚
        `#include <map_fragment>
        {
          // Two octaves of cell hash: big cells go first, fine cells later.
          // 2026-11-27 on-device: coarse cells (14/38 across the window) -- with fine cells the
          // holes were filled by the same picture's splat and the dissolve read as invisible.
          float hA = fract(sin(dot(floor(vMapUv * 14.0), vec2(12.9898, 78.233))) * 43758.5453);
          float hB = fract(sin(dot(floor(vMapUv * 38.0), vec2(39.346, 11.135))) * 24634.6345);
          float h = mix(hA, hB, 0.32);
          // uFlyDissolve=0 keeps alpha at 1 (only a hair-thin edge at h<0.02); =1 removes everything.
          diffuseColor.a *= smoothstep(uFlyDissolve - 0.06, uFlyDissolve + 0.02, h);
        }`,
      );
  };
  // æ³¨å…¥æ”¹äº†æºç ï¼šç»™ç‹¬ç«‹ç¼“å­˜é”®ï¼Œé¿å…ä¸Žåˆ«çš„ MeshBasicMaterial å…±äº« program
  mat.customProgramCacheKey = () => "gs-fly-paint-dissolve";
  return mat;
}

/** çª—æ´žç”»é¢çš„ renderOrderã€‚ä»»åŠ¡ä¹¦è¯´"åŒä¸€ä¸ª renderOrder 19"ï¼Œä½†**ä¸¤å¼ å¹³é¢è¦å®šå…ˆåŽ**æ‰æ·¡å¾—å‡ºæ¥ï¼Œ
 *  æ‰€ä»¥å¤œ 18 / æ˜¼ 19ï¼šæ²¡æœ‰å…ˆåŽçš„è¯ï¼ŒåŒ renderOrder çš„ä¸¤å—é€æ˜Žé¢æŒ‰å¯¹è±¡åˆ›å»ºé¡ºåºç”»ï¼Œ
 *  ç¬¬ä¸€æ¬¡åˆ‡æ¢ä¹‹åŽé¡ºåºå°±å›ºåŒ–äº†ï¼Œåå‘æ·¡å…¥ä¼šå˜æˆ"æ˜¼é‚£å¼ æ°¸è¿œåœ¨ä¸Š"ã€‚19 ç»™ç™½å¤©é‚£ä¸€å¼ æ˜¯ç…§ä»»åŠ¡ä¹¦çš„æ•°ã€‚ */
const PAINT_ORDER = { night: 18, day: 19 } as const;
/** å¢™é¢äº®æ™•æŽ’åœ¨å¹³è´´å›¾ä¹‹åŽã€çª—æ¡†ï¼ˆ22ï¼‰ä¹‹å‰ â€”â€” äº®æ™•åŽ‹åœ¨å¢™ä¸Šï¼Œä½†ç»ä¸èƒ½ç›–ä½çª—æ¡† */
const GLOW_ORDER = 20;

// â”€â”€ çª—æ´žè£å‰ªçš„ GLSLï¼ˆå¤œç©º / æœˆäº®å…±ç”¨ï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â˜… åˆ¤æ®ç”¨**ç‰‡å…ƒä¸–ç•Œä½ç½®**åæŽ¨è§†çº¿æ–¹å‘ï¼ˆ`cameraPosition` æ˜¯ three ç»™ ShaderMaterial çš„å†…å»º uniformï¼‰ï¼Œ
//   ä¸éœ€è¦æ¯å¸§ä»Ž JS ä¼ ç›¸æœºè¿›æ¥ã€‚
// â˜… ä¸‰ä¸ªçª—æ´ž uniform åªåœ¨è¿™é‡Œå£°æ˜Žä¸€æ¬¡ â€”â€” ä¸¤ä¸ªç‰‡å…ƒç€è‰²å™¨éƒ½ include è¿™æ®µï¼Œé‡å¤å£°æ˜Ž GLSL ç›´æŽ¥æŠ¥
//   redefinitionï¼ˆ2026-11-27 è¸©è¿‡ï¼šå±å¹•ä¸Šè¡¨çŽ°ä¸º"æœˆäº®/å¤œç©ºæ•´å—ä¸ç”»ã€æŽ§åˆ¶å°æ»¡å± program not valid"ï¼‰ã€‚
// i18n-ignore-next-line: GLSL æºç ï¼ˆç‰‡å…ƒç€è‰²å™¨æ³¨é‡Šï¼Œä¸æ˜¯ç•Œé¢æ–‡æ¡ˆï¼‰
const PORTAL_GLSL = /* glsl */ `
uniform vec3 uWinC;
uniform vec3 uWinN;
uniform float uWinR;

// true = è¿™ä¸ªæ–¹å‘ä¸ç©¿è¿‡çª—æ´žï¼ˆç›¸æœºåœ¨å®¤å†…æ—¶è¦ discardï¼‰
bool outsidePortal(vec3 dir) {
  if (dot(cameraPosition - uWinC, uWinN) <= 0.0) return false; // å·²ç»ç©¿å‡ºåŽ»äº†ï¼šæ»¡å¤©éƒ½æ˜¯å¤©
  float den = dot(dir, uWinN);
  if (abs(den) < 1e-4) return true;
  float t = dot(uWinC - cameraPosition, uWinN) / den;
  if (t <= 0.0) return true;
  vec3 hit = cameraPosition + dir * t;
  return distance(hit, uWinC) > uWinR;
}
`;

const NOISE_GLSL = /* glsl */ `
float mwHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float mwNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mwHash(i);
  float b = mwHash(i + vec2(1.0, 0.0));
  float c = mwHash(i + vec2(0.0, 1.0));
  float d = mwHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** å¤œç©ºï¼šæ·±è“ç´«çš„æ¸å˜ + åœ°å¹³çº¿ä¸€å±‚å†·å…‰ + ç¨€ç–æ˜Ÿ + ä¸¤æ¡å¾ˆæ·¡çš„äº‘å¸¦ï¼ˆ**å¤œé‡Œçš„æ ·å­ï¼Œä¸€ä¸ªå­—æ²¡æ”¹**ï¼‰ã€‚
 *
 *  â˜… 2026-11-27ï¼ˆ`feat/gs-window-daynight`ï¼‰å¤šäº† `uSkin`ï¼ˆ0 = å¤œã€1 = æ˜¼ï¼‰ï¼š
 *    è¿™ä¸€å±‚åªåœ¨"ç›¸æœºç©¿å‡ºçª—æ´žä¹‹åŽ"æ‰çœ‹å¾—è§ï¼ˆå®¤å†…æ—¶çª—æ´žè¢«å¹³è´´å›¾/splat ç›–ä½ï¼‰ï¼Œä¹Ÿå°±æ˜¯**ç©¿çª—è½¬åœº**é‚£ 1.5 sã€‚
 *    ç™½å¤©è¿™ä¸€æ¡£å¦‚æžœè¿˜çœ‹è§ä¸€å±æœˆå¤œï¼Œ"æ˜Žäº®æµ·å¤©"å°±å‰åŽä¸æ­ â€”â€” æ‰€ä»¥åœ¨ç‰‡å…ƒæœ€åŽæŠŠé¢œè‰²æ•´ä½“ mix åˆ°ä¸€ç‰‡
 *    æ˜Žäº®çš„å¤©é’ï¼ˆä¸é‡å†™æ˜Ÿæ˜Ÿ/äº‘ï¼Œ`uSkin=0` æ—¶é€åƒç´ ä¸ŽåŽŸæ¥**é€å­—èŠ‚ç›¸åŒ**ï¼‰ã€‚ */
// i18n-ignore-next-line: GLSL æºç ï¼ˆç‰‡å…ƒç€è‰²å™¨æ³¨é‡Šï¼Œä¸æ˜¯ç•Œé¢æ–‡æ¡ˆï¼‰
const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uMoonC;
uniform float uMoonR;
uniform float uSkin;
uniform float uPaintSplat;
uniform float uFlyFade;
${PORTAL_GLSL}
${NOISE_GLSL}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;
  // â˜…â˜… 2026-11-27 ç¬¬å››ä¸ªå‘ï¼š**çª—æ™¯ splat æ°¸è¿œç”»åœ¨è¿™å±‚å¤œç©ºä¹‹å‰**ã€‚
  //   Spark æŠŠåœºæ™¯é‡Œæ‰€æœ‰ SplatMesh æ”¶è¿›åŒä¸€ä¸ª passï¼Œé‚£ä¸ª pass çš„ renderOrder æ˜¯ 0ï¼ˆæˆ¿é—´é‚£ä»½ï¼‰ï¼Œ
  //   è€Œè¿™å—å¤œç©ºçƒæ˜¯ meshï¼ˆ12ï¼‰â€”â€” mesh çš„é€æ˜Žé˜Ÿåˆ—æŽ’åœ¨ pass ä¹‹åŽï¼ŒäºŽæ˜¯å¤œç©ºæŠŠ splat æ•´å—ç›–æŽ‰ï¼š
  //   æˆªå›¾ä¸Šçª—æ´žé‡Œåªæœ‰"å¤œç©º + æœˆäº®æš—çŽ¯"ï¼Œsplat æ˜Žæ˜Žåœ¨ç”»ï¼ˆtris 524kï¼‰å´ä¸€ä¸ªåƒç´ éƒ½çœ‹ä¸è§ã€‚
  //   SplatMesh è‡ªå·±çš„ renderOrder æ”¹å¤šå°‘éƒ½æ²¡ç”¨ï¼ˆæŽ’åºåœ¨ pass å†…éƒ¨ï¼‰ã€‚æ‰€ä»¥ï¼šsplat åœ¨çš„æ—¶å€™ï¼Œ
  //   ç›¸æœºåœ¨å®¤å†…å°±**ä¸ç”»å¤œç©º**ï¼ˆçª—æ´žè¢« splat é“ºæ»¡ï¼Œä¸éœ€è¦çº¸åº•ï¼‰ã€‚ç©¿å‡ºçª—é¢ä¹‹åŽç…§ç”»ï¼ˆæ»¡å¤©éƒ½æ˜¯å¤©ï¼‰ã€‚
  if (uPaintSplat > 0.5 && dot(cameraPosition - uWinC, uWinN) > 0.0) discard;

  float up = clamp(dir.y, -1.0, 1.0);
  float h = smoothstep(-0.06, 0.8, up);
  vec3 col = mix(vec3(0.034, 0.048, 0.085), vec3(0.006, 0.009, 0.024), h);
  // åœ°å¹³çº¿é™„è¿‘ä¸€å±‚å¾ˆæ·¡çš„å†·å…‰ï¼ˆæœˆå…‰æŠŠä½Žç©ºç…§äº®ä¸€ç‚¹ç‚¹ï¼‰
  col += vec3(0.030, 0.045, 0.085) * pow(clamp(1.0 - abs(up), 0.0, 1.0), 5.0);
  // æ˜Ÿï¼šåªåœ¨ä½Žç©ºä»¥ä¸Šï¼Œç¨€ç–ã€æœ‰æ˜Žæš—
  vec2 sp = dir.xz / max(0.22, up + 0.6) * 7.0;
  vec2 cell = floor(sp * 26.0);
  float star = mwHash(cell + 3.7);
  float twinkle = 0.45 + 0.55 * mwHash(cell + 11.3);
  col += vec3(0.62, 0.72, 1.0) * step(0.9965, star) * twinkle * smoothstep(0.0, 0.4, up);
  // å¾®å¼±äº‘ï¼šä¸¤æ¡ä½Žé¢‘å™ªå£°å¸¦ï¼ŒåŽ‹åœ¨ä½Žç©º
  float cl = mwNoise(vec2(atan(dir.z, dir.x) * 2.2, up * 4.5)) * 0.65
           + mwNoise(vec2(atan(dir.z, dir.x) * 5.0 + 7.0, up * 9.0)) * 0.35;
  cl = smoothstep(0.48, 0.86, cl) * smoothstep(-0.02, 0.3, up) * 0.30;
  col = mix(col, vec3(0.085, 0.11, 0.17), cl);

  // æœˆç›˜å¤–é‚£åœˆæš—åŒºï¼šæœˆç›˜è¾¹ç¼˜åŽ‹åˆ°å¤œç©ºçš„ 12%ï¼Œå‘å¤– 9% å¾„å‘å›žåˆ°å¤œè“
  vec3 toMoon = uMoonC - cameraPosition;
  float moonDist = max(length(toMoon), 1e-3);
  float moonAng = atan(uMoonR / moonDist);
  float ang = acos(clamp(dot(dir, toMoon / moonDist), -1.0, 1.0));
  col *= mix(0.12, 1.0, smoothstep(moonAng, moonAng * 1.09, ang));

  // ç™½å¤©ï¼ˆuSkin=1ï¼‰ï¼šæ¢æˆ"çª—å¤–çš„æµ·å¤©"â€”â€” åœ°å¹³çº¿æš–ç™½ã€å¤©é¡¶å¤©é’ã€‚çº¿æ€§ç©ºé—´ï¼ŒACES ä¹‹åŽå¤§çº¦æ˜¯å¤©è“ã€‚
  vec3 dayCol = mix(vec3(0.52, 0.66, 0.74), vec3(0.10, 0.26, 0.62), h);
  dayCol += vec3(0.30, 0.22, 0.12) * pow(clamp(1.0 - abs(up), 0.0, 1.0), 4.0);
  col = mix(col, dayCol, clamp(uSkin, 0.0, 1.0));

  // â˜… 2026-11-27ï¼ˆfeat/gs-flythrough-dissolveï¼‰ï¼šç©¿çª—è½¬åœºé‡Œ"é‚£å¼ ç”»"è¦è·Ÿç€åŒ–ç‚¹ä¸€èµ·æ•£æŽ‰ â€”â€”
  //   å¤œç©º / æœˆäº® / å¢™ä¸Šçš„æ™•éƒ½ä¹˜è¿™ä¸€ä½ï¼ˆ1 = åŽŸæ ·ï¼Œ0 = å…¨é»‘ï¼‰ã€‚ä¸é£žæ—¶æ’ 1ï¼Œé€åƒç´ ä¸å˜ã€‚
  //   â˜… è¿™é‡Œç”¨ **alpha**ï¼ˆä¸æ˜¯æŠŠé¢œè‰²ä¹˜æˆé»‘ï¼‰ï¼šå¤œç©ºçƒæ˜¯ç›–åœ¨ splat ä¹‹åŽç”»çš„æ•´å±é¢ï¼Œé¢œè‰²ä¹˜ 0
  //     ä¼šæŠŠç‚¹äº‘å»Š**æ•´å—ç›–æˆé»‘å±**ï¼ˆç¬¬ä¸€ç‰ˆå°±æ˜¯è¿™æ ·ï¼Œæˆªå›¾é‡Œçº¯é»‘ï¼‰ã€‚alpha é™ä¸‹åŽ»æ‰æ˜¯"é€è¿‡åŽ»"ã€‚
  gl_FragColor = vec4(col, uFlyFade);
}
`;

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** æœˆäº®ï¼šç¡¬è¾¹äº®ç›˜ + æœˆæµ· + çŽ¯å½¢å±± + ä¸´è¾¹æ˜æš— + 1~2 px äº®è¾¹ + å¾ˆè–„çš„è¾‰å…‰ï¼ˆ**å¤œé‡Œé‚£æžšï¼Œæ²¡æ”¹**ï¼‰ã€‚
 *  â˜… åŠ è‰²æ··åˆï¼šåº•è‰²æ˜¯å¤œç©ºï¼Œæœˆäº®æœ¬èº«å°±æ˜¯å…‰æºã€‚
 *  â˜… 2026-11-27 å¤šäº† `uSkin`ï¼šç™½å¤©è¿™ä¸€æ¡£æŠŠè¿™æžšæœˆäº®æ•´ä½“ä¹˜åˆ° 0ï¼ˆåŠ è‰²æ··åˆä¸‹ä¹˜ 0 = ä¸ç”»ï¼‰ï¼Œ
 *    çª—æ´žé‡Œç»™çŽ©å®¶çœ‹çš„æ˜¯é‚£å¼ åŽšæ¶‚æµ·å¤©ã€‚`uSkin=0` æ—¶ä¸ŽåŽŸå®žçŽ°**é€å­—èŠ‚ç›¸åŒ**ã€‚ */
// i18n-ignore-next-line: GLSL æºç ï¼ˆç‰‡å…ƒç€è‰²å™¨æ³¨é‡Šï¼Œä¸æ˜¯ç•Œé¢æ–‡æ¡ˆï¼‰
const MOON_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float uHalo;
uniform float uSkin;
uniform float uPaint;
uniform float uFlyFade;
${PORTAL_GLSL}
${NOISE_GLSL}

// åœ†å½¢çŽ¯å½¢å±±ï¼šè¿”å›ž (æš—å‘, äº®çŽ¯)ï¼Œéƒ½æ˜¯ 0..1ã€‚ä½ç½®å›ºå®š â€”â€” æ¯æ¬¡é è¿‘éƒ½æ¢å‘ä½å°±æˆäº†è´´çº¸ã€‚
vec2 mwCrater(vec2 p, vec2 c, float rad) {
  float d = length(p - c) / rad;
  float pit = 1.0 - smoothstep(0.0, 0.90, d);
  float rim = smoothstep(0.72, 0.93, d) * (1.0 - smoothstep(0.93, 1.20, d));
  return vec2(pit, rim);
}

// ä¸€å±‚å°å‘ï¼ˆåªæ˜¯æœˆé¢çš„éº»ç‚¹ï¼Œä¸è¯¥æŠ¢ä¸‰åº§å¤§å‘çš„æˆï¼‰
float mwSmallCraters(vec2 q) {
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = mwHash(cell);
  if (h < 0.70) return 0.0;
  float rad = 0.14 + 0.18 * mwHash(cell + 4.0);
  float d = length(f) / rad;
  return (1.0 - smoothstep(0.35, 1.0, d)) * 0.28;
}

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  if (outsidePortal(dir)) discard;
  // â˜… 2026-11-27ï¼ˆæ‹†å‡ºåŽ»ä¹‹åŽçš„ç¬¬ä¸€ä¸ªå‘ï¼‰ï¼šçª—æ´žé‡Œå·²ç»æœ‰"é‚£å¹…ç”»"ï¼ˆå¹³è´´å›¾ / splatï¼‰æ—¶ï¼Œ
  //   è¿™æžšç¨‹åºåŒ–æœˆäº®**åªåœ¨ç›¸æœºç©¿å‡ºçª—é¢ä¹‹åŽ**æ‰ç”»ã€‚ä¹‹å‰ä¸åˆ†é‡Œå¤–ä¸€å¾‹åŠ è‰² â‡’ å®¤å†…çœ‹åˆ°çš„
  //   æ˜¯"ç”» + ä¸€æžšå‘äº®çš„å¤§æœˆäº®å åœ¨ä¸€èµ·"ï¼Œæœˆäº®é‚£åœˆäº®æŠŠåŽšæ¶‚çš„ç¬”è§¦æ•´ä¸ªæ´—æŽ‰äº†ï¼ˆç¬¬ä¸€ç‰ˆæˆªå›¾å¦‚æ­¤ï¼‰ã€‚
  //   æœˆç›˜æ˜¯åŠ è‰²æ··åˆã€å¹³è´´å›¾æ˜¯ä¸é€æ˜Žåº•è‰²ï¼Œä¸¤è€…å ç€ç”»ä¸ä¼šæœ‰é®æŒ¡å…³ç³»ï¼ˆéƒ½ä¸å†™æ·±åº¦ï¼‰ï¼Œåªèƒ½è¿™æ ·åˆ¤é‡Œå¤–ã€‚
  //   uPaint=0ï¼ˆè´´å›¾æ²¡åŠ è½½æˆåŠŸï¼‰æ—¶é€€å›žåŽŸæ¥çš„è¡Œä¸ºï¼šå®¤å†…ç…§æ ·èƒ½çœ‹è§ä¸€è½®æœˆäº®ï¼Œçª—ä¸ä¼šå˜æˆé»‘æ´žã€‚
  if (uPaint > 0.5 && dot(cameraPosition - uWinC, uWinN) > 0.0) discard;

  vec2 p = (vUv - 0.5) * 2.0 * uHalo; // 1 = æœˆç›˜è¾¹
  float r = length(p);
  float disc = 1.0 - smoothstep(1.0 - 0.0045, 1.0 + 0.0045, r);

  float m = mwNoise(p * 1.7 + vec2(3.1, 7.7)) * 0.50
          + mwNoise(p * 3.4 + vec2(11.0, 2.0)) * 0.28
          + mwNoise(p * 6.8 + vec2(5.0, 9.0)) * 0.16
          + mwNoise(p * 12.0 + vec2(2.0, 4.0)) * 0.06;
  float mare = smoothstep(0.45, 0.55, m);
  vec3 highland = vec3(0.92, 0.95, 1.01);
  vec3 mareCol = vec3(0.39, 0.42, 0.53);
  vec3 albedo = mix(highland, mareCol, mare);
  albedo *= 0.96 + 0.08 * mwNoise(p * 8.5 + vec2(3.0, 6.0));
  albedo *= 0.93 + 0.14 * (mwNoise(p * 22.0) * 0.6 + mwNoise(p * 47.0 + 7.3) * 0.4);

  vec2 c1 = mwCrater(p, vec2(-0.36, 0.16), 0.22);
  vec2 c2 = mwCrater(p, vec2(0.32, -0.30), 0.14);
  vec2 c3 = mwCrater(p, vec2(0.10, 0.46), 0.10);
  float small = mwSmallCraters(p * 7.5) + mwSmallCraters(p * 15.0 + 11.0) * 0.6;
  float pit = max(max(c1.x, c2.x), max(c3.x, small * 0.5));
  float rim = max(max(c1.y, c2.y), c3.y * 0.7);
  float limb = 1.0 - 0.25 * smoothstep(0.30, 1.0, r);
  vec3 moonCol = albedo * (1.0 - 0.68 * pit) * limb;
  moonCol += vec3(0.70, 0.72, 0.68) * rim * 0.26;

  float edgeRim = exp(-pow((r - 1.006) / 0.010, 2.0)) * 0.55;
  float glow = r > 1.0 ? exp(-(r - 1.0) * 18.0) * 0.26 * (1.0 - smoothstep(1.02, 1.065, r)) : 0.0;
  vec3 col = moonCol * disc + vec3(0.88, 0.92, 1.0) * edgeRim + vec3(0.42, 0.55, 0.88) * glow;
  // uFlyFadeï¼šåŒ–ç‚¹é‚£ 0.6 s é‡Œ"é‚£å¼ ç”»"æ•´ä½“é€€æŽ‰ï¼ˆä¸é£žæ—¶æ’ 1ï¼‰
  gl_FragColor = vec4(col * (1.0 - clamp(uSkin, 0.0, 1.0)) * uFlyFade, 1.0);
}
`;

/** å¢™é¢äº®æ™•ï¼ˆ**åªæœ‰ç™½å¤©ç”»**ï¼‰ï¼šè´´çª—æ¡†å¤–ç¼˜çš„ä¸€åœˆåŠ è‰²ã€‚
 *  â˜… ä¸ºä»€ä¹ˆå¿…é¡»æ˜¯"å‡"æ™•ï¼šsplat æŠŠæ‰€æœ‰å—å…‰**çƒ˜æ­»**åœ¨ç‚¹äº‘é‡Œï¼ˆä¸‰ä¸ªæ–‡ä»¶éƒ½å†™è¿‡è¿™æ¡ï¼‰ï¼Œ
 *    åŠ ç¯åªä¼šè®© mesh æ›´äº®ã€ç‚¹äº‘çš„å¢™ä¸€ç‚¹ä¸åŠ¨ã€‚ç™½å¤©è¿™æ‰‡çª—è¦æŠŠå¢™ç…§å‡ºä¸€åœˆæš–å…‰ï¼Œåªå¯èƒ½æ˜¯ä¸€å¼ åŠ è‰²é¢ã€‚
 *  â˜… å½¢çŠ¶ï¼šå¸§å†…ä¸º 0ï¼ˆç»ä¸æ¶‚åˆ°çª—æ™¯ä¸Šï¼‰â†’ çª—æ¡†å¤–ç¼˜ 0.56 m èµ· â†’ 0.66 m å¤„æœ€äº® â†’ 1.00 m é™åˆ° 0
 *    ï¼ˆ= è´´ç€çª—æ¡†å¤–ä¾§ 0.42 mï¼Œè½åœ¨ä¸»äººç»™çš„ 0.4~0.6 m é‡Œï¼‰ã€‚å¹³æ–¹ä¸€æ¬¡è®©è¾¹ç¼˜æ›´æŸ”
 *    ï¼ˆä¸€æ¬¡æ–¹åœ¨æˆªå›¾ä¸Šèƒ½çœ‹å‡ºä¸€åœˆ"æ¸å˜å¼€å§‹"çš„ç¡¬çº¿ï¼‰ã€‚
 *  â˜… å³°å€¼æ”¾å¾—ç¦»çª—æ¡†è¿‘ï¼ˆ0.66 è€Œä¸æ˜¯ 0.85ï¼‰ï¼šç¬¬ä¸€ç‰ˆå³°å€¼åœ¨ 0.85 mï¼Œè¯»èµ·æ¥æ˜¯"å¢™ä¸ŠæŒ‚äº†ä¸€åœˆå…‰"ï¼Œ
 *    ä¸åƒå…‰ä»Žçª—é‡Œæº¢å‡ºæ¥ï¼›æ”¶è¿‘ä¹‹åŽçª—æ¡†è¾¹ç¼˜ä¸€äº®ã€å¾€å¤–æ¸éšï¼Œæ‰æ˜¯çª—å…‰ã€‚ */
const GLOW_VERT = /* glsl */ `
varying vec2 vXy;
void main() {
  vXy = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vXy;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFlyFade;
void main() {
  float r = length(vXy);
  float a = smoothstep(0.56, 0.66, r) * (1.0 - smoothstep(0.66, 1.00, r));
  a *= a;
  gl_FragColor = vec4(uColor * a * uIntensity * uFlyFade, 1.0);
}
`;

/** çª—æ´žå¤–é‚£åœˆ"çŸ³æ¡†æš—éƒ¨"çš„ shaderï¼ˆå¤œé‡Œçš„æ ·å­ï¼Œæ¬åˆ°è¿™å„¿åªæ˜¯ä¸ºäº†ä¸Žäº®æ™•å¹¶æŽ’çœ‹ï¼‰ã€‚
 *  å®ƒçš„ä¸é€æ˜Žåº¦ä¸Ž"ç™½å¤©äº®æ™•"åå‘ï¼šå¤œé‡Œ 1ã€ç™½å¤© 0ã€‚ */
const SURROUND_VERT = /* glsl */ `
varying vec2 vXy;
void main() {
  vXy = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SURROUND_FRAG = /* glsl */ `
varying vec2 vXy;
uniform float uInner;
uniform float uOuter;
uniform float uFade;
uniform float uFlyFade;
void main() {
  float r = length(vXy);
  float a = (1.0 - smoothstep(uInner, uOuter, r)) * 0.82 * uFade * uFlyFade;
  gl_FragColor = vec4(vec3(0.022, 0.028, 0.042), a);
}
`;

/** æœˆç›˜å¤–çš„ halo å€çŽ‡ï¼ˆå¹³é¢æ¯”æœˆç›˜å¤§ 1.45 å€ï¼Œäº®çŽ¯/è–„è¾‰å…‰è¦éœ²åœ¨ç›˜å¤–ï¼‰ */
const HALO = 1.45;

interface Props {
  /** 0 = å®Œå…¨å¤œé‡Œã€1 = å®Œå…¨ç™½å¤©ï¼ˆå·²è¿‡ smoothstepï¼Œè§ windowSkin.skinWeightï¼‰ */
  weight: number;
  /** çª—æ´žé‡Œæ”¾ä¸æ”¾**çª—æ™¯ splat**ï¼ˆ12 ä¸‡ç‚¹ `window-*.spz`ï¼‰ã€‚
   *  â˜… 2026-11-27ï¼ˆ`feat/gs-scene-split`ï¼‰ï¼šå¤§åŽ…/åŒ¹é…é¡µ = trueï¼ˆè§†å·®ï¼‰ï¼›è¿›æˆ¿é—´ = falseï¼ˆåªç”¨å¹³è´´å›¾ï¼Œ
   *    ä¸»äººæ‹æ¿"çª—æ´žæ”¹ç”¨å¹³è´´å›¾"ï¼‰â€”â€” `false` æ—¶è¿ž spz éƒ½ä¸è¯·æ±‚ï¼Œ`uPaintSplat` ä¹Ÿä¿æŒ 0ï¼ˆå¤œç©ºçƒç…§ç”»ï¼‰ã€‚ */
  splat?: boolean;
}

/** çª—æ´žé‡Œçš„å…¨éƒ¨å†…å®¹ + çª—å…‰ï¼ˆçª—æ¡†/çª—æ£‚åœ¨ `MoonWindow.tsx`ï¼Œä¸åœ¨è¿™é‡Œï¼‰ */
export default function WindowSkin({ weight, splat = true }: Props) {
  const moon = useMemo(() => moonDisc(), []);
  const dome = useMemo(() => skyDome(), []);
  const [wx, wy, wz] = WINDOW.center;
  const moonSize = moon.radius * 2 * HALO;

  // ä¸¤å¥— spz çš„å¯ç”¨æ€§ï¼šå„è‡ªç‹¬ç«‹ï¼ˆå¯èƒ½åªè·‘é€šäº†ä¸€å¼ ï¼‰ã€‚é»˜è®¤"ä¸çŸ¥é“"= å…ˆæŒ‚ä¸ŠåŽ»è¯•ï¼Œ
  // 404 ä¹‹åŽç”± onState è®°æˆ failedï¼Œé‚£ä¸€æ¡£å°±åªå‰©å¹³è´´å›¾ã€‚
  const [spzState, setSpzState] = useState<{ night: "try" | "ok" | "failed"; day: "try" | "ok" | "failed" }>({
    night: "try",
    day: "try",
  });

  // â”€â”€ å¤œç©º / æœˆäº®ï¼ˆå¤œé‡Œçš„ç¨‹åºåŒ–çª—æ™¯ï¼›ç©¿çª—ä¹‹åŽæ‰çœ‹å¾—è§ï¼‰â”€â”€
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
          uMoonC: { value: new THREE.Vector3(...moon.center) },
          uMoonR: { value: moon.radius },
          uSkin: { value: 0 },
          uPaintSplat: { value: 0 },
          uFlyFade: FLY_U.image,
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    // moon ç”±ä¸Šé¢åŒä¸€ä¸ªæ¸²æŸ“å‘¨æœŸçš„ useMemo å›ºå®šä¸‹æ¥ï¼Œä¸ä¼šå˜
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const moonMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uWinC: { value: new THREE.Vector3(...WINDOW.center) },
          uWinN: { value: new THREE.Vector3(...WINDOW.normal) },
          uWinR: { value: WINDOW.radius },
          uHalo: { value: HALO },
          uSkin: { value: 0 },
          uPaint: { value: 0 },
          uFlyFade: FLY_U.image,
        },
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );
  // ç»„ä»¶å¸è½½æ—¶é‡Šæ”¾ï¼ˆTableScene åœ¨ GS å¤±è´¥å›žé€€æ—¶ä¼šæ•´æ£µæ‘˜æŽ‰ï¼‰
  useEffect(
    () => () => {
      skyMat.dispose();
      moonMat.dispose();
    },
    [skyMat, moonMat],
  );

  // â”€â”€ ä¸¤å—å¹³è´´å›¾ï¼ˆå¤œ = ä¸é€æ˜Žåº•ã€æ˜¼ = æŒ‰æƒé‡æ·¡å…¥ï¼‰â”€â”€
  const [texNight, texDay] = useWindowTextures();
  // â”€â”€ å¢™é¢äº®æ™• / çŸ³æ¡†æš—éƒ¨ / çª—å…‰ â”€â”€
  const glowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(WINSKIN_GLOW.day.color) },
          uIntensity: { value: 0 },
          uFlyFade: FLY_U.image,
        },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  const surroundMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInner: { value: WINDOW.frameOuter - 0.01 },
          uOuter: { value: 0.98 },
          uFade: { value: 1 },
          uFlyFade: FLY_U.image,
        },
        vertexShader: SURROUND_VERT,
        fragmentShader: SURROUND_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => surroundMat.dispose(), [surroundMat]);

  const lightRef = useRef<THREE.PointLight>(null);

  // â”€â”€ ç©¿çª—è½¬åœºï¼ˆ2026-11-27ï¼Œfeat/gs-flythrough-dissolveï¼‰â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /** æ­£åœ¨æ¼”è½¬åœºï¼šè¿™ä¸€æ®µé‡Œå¹³è´´å›¾è¦**ç›–åœ¨çª—æ™¯ splat ä¸Šé¢**ï¼ˆå¹³æ—¶ splat ä¼˜å…ˆã€è´´å›¾ä¸æŒ‚ï¼‰ */
  const flying = useMatchCam((s) => s.stage === "fly");
  /** ä¸¤å—å¹³è´´å›¾æè´¨ï¼ˆå¸¦"åŒ–ç‚¹"æ³¨å…¥ï¼›æœ‰å›¾æ‰å»º â€”â€” è§ä¸‹é¢ç¬¬ä¸‰ä¸ªå‘çš„æ³¨é‡Šï¼‰ã€‚
   *  â˜… ä¸ºä»€ä¹ˆä¸æ²¿ç”¨ JSX é‡Œçš„ <meshBasicMaterial>ï¼šåŒ–ç‚¹è¦åœ¨ç‰‡å…ƒé‡Œé€å—é€€åœºï¼Œ
   *    è€Œ three çš„ MeshBasicMaterial åªèƒ½é€šè¿‡ onBeforeCompile æ³¨å…¥ï¼ˆæ¢ ShaderMaterial ä¼šä¸¢ sRGB/toneMapped å¤„ç†ï¼‰ã€‚ */
  const nightPaintMat = useMemo(() => (texNight ? makePaintMaterial(texNight) : null), [texNight]);
  const dayPaintMat = useMemo(() => (texDay ? makePaintMaterial(texDay) : null), [texDay]);
  useEffect(() => () => { nightPaintMat?.dispose(); }, [nightPaintMat]);
  useEffect(() => () => { dayPaintMat?.dispose(); }, [dayPaintMat]);
  /** é¢„çƒ­å¸§ï¼šspz æˆåŠŸæ—¶å¹³è´´å›¾å¹³æ—¶ä¸æŒ‚ï¼Œç¬¬ä¸€æ¬¡æŒ‚æ˜¯åœ¨è½¬åœºå¼€å§‹é‚£ä¸€æ‹ â€”â€” ä¼šçŽ°ç¼–è¯‘ programã€‚
   *  è¿™é‡Œåœ¨å¤§åŽ…é‡Œå…ˆä»¥ opacity 0 ç”»ä¸¤å¸§ï¼ˆçœ‹ä¸è§ï¼Œä½† program ç¼–è¯‘æŽ‰äº†ï¼‰ï¼Œè½¬åœºå¼€å§‹ä¸å†å¡ã€‚ */
  const [paintWarm, setPaintWarm] = useState(0);
  useFrame(() => {
    if (paintWarm > 0) setPaintWarm(paintWarm - 1);
  });

  // â˜… DEV çš„è¯»æ•°å£å­ï¼ˆåŒ StudioPage çš„ __r3fCapture é‚£æ¡çº¦å®šï¼‰ï¼šçª—æ™¯æ¯å¼ æˆªå›¾è¦æŠ¥
  //   "è¿™ä¸€å¸§æ˜¯å“ªä¸€æ¡£ã€è´´å›¾åˆ°æ²¡åˆ°ã€splat é€šæ²¡é€š"ï¼ŒæŽ§åˆ¶å°æ—¥å¿—äº‹åŽæŠ“ä¸åˆ°ï¼ŒæŒ‚ window æœ€çœäº‹ã€‚
  //   ç”Ÿäº§æž„å»ºé‡Œæ•´æ®µä¸å­˜åœ¨ã€‚
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__gswin = { weight, texNight: !!texNight, texDay: !!texDay, spzState };
  }, [weight, texNight, texDay, spzState]);

  // æƒé‡å˜åŒ–æ—¶åŒæ­¥æ‰€æœ‰ uniform / ç¯å‚æ•°ï¼ˆäº¤å‰æ·¡å…¥å°±æ˜¯é è¿™ä¸€å¤„æŽ¨è¿›çš„ï¼‰
  useLayoutEffect(() => {
    skyMat.uniforms.uSkin.value = weight;
    moonMat.uniforms.uSkin.value = weight;
    // çª—æ´žé‡Œå·²ç»æœ‰é‚£å¹…ç”»ï¼ˆè´´å›¾åˆ°äº†ï¼‰â‡’ å®¤å†…ä¸ç”»ç¨‹åºåŒ–æœˆäº®ï¼ˆè§ MOON_FRAG é‡Œçš„ discard æ³¨é‡Šï¼‰
    moonMat.uniforms.uPaint.value = texNight ? 1 : 0;
    // çª—æ™¯ splat åœ¨åœºæ—¶ï¼Œå®¤å†…ä¸ç”»å¤œç©ºçƒï¼ˆå®ƒä¼šè¢« splat ç›–ä½ï¼Œè§ SKY_FRAG é‡Œçš„ discard æ³¨é‡Šï¼‰ã€‚
    // â˜… æˆ¿é—´é‚£ä¸€æ¡£ï¼ˆsplat=falseï¼‰ä¿æŒ 0ï¼šçª—æ´žåªæœ‰å¹³è´´å›¾ï¼Œå¤œç©ºçƒç…§æ—§ç”»åœ¨å®ƒä¸‹é¢ï¼ˆç©¿çª—è½¬åœºè¿˜ç”¨å¾—ä¸Šï¼‰ã€‚
    skyMat.uniforms.uPaintSplat.value = splat && (spzState.night === 'ok' || spzState.day === 'ok') ? 1 : 0;
    glowMat.uniforms.uIntensity.value = WINSKIN_GLOW.day.intensity * weight;
    surroundMat.uniforms.uFade.value = 1 - weight;
    const l = lightRef.current;
    if (l) {
      l.color.lerpColors(new THREE.Color(WINSKIN_LIGHT.night.color), new THREE.Color(WINSKIN_LIGHT.day.color), weight);
      l.intensity = WINSKIN_LIGHT.night.intensity + (WINSKIN_LIGHT.day.intensity - WINSKIN_LIGHT.night.intensity) * weight;
      l.distance = WINSKIN_LIGHT.night.distance + (WINSKIN_LIGHT.day.distance - WINSKIN_LIGHT.night.distance) * weight;
    }
  }, [weight, skyMat, moonMat, glowMat, surroundMat, texNight, spzState, splat]);

  const nightOn = weight < 0.999;
  const dayOn = weight > 0.001;
  // â˜… "ä¼˜å…ˆ splatã€ä¸å¯ç”¨æ‰å›žé€€è´´å›¾"ï¼ˆä»»åŠ¡ä¹¦ B-2ï¼‰ï¼šspz åŠ è½½æˆåŠŸå°±**ä¸ç”»**é‚£å¼ å¹³è´´å›¾ï¼Œ
  //   ä¸€æ ¼éƒ½ä¸å¤šå ï¼›404ï¼ˆè€åŒ… / æ–‡ä»¶è¢«è£è¿‡çš„é‚£ä¸€ç‰ˆï¼‰æ‰ç”¨è´´å›¾ã€‚
  //   ä¸¤æ¡£å„è‡ªåˆ¤ï¼šå¯èƒ½åªè·‘é€šäº†å…¶ä¸­ä¸€å¼ ï¼ˆml-sharp é‚£ä¸€è½®å°±æ˜¯å…ˆå‡ºæœˆã€åŽå‡ºæµ·ï¼‰ã€‚
  //   â˜… æˆ¿é—´é‚£ä¸€æ¡£ `splat=false`ï¼šç›´æŽ¥æŒ‰ tex èµ°ï¼ˆ`spzState` ä¸€ç›´æ˜¯ "try"ï¼Œæ°¸è¿œç­‰ä¸åˆ° okï¼‰ã€‚
  const nightKind = splat && spzState.night === "ok" ? "splat" : "tex";
  const dayKind = splat && spzState.day === "ok" ? "splat" : "tex";
  /** å¹³è´´å›¾ä»€ä¹ˆæ—¶å€™æŒ‚ï¼šâ‘  è¿™ä¸€æ¡£æœ¬æ¥å°±æ˜¯è´´å›¾ï¼ˆsplat å¤±è´¥ / æˆ¿é—´ï¼‰ï¼›â‘¡ è½¬åœºåœ¨æ¼”ï¼ˆç›–åœ¨ splat ä¸ŠåŒ–ç‚¹ï¼‰ï¼›
   *  â‘¢ é¢„çƒ­å¸§ï¼ˆopacity 0 ç”»ä¸¤å¸§ï¼Œç¼–è¯‘ programï¼‰ã€‚å…¶ä½™æ—¶å€™ä¸æŒ‚ â€”â€” å¤§åŽ…çš„è§‚æ„Ÿä»æ˜¯ splat ä¼˜å…ˆã€‚ */
  const paintShow = flying || paintWarm > 0;
  /** é¢„çƒ­å¸§è¦çœŸçš„"çœ‹ä¸è§"ï¼šå¹³æ—¶æ ¹æœ¬ä¸è¯¥æœ‰è¿™å¼ å›¾çš„æ¡£ï¼ˆsplat æˆåŠŸï¼‰ç”» 0 ä¸é€æ˜Žåº¦ */
  const paintHideOpacity = paintWarm > 0 && !flying && nightKind !== "tex" && dayKind !== "tex";
  useLayoutEffect(() => {
    if (nightPaintMat) nightPaintMat.opacity = paintHideOpacity ? 0 : 1;
    if (dayPaintMat) dayPaintMat.opacity = paintHideOpacity ? 0 : weight;
  }, [nightPaintMat, dayPaintMat, paintHideOpacity, weight]);
  /** spz æˆåŠŸï¼ˆå¹³æ—¶ç”¨ä¸åˆ°å¹³è´´å›¾ï¼‰æ—¶é¢„çƒ­ä¸€æ¬¡ï¼›å¤±è´¥é‚£ä¸€æ¡£æœ¬æ¥å°±ç”¨è´´å›¾ï¼Œä¸ç”¨é¢„çƒ­ */
  const splatKindOn = nightKind === "splat" || dayKind === "splat";
  useEffect(() => {
    if (splatKindOn) setPaintWarm(2);
  }, [splatKindOn]);

  return (
    <>
      {/* â”€â”€ çª—æ´žç”»é¢ï¼šå¹³è´´å›¾ï¼ˆæ°¸è¿œåœ¨ï¼Œsplat ä¸åœ¨æ—¶å®ƒå°±æ˜¯è¿™ä¸ªçª—çš„å…¨éƒ¨ï¼‰ â”€â”€ */}
      {/* â˜… 2026-11-27 ç¬¬ä¸‰ä¸ªå‘ï¼šå¿…é¡» `texNight &&` æ‰æŒ‚è¿™å— meshã€‚
          å…ˆæŒ‚ä¸€å— `map=null` çš„ç™½è‰²åœ†é¢ã€ç­‰è´´å›¾åˆ°äº†å†æ”¹ `map` â€”â€” three ä¸ä¼šä¸º"è¿è¡Œæ—¶æ¢ map"
          é‡æ–°ç¼–è¯‘ programï¼ˆ`material.needsUpdate` æ²¡äººç½®ä½ï¼‰ï¼Œå±å¹•ä¸Šå°±æ˜¯ä¸€æ•´ç‰‡ #e2e2e2 çš„ç™½åœ†
          ï¼ˆACES æŠŠçº¯ç™½åŽ‹åˆ° 226/255ï¼Œä¸Žå®žé™…æˆªå›¾çš„è¯»æ•°ä¸€è‡´ï¼‰ï¼Œè€Œä¸”**åªåœ¨å¤œé‡Œé‚£ä¸€æ¡£å‡ºçŽ°**ã€‚
          è®©æè´¨**å¸¦ç€ map å‡ºç”Ÿ**å°±æ²¡æœ‰è¿™ä¸€å±‚ï¼šæ‰€ä»¥ä¸‹é¢ä¸¤å¼ è´´å›¾éƒ½æ˜¯"æœ‰å›¾æ‰æŒ‚"ã€‚
          åœ†é¢ + åœ†å½¢ UVï¼šCircleGeometry çš„ uv æ˜¯"å¤–æŽ¥æ–¹å›¾ â†’ 0..1"ï¼Œæ‰€ä»¥åœ†å†…æ­£å¥½é‡‡æ ·åˆ°
          é‚£å¼  678Â² è£å›¾çš„**å†…åˆ‡åœ†**ï¼ˆ= çª—æ´žæœ¬ä½“ï¼‰ï¼Œå››è§’ï¼ˆå¢™/çª—æ¡†ï¼‰ä¸ä¼šè¢«é‡‡åˆ°ã€‚ */}
      {nightOn && nightPaintMat && (nightKind === "tex" || paintShow) && (
        <mesh position={[wx, wy, wz + 0.0015]} renderOrder={PAINT_ORDER.night} material={nightPaintMat}>
          <circleGeometry args={[WINDOW.radius, 96]} />
        </mesh>
      )}
      {dayOn && dayPaintMat && (dayKind === "tex" || paintShow) && (
        <mesh position={[wx, wy, wz + 0.0015]} renderOrder={PAINT_ORDER.day} material={dayPaintMat}>
          <circleGeometry args={[WINDOW.radius, 96]} />
        </mesh>
      )}

      {/* â”€â”€ çª—æ™¯ splatï¼ˆè‹¥ ml-sharp çš„äº§ç‰©åœ¨ï¼‰ï¼šè´´åœ¨çª—æ´žä¸Šï¼Œæ¯”å¹³è´´å›¾å¤šä¸€å±‚è§†å·® â”€â”€
          ä¸¤å±‚å ç€ç”»ï¼šsplat æ˜¯"æ›´çœŸçš„é‚£ä¸€å±‚"ï¼Œå¹³è´´å›¾ç•™åœ¨ä¸‹é¢è¡¥å®ƒè¾¹ç¼˜çš„çªŸçª¿ã€‚
          splat è‡ªå·±çš„ä¸é€æ˜Žåº¦è·Ÿç€åŒä¸€ä¸ªæƒé‡èµ°ï¼Œæ‰€ä»¥äº¤å‰æ·¡å…¥æ—¶å®ƒä¹Ÿä¸€èµ·æ·¡ã€‚ */}
      <Suspense fallback={null}>
        {splat && nightOn && spzState.night !== "failed" && (
          <WindowSplat
            skin="night"
            url={WINDOW_SPZ.night}
            opacity={1 - weight}
            onState={(s) => setSpzState((p) => (p.night === s ? p : { ...p, night: s }))}
          />
        )}
        {splat && dayOn && spzState.day !== "failed" && (
          <WindowSplat
            skin="day"
            url={WINDOW_SPZ.day}
            opacity={weight}
            onState={(s) => setSpzState((p) => (p.day === s ? p : { ...p, day: s }))}
          />
        )}
      </Suspense>

      {/* â”€â”€ ç‚¹äº‘å»Š + å…‰å°˜ï¼ˆ2026-11-27ï¼Œfeat/gs-flythrough-dissolveï¼›feat/gs-tunnel-depth åŠ å±‚ï¼‰â”€â”€
          â˜… ä¸»äººç¬¬ 2 æ¡ï¼š"å•å¼ çª—æ™¯ splat æ·±åº¦ç›’åªæœ‰ 0.22 mï¼Œé£žå‡ºåŽ»å°±ç©ºäº†" â€”â€” æ‰€ä»¥æŠŠ**åŒä¸€ä»½**
            çª—æ™¯ splat çš„ç‚¹å¤åˆ¶ 12ï¼ˆå¤œï¼‰/ 9ï¼ˆæ˜¼ï¼‰å±‚æ²¿ z é“ºå¼€ï¼ˆflyCorridor.tsï¼‰ï¼Œå¤–åŠ å¤œæ¡£çš„æ·±ç©ºå‰¯æœ¬ã€‚
            æ•°æ®æ˜¯çª—å£ splat å°±ç»ªåŽåœ¨å¤§åŽ…ç©ºé—²æ—¶çƒ˜ä¸€ä»½ packed æ•°ç»„ï¼Œåªå¤š **1 ä¸ª SplatMesh**ï¼ˆ+1 draw callï¼‰ï¼›
            å…‰å°˜æ˜¯ 1 ä¸ª Pointsï¼ˆ+1ï¼‰ã€‚
          â˜… æˆ¿é—´é‚£ä¸€æ¡£ä¸æŒ‚ï¼ˆsplat=false æ—¶è¿™ä¸€æ•´å—éƒ½ä¸è¯·æ±‚ï¼‰ã€‚ */}
      <Suspense fallback={null}>{splat && <FlyCloud />}</Suspense>

      {/* â”€â”€ ç©¿è¡Œå°½å¤´é‚£å¼ èƒŒæ™¯ï¼ˆ2026-11-27ï¼Œfeat/gs-tunnel-depthï¼›ä¸»äººç¬¬ 1 æ¡ï¼‰â”€â”€
          â˜… å¤œ=æœˆäº®/å¤œç©ºã€æ˜¼=äº‘æµ·ï¼Œè´´å›¾æ˜¯ `design/gen-fly-backdrop.py` ä»Ž out-2/out-3 çš„çª—æ´žå†…å®¹è£çš„ã€‚
          â˜… æ‘†åœ¨é£žè¡Œç»ˆç‚¹å‰æ–¹ 2.4 mã€æ­£å¯¹ç›¸æœºï¼›renderOrder âˆ’10ï¼ˆåœ¨ Spark çš„ splat pass ä¹‹å‰ç”»ï¼‰ï¼Œ
            ä¸é€æ˜Žåº¦è·Ÿ `FLY_U.backdrop`ï¼ˆtravel 0.45~0.85 æ·¡è¿›æ¥ï¼‰â€”â€” èµ°å»Šæœ€åŽå‡ å±‚è¶Šé£žè¶Šç¨€ï¼Œ
            èƒŒæ™¯å°±æ˜¯é‚£ä¹ˆ"é€å‡ºæ¥"çš„ï¼Œä¸æ˜¯ç¡¬åˆ‡ã€‚å¤§åŽ…é‡Œæ’ 0ã€ä¸ç”»ã€‚ */}
      {splat && <BackdropPlane skin={weight > 0.5 ? "day" : "night"} />}

      {/* â”€â”€ å¤œç©ºçƒ + æœˆäº®ç›˜ï¼šç©¿çª—ä¹‹åŽæ•´å±éƒ½æ˜¯å¤©ï¼Œè¿™ä¸¤æ ·å¿…é¡»ç•™ç€ï¼ˆç©¿çª—è½¬åœºé å®ƒä»¬ï¼‰ â”€â”€
          â˜… 2026-11-27 ç¬¬äºŒä¸ªå‘ï¼šå¤œç©ºçƒçš„ renderOrder **ä»Ž 19 é™åˆ° 12**ã€‚
            19 ä¸Ž"ç™½å¤©é‚£å¼ è´´å›¾"åŒä¸º 19ã€åˆæŽ’åœ¨"å¤œé‡Œé‚£å¼ "ï¼ˆ18ï¼‰ä¹‹åŽ â‡’ å¤œç©ºï¼ˆç‰‡å…ƒé‡Œåªè£æŽ‰çª—æ´ž**å¤–**
            çš„æ–¹å‘ï¼Œçª—æ´ž**å†…**æ˜¯ç…§ç”»çš„ï¼‰æŠŠ 18 é‚£å±‚æ•´å—ç›–æŽ‰ï¼Œå¤œé‡Œçª—æ´žé‡Œåªå‰©ä¸€ç‰‡é»‘ + å‡ é¢—æ˜Ÿ
            ï¼ˆç¬¬ä¸€ç‰ˆæˆªå›¾å°±æ˜¯è¿™æ ·ï¼Œç™½å¤©é‚£æ¡£å› ä¸ºåŒåœ¨ 19ã€é æ’å…¥é¡ºåºä¾¥å¹¸æ­£å¸¸ï¼‰ã€‚
            çŽ°åœ¨é˜Ÿä¼æ˜¯ï¼šæˆ¿é—´ splat 10 â†’ **å¤œç©º 12** â†’ çª—æ™¯è´´å›¾ 18/19 â†’ äº®æ™• 20 â†’ æœˆç›˜ 21 â†’ çª—æ¡† 22/23ã€‚ */}
      <mesh position={dome.center} renderOrder={12} frustumCulled={false} material={skyMat}>
        <sphereGeometry args={[dome.radius, 48, 24]} />
      </mesh>
      <mesh position={moon.center} renderOrder={21} material={moonMat}>
        <planeGeometry args={[moonSize, moonSize]} />
      </mesh>

      {/* â”€â”€ å¢™ä¸Šçš„ä¸¤åœˆï¼šç™½å¤©æ˜¯**æš–ç™½äº®æ™•**ã€å¤œé‡Œæ˜¯åŽ‹ä½çƒ˜æ­»ç£¨ç ‚è¾¹çš„**æš—çŽ¯**ï¼ˆåŒä¸€å—åœ°æ–¹ä¸¤ç§æ ·å­ï¼‰â”€â”€ */}
      <mesh position={[wx, wy, wz + 0.0022]} renderOrder={GLOW_ORDER} material={glowMat}>
        <ringGeometry args={[0.54, 1.02, 96, 1]} />
      </mesh>
      {/* â˜… 2026-11-27ï¼ˆæ•´å›¾åº•è¡¨ä¸Šçº¿åŽï¼Œagent-63 å®žæµ‹ï¼‰ï¼šè¿™åœˆ"çŸ³æ¡†æš—éƒ¨"åŽŸæ¥æ˜¯åŽ‹æˆ¿é—´ splat é‡Œé‚£å—
          çƒ˜æ­»çš„ç£¨ç ‚çŽ»ç’ƒäº®è¾¹çš„ï¼ˆ0.57~0.98 m çŽ¯ï¼‰ã€‚çŽ°åœ¨ splat æ˜¯**æ•´å¼ å›¾ï¼ˆè‡ªå¸¦æ•´é¢å¢™ï¼‰**ï¼Œè¿™åœˆ 0.82
          alpha çš„æš—çŽ¯æŠŠå¢™åŽ‹æˆè¿‘é»‘ï¼ˆåŽŸå›¾å¢™ä¸­è“ lumâ‰ˆ76ï¼‰â€”â€” splat å°±ç»ªæ—¶ä¸æŒ‚å®ƒã€‚ç™½å¤©é‚£åœˆåŠ è‰²äº®æ™•ç…§ç•™ã€‚ */}
      {!(splat && (spzState.night === "ok" || spzState.day === "ok")) && (
        <mesh position={[wx, wy, wz + 0.002]} renderOrder={22} material={surroundMat}>
          <ringGeometry args={[WINDOW.frameOuter - 0.01, 0.98, 96, 1]} />
        </mesh>
      )}

      {/* â”€â”€ çª—å†…é‚£ç›ç¯ï¼ˆåªç…§ meshï¼‰ï¼šå¤œé‡Œå†·è“æœˆå…‰ã€ç™½å¤©æš–ç™½å¼ºå…‰ï¼Œå‚æ•°åœ¨ windowSkin.WINSKIN_LIGHT â”€â”€
          ä½ç½® = çª—å¿ƒå¾€å®¤å†… 0.85 mï¼ˆè´´å¤ªè¿‘ä¼šæŠŠçª—æ£‚æ‰“å‡ºé•œé¢é«˜å…‰ï¼Œç¬¬ä¸€ç‰ˆè¸©è¿‡ï¼‰ã€‚ */}
      <pointLight
        ref={lightRef}
        position={[wx + WINDOW.normal[0] * 0.85, wy, wz + WINDOW.normal[2] * 0.85]}
        color={WINSKIN_LIGHT.night.color}
        intensity={WINSKIN_LIGHT.night.intensity}
        distance={WINSKIN_LIGHT.night.distance}
        decay={WINSKIN_LIGHT.night.decay}
      />
    </>
  );
}

/** ä¸¤å¼ çª—æ™¯è´´å›¾ï¼ˆæ‡’åŠ è½½ + å¤±è´¥ä¸æŠ›ï¼‰ï¼š`useLoader` ä¼šåœ¨ 404 æ—¶æŠŠæ•´æ£µå­æ ‘ç‚¸æŽ‰ï¼Œ
 *  è€Œè¿™ä¸¤å¼ æ˜¯**å¯é€‰èµ„æº**ï¼ˆWebView ç¼“å­˜åæŽ‰/åŒ…è¢«è£è¿‡éƒ½å¯èƒ½æ‹¿ä¸åˆ°ï¼‰â€”â€”
 *  æ‹¿ä¸åˆ°å°±è¿”å›ž nullï¼Œçª—æ´žé€€æˆçº¯å¤œç©ºï¼ˆä»ç„¶æ˜¯"ä¸€æ‰‡çª—"ï¼Œä¸æ˜¯ä¸€å—ç™½æ¿ï¼‰ã€‚ */
function useWindowTextures(): [THREE.Texture | null, THREE.Texture | null] {
  const [tex, setTex] = useState<[THREE.Texture | null, THREE.Texture | null]>([null, null]);
  useLayoutEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture | null>((resolve) =>
        loader.load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.magFilter = THREE.LinearFilter;
            t.anisotropy = 4;
            t.needsUpdate = true;
            resolve(t);
          },
          undefined,
          () => resolve(null),
        ),
      );
    Promise.all([load(WINDOW_TEX.night), load(WINDOW_TEX.day)]).then(([n, d]) => {
      if (!alive) {
        n?.dispose();
        d?.dispose();
        return;
      }
      setTex([n, d]);
    });
    return () => {
      alive = false;
    };
  }, []);
  // å¸è½½æ—¶é‡Šæ”¾
  // â˜… 2026-11-27ï¼ˆ`feat/gs-scene-split` é¡ºæ‰‹ä¿®ï¼‰ï¼šä¾èµ–å¿…é¡»æ˜¯ `[tex]`ã€‚åŽŸæ¥å†™ `[]`ï¼Œcleanup é—­åŒ…
  //   æ•èŽ·çš„æ˜¯**é¦–å¸§**çš„ `[null, null]` â€”â€” ä¸¤å¼  webp æ¯æŒ‚ä¸€æ¬¡å°±å¤šä¸¤ä»½ GPU çº¹ç†ã€æ°¸ä¸é‡Šæ”¾
  //   ï¼ˆå¤§åŽ…â†”æˆ¿é—´æ¥å›žåˆ‡æ—¶ `renderer.info.memory.textures` æ¯æ¬¡ +2ï¼‰ã€‚`[tex]` æ—¶æ—§ cleanup é‡Œä»æ˜¯
  //   ä¸Šä¸€ä»½ï¼ˆé¦–å¸§çš„ nullï¼‰ï¼Œæ–° effect æ•èŽ·çš„æ˜¯çœŸçº¹ç†ï¼Œå¸è½½é‚£ä¸€ä¸‹æ‰æ”¾å¾—æŽ‰ã€‚
  useEffect(
    () => () => {
      tex[0]?.dispose();
      tex[1]?.dispose();
    },
    [tex],
  );
  return tex;
}

