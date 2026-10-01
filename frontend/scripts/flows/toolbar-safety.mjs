import assert from "node:assert/strict";
import { resolve } from "node:path";
import { brand } from "../../src/branding.ts";
import { openPreview, assertFits } from "../preview-browser.mjs";

const red = "rgb(149, 64, 38)";
const white = "rgb(255, 255, 254)";
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function assertDanger(page, title, submitLabel) {
  const dialog = page.getByTestId("app-dialog-surface");
  const bounds = await dialog.boundingBox();
  const size = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width + 1 && bounds.y + bounds.height <= size.height + 1, `Danger dialog fits ${size.width}: ${JSON.stringify(bounds)}`);
  assert.equal(await dialog.evaluate(e => getComputedStyle(e).borderColor), red);
  assert.equal(await page.getByRole("heading", { name: title, exact: true }).evaluate(e => getComputedStyle(e).color), red);
  // Paper paints its button surface on the container; the accessible button is inside it.
  assert.equal(await button(page, submitLabel).evaluate(e => getComputedStyle(e.parentElement).backgroundColor), red);
  await assertFits(page, `${title} ${size.width}`);
}

export async function verifyToolbarSafety(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const height = width >= 1024 ? 992 : width === 390 ? 844 : 720;
    const home = await openPreview(browser, "/", width, height, failures);
    const actions = home.getByTestId("header-actions");
    const metrics = await actions.getByRole("button").evaluateAll(elements => elements.map(e => {
      const bounds = e.getBoundingClientRect(), style = getComputedStyle(e), outer = getComputedStyle(e.parentElement);
      return { width: bounds.width, height: bounds.height, center: bounds.y + bounds.height / 2, radius: style.borderRadius, border: style.borderColor, background: outer.backgroundColor, icon: e.querySelector("svg")?.getAttribute("width") };
    }));
    assert.equal(metrics.length, 2);
    const target = width < 650 ? 48 : 44;
    for (const metric of metrics) {
      assert.equal(metric.width, target); assert.equal(metric.height, target);
      assert.equal(metric.background, white); assert.equal(metric.icon, "22");
    }
    assert.equal(metrics[0].radius, metrics[1].radius); assert.equal(metrics[0].border, metrics[1].border);
    assert.ok(Math.abs(metrics[0].center - metrics[1].center) < 1, "Toolbar controls share a center line");
    if (width >= 1024) {
      const connection = actions.getByLabel("已連接", { exact: true });
      const box = await connection.boundingBox();
      assert.ok(Math.abs(box.y + box.height / 2 - metrics[0].center) < 1, "Passive connection status is centered");
      assert.equal(await connection.evaluate(e => getComputedStyle(e).backgroundColor), white);
      assert.equal(await connection.getAttribute("role"), null, "Connection status is not an action button");
    }
    await assertFits(home, `toolbar ${width}`);
    await home.screenshot({ path: resolve(directory, `home-${width}.png`) });
    if (width === 1440) await actions.screenshot({ path: resolve(directory, "toolbar-1440.png") });
    const rail = actions.getByRole("button", { name: /資訊側欄$/ });
    const expanded = await rail.getAttribute("aria-expanded");
    await rail.focus(); await home.keyboard.press("Enter");
    assert.equal(await rail.getAttribute("aria-expanded"), expanded === "true" ? "false" : "true");
    await rail.focus(); await home.keyboard.press("Enter");
    assert.equal(await rail.getAttribute("aria-expanded"), expanded);
    await button(home, "開啟訊息提示").focus(); await home.keyboard.press("Enter");
    await home.getByRole("dialog").waitFor();
    await home.keyboard.press("Escape");
    await home.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await home.getByRole("dialog").count(), 0);
    assert.equal(await home.evaluate(() => document.activeElement?.getAttribute("aria-label")), "開啟訊息提示");
    await home.close();

    const profile = await openPreview(browser, "/profile", width, height, failures);
    await button(profile, "刪除整位孩子（預覽）").focus(); await profile.keyboard.press("Enter");
    const submit = button(profile, "確認並模擬刪除整位孩子");
    assert.ok(await submit.isDisabled());
    await profile.getByRole("textbox", { name: "核對刪除孩子稱呼", exact: true }).fill("小昕");
    await profile.getByRole("checkbox", { name: "我明白會永久刪除小昕及全部關聯資料", exact: true }).click();
    assert.ok(await submit.isEnabled());
    await assertDanger(profile, "永久刪除整位孩子", "確認並模擬刪除整位孩子");
    await profile.getByText("再次確認刪除「小昕」", { exact: true }).evaluate(e => e.scrollIntoView({ block: "nearest" }));
    await profile.waitForTimeout(200);
    await profile.screenshot({ path: resolve(directory, `child-delete-${width}.png`) });
    if (width === 1440) await profile.getByTestId("app-dialog-surface").screenshot({ path: resolve(directory, "child-delete-dialog-1440.png") });
    await button(profile, "取消刪除孩子").focus(); await profile.keyboard.press("Enter");
    await profile.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await profile.getByRole("dialog").count(), 0);
    assert.equal(await button(profile, "切換至小昕").count(), 1, "Cancel preserves the child");
    await profile.close();
  }
  const photos = await openPreview(browser, "/photos", 320, 720, failures);
  await button(photos, `開啟照片：私人 · ${brand.illustrationFilename}`).click();
  await button(photos, "刪除照片及連結記錄").click();
  const submit = button(photos, "確認刪除照片");
  assert.ok(await submit.isDisabled());
  await photos.getByRole("checkbox", { name: "我已核對照片與連結記錄的刪除範圍", exact: true }).click();
  assert.ok(await submit.isDisabled(), "Photo deletion still requires both confirmations");
  await photos.getByRole("checkbox", { name: "我確認要刪除這份照片及連結記錄", exact: true }).click();
  assert.ok(await submit.isEnabled());
  await assertDanger(photos, "刪除照片及連結記錄", "確認刪除照片");
  await photos.screenshot({ path: resolve(directory, "photo-delete-320.png") });
  await photos.keyboard.press("Escape");
  await photos.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await photos.getByRole("dialog").count(), 0);
  assert.equal(await button(photos, `開啟照片：私人 · ${brand.illustrationFilename}`).count(), 1);
  await photos.close();
  return "toolbar-safety: four sizes/shared SVG surfaces/44-48 actual targets/centered status/Enter toggle/Escape focus/red child modal/name and scope/cancel/photo confirmation";
}
