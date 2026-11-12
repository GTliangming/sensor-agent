import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import type { Page } from "playwright-core";
import { LEVELS } from "../src/data/all-levels";
import { solveLevel } from "../src/core/solver";
import { launchChrome } from "./browser";

// 浏览器端到端测试：用真实 Chrome 打开构建产物，按最优顺序点完 10 关，并验证救场流程。
// 点击位置由页面内的 findTapPoint 给出（只有 URL 带 ?e2e 时才暴露），保证点的是物件真正露出来的地方。
// 用法：npm run e2e（会先构建）。截图输出到 e2e-output/。

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "e2e-output");
mkdirSync(outDir, { recursive: true });

const server = await preview({ root, preview: { port: 4317, strictPort: false }, logLevel: "warn" });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("预览服务没有启动");

const browser = await launchChrome();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

async function tapInstance(p: Page, id: string): Promise<boolean> {
  const point = await p.evaluate((i) => (window as any).__e2e.tapPoint(i), id);
  if (!point) return false;
  await p.mouse.click(point.x, point.y);
  return true;
}

async function openLevel(p: Page, number: number) {
  await p.locator(".level-card").nth(number - 1).click();
  await p.waitForSelector(".hud-header");
  await p.waitForTimeout(500);
}

const panelTitle = (p: Page) => p.evaluate(() => document.querySelector(".panel__title")?.textContent ?? null);
const clickButton = (p: Page, text: string) =>
  p.evaluate((t) => [...document.querySelectorAll<HTMLButtonElement>(".btn")].find((b) => b.textContent?.includes(t))?.click(), text);

try {
  await page.goto(`${url}?e2e`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".level-card");

  for (const level of LEVELS) {
    await openLevel(page, level.levelNumber);
    if (level.levelNumber === 1) {
      const stageBox = await page.locator(".stage").boundingBox();
      check(stageBox?.height === 844 && stageBox?.width === 390, "全面屏手机上舞台铺满整屏（390×844，无上下黑边）");
      check((await page.locator(".guide-hand").count()) === 1, "第 1 关首次游玩显示手指引导");
    }
    if (level.levelNumber === 1 || level.levelNumber === 10) {
      await page.screenshot({ path: join(outDir, `${level.id}-start.png`) });
    }
    let untappable = 0;
    for (const id of solveLevel(level).path) {
      if (!(await tapInstance(page, id))) untappable++;
      await page.waitForTimeout(60);
    }
    // 飞入动画按渲染帧推进，软件渲染下帧率低、墙钟时间会超过动画时长：等面板出现而不是固定等 900ms
    await page.waitForSelector(".panel__title", { timeout: 8000 }).catch(() => null);
    const title = await panelTitle(page);
    const ok = title === "收拾干净了！" && untappable === 0;
    if (!ok) {
      const counts = await page.locator(".target-slot__count").allTextContents();
      const storage = await page.evaluate(() => document.querySelector(".storage-label")?.textContent);
      console.log(`      面板=${title} 目标=${counts.join(" ")} ${storage}`);
      await page.screenshot({ path: join(outDir, `${level.id}-fail.png`) });
    }
    check(ok, `${level.id} ${level.name} 通关（找不到可点位置 ${untappable} 个）`);
    await clickButton(page, "返回选关");
    await page.waitForTimeout(300);
    if (!ok) break;
  }

  const save = JSON.parse((await page.evaluate(() => localStorage.getItem("yiwubainian.save"))) ?? "{}");
  check(save.unlockedLevel === 11 && save.completedLevels?.length === 10, "存档记录 10 关全部通关");
  // 被压住的物件：点它露出来的部分，不能被拾取
  {
    const level = LEVELS[2];
    await openLevel(page, 3);
    const blocked = level.itemInstances.find((i) => i.blocking.length > 0)!;
    const before = await page.evaluate(() => document.querySelector(".storage-label")?.textContent);
    const counts = await page.locator(".target-slot__count").allTextContents();
    await tapInstance(page, blocked.id);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.querySelector(".storage-label")?.textContent);
    const countsAfter = await page.locator(".target-slot__count").allTextContents();
    check(before === after && counts.join() === countsAfter.join(), `点被压住的 ${blocked.id} 不会被拾取`);
    await page.locator("button[aria-label='返回选关']").click();
    await page.waitForTimeout(300);
  }

  // 只差最后 1 个时，找寻格上出现放大镜，点它免费定位
  {
    const level = LEVELS[0];
    await openLevel(page, 1);
    const first = level.objectives[0];
    const instances = level.itemInstances.filter((i) => i.itemId === first.itemId && i.blocking.length === 0);
    for (const inst of instances.slice(0, first.requiredCount - 1)) {
      await tapInstance(page, inst.id);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
    check((await page.locator(".target-slot__locate").count()) === 1, "目标只差最后 1 个时显示放大镜");
    const hintsBefore = await page.locator(".hint-btn__count").textContent();
    await page.locator(".target-slot--locate").click();
    await page.waitForTimeout(300);
    check((await page.locator(".hint-btn__count").textContent()) === hintsBefore, "点放大镜定位不消耗提示次数");
    await page.locator("button[aria-label='返回选关']").click();
    await page.waitForTimeout(300);
  }

  // 救场：第 1 关连点 4 个没被压住的干扰物 → 归位格满 → 模拟广告 → 归位格清空、继续游戏
  {
    const level = LEVELS[0];
    await openLevel(page, 1);
    // 断点续玩：上一段从第 1 关退出时存了快照（已找 2 件、分数 210），进关先问“继续还是重新开始”
    check((await panelTitle(page)) === "上次玩到一半", "重进有快照的关卡时显示断点续玩提示");
    await clickButton(page, "继续玩");
    await page.waitForTimeout(300);
    const countsAfterResume = await page.locator(".target-slot__count").allTextContents();
    const scoreAfterResume = await page.evaluate(() => document.querySelector(".hud-header__score")?.textContent ?? "");
    check(countsAfterResume[0] === "1/3" && scoreAfterResume.includes("210"), "点继续玩恢复快照（还差 1 个目标、分数 210）");
    // 回选关再进一次，选“重新开始”应从干净局面开始
    await page.locator("button[aria-label='返回选关']").click();
    await page.waitForTimeout(300);
    await openLevel(page, 1);
    check((await panelTitle(page)) === "上次玩到一半", "退出后重进仍显示断点续玩提示");
    await clickButton(page, "重新开始");
    await page.waitForTimeout(300);
    const countsFresh = await page.locator(".target-slot__count").allTextContents();
    const scoreFresh = await page.evaluate(() => document.querySelector(".hud-header__score")?.textContent ?? "");
    check(countsFresh[0] === "3/3" && scoreFresh.includes("0"), "点重新开始清空快照、从头开始");
    check((await page.locator(".guide-hand").count()) === 0, "第 1 关通关后再玩不再显示引导");
    const targetIds = new Set(level.objectives.map((o) => o.itemId));
    const wrong = level.itemInstances.filter((i) => !targetIds.has(i.itemId) && i.blocking.length === 0).slice(0, 4);
    for (const [n, inst] of wrong.entries()) {
      await tapInstance(page, inst.id);
      await page.waitForTimeout(n === 2 ? 700 : 120);
      if (n === 2) {
        const warn = await page.evaluate(() => document.querySelector(".storage-label")?.textContent ?? "");
        check(warn.includes("只剩 1 格"), "归位格只剩 1 格时显示警告");
      }
    }
    // 归位格满的面板在第 4 个物件飞入（0.8s）后才出现，软件渲染下等面板而不是固定等 800ms
    await page.waitForSelector(".panel__title", { timeout: 8000 }).catch(() => null);
    check((await panelTitle(page)) === "归位格满了", "归位格满后弹出救场面板");
    await page.screenshot({ path: join(outDir, "rescue-panel.png") });
    await clickButton(page, "看广告");
    await page.waitForTimeout(1700);
    const label = await page.evaluate(() => document.querySelector(".storage-label")?.textContent);
    check(label === "归位格 0/4" && (await panelTitle(page)) === null, "看完模拟广告后归位格清空并继续游戏");

    // 切到后台自动暂停
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    check((await panelTitle(page)) === "暂停", "切到后台自动暂停");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    });
    await clickButton(page, "继续");
    await page.waitForTimeout(300);
    check((await panelTitle(page)) === null, "暂停后点继续恢复游戏");
  }

  // 桌面浏览器（横向宽屏）按 9:16 居中显示
  {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await desktop.goto(`${url}?e2e`);
    await openLevel(desktop, 1);
    const box = await desktop.locator(".stage").boundingBox();
    check(!!box && Math.abs(box.width / box.height - 9 / 16) < 0.01 && box.height === 800, "桌面浏览器按 9:16 居中显示");
    await desktop.screenshot({ path: join(outDir, "desktop-level_001.png") });
    await desktop.close();
  }
} finally {
  await browser.close();
  await server.close();
}

check(errors.length === 0, `页面无运行时错误${errors.length ? "：" + errors.join("; ") : ""}`);
console.log(`\n${failures.length === 0 ? "E2E PASSED" : `E2E FAILED（${failures.length} 项）`}`);
process.exit(failures.length === 0 ? 0 : 1);
