import assert from "node:assert/strict";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { openPreview, assertFits } from "../preview-browser.mjs";

async function target(locator, label) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds && bounds.width >= 48 && bounds.height >= 48, `${label}: primary mobile target below 48 logical pixels`);
}

export async function verifyMobileDensity(browser, failures, directory) {
  const metrics = [];
  for (const width of [390, 320]) {
    const page = await openPreview(browser, "/", width, width === 390 ? 844 : 720, failures);
    const childCard = page.getByTestId("mobile-child-card");
    await childCard.getByText("約 3 歲 2 個月", { exact: true }).waitFor();
    await childCard.getByText("截至 2026 年 9 月", { exact: true }).waitFor();
    for (const name of ["查看小昕的孩子檔案", "選擇孩子，目前小昕", "進行對話", "開啟訊息提示", "開啟資訊側欄"]) {
      await target(page.getByRole("button", { name, exact: true }), name);
    }
    await target(page.getByRole("link", { name: "開啟設定", exact: true }), "開啟設定");
    const title = await page.getByRole("heading", { name: "待辦事項", exact: true }).boundingBox();
    const action = await page.getByRole("button", { name: "查看全部", exact: true }).boundingBox();
    assert.ok(title.y < action.y + action.height && action.y < title.y + title.height, "Task title and action align on one row");
    const quick = page.getByRole("button", { name: /^快速(記錄情況|記錄睡眠|身高體重|照片記錄)$/ });
    const quickBounds = await quick.evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, y: bounds.y };
    }));
    assert.equal(quickBounds.length, 4);
    assert.equal(new Set(quickBounds.map(bounds => Math.round(bounds.y))).size, width === 390 ? 1 : 2, "Quick actions reflow by available content width");
    for (const bounds of quickBounds) assert.ok(bounds.width >= 48 && bounds.height >= 48);
    const bounds = await childCard.boundingBox();
    metrics.push({ width, childCard: { width: bounds.width, height: bounds.height, y: bounds.y }, quickHeight: quickBounds[0].height });
    await assertFits(page, `mobile density ${width}`);
    await page.screenshot({ path: resolve(directory, `home-${width}.png`) });
    await page.getByRole("button", { name: "選擇孩子，目前小昕", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByText("小昕 · 約 3 歲 2 個月 · 截至 2026 年 9 月", { exact: true }).waitFor();
    await assertFits(page, `child picker ${width}`);
    await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
    await childCard.getByText("約 8 歲", { exact: true }).waitFor();
    await page.getByRole("button", { name: "選擇孩子，目前阿樂", exact: true }).click();
    await page.getByRole("radio", { name: "小昕 · 約 3 歲 2 個月 · 截至 2026 年 9 月", exact: true }).click();
    await page.getByRole("button", { name: "準備問題：整理最近的睡眠", exact: true }).click();
    const draft = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    await draft.waitFor();
    assert.equal(await draft.inputValue(), "整理最近的睡眠");
    const raw = "  保留我的原問題。  ";
    await draft.fill(raw);
    assert.equal(await page.getByRole("button", { name: "先列出想問的問題", exact: true }).isDisabled(), true);
    const composer = await page.getByTestId("chat-composer").boundingBox();
    metrics.at(-1).composerHeight = composer.height;
    await target(page.getByRole("button", { name: "預覽輸入", exact: true }), "Composer preview");
    await assertFits(page, `compact composer ${width}`);
    await page.screenshot({ path: resolve(directory, `chat-${width}.png`) });
    await page.getByRole("link", { name: "主頁", exact: true }).click();
    await page.getByRole("button", { name: "準備問題：記錄孩子的飲食", exact: true }).click();
    assert.equal(await draft.inputValue(), raw, "Home shortcut must retain the original child draft");
    await draft.fill("");
    const inspiration = page.getByRole("button", { name: "先列出想問的問題", exact: true });
    await inspiration.focus(); await page.keyboard.press("Enter");
    assert.equal(await draft.inputValue(), "先列出想問的問題", "Keyboard can reach a horizontally scrolled suggestion");
    await page.getByRole("link", { name: "主頁", exact: true }).click();
    await page.getByRole("button", { name: "快速記錄睡眠", exact: true }).click();
    await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).waitFor();
    await page.getByRole("button", { name: "記錄種類：睡眠", exact: true }).waitFor();
    await assertFits(page, `mobile quick draft ${width}`);
    await page.close();
  }
  // Enlarge only text in the synthetic Web page, not the viewport or layout dimensions.
  // This checks Web reflow; it is not evidence of Android system font scaling or TalkBack.
  for (const width of [390, 320]) {
    const page = await openPreview(browser, "/", width, width === 390 ? 844 : 720, failures);
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("div, span, p")) {
        if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
        const computed = getComputedStyle(element);
        element.style.fontSize = `${parseFloat(computed.fontSize) * 1.5}px`;
        if (computed.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(computed.lineHeight) * 1.5}px`;
      }
    });
    await assertFits(page, `150% Web text ${width}`);
    await page.getByTestId("mobile-child-card").screenshot({ path: resolve(directory, `child-large-text-${width}.png`) });
    await page.close();
  }
  const full = await openPreview(browser, "/", 390, 1660, failures);
  await assertFits(full, "mobile full layout 390");
  await full.screenshot({ path: resolve(directory, "home-390-full-layout.png") });
  await full.close();
  await writeFile(resolve(directory, "after-metrics.json"), JSON.stringify({ scope: "Synthetic Web only; logical pixels, not device acceptance", metrics }, null, 2) + "\n");
  return "mobile density: 390/320 targets/age basis/header alignment/four-or-two quick actions/child picker/keyboard suggestions/original draft/quick form/150% Web text reflow";
}
