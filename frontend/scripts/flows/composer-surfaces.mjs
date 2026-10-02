import { brand } from "../../src/branding.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPreview, assertFits } from "../preview-browser.mjs";

async function cameraChooser(page) {
  await page.getByTestId("agent-input-toolbar").getByRole("button", { name: "拍照", exact: true }).click();
  const camera = page.getByTestId("web-camera-dialog");
  await camera.waitFor();
  await camera.getByText("這部裝置未找到相機", { exact: false }).waitFor();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    camera.getByRole("button", { name: "系統拍照／選圖", exact: true }).click(),
  ]);
  assert.equal(new URL(page.url()).pathname, "/chat", "A single capture press stays in the conversation");
  assert.equal(chooser.isMultiple(), false);
  assert.equal(await chooser.element().getAttribute("capture"), "environment");
  assert.equal(await chooser.element().getAttribute("accept"), "image/jpeg,image/png");
  return chooser;
}
async function captureFile(page, name = "相機輸入示例.png") {
  const chooser = await cameraChooser(page);
  await chooser.setFiles({ name, mimeType: "image/png", buffer: await readFile(resolve("assets/brand/favicon.png")) });
  return chooser;
}
async function photoUri(page) {
  const image = page.getByTestId("composer-photo-preview").locator("img");
  await image.waitFor();
  await image.evaluate(element => element.decode());
  return image.getAttribute("src");
}

export async function verifyComposerSurfaces(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/chat", width, width < 400 ? 844 : 992, failures);
    await page.evaluate(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      globalThis.composerRevokedUris = [];
      URL.revokeObjectURL = uri => { globalThis.composerRevokedUris.push(uri); revoke(uri); };
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Synthetic missing camera", "NotFoundError"); };
    });
    const picker = page.getByRole("button", { name: /選擇孩子，目前/ });
    const surfaces = await picker.evaluate(element => ({
      control: getComputedStyle(element).backgroundColor,
      navigation: getComputedStyle(element.parentElement).backgroundColor,
    }));
    assert.equal(surfaces.control, "rgb(255, 255, 254)");
    assert.equal(surfaces.navigation, "rgb(227, 246, 245)");
    const fact = picker.locator("..").getByText("地區", { exact: true }).locator("..");
    assert.equal(await fact.evaluate(element => getComputedStyle(element).backgroundColor), surfaces.control);
    const rail = page.getByRole("button", { name: /資訊側欄/ });
    assert.equal(await rail.evaluate(element => getComputedStyle(element).backgroundColor), surfaces.control);
    const toolbar = page.getByTestId("agent-input-toolbar");
    for (const label of ["拍照", "檔案與來源", "語音輸入"]) {
      const control = toolbar.getByRole("button", { name: label, exact: true });
      const bounds = await control.boundingBox();
      assert.ok(bounds.width >= 48 && bounds.height >= 48, `Input target ${label} at ${width}`);
      assert.equal(await control.locator("svg").count(), 1);
    }
    const input = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    const draft = "  保留原有問題草稿；先核對照片來源。  ";
    await input.fill(draft);
    await toolbar.getByRole("button", { name: "語音輸入", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("app-dialog-surface");
    await dialog.getByText("語音輸入", { exact: true }).waitFor();
    await page.getByText("語音錄入及轉文字尚未接通。", { exact: false }).waitFor();
    await page.getByRole("button", { name: "繼續輸入文字", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "撰寫對話問題");
    assert.equal(await input.inputValue(), draft);
    await toolbar.getByRole("button", { name: "檔案與來源", exact: true }).click();
    await dialog.waitFor();
    await page.getByText("PDF／Word 尚未支援", { exact: false }).waitFor();
    await assertFits(page, `files menu ${width}`);
    await page.screenshot({ path: resolve(directory, `input-menu-${width}.png`) });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), draft);
    await page.getByText(brand.agentTitle, { exact: true }).click();
    await assertFits(page, `composer and surfaces ${width}`);
    if (width < 400) {
      const tools = await toolbar.boundingBox();
      const preview = await page.getByRole("button", { name: "預覽輸入", exact: true }).boundingBox();
      assert.ok(Math.abs(tools.y - preview.y) < 2, `Mobile input controls share one row at ${width}`);
    }
    await page.screenshot({ path: resolve(directory, `chat-${width}.png`) });
    await captureFile(page);
    const photo = page.getByTestId("composer-photo-preview");
    await photo.getByText("相機輸入示例.png", { exact: true }).waitFor();
    await photo.getByText("本地照片 · 未上傳／未送出", { exact: true }).waitFor();
    const firstUri = await photoUri(page);
    assert.equal(await input.inputValue(), draft);
    await assertFits(page, `inline camera preview ${width}`);
    await page.screenshot({ path: resolve(directory, `camera-${width}.png`) });
    if (width === 1440) {
      const cancelled = await cameraChooser(page);
      await cancelled.setFiles([]);
      assert.equal(await photoUri(page), firstUri, "Cancel retains the selected original");
      assert.equal(await input.inputValue(), draft);
      const invalid = await cameraChooser(page);
      await invalid.setFiles({ name: "不支援文件.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
      await page.getByRole("alert").getByText(/只接受 JPEG／PNG/).waitFor();
      assert.equal(await photoUri(page), firstUri, "Invalid input retains the selected original");
      assert.equal(await input.inputValue(), draft);
      await captureFile(page, "重新拍照示例.png");
      await photo.getByText("重新拍照示例.png", { exact: true }).waitFor();
      await page.waitForFunction(uri => globalThis.composerRevokedUris.includes(uri), firstUri);
      assert.equal(await page.getByRole("alert").count(), 0);
      const replacementUri = await photoUri(page);
      await page.getByRole("button", { name: "移除本地照片", exact: true }).focus();
      await page.keyboard.press("Enter");
      await photo.waitFor({ state: "hidden" });
      await page.waitForFunction(uri => globalThis.composerRevokedUris.includes(uri), replacementUri);
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "撰寫對話問題");
      assert.equal(await input.inputValue(), draft);
      await captureFile(page);
      const childUri = await photoUri(page);
      await picker.click();
      await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
      await photo.waitFor({ state: "hidden" });
      await page.waitForFunction(uri => globalThis.composerRevokedUris.includes(uri), childUri);
      assert.equal(await input.inputValue(), "");
      await picker.click();
      await page.getByRole("radio", { name: "小昕 · 約 3 歲 2 個月 · 截至 2026 年 9 月", exact: true }).click();
      assert.equal(await input.inputValue(), draft);
      assert.equal(await photo.count(), 0, "Returning to a child does not restore a disposed local photo");
      // Hold integrity calculation across a scope change; an old picker cannot fill the new child's composer.
      await page.evaluate(() => {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        globalThis.releaseComposerDigest = null;
        crypto.subtle.digest = (...args) => {
          globalThis.pendingComposerDigest = (async () => {
            await new Promise(resolve => { globalThis.releaseComposerDigest = resolve; });
            return digest(...args);
          })();
          return globalThis.pendingComposerDigest;
        };
        globalThis.restoreComposerDigest = () => { crypto.subtle.digest = digest; };
      });
      await captureFile(page, "遲到照片示例.png");
      await page.waitForFunction(() => !!globalThis.releaseComposerDigest);
      await picker.click();
      await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
      await page.evaluate(async () => {
        globalThis.releaseComposerDigest(); globalThis.restoreComposerDigest();
        await globalThis.pendingComposerDigest;
        await new Promise(requestAnimationFrame);
      });
      assert.equal(await photo.count(), 0, "A late integrity result cannot fill another child's composer");
      await picker.click();
      await page.getByRole("radio", { name: "小昕 · 約 3 歲 2 個月 · 截至 2026 年 9 月", exact: true }).click();
      assert.equal(await input.inputValue(), draft);
      await captureFile(page);
    }
    const departureUri = await photoUri(page);
    await page.getByRole("button", { name: "檔案與來源", exact: true }).click();
    await page.getByRole("button", { name: "貼上文字或網址", exact: true }).click();
    await page.waitForURL("**/sources");
    await page.waitForFunction(uri => globalThis.composerRevokedUris.includes(uri), departureUri);
    await assertFits(page, `source route ${width}`);
    await page.goBack();
    await page.getByTestId("agent-input-toolbar").waitFor();
    assert.equal(await input.inputValue(), draft, `Return from source preserves draft at ${width}`);
    assert.equal(await photo.count(), 0, "Leaving the chat disposes local photo input");
    if (width === 1440) {
      await page.getByRole("button", { name: "檔案與來源", exact: true }).click();
      await page.getByRole("button", { name: "選擇照片檔案", exact: true }).click();
      await page.waitForURL("**/photos");
      assert.equal(new URL(page.url()).search, "", "Ordinary photo picker does not retain camera intent");
      assert.equal(await page.locator('input[capture="environment"]').count(), 0);
      await page.getByRole("button", { name: "選擇原照片", exact: true }).waitFor();
      await page.locator('input[type="file"]').setInputFiles({ name: "一般選圖示例.png", mimeType: "image/png", buffer: await readFile(resolve("assets/brand/favicon.png")) });
      await page.getByText("一般選圖示例.png", { exact: false }).first().waitFor();
      await page.goBack();
      await page.getByTestId("agent-input-toolbar").waitFor();
      assert.equal(await input.inputValue(), draft);
    }
    if (width < 400) {
      await captureFile(page, "放大文字與照片預覽示例.png");
      await photoUri(page);
      await page.addStyleTag({ content: "input, textarea, [dir='auto'] { font-size: 150% !important; }" });
      await assertFits(page, `composer 150% Web text ${width}`);
      await page.screenshot({ path: resolve(directory, `chat-text-${width}.png`) });
    }
    await page.close();
  }
  return "composer: 4 widths, camera stays on /chat with native file fallback, inline image/draft preservation, cancel/reject/replace/remove, blob disposal on removal/scope/departure, late integrity result isolation, ordinary photo/source navigation, keyboard and 150% Web text; no real camera/microphone/Server";
}
