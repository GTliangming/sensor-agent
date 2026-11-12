import * as THREE from "three";
import { maskHitAt, spriteFileName } from "../core/mask";
import { MASKS } from "../data";

// 物件贴图：由 scripts/export-icons.ts 预先烘焙到 public/sprites/，运行时只加载图片，
// 所以任何设备上看到的图标都与生成关卡用的轮廓一致。

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

/** 贴图的 URL，HUD 的 <img> 也用它 */
export function spriteUrl(itemId: string, variantId: string): string {
  return `${import.meta.env.BASE_URL}sprites/${spriteFileName(itemId, variantId)}`;
}

/** 物件贴图（异步加载，加载完成时调用 onLoad 以便重绘） */
export function itemTexture(itemId: string, variantId: string, onLoad: () => void): THREE.Texture {
  const key = `${itemId}:${variantId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const texture = loader.load(spriteUrl(itemId, variantId), onLoad);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/** 预加载一关用到的全部贴图，全部就绪后 resolve（单张失败也继续，避免卡在加载中）。
 * onProgress 在每张贴图就绪后回调（已完成数，总数），用于进关加载进度条。 */
export function preloadSprites(
  pairs: [itemId: string, variantId: string][],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const unique = [...new Set(pairs.map(([i, v]) => `${i}:${v}`))];
  let done = 0;
  const tick = () => {
    done++;
    onProgress?.(done, unique.length);
  };
  return Promise.all(
    unique.map(
      (key) =>
        new Promise<void>((resolve) => {
          if (cache.has(key) && cache.get(key)!.image) {
            tick();
            return resolve();
          }
          const [itemId, variantId] = key.split(":");
          const texture = loader.load(
            spriteUrl(itemId, variantId),
            () => {
              tick();
              resolve();
            },
            undefined,
            () => {
              tick();
              resolve();
            },
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          cache.set(key, texture);
        }),
    ),
  ).then(() => undefined);
}

/**
 * uv 处是否落在物件图标本体上。读的是生成关卡时用的同一份形状掩码，
 * 所以“能点中的区域”和“算遮挡的区域”完全一致。
 * dilate 为外扩格数（小物件的点按容差，见 ThreeStage.loadLevel）。
 */
export function isItemHitAt(itemId: string, u: number, v: number, dilate = 0): boolean {
  const mask = MASKS.get(itemId);
  return mask ? maskHitAt(mask, u, v, dilate, MASKS.size) : true;
}

export function labelTexture(text: string, color = "rgba(70,58,46,0.55)"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 52px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
