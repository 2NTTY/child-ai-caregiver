import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits } from "../preview-browser.mjs";

export async function verifyDesign(browser, failures, directory) {
  for (const width of [1440, 1024, 840, 744, 390, 320]) {
    const page = await openPreview(browser, "/", width, width < 400 ? 844 : 920, failures);
    const picker = page.getByRole("button", { name: /選擇孩子，目前/ });
    const bounds = await picker.boundingBox();
    assert.ok(bounds.height >= 44 && bounds.width / bounds.height < 6, "Child switch proportions at " + width);
    const avatar = await page.getByText("小", { exact: true }).first().locator("..").boundingBox();
    assert.ok(Math.abs(avatar.width - avatar.height) < 1, "Circular child avatar at " + width);
    assert.ok(await page.locator('[data-testid^="svg-icon-"] svg').count() > 5, "SVG controls at " + width);
    await picker.click();
    const dialog = page.getByTestId("app-dialog-surface");
    await dialog.waitFor();
    const visual = await dialog.evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.backgroundColor, radius: parseFloat(style.borderTopLeftRadius), width: element.getBoundingClientRect().width };
    });
    assert.equal(visual.color, "rgb(255, 255, 254)", "Branded dialog surface at " + width);
    assert.ok(visual.radius >= 12 && visual.radius <= 24, "Card-like dialog corners at " + width);
    assert.ok(visual.width <= width - 16, "Dialog fits viewport at " + width);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    if (width < 900) {
      await page.getByRole("button", { name: "更多頁面", exact: true }).click();
      await dialog.waitFor();
      const row = dialog.getByRole("button", { name: "子女檔案", exact: true });
      const rowBounds = await row.boundingBox();
      const surfaceBounds = await dialog.boundingBox();
      assert.ok(rowBounds.width > surfaceBounds.width * .75 && rowBounds.height >= 44, "Consistent menu rows at " + width);
      assert.ok(await row.locator("svg").count() >= 2, "SVG menu icon and chevron at " + width);
      await assertFits(page, "more menu " + width);
      await page.screenshot({ path: resolve(directory, "more-menu-" + width + ".png") });
      await row.click();
      await page.waitForURL("**/profile");
    } else {
      await page.screenshot({ path: resolve(directory, "home-svg-" + width + ".png") });
    }
    await page.close();
  }
  return "design: branded dialogs/SVG controls/menu rows/child picker proportions at 1440/1024/840/744/390/320";
}
