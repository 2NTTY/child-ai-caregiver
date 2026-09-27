import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8081";
const screenshotDir = resolve("verification/screenshots");
await mkdir(screenshotDir, { recursive: true });

async function waitForPreviewReady(page) {
  await page.waitForFunction(() => {
    const control = document.querySelector('[aria-label="切換合成預覽情境"]');
    return control && document.images.length >= 2 && [...document.images].every(image => image.complete && image.naturalWidth > 0);
  }, undefined, { timeout: 60_000 });
}

const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "msedge" }),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--disable-features=UseDawn,SkiaGraphite,Vulkan", "--use-gl=swiftshader"],
});

const pageErrors = [];
try {
  for (const width of [1586, 1440, 1024, 390, 320]) {
    const height = width === 1586 ? 992 : width >= 1024 ? 1000 : width === 390 ? 844 : 720;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on("pageerror", error => pageErrors.push(`${width}: ${error.message}`));
    await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText(width >= 900 ? "育伴港 · 基本聊天" : "把每天的細節", { exact: false }).first().waitFor({ timeout: 60_000 });
    await waitForPreviewReady(page);
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      controls: [...document.querySelectorAll("[role='button'], button")].filter(el => {
        const box = el.getBoundingClientRect();
        return box.height > 0 && box.top < window.innerHeight && box.bottom > 0 && (box.left < -1 || box.right > window.innerWidth + 1);
      }).map(el => ({ name: el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30), x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right })),
    }));
    assert.equal(geometry.viewport, width);
    assert.ok(geometry.page <= width + 1, `horizontal page overflow at ${width}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.body <= width + 1, `horizontal body overflow at ${width}: ${JSON.stringify(geometry)}`);
    assert.deepEqual(geometry.controls, [], `clipped visible controls at ${width}`);
    await page.screenshot({ path: resolve(screenshotDir, `home-${width}.png`) });
    if (width < 1024) {
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 650);
      await page.waitForTimeout(180);
      await page.screenshot({ path: resolve(screenshotDir, `home-${width}-lower.png`) });
      const lowerWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(lowerWidth <= width + 1, `horizontal overflow after scrolling at ${width}`);
    }
    if (width === 1586) {
      const chatAction = page.getByRole("button", { name: "開啟基本聊天" });
      await chatAction.focus();
      await page.keyboard.press("Enter");
      await page.getByText("「基本聊天」屬現有產品功能", { exact: false }).waitFor();
      console.log("Desktop CTA: keyboard activation explains the formal chat handoff without sending a request");
    }
    console.log(`${width} CSS px: no horizontal overflow, visible controls fit, screenshot saved`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => pageErrors.push(`interaction: ${error.message}`));
  await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForPreviewReady(page);
  const controlsToggle = page.getByRole("button", { name: "切換合成預覽情境" });
  await controlsToggle.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "結果未知", exact: true }).waitFor();
  const unknown = page.getByRole("button", { name: "結果未知", exact: true });
  await unknown.focus();
  await page.keyboard.press("Enter");
  await page.getByText("提交結果尚未確認", { exact: true }).waitFor();
  const review = page.getByRole("button", { name: "查核原操作", exact: true });
  await review.focus();
  await page.keyboard.press("Enter");
  await page.getByText("結果未知的正式操作必須用原 opId 查核", { exact: false }).waitFor();
  await page.screenshot({ path: resolve(screenshotDir, "home-390-unknown.png") });
  console.log("Keyboard: scenario control and original-operation review respond to Enter");

  for (const [scenario, visibleText] of [
    ["待確認", "有一項內容等你確認"],
    ["處理中", "正在提交原操作"],
    ["已保存", "原操作已確認保存"],
    ["失敗", "原操作確定未成功"],
    ["離線", "目前離線；以下可能是較早讀取的資料"],
    ["讀取中", "正在讀取已確認記錄"],
    ["尚無孩子", "先建立第一位孩子的檔案"],
  ]) {
    await page.getByRole("button", { name: scenario, exact: true }).click();
    await page.getByText(visibleText, { exact: false }).first().waitFor();
  }
  console.log("Synthetic states: confirmation, saving, saved, failed, offline, loading, empty are distinguishable");

  await page.getByRole("button", { name: "一般", exact: true }).click();
  await controlsToggle.click();
  await page.getByRole("button", { name: /選擇孩子/ }).click();
  await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月" }).click();
  await page.getByText("課後記錄", { exact: true }).waitFor();
  assert.equal(await page.getByText("睡眠記錄", { exact: true }).count(), 0);
  await page.getByText("1 項", { exact: true }).first().waitFor();
  await page.getByRole("textbox", { name: "篩選下方已載入的記錄" }).fill("不存在的資料");
  await page.getByText("這幾項已載入記錄中沒有符合的內容。", { exact: true }).waitFor();
  console.log("Child switching and local record filtering update the visible data");
  await page.close();

  assert.deepEqual(pageErrors, [], `browser exceptions: ${pageErrors.join("; ")}`);
  console.log("No browser page errors");
} finally {
  await browser.close();
}
