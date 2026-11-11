import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import itemsFile from "../src/data/items_ch01.json";
import type { ItemsFile } from "../src/core/types";
import { MASK_SIZE, encodeMask, type ItemMasksFile } from "../src/core/mask";

// 导出每个物件图标的形状掩码到 src/data/item_masks.json，供关卡生成按真实形状计算遮挡。
// 图标是浏览器渲染的 emoji，所以要借用 Chrome 渲染：
//   1. Chrome 以 --remote-debugging-port=9333 启动（可用 --headless=new）
//   2. npm run export:masks
// 绘制参数必须与 src/render/sprites.ts 的 itemTexture 保持一致。

const PX = 256;
const items = (itemsFile as ItemsFile).items;

const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
const page = targets.find((t: { type: string }) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const result = await new Promise<string>((resolve) => {
  ws.addEventListener("message", (e) => resolve(JSON.parse(String(e.data)).result.result.value));
  const expression = `(() => {
    const PX = ${PX}, N = ${MASK_SIZE};
    const icons = ${JSON.stringify(items.map((i) => [i.id, i.icon]))};
    const out = {};
    for (const [id, icon] of icons) {
      const c = document.createElement("canvas");
      c.width = PX; c.height = PX;
      const ctx = c.getContext("2d");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = (PX * 0.84) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(icon, PX / 2, PX * 0.52);
      const data = ctx.getImageData(0, 0, PX, PX).data;
      const bits = [];
      const step = PX / N;
      for (let my = 0; my < N; my++) for (let mx = 0; mx < N; mx++) {
        let on = 0;
        for (let sy = 0; sy < step && !on; sy += 2) for (let sx = 0; sx < step && !on; sx += 2) {
          const px = Math.floor(mx * step + sx), py = Math.floor(my * step + sy);
          if (data[(py * PX + px) * 4 + 3] > 140) on = 1;
        }
        bits.push(on);
      }
      out[id] = bits;
    }
    return JSON.stringify(out);
  })()`;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
});
ws.close();

const raw = JSON.parse(result) as Record<string, number[]>;
const file: ItemMasksFile = { size: MASK_SIZE, masks: {} };
for (const item of items) {
  const bits = Uint8Array.from(raw[item.id]);
  const filled = bits.reduce((a, b) => a + b, 0);
  if (filled < 20) throw new Error(`物件 ${item.id} 的图标 ${item.icon} 渲染为空，检查字体`);
  file.masks[item.id] = encodeMask(bits);
  console.log(`${item.id.padEnd(24)} ${item.icon}  覆盖 ${((filled / bits.length) * 100).toFixed(0)}%`);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/data/item_masks.json");
writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
console.log(`已写入 ${out}`);
