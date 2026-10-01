import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits } from "../preview-browser.mjs";

async function enterSettings(page, width) {
  if (width >= 900) await page.getByRole("link", { name: "設定", exact: true }).click();
  else {
    await page.getByRole("button", { name: "更多頁面", exact: true }).click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
  }
  await page.waitForURL("**/settings");
  await page.getByRole("tab", { name: "應用偏好", exact: true }).click();
}

async function imageUri(page) {
  return page.getByTestId("home-background-image").evaluate(element => element.querySelector("img")?.getAttribute("src") ?? "");
}

async function chooseImage(page, image) {
  const chooserPromise = page.waitForEvent("filechooser");
  const button = page.getByRole("button", { name: "選擇背景圖片", exact: true });
  await button.focus(); await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(image ? [image] : []);
}

export async function verifyAppearance(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/", width, width < 400 ? 844 : 992, failures);
    await page.evaluate(() => {
      window.backgroundReleases = [];
      const release = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = uri => { window.backgroundReleases.push(uri); release(uri); };
    });
    const data = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 480;
      const context = canvas.getContext("2d");
      context.fillStyle = "#272343"; context.fillRect(0, 0, 800, 480);
      context.fillStyle = "#BAE8E8"; context.fillRect(550, 0, 250, 480);
      context.fillStyle = "#FFD803"; context.fillRect(600, 120, 120, 120);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const image = { name: "synthetic-background.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") };
    if (width >= 900) {
      const button = page.getByTestId("agent-entry");
      assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 216, 3)");
    }
    if (width >= 1024) {
      const banner = await page.getByTestId("desktop-home-banner").boundingBox();
      const art = await page.getByTestId("home-background-image").boundingBox();
      assert.ok(art.x >= banner.x + banner.width * .45 && art.x + art.width >= banner.x + banner.width - 2, "Original illustration reaches the visible right side");
    }
    await page.screenshot({ path: resolve(directory, `home-${width}.png`) });
    await enterSettings(page, width);
    const card = page.getByTestId("background-settings");
    const original = await imageUri(page);
    await chooseImage(page, null);
    assert.equal(await imageUri(page), original, "Cancelling the file chooser preserves the original");
    await chooseImage(page, image);
    await card.getByText("本次背景：synthetic-background.png", { exact: true }).waitFor();
    const selected = await imageUri(page);
    assert.ok(selected.startsWith("blob:"), "Local selection uses an object URL");
    await assertFits(page, "background settings " + width);
    await page.screenshot({ path: resolve(directory, `background-settings-${width}.png`) });
    await chooseImage(page, { name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await card.getByText("請選擇 4 MiB 以內的 JPG、PNG 或 WebP 圖片。原有背景仍然保留。", { exact: true }).waitFor();
    assert.equal(await imageUri(page), selected, "Invalid format preserves the current image");
    await chooseImage(page, { name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    await card.getByText("未能讀取這張背景圖片，原有背景仍然保留。請選擇另一張圖片。", { exact: true }).waitFor();
    assert.equal(await imageUri(page), selected, "Unreadable image preserves the current image");
    await page.getByRole("link", { name: "育伴港，返回主頁", exact: true }).click();
    await page.waitForURL(/\/\/?$/);
    assert.equal(await imageUri(page), selected, "Background survives navigation within the preview");
    await assertFits(page, "custom homepage " + width);
    await page.screenshot({ path: resolve(directory, `custom-home-${width}.png`) });
    await enterSettings(page, width);
    await chooseImage(page, { ...image, name: "replacement.png" });
    await card.getByText("本次背景：replacement.png", { exact: true }).waitFor();
    const replacement = await imageUri(page);
    assert.ok(await page.evaluate(uri => window.backgroundReleases.includes(uri), selected), "Replaced object URL released");
    await card.getByRole("button", { name: "恢復育伴港原圖", exact: true }).click();
    assert.equal(await imageUri(page), original);
    assert.ok(await page.evaluate(uri => window.backgroundReleases.includes(uri), replacement), "Restored object URL released");
    assert.equal(await card.getByRole("button", { name: "恢復育伴港原圖", exact: true }).isEnabled(), false);
    if (width === 390 || width === 320) {
      await page.evaluate(() => {
        for (const element of document.querySelectorAll('input,textarea,[dir="auto"]')) {
          const style = getComputedStyle(element);
          element.style.fontSize = `${parseFloat(style.fontSize) * 1.5}px`;
          if (style.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(style.lineHeight) * 1.5}px`;
        }
      });
      await assertFits(page, "background settings 150% text " + width);
      await page.screenshot({ path: resolve(directory, `background-large-text-${width}.png`) });
    }
    if (width === 1440) {
      await chooseImage(page, image);
      await card.getByText("本次背景：synthetic-background.png", { exact: true }).waitFor();
      const lastImage = await imageUri(page);
      await page.getByRole("tab", { name: "個人與帳戶", exact: true }).click();
      await page.getByRole("button", { name: "切換帳戶", exact: true }).click();
      await page.waitForURL("**/login");
      await page.getByRole("button", { name: "登入（預覽）", exact: true }).waitFor();
      await page.waitForFunction(uri => window.backgroundReleases.includes(uri), lastImage, { timeout: 4000 });
    }
    await page.close();
  }
  return "appearance: four widths, keyboard file chooser, cancellation/invalid/corrupt selection preservation, cross-route background, replacement/reset/exit disposal, 150% mobile Web text; no upload or persistence";
}
