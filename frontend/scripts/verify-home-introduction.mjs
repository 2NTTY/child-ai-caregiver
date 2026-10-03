import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFits, launchPreviewBrowser, openPreview } from "./preview-browser.mjs";

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? "verification/fe-w31-motion-stability");
const browser = await launchPreviewBrowser(), failures = [], passed = [], metrics = [];
const greetingName = "你好，媽媽！";
const homeLink = page => page.getByRole("link", { name: "主頁", exact: true });
const chatLink = page => page.getByRole("link", { name: "與 Agent 對話", exact: true });
const cardFor = page => page.getByTestId("mobile-child-card");
const describe = card => card.evaluate(element => {
  const button = element.querySelector('[role="button"]'), avatar = button.children[0], copy = button.children[1], arrow = button.children[2];
  const copyContent = copy.children.length === 1 ? copy.children[0] : copy;
  const box = node => node.getBoundingClientRect().toJSON();
  return { card: box(element), button: box(button), avatar: box(avatar), copy: box(copy), arrow: box(arrow),
    background: getComputedStyle(button).backgroundColor, nameSize: getComputedStyle(copyContent.children[0]).fontSize,
    ageSize: getComputedStyle(copyContent.children[1]).fontSize, copyGrow: getComputedStyle(copy).flexGrow };
});
async function returnHome(page) {
  await chatLink(page).click();
  await page.getByRole("textbox", { name: "撰寫對話問題", exact: true }).waitFor();
  await homeLink(page).click();
  await cardFor(page).waitFor();
  assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).count(), 0, "Returning within the preview session cannot replay the greeting");
}
async function checkDocked(page, label) {
  const card = cardFor(page), control = await describe(card), header = await page.getByTestId("mobile-home-header").boundingBox();
  assert.equal(control.avatar.width, 48); assert.equal(control.avatar.height, 48);
  assert.equal(control.nameSize, "18px"); assert.equal(control.ageSize, "14px");
  assert.ok(control.button.height >= 72 && control.button.width >= 48);
  assert.ok(control.button.width <= 200 && control.arrow.x - control.copy.right <= 9, label + ": chevron hugs the child copy");
  assert.equal(control.background, "rgba(0, 0, 0, 0)");
  assert.ok(control.card.y >= header.y && control.card.bottom <= header.y + header.height + 1);
  await assertFits(page, label);
  return control;
}
async function observeMotion(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const card = document.querySelector('[data-testid="mobile-child-card"]'), greeting = document.querySelector('[data-testid="mobile-home-greeting"]');
    const began = performance.now(), frames = []; let settled = 0;
    function sample() {
      const button = card.querySelector('[role="button"]'), frame = card.querySelector('[data-testid="mobile-child-card-frame"]');
      const box = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right }; };
      const hidden = greeting.getAttribute('aria-hidden') === 'true';
      frames.push({ at: performance.now() - began, hidden, opacity: Number(getComputedStyle(greeting).opacity), card: box(card),
        frameOpacity: Number(getComputedStyle(frame).opacity), frame: box(frame), avatar: box(button.children[0]), arrow: box(button.children[2]),
        position: getComputedStyle(card).position, copyBasis: getComputedStyle(button.children[1]).flexBasis, greetingChildren: greeting.childElementCount });
      if (hidden) settled++; else settled = 0;
      if (settled >= 12) resolve(frames);
      else if (performance.now() - began > 12000) reject(new Error('Homepage animation did not settle'));
      else requestAnimationFrame(sample);
    }
    sample();
  }));
}
try {
  await mkdir(directory, { recursive: true });
  for (const [width, reduced] of [[649, false], [605, false], [390, false], [320, false], [390, true]]) {
    const suffix = width + (reduced ? "-reduced" : "");
    const page = await openPreview(browser, "/", width, width === 320 ? 720 : 844, failures);
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const card = cardFor(page), header = page.getByTestId("mobile-home-header");
    await page.getByRole("heading", { name: greetingName, exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).evaluate(e => getComputedStyle(e).fontSize), "26px");
    assert.deepEqual(await page.getByTestId("mobile-home-greeting").locator('[dir="auto"]').evaluateAll(elements => elements.map(e => getComputedStyle(e).fontSize)), ["26px", "16px", "14px"]);
    const initial = await card.boundingBox(), image = await header.getByTestId("home-background-image").boundingBox();
    const greeting = await page.getByTestId("mobile-home-greeting").boundingBox();
    assert.ok(initial.y >= greeting.y + greeting.height + 15, 'The larger greeting leaves room before the child card');
    await page.screenshot({ path: resolve(directory, "child-reading-" + suffix + ".png") });
    const motion = reduced ? null : observeMotion(page);
    const start = Date.now();
    await page.waitForTimeout(1800);
    assert.equal(await page.getByTestId("mobile-home-greeting").evaluate(e => getComputedStyle(e).opacity), "1");
    if (width === 390 && !reduced) {
      const trigger = card.getByRole("button");
      await trigger.focus(); await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(2200);
      assert.equal(await page.getByTestId("mobile-home-greeting").evaluate(e => getComputedStyle(e).opacity), "1");
      assert.ok(Math.abs((await card.boundingBox()).y - initial.y) < 1);
      assert.equal((await describe(card)).background, "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await page.getByRole("heading", { name: greetingName, exact: true }).waitFor({ state: "hidden", timeout: 6500 });
    assert.ok(Date.now() - start >= 2800, "The first entry keeps approximately three seconds of reading time");
    const control = await checkDocked(page, "docked child " + suffix);
    let motionMetrics = null;
    if (motion) {
      const frames = await motion, settledAt = frames.findIndex(frame => frame.hidden), before = frames[settledAt - 1], after = frames[settledAt];
      const moving = frames.filter(frame => !frame.hidden && frame.card.y < initial.y - 0.5 &&
        (frame.card.width > control.card.width + 0.5 || frame.card.y > control.card.y + 0.5));
      assert.ok(moving.length >= 5, 'Observe the complete motion rather than only its final screenshot');
      const initialRightGap = frames[0].frame.right - frames[0].arrow.right;
      assert.ok(moving.every(frame => frame.frame.right - frame.arrow.right >= -1 && frame.frame.right - frame.arrow.right <= initialRightGap + 1), 'The frame right edge stays beside the moving arrow');
      assert.ok(moving.some(frame => frame.frameOpacity > 0 && frame.frameOpacity < 1), 'The frame visibly fades while it contracts');
      assert.ok(moving.some(frame => frame.frameOpacity === 0 && frame.card.y > control.card.y + 8), 'The frame disappears before the child control finishes moving');
      assert.ok(Math.abs(after.card.width - before.card.width) <= 2, 'The container cannot jump in width when docking switches');
      assert.ok(Math.abs(after.card.height - before.card.height) <= 1, 'The card height stays continuous at the last animation frame');
      const ending = frames.slice(settledAt);
      assert.ok(ending.every(frame => ["x", "y", "width", "height"].every(key => Math.abs(frame.card[key] - after.card[key]) <= 1)), 'The completed card does not reflow after the animation');
      assert.ok(Math.abs(after.arrow.x - before.arrow.x) <= 2, 'The arrow cannot jump sideways when docking switches');
      assert.ok(Math.abs(after.avatar.x - before.avatar.x) <= 2 && Math.abs(after.avatar.y - before.avatar.y) <= 2, 'The child identity cannot jump at the final frame');
      motionMetrics = { movingFrames: moving.length, finalCardWidthDelta: after.card.width - before.card.width,
        finalCardHeightDelta: after.card.height - before.card.height, endingFrames: ending.length,
        maximumRightGap: Math.max(...moving.map(frame => frame.frame.right - frame.arrow.right)), finalArrowDelta: after.arrow.x - before.arrow.x,
        finalAvatarDelta: { x: after.avatar.x - before.avatar.x, y: after.avatar.y - before.avatar.y }, frames: frames.filter(frame => frame.opacity < 1 || frame.hidden) };
    }
    assert.ok(control.button.y < initial.y - 80);
    assert.deepEqual(await header.getByTestId("home-background-image").boundingBox(), image, "Artwork remains fixed during the introduction");
    await page.screenshot({ path: resolve(directory, "child-docked-" + suffix + ".png") });
    const trigger = card.getByRole("button");
    await trigger.click(); await page.getByRole("dialog").waitFor();
    const opened = await describe(card);
    assert.deepEqual(opened.card, control.card); assert.deepEqual(opened.button, control.button);
    assert.equal(opened.background, control.background, "Opening no longer adds a wide white rectangle");
    await page.screenshot({ path: resolve(directory, "child-open-" + suffix + ".png") });
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual((await describe(card)).button, control.button, "Dismissal preserves geometry");
    await trigger.click();
    await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
    await card.getByRole("button", { name: "選擇孩子，目前阿樂", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).count(), 0);
    await returnHome(page);
    await page.waitForTimeout(500);
    await checkDocked(page, "return home " + suffix);
    if (width === 320) {
      await card.locator('[dir="auto"]').evaluateAll(elements => {
        for (const element of elements) { const style = getComputedStyle(element); element.style.fontSize = parseFloat(style.fontSize) * 1.5 + "px"; if (style.lineHeight !== "normal") element.style.lineHeight = parseFloat(style.lineHeight) * 1.5 + "px"; }
      });
      await assertFits(page, "150% child text 320");
      const enlarged = await card.boundingBox(), area = await header.boundingBox();
      assert.ok(enlarged.y >= area.y && enlarged.y + enlarged.height <= area.y + area.height + 1);
      const overflow = await card.locator('[dir="auto"]').evaluateAll(elements => elements.some(e => e.scrollWidth > e.clientWidth + 1));
      assert.equal(overflow, false, "Enlarged child text stays inside the selector");
      await page.screenshot({ path: resolve(directory, "child-320-large-text.png") });
    }
    if (width === 649) {
      await page.setViewportSize({ width: 650, height: 844 });
      await page.getByTestId("desktop-home-banner").waitFor();
      await page.setViewportSize({ width: 649, height: 844 });
      await card.waitFor();
      assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).count(), 0);
      await checkDocked(page, "649/650 remount");
    }
    metrics.push({ width, reduced, initial, docked: control, opened, motion: motionMetrics });
    passed.push(suffix + ": reading delay, fixed artwork, larger child control, close chevron, transparent open state, Escape/selection, no replay on route return" + (width === 320 ? ", 150% text" : "") + (width === 649 ? ", breakpoint remount" : ""));
    await page.close();
  }
  {
    const page = await openPreview(browser, "/", 390, 844, failures);
    await page.getByRole("heading", { name: greetingName, exact: true }).waitFor();
    await returnHome(page);
    const control = await checkDocked(page, "return before intro timer finishes");
    await page.waitForTimeout(5500);
    assert.deepEqual((await describe(cardFor(page))).card, control.card, "Cancelled timer cannot move the returned homepage");
    await page.goto(new URL("/login", process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8082").toString());
    await page.getByRole("link", { name: "返回主頁合成預覽", exact: true }).click();
    await page.getByRole("heading", { name: greetingName, exact: true }).waitFor();
    passed.push("Early route departure consumes the first entry; returning stays docked past the old timer. A fresh dashboard preview boundary allows one new introduction; no actual login was performed.");
    await page.close();
  }
  {
    const page = await openPreview(browser, "/", 390, 844, failures);
    await page.waitForFunction(() => { const e = document.querySelector('[data-testid="mobile-home-greeting"]'); const opacity = e && Number(getComputedStyle(e).opacity); return opacity > 0 && opacity < 1; }, undefined, { polling: 10, timeout: 6500 });
    await cardFor(page).getByRole("button").click({ force: true });
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
    await checkDocked(page, "click during the transition");
    assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).count(), 0);
    passed.push("Clicking during the transition settles to the docked layout without a reset or replay.");
    await page.close();
  }
  for (const width of [1440, 1024]) {
    const page = await openPreview(browser, "/", width, 992, failures);
    const trigger = page.getByRole("button", { name: "選擇孩子，目前小昕", exact: true }).first();
    const dimensions = await trigger.evaluate(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, avatar: e.children[0].getBoundingClientRect().width, font: getComputedStyle(e.children[1].children[0]).fontSize }));
    assert.ok(dimensions.height >= 48); assert.equal(dimensions.avatar, 36); assert.equal(dimensions.font, "14px");
    await trigger.focus(); await page.keyboard.press("Enter"); await page.getByRole("dialog").waitFor();
    await assertFits(page, "shared child picker " + width);
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 }); await cardFor(page).waitFor();
    assert.equal(await page.getByRole("heading", { name: greetingName, exact: true }).count(), 0, "A desktop first entry already consumes the introduction");
    await checkDocked(page, "desktop-to-mobile " + width);
    passed.push(width + ": shared toolbar picker proportions, keyboard dialog and desktop-to-mobile without replay");
    await page.close();
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, "child-control-checks.json"), JSON.stringify({ at: new Date().toISOString(), scope: "Synthetic local UI; route/session-boundary lifecycle, child selector and targeted reflow only. No real authentication, API, model, notification or native device acceptance.", passed, metrics, failures }, null, 2) + "\n");
  console.log(JSON.stringify({ passed, failures }));
} finally { await browser.close(); }
