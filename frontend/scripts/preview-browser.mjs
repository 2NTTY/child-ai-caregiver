import assert from "node:assert/strict";
import { chromium } from "playwright-core";

export async function launchPreviewBrowser() {
  return chromium.launch({ ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "msedge" }), headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--disable-features=UseDawn,SkiaGraphite,Vulkan", "--use-gl=swiftshader"] });
}
export async function openPreview(browser, path, width = 1440, height = 992, failures = []) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => failures.push(`${path} ${width}: ${error.message}`));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) failures.push(`Unexpected API call: ${request.method()}`); });
  await page.goto(new URL(path, process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8082").toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  if (path !== "/login") await page.getByText("介面預覽 · 合成資料 · 未接駁 Server", { exact: true }).waitFor({ timeout: 60000 });
  await page.getByTestId("frontend-preview-ready").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => [...document.images].every(image => image.complete), undefined, { timeout: 10000 });
  return page;
}
export async function assertFits(page, label) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.page <= geometry.width + 1 && geometry.body <= geometry.width + 1, `${label}: page overflow ${JSON.stringify(geometry)}`);
  const controls = await page.locator("input, textarea, [role='button']").evaluateAll(elements => elements.filter(element => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    // Horizontal tab/fact lists deliberately scroll; offscreen controls inside them are not page overflow.
    let parent = element.parentElement;
    while (parent) { const style = getComputedStyle(parent); if (parent.scrollWidth > parent.clientWidth + 1 && ["auto", "scroll"].includes(style.overflowX)) return false; parent = parent.parentElement; }
    return bounds.left < -1 || bounds.right > innerWidth + 1;
  }).map(element => ({ label: element.getAttribute("aria-label") ?? element.textContent?.slice(0, 50), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })));
  assert.deepEqual(controls, [], `${label}: clipped controls ${JSON.stringify(controls)}`);
}
export async function selectOption(scope, label, option) {
  await scope.getByRole("button", { name: new RegExp(`^${label}：`) }).click();
  // Paper portals are attached to the page, outside a scoped member/card locator.
  const page = typeof scope.page === "function" ? scope.page() : scope;
  await page.getByLabel(`${label}選項：${option}`, { exact: true }).click();
}
