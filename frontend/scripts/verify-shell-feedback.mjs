import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFits, launchPreviewBrowser, openPreview } from "./preview-browser.mjs";

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? "verification/fe-w28-shell-feedback");
const browser = await launchPreviewBrowser(), failures = [], metrics = [];
await mkdir(directory, { recursive: true });
async function scrollGeometry(page) {
  const bars = await page.locator(".os-scrollbar").evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    const horizontal = element.classList.contains("os-scrollbar-horizontal");
    const handle = element.querySelector(".os-scrollbar-handle").getBoundingClientRect();
    const track = element.querySelector(".os-scrollbar-track");
    return [{ horizontal, size: horizontal ? box.height : box.width, thumb: horizontal ? handle.height : handle.width,
      position: getComputedStyle(element).position, track: getComputedStyle(track).backgroundColor }];
  }));
  assert.ok(bars.length > 0);
  for (const bar of bars) {
    assert.equal(bar.size, 6); assert.equal(bar.thumb, 4);
    assert.equal(bar.position, "absolute"); assert.equal(bar.track, "rgba(0, 0, 0, 0)");
  }
  const gutters = await page.locator('[data-overlayscrollbars-viewport]').evaluateAll(elements => elements.map(element => element.offsetWidth - element.clientWidth));
  assert.ok(gutters.length > 0); assert.ok(gutters.every(value => value === 0));
  return { bars, gutters };
}
try {
  for (const width of [320, 390, 900, 1024, 1280, 1440]) {
    const page = await openPreview(browser, "/", width, width >= 900 ? 992 : 844, failures);
    const actions = page.getByTestId("header-actions");
    assert.equal(await actions.getByRole("button").count(), 2);
    assert.equal(await actions.getByRole("link").count(), 0);
    assert.equal(await actions.getByLabel("已連接", { exact: true }).count(), 0);
    await page.getByRole("link", { name: "與 Agent 對話", exact: true }).click();
    await page.getByRole("textbox", { name: "撰寫對話問題", exact: true }).waitFor();
    await page.evaluate(() => {
      window.homeFrames = []; const start = performance.now();
      const record = () => {
        const child = document.querySelector('[data-testid="mobile-child-card"]');
        const quick = document.querySelector('[data-testid="mobile-quick-actions"]');
        const grid = document.querySelector('[data-testid="desktop-home-grid"]');
        const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        if (child || grid) window.homeFrames.push({ child: child && box(child.querySelector('[role="button"]')),
          quick: quick && [...quick.children].map(box), columns: grid && [...grid.children].map(box) });
        if (performance.now() - start < 500) requestAnimationFrame(record);
      }; requestAnimationFrame(record);
    });
    await page.getByRole("link", { name: "主頁", exact: true }).click();
    await page.waitForTimeout(550);
    const frames = await page.evaluate(() => window.homeFrames);
    assert.ok(frames.length > 1);
    assert.equal(new Set(frames.map(frame => JSON.stringify(frame))).size, 1, "Returning home keeps its first-frame geometry at " + width);
    await assertFits(page, "returned home " + width);
    if (width === 390) await page.screenshot({ path: resolve(directory, "home-stable-390.png") });
    await page.getByRole("link", { name: "與 Agent 對話", exact: true }).click();
    const tabs = page.getByTestId("chat-answer").getByTestId("answer-source-tabs");
    await tabs.waitFor(); await tabs.scrollIntoViewIfNeeded();
    assert.equal((await tabs.boundingBox()).height, 48, "The horizontal wrapper keeps the source strip height");
    let dragged = false;
    if (width < 650) {
      const handle = tabs.locator("..").locator(".os-scrollbar-horizontal .os-scrollbar-handle");
      await handle.waitFor({ state: "visible" });
      const before = await tabs.evaluate(element => element.scrollLeft), box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
      assert.ok(await tabs.evaluate(element => element.scrollLeft) > before, "Horizontal overlay thumb remains draggable");
      dragged = true;
    }
    await tabs.getByRole("tab").first().click();
    await page.getByTestId("chat-answer").getByTestId("source-details-panel").waitFor();
    const scrolls = await scrollGeometry(page);
    await assertFits(page, "chat with matching scrollbars " + width);
    if (width === 390 || width === 1440) await page.screenshot({ path: resolve(directory, "scrollbars-" + width + ".png") });
    if (width < 650) {
      await page.getByRole("button", { name: "更多頁面", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "設定", exact: true }).click();
      await page.getByRole("heading", { name: "設定", exact: true }).waitFor();
      const first = page.getByRole("tab", { name: "個人與帳戶", exact: true });
      const height = (await first.boundingBox()).height;
      assert.ok(height >= 48 && height < 60, "Hidden horizontal bars retain natural tab height");
      await page.getByRole("tab", { name: "資料與私隱", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.getByRole("tab", { name: "資料與私隱", exact: true }).getAttribute("aria-selected"), "true");
      await assertFits(page, "settings via More " + width);
    }
    metrics.push({ width, sampledFrames: frames.length, firstFrame: frames[0], scrolls, dragged });
    await page.close();
  }
  const more = await openPreview(browser, "/more", 390, 844, failures);
  await more.getByRole("heading", { name: "更多頁面", exact: true }).waitFor();
  await more.getByRole("button", { name: "設定", exact: true }).click();
  await more.getByRole("heading", { name: "設定", exact: true }).waitFor();
  await more.close();
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, "shell-feedback-checks.json"), JSON.stringify({ at: new Date().toISOString(),
    scope: "Local synthetic Web UI: header actions, return-home first frames, overlay geometry/dragging, source strip and hidden settings tabs. No API, model, notification, authentication or native-device acceptance.", metrics, moreRoute: "Settings remains reachable through the new route; native tab wiring is bundle-only evidence.", failures }, null, 2) + "\n");
  console.log(JSON.stringify({ widths: metrics.map(item => item.width), firstFramesStable: true, matchingOverlaySize: "6px/4px", failures }));
} finally { await browser.close(); }
