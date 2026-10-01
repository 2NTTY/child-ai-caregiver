import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPreview, assertFits } from "../preview-browser.mjs";

export async function verifyComposerSurfaces(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/chat", width, width < 400 ? 844 : 992, failures);
    const picker = page.getByRole("button", { name: /選擇孩子，目前/ });
    const surfaces = await picker.evaluate(element => ({
      control: getComputedStyle(element).backgroundColor,
      navigation: getComputedStyle(element.parentElement).backgroundColor,
    }));
    assert.equal(surfaces.control, "rgb(255, 255, 255)");
    assert.equal(surfaces.navigation, "rgb(246, 244, 236)");
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
    await page.getByText("育伴港 Agent 對話", { exact: true }).click();
    await assertFits(page, `composer and surfaces ${width}`);
    if (width < 400) {
      const tools = await toolbar.boundingBox();
      const preview = await page.getByRole("button", { name: "預覽輸入", exact: true }).boundingBox();
      assert.ok(Math.abs(tools.y - preview.y) < 2, `Mobile input controls share one row at ${width}`);
    }
    await page.screenshot({ path: resolve(directory, `chat-${width}.png`) });
    await toolbar.getByRole("button", { name: "拍照", exact: true }).click();
    await page.waitForURL("**/photos?input=camera");
    await page.getByRole("button", { name: "拍照或選圖", exact: true }).waitFor();
    const cameraFile = page.locator('input[type="file"][capture="environment"]');
    assert.equal(await cameraFile.getAttribute("accept"), "image/jpeg,image/png");
    await cameraFile.setInputFiles({ name: "相機輸入示例.png", mimeType: "image/png", buffer: await readFile(resolve("assets/brand/favicon.png")) });
    await page.getByText("相機輸入示例.png", { exact: false }).first().waitFor();
    await page.getByText("此隔離預覽不會上傳照片", { exact: false }).waitFor();
    await assertFits(page, `camera photo route ${width}`);
    await page.screenshot({ path: resolve(directory, `camera-${width}.png`) });
    await page.goBack();
    await page.getByTestId("agent-input-toolbar").waitFor();
    assert.equal(await input.inputValue(), draft, `Return from photo preserves draft at ${width}`);
    await page.getByRole("button", { name: "檔案與來源", exact: true }).click();
    await page.getByRole("button", { name: "貼上文字或網址", exact: true }).click();
    await page.waitForURL("**/sources");
    await assertFits(page, `source route ${width}`);
    await page.goBack();
    await page.getByTestId("agent-input-toolbar").waitFor();
    assert.equal(await input.inputValue(), draft, `Return from source preserves draft at ${width}`);
    if (width === 1440) {
      await page.getByRole("button", { name: "檔案與來源", exact: true }).click();
      await page.getByRole("button", { name: "選擇照片檔案", exact: true }).click();
      await page.waitForURL("**/photos");
      assert.equal(new URL(page.url()).search, "", "Ordinary photo picker does not retain camera intent");
      assert.equal(await page.locator('input[capture="environment"]').count(), 0);
      await page.goBack();
      await page.getByTestId("agent-input-toolbar").waitFor();
      assert.equal(await input.inputValue(), draft);
    }
    if (width < 400) {
      await page.addStyleTag({ content: "input, textarea, [dir='auto'] { font-size: 150% !important; }" });
      await assertFits(page, `composer 150% Web text ${width}`);
      await page.screenshot({ path: resolve(directory, `chat-text-${width}.png`) });
    }
    await page.close();
  }
  return "composer/surfaces: 4 widths, distinct shared controls, SVG/48 targets, keyboard/file/voice statuses, camera picker/file preview, source navigation, retained question and 150% Web text; no real camera/microphone/Server";
}
