// 受保护资产运行时解密：.glbx = "GLBX1"(5B) + iv(12B) + AES-256-GCM 密文。
// fetch → 内存解密 → GLTFLoader.parse——磁盘与网络层永远没有明文模型。
// 密钥经 VITE_ASSET_KEY 构建期注入（.env.local，不进仓库）；
// Web 端属"合理阻却"级保护，正式防提取以 App 打包（密文进包体）为准。
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const KEY_B64 = (import.meta.env.VITE_ASSET_KEY as string | undefined) ?? "";

/** 构建里是否带了资产密钥（没带则受保护资产不可用，调用方应回退明文资产） */
export function hasAssetKey(): boolean {
  return KEY_B64.length > 0;
}

let cachedKey: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    const raw = Uint8Array.from(atob(KEY_B64), (c) => c.charCodeAt(0));
    cachedKey = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  }
  return cachedKey;
}

async function decryptGlbx(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buf);
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (magic !== "GLBX1") throw new Error("不是 GLBX1 加密资产");
  const iv = bytes.slice(5, 17);
  const cipher = bytes.slice(17);
  const key = await getKey();
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
}

/**
 * 加密 GLB 加载器：与 GLTFLoader 同接口，可直接用于 r3f useLoader。
 * useLoader(EncryptedGLTFLoader, "/models/protected/xxx.glbx")
 */
export class EncryptedGLTFLoader extends GLTFLoader {
  constructor(manager?: THREE.LoadingManager) {
    super(manager);
    this.setMeshoptDecoder(MeshoptDecoder);
  }

  load(
    url: string,
    onLoad: (gltf: GLTF) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void,
  ): void {
    const fileLoader = new THREE.FileLoader(this.manager);
    fileLoader.setResponseType("arraybuffer");
    fileLoader.setPath("");
    fileLoader.load(
      url,
      (data) => {
        decryptGlbx(data as ArrayBuffer)
          .then((plain) => this.parse(plain, "", onLoad, onError as (e: ErrorEvent) => void))
          .catch((e) => onError?.(e));
      },
      onProgress,
      (e) => onError?.(e),
    );
  }
}

/** 按扩展名选 loader：.glbx 走解密、其余走普通 GLTFLoader（同样挂 meshopt）；兼容 ?v= 版本查询串 */
export function loaderFor(url: string): typeof GLTFLoader {
  return url.includes(".glbx") ? (EncryptedGLTFLoader as typeof GLTFLoader) : GLTFLoader;
}
