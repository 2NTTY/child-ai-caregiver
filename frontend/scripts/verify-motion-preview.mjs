import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8082";
const output = resolve("verification/motion-preview");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "msedge" }),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--disable-features=UseDawn,SkiaGraphite,Vulkan", "--use-gl=swiftshader"],
});

const errors = [];
try {
  for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 760 : 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`${width}px: ${error.message}`));
    await page.goto(new URL("/motion-preview", baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText("動態方向比較", { exact: true }).waitFor();
    await page.getByText("安靜回應", { exact: true }).waitFor();
    const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(geometry.page <= geometry.viewport + 1, `${width}px horizontal overflow: ${JSON.stringify(geometry)}`);
    await page.waitForTimeout(550);
    if (width === 1440 || width === 320) await page.screenshot({ path: resolve(output, `calm-${width}.png`) });

    await page.getByRole("tab", { name: "B · 導向" }).click();
    await page.getByText("路徑導向", { exact: true }).waitFor();
    await page.waitForTimeout(550);
    if (width === 1440) await page.screenshot({ path: resolve(output, "guided-1440.png") });
    await page.getByRole("button", { name: "切換孩子" }).click();
    await page.getByText("阿樂", { exact: true }).waitFor();
    await page.getByText("檔案待核對", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "C · 活潑" }).click();
    await page.getByText("溫暖微動", { exact: true }).waitFor();
    await page.waitForTimeout(550);
    if (width === 1440 || width === 320) await page.screenshot({ path: resolve(output, `warm-${width}.png`) });
    await page.getByRole("button", { name: "展開詳情" }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("展開後仍維持「待確認」；動畫不代表已保存。", { exact: true }).waitFor();
    await page.getByText("待確認", { exact: true }).waitFor();

    const reduceToggle = page.getByRole("switch", { name: "減少動態示例" });
    await reduceToggle.focus();
    await page.keyboard.press("Space");
    assert.equal(await reduceToggle.isChecked(), true);
    await page.getByRole("button", { name: "重播進場" }).click();
    await page.getByText("待確認", { exact: true }).waitFor();
    await reduceToggle.click();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("系統已要求減少動態，示例固定為靜態。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "重播進場" }).click();
    await page.getByText("待確認", { exact: true }).waitFor();
    await page.close();
    await context.close();
    console.log(`${width}px: all three motion options, keyboard and reduced motion passed`);
  }
  assert.deepEqual(errors, [], `Browser exceptions: ${errors.join("; ")}`);
} finally {
  await browser.close();
}
