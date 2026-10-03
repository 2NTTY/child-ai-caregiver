import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchPreviewBrowser, openPreview, assertFits } from "./preview-browser.mjs";

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? "verification/fe-w36-codex-chat");
await mkdir(directory, { recursive: true });
const browser = await launchPreviewBrowser(), failures = [], passed = [], metrics = [];
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/chat", width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
    const input = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    const panel = page.getByTestId("chat-composer-panel"), timeline = page.getByTestId("chat-timeline-scroll");
    const disclosure = page.getByTestId("agent-preview-toggle");
    assert.equal(await disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByTestId("agent-preview-content").isVisible(), false);
    await input.evaluate(element => { element.dataset.inputProbe = "same-private-draft-input"; });
    const textStyle = await page.getByTestId("chat-answer").getByText(/^可以先把已確認的睡眠記錄/).evaluate(element => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, line: style.lineHeight, font: style.fontFamily };
    });
    assert.equal(textStyle.size, "15px"); assert.equal(textStyle.line, "24px"); assert.ok(textStyle.font.includes("system-ui"));
    const initialInput = await input.boundingBox();
    const inputStyle = await input.evaluate(element => ({ size: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }));
    assert.equal(inputStyle.size, "16px");
    const raw = "  保留原文與中文選字，不應提前預覽。  ";
    await input.fill(raw);
    await input.dispatchEvent("compositionstart");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
    assert.equal(await input.inputValue(), raw); assert.equal(await page.getByTestId("chat-local-message").count(), 0);
    await input.dispatchEvent("compositionend");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, bubbles: true });
    assert.equal(await input.inputValue(), raw);
    await input.press("End"); await input.press("Shift+Enter"); await input.pressSequentially("第二行");
    assert.ok((await input.inputValue()).endsWith("\n第二行"));
    assert.equal(await page.getByTestId("chat-local-message").count(), 0);
    await input.press("Enter");
    await page.getByTestId("chat-local-message").last().getByText(/第二行/).waitFor();
    assert.equal(await input.inputValue(), "");
    await input.fill(Array.from({ length: 32 }, (_, index) => `第 ${index + 1} 行：這是仍保留在輸入區的長草稿。`).join("\n"));
    const longInput = await input.boundingBox();
    assert.ok(longInput.height > initialInput.height && longInput.height <= 169, "Long input must grow with a bounded scroll viewport");
    assert.ok(await input.evaluate(element => element.scrollHeight > element.clientHeight));
    await input.fill("較短草稿");
    const shortInput = await input.boundingBox();
    assert.ok(Math.abs(shortInput.height - initialInput.height) <= 1, "Deleting long text must restore composer height");
    assert.equal(await input.getAttribute("data-input-probe"), "same-private-draft-input");
    const target = width < 768 ? 48 : 40;
    for (const label of ["拍照", "檔案與來源", "語音輸入", "展開建議問題", "預覽輸入"]) {
      const control = page.getByRole("button", { name: label, exact: true });
      const bounds = await control.boundingBox();
      assert.ok(bounds.width >= target && bounds.height >= target, `Reachable input control ${label} at ${width}`);
    }
    await input.fill("");
    await page.getByTestId("chat-answer").scrollIntoViewIfNeeded();
    await assertFits(page, `Codex chat ${width}`);
    const panelBounds = await panel.boundingBox(), answerBounds = await page.getByTestId("chat-answer").boundingBox();
    assert.ok(Math.abs(panelBounds.x - answerBounds.x) <= 1 && Math.abs(panelBounds.width - answerBounds.width) <= 1, "The reply and composer share a reading column");
    await page.screenshot({ path: resolve(directory, `chat-${width}.png`) });
    await page.setViewportSize({ width, height: 600 });
    await input.fill(Array.from({ length: 18 }, (_, index) => `短視窗長草稿 ${index}`).join("\n"));
    await assertFits(page, `Codex chat short viewport ${width}`);
    const composer = await page.getByTestId("chat-composer").boundingBox(), scroll = await timeline.boundingBox();
    assert.ok(scroll.height >= 100 && scroll.y + scroll.height <= composer.y + 1 && composer.y + composer.height <= 601, "Short viewport keeps messages and input separate and reachable");
    metrics.push({ width, textStyle, inputStyle, initialHeight: initialInput.height, longHeight: longInput.height, restoredHeight: shortInput.height, shortViewport: { composerHeight: composer.height, messageHeight: scroll.height } });
    passed.push(`${width}: shared reading column, plain assistant text, compact single composer; raw text, Shift+Enter, IME Enter, one preview on Enter; same input across grow/shrink; reachable tools and no overlap in a 600px viewport`);
    await page.close();
  }
  const touchContext = await browser.newContext({ hasTouch: true });
  const touchPage = await openPreview(touchContext, "/chat", 1024, 992, failures);
  assert.equal(await touchPage.evaluate(() => matchMedia("(any-pointer: coarse)").matches), true);
  for (const label of ["拍照", "檔案與來源", "語音輸入", "展開建議問題", "預覽輸入"]) {
    const bounds = await touchPage.getByRole("button", { name: label, exact: true }).boundingBox();
    assert.ok(bounds.width >= 48 && bounds.height >= 48, `Wide touch input control ${label}`);
  }
  await touchPage.waitForFunction(() => { const scroll = document.querySelector('[data-testid="chat-timeline-scroll"]'); return scroll && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2; });
  const touchScroll = await touchPage.getByTestId("chat-timeline-scroll").boundingBox();
  await touchPage.mouse.move(touchScroll.x + 8, touchScroll.y + touchScroll.height / 2); await touchPage.mouse.wheel(0, -1200);
  const returnLatest = touchPage.getByRole("button", { name: "回到最新", exact: true });
  await returnLatest.waitFor();
  const returnBounds = await returnLatest.boundingBox();
  assert.ok(returnBounds.width >= 48 && returnBounds.height >= 48, "Wide touch return-to-latest retains a 48px target");
  passed.push("1024 coarse pointer: compact visual controls retain 48px touch targets independently of pane width");
  await touchContext.close();
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, "codex-chat-checks.json"), JSON.stringify({ at: new Date().toISOString(), scope: "Local synthetic frontend rendering and input behavior only; no API, real agent, transport, persistence, mobile keyboard or device acceptance.", passed, metrics, failures }, null, 2) + "\n");
  console.log(JSON.stringify({ passed, failures }));
} finally { await browser.close(); }
