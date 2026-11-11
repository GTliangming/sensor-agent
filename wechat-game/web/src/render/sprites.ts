import * as THREE from "three";
import type { ItemConfig } from "../core/types";

// 占位贴图：透明底，只有物件图标和一层柔和投影，不带文字和边框。
// 正式美术资源到位后替换为 PNG 加载。

const cache = new Map<string, THREE.CanvasTexture>();
const PX = 256;

export function itemTexture(item: ItemConfig): THREE.CanvasTexture {
  const key = item.id;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = PX;
  canvas.height = PX;
  const ctx = canvas.getContext("2d")!;

  ctx.shadowColor = "rgba(50, 40, 30, 0.45)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${PX * 0.84}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(item.icon, PX / 2, PX * 0.52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.alphaMask = buildAlphaMask(ctx);
  cache.set(key, texture);
  return texture;
}

const MASK = 64;
const DILATE = 1; // 掩码外扩格数（约 3 设计像素），只给细线条图标一点容差，不盖过旁边露出的物件

/** 低分辨率不透明度掩码，用于点击时忽略图标外的透明区域 */
function buildAlphaMask(ctx: CanvasRenderingContext2D): Uint8Array {
  const data = ctx.getImageData(0, 0, PX, PX).data;
  const solid = new Uint8Array(MASK * MASK);
  const step = PX / MASK;
  for (let my = 0; my < MASK; my++) {
    for (let mx = 0; mx < MASK; mx++) {
      const px = Math.floor(mx * step + step / 2);
      const py = Math.floor(my * step + step / 2);
      solid[my * MASK + mx] = data[(py * PX + px) * 4 + 3] > 140 ? 1 : 0;
    }
  }
  const mask = new Uint8Array(MASK * MASK);
  for (let my = 0; my < MASK; my++) {
    for (let mx = 0; mx < MASK; mx++) {
      let on = 0;
      for (let dy = -DILATE; dy <= DILATE && !on; dy++) {
        for (let dx = -DILATE; dx <= DILATE && !on; dx++) {
          const x = mx + dx;
          const y = my + dy;
          if (x >= 0 && y >= 0 && x < MASK && y < MASK) on = solid[y * MASK + x];
        }
      }
      mask[my * MASK + mx] = on;
    }
  }
  return mask;
}

/** uv 处是否落在图标本体上（含外扩的点击容差） */
export function isOpaqueAt(texture: THREE.Texture, u: number, v: number): boolean {
  const mask = texture.userData.alphaMask as Uint8Array | undefined;
  if (!mask) return true;
  const mx = Math.min(MASK - 1, Math.max(0, Math.floor(u * MASK)));
  const my = Math.min(MASK - 1, Math.max(0, Math.floor((1 - v) * MASK)));
  return mask[my * MASK + mx] === 1;
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
