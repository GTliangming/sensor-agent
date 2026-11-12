import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import itemsFile from "../src/data/items_ch01.json";
import type { ItemsFile } from "../src/core/types";
import { ICON_DRAW, MASK_SIZE, SPRITE_PX, encodeMask, spriteFileName, type ItemMasksFile } from "../src/core/mask";
import { launchChrome } from "./browser";
import iconSources from "./icon-sources.json";

// 把占位图标烘焙成 WebP 贴图，并导出每个物件的形状掩码。用法：npm run export:icons
//   - public/sprites/<物件>__<变体>.webp：游戏里实际显示的贴图（带柔和投影，多变体物件按变体颜色着色）
//   - src/data/item_masks.json：图标本体轮廓，供关卡生成、配置校验和运行时点击判定使用
// 游戏运行时只加载这些贴图，不再现场画 emoji，所以不同系统看到的图标与轮廓完全一致。
// 图标来源分两档（见 scripts/icon-sources.json）：有映射的物件用 game-icons.net 的 CC-BY 3.0 SVG
// （临时美术，待 Tanaka 提供正式美术后替换）；没有合适图标的物件仍用 emoji 占位烘焙。
// 正式美术接入后，用美术 PNG 替换本脚本的绘制部分即可，文件名与掩码格式保持不变。
// 注意：换了图标必须重跑 npm run gen:levels（关卡按新掩码重算遮挡）+ npm run validate:configs。

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spriteDir = join(root, "public/sprites");
const sourcesDir = join(root, "scripts/icon-sources");
const items = (itemsFile as ItemsFile).items;

type IconSource = { author: string; gameIcon: string };
const sources = (iconSources as { sources: Record<string, IconSource> }).sources;

/**
 * game-icons.net 的 SVG 统一是“黑底 + 白色图形”画法（另有少量只有白色图形、无底）：
 * 去掉满幅黑底、把白色图形改成黑色，再按 viewBox 补 width/height，得到透明底黑色剪影。
 * 导出时再按物件底色重着色，掩码按透明通道算，与旧 emoji 流程一致。
 */
function normalizeSvg(raw: string): string {
  let svg = raw.replace(/<path d="M0 0h512v512H0z"\/>/, "");
  svg = svg.replaceAll('fill="#fff"', 'fill="#000"');
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (vb && !svg.includes('width="')) {
    svg = svg.replace("<svg ", `<svg width="${vb[1]}" height="${vb[2]}" `);
  }
  return svg;
}

const jobs = items.map((item) => {
  const src = sources[item.id];
  let svg: string | null = null;
  if (src) {
    const file = join(sourcesDir, `${item.id}.svg`);
    if (!existsSync(file)) throw new Error(`物件 ${item.id} 在 icon-sources.json 有映射但缺少 ${file}`);
    svg = normalizeSvg(readFileSync(file, "utf8"));
  }
  // 多变体物件先烘成近白色底，再按变体色 multiply 着色；单变体直接用该变体的柔和底色。
  const baseColor =
    item.variants.length > 1
      ? "#f6f2ea"
      : (item.variants.find((v) => v.id === item.defaultVariantId) ?? item.variants[0]).color;
  return {
    id: item.id,
    icon: item.icon,
    svg,
    baseColor,
    // 只有一个变体的物件保持原色；多变体的按变体颜色着色，玩家能分辨同款不同色
    variants: item.variants.map((v) => ({ id: v.id, tint: item.variants.length > 1 ? v.color : null })),
  };
});

const browser = await launchChrome();
const page = await browser.newPage();
const rendered = await page.evaluate(
  async ({ jobs, PX, N, draw }) => {
    const canvas = () => {
      const c = document.createElement("canvas");
      c.width = PX;
      c.height = PX;
      return [c, c.getContext("2d")!] as const;
    };
    const loadImage = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`SVG 图片加载失败：${src.slice(0, 80)}`));
        img.src = src;
      });
    const out: Record<string, { mask: number[]; sprites: Record<string, string> }> = {};
    for (const job of jobs) {
      // 1. 不带投影的图标本体，用来算轮廓
      const [base, bctx] = canvas();
      if (job.svg) {
        // SVG 剪影：按 0.88 边长居中画满，再整体重着色成物件底色
        const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(job.svg)}`);
        const side = PX * 0.88;
        bctx.drawImage(img, (PX - side) / 2, (PX - side) / 2, side, side);
        bctx.globalCompositeOperation = "source-in";
        bctx.fillStyle = job.baseColor;
        bctx.fillRect(0, 0, PX, PX);
        bctx.globalCompositeOperation = "source-over";
      } else {
        bctx.textAlign = "center";
        bctx.textBaseline = "middle";
        bctx.font = `${PX * draw.fontScale}px ${draw.fontFamily}`;
        bctx.fillText(job.icon, PX / 2, PX * draw.centerY);
      }
      const data = bctx.getImageData(0, 0, PX, PX).data;
      const step = PX / N;
      const mask: number[] = [];
      for (let my = 0; my < N; my++) {
        for (let mx = 0; mx < N; mx++) {
          let on = 0;
          for (let sy = 0; sy < step && !on; sy += 2) {
            for (let sx = 0; sx < step && !on; sx += 2) {
              const px = Math.floor(mx * step + sx);
              const py = Math.floor(my * step + sy);
              if (data[(py * PX + px) * 4 + 3] > draw.alphaThreshold) on = 1;
            }
          }
          mask.push(on);
        }
      }
      // 2. 每个变体：按需着色，再加投影
      const sprites: Record<string, string> = {};
      for (const v of job.variants) {
        const [tinted, tctx] = canvas();
        tctx.drawImage(base, 0, 0);
        if (v.tint) {
          tctx.globalCompositeOperation = "multiply";
          tctx.globalAlpha = 0.7;
          tctx.fillStyle = v.tint;
          tctx.fillRect(0, 0, PX, PX);
          tctx.globalAlpha = 1;
          tctx.globalCompositeOperation = "destination-in";
          tctx.drawImage(base, 0, 0);
        }
        const [final, fctx] = canvas();
        fctx.shadowColor = "rgba(50, 40, 30, 0.45)";
        fctx.shadowBlur = 16;
        fctx.shadowOffsetY = 8;
        fctx.drawImage(tinted, 0, 0);
        sprites[v.id] = final.toDataURL("image/webp", 0.86).split(",")[1];
      }
      out[job.id] = { mask, sprites };
    }
    return out;
  },
  { jobs, PX: SPRITE_PX, N: MASK_SIZE, draw: ICON_DRAW },
);
await browser.close();

rmSync(spriteDir, { recursive: true, force: true });
mkdirSync(spriteDir, { recursive: true });
const masks: ItemMasksFile = { size: MASK_SIZE, masks: {} };
let spriteCount = 0;
let svgCount = 0;
for (const item of items) {
  const { mask, sprites } = rendered[item.id];
  const bits = Uint8Array.from(mask);
  const filled = bits.reduce((a, b) => a + b, 0);
  if (filled < 20) throw new Error(`物件 ${item.id} 的图标 ${item.icon} 渲染为空，检查字体或 SVG 来源`);
  if (jobs.find((j) => j.id === item.id)?.svg) svgCount++;
  masks.masks[item.id] = encodeMask(bits);
  for (const [variantId, png] of Object.entries(sprites)) {
    writeFileSync(join(spriteDir, spriteFileName(item.id, variantId)), Buffer.from(png, "base64"));
    spriteCount++;
  }
}
writeFileSync(join(root, "src/data/item_masks.json"), JSON.stringify(masks, null, 2) + "\n");
console.log(
  `已导出 ${items.length} 个物件的轮廓、${spriteCount} 张贴图到 public/sprites/（其中 ${svgCount} 个物件用 SVG 来源、${items.length - svgCount} 个仍用 emoji 占位）`,
);
