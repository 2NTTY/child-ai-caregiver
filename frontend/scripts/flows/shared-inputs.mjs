import { brand } from "../../src/branding.ts";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
const field = (page, name) => page.getByRole("textbox", { name, exact: true });
const checkbox = (page, name) => page.getByRole("checkbox", { name, exact: true });
const raw = "  大約九點多入睡，途中醒過一次。\n時間與原因仍須向照顧者核對。  ";
const date = "  九月下旬，發布日期待核對  ";
async function tools(page) { if (await button(page, "顯示來源情境").count()) await button(page, "顯示來源情境").click(); }
async function fault(page, phase, outcome) { await tools(page); await selectOption(page, "來源問題階段", phase); await selectOption(page, "模擬來源結果", outcome); }
async function openInput(page, label = "媽媽貼上的觀察原文") { await button(page, `查看私人來源：${label}`).click(); await page.getByTestId("source-details").waitFor(); }
async function show(page, id) { await page.getByTestId(id).evaluate(element => element.scrollIntoView({ block: "start" })); }
async function review(page, value = raw) { await field(page, "來源記錄原文").fill(value); await button(page, "預覽家庭共享內容").click(); await page.getByTestId("source-shared-review").waitFor(); }
async function share(page) { await checkbox(page, "我確認把以上記錄與獲授權家庭成員共享").click(); await button(page, "確認家庭共享").click(); }
async function readComplete(page) { await page.waitForFunction(() => ![...document.querySelectorAll("div")].some(element => element.textContent === "正在讀取私人來源…")); }
async function normalSourcePage(browser, failures, width = 390) { return openPreview(browser, "/sources", width, width < 400 ? 844 : 992, failures); }

export async function verifySources(browser, failures, directory) {
  const navigation = await openPreview(browser, "/", 320, 844, failures); await button(navigation, "更多頁面").click();
  await navigation.getByRole("button", { name: "私人來源", exact: true }).click(); await navigation.getByTestId("source-composer").waitFor();
  assert.equal(new URL(navigation.url()).pathname, "/sources"); await navigation.close();
  for (const width of [1440, 1024, 390, 320]) {
    const page = await normalSourcePage(browser, failures, width);
    await field(page, "自備來源原文").fill(raw); await field(page, "來源日期原文").fill(date); await field(page, "來源備註").fill("  由我提供  ");
    await field(page, "來源名稱").focus(); await assertFits(page, `source composer ${width}`); await show(page, "source-composer");
    await page.waitForTimeout(220); await page.screenshot({ path: resolve(directory, `sources-composer-${width}.png`) });
    await button(page, "保存私人來源").focus(); await page.keyboard.press("Enter");
    await page.getByText("來源已私人保存（合成預覽）。尚未家庭共享。", { exact: true }).waitFor();
    await page.getByText(`來源日期原文：${date}`, { exact: true }).waitFor();
    await page.getByRole("button", { name: /^查看完整原文/ }).click(); assert.equal(await page.getByTestId("source-full-text").textContent(), raw);
    assert.equal(await button(page, "取得此網頁內容").count(), 0); assert.equal(await field(page, "來源記錄原文").inputValue(), "");
    await assertFits(page, `source saved ${width}`); await page.close();
  }
  const linked = await normalSourcePage(browser, failures);
  await openInput(linked, "媽媽的私人來源"); assert.equal(await field(linked, "來源記錄原文").count(), 0);
  assert.equal(await button(linked, "取得此網頁內容").isDisabled(), true); await button(linked, "返回新增私人來源並自行貼上正文").click();
  assert.equal(await field(linked, "來源日期原文").inputValue(), "九月下旬，發布日期待核對");
  assert.equal(await field(linked, "來源 HTTPS 網址").inputValue(), "https://example.com/family-notes");
  assert.equal(await field(linked, "來源備註").inputValue(), "由我自行整理，正文尚待提供。");
  await field(linked, "自備來源原文").fill(raw); await button(linked, "保存私人來源").click();
  await linked.getByText("來源已私人保存（合成預覽）。尚未家庭共享。", { exact: true }).waitFor();
  assert.equal(await linked.getByTestId("source-list").getByText("媽媽的私人來源", { exact: true }).count(), 2); await linked.close();

  const publicPage = await normalSourcePage(browser, failures, 320);
  await field(publicPage, "自備來源原文").fill("a".repeat(10001)); await button(publicPage, "保存私人來源").click();
  await publicPage.getByText("原文最多 10,000 字，請自行選擇內容；不會截短原文。", { exact: true }).waitFor();
  assert.equal((await field(publicPage, "自備來源原文").inputValue()).length, 10001);
  await selectOption(publicPage, "來源方式", "清單中的公開來源"); await selectOption(publicPage, "公開來源", "衛生署家庭健康服務（合成清單）");
  await button(publicPage, "保存私人來源").click(); await publicPage.getByText("來源已私人保存（合成預覽）。尚未家庭共享。", { exact: true }).waitFor();
  assert.equal(await field(publicPage, "來源記錄原文").count(), 0); assert.equal(await button(publicPage, "取得此網頁內容").isDisabled(), true);
  await checkbox(publicPage, "我同意取得此來源的公開正文並私人保存").focus(); await publicPage.keyboard.press("Space");
  await button(publicPage, "取得此網頁內容").click(); await publicPage.getByText("正文已私人保存（合成預覽），請核對來源及實際內容。", { exact: true }).waitFor();
  await publicPage.getByText("來源日期原文：未提供", { exact: true }).waitFor(); await assertFits(publicPage, "public explicit fetch 320"); await publicPage.close();

  const extracted = await normalSourcePage(browser, failures, 320); await openInput(extracted, "媽媽的長文合成示例");
  assert.equal(await field(extracted, "提取原文片段").inputValue(), ""); assert.equal(await button(extracted, "提取所選片段").isDisabled(), true);
  await field(extracted, "提取原文片段").fill("a".repeat(10001)); assert.equal((await field(extracted, "提取原文片段").inputValue()).length, 10001);
  const excerpt = "這是私人長文的合成原文，只有明確選擇的連續片段才會交給提取流程。\n";
  await field(extracted, "提取原文片段").fill(excerpt); await checkbox(extracted, "我同意把以上原文片段交由模型提取").click();
  await button(extracted, "提取所選片段").click(); await extracted.getByText("有待核對的合成候選，尚未保存成家庭記錄。", { exact: true }).waitFor();
  assert.equal(await field(extracted, "來源記錄原文").inputValue(), ""); await button(extracted, "採用候選作草稿").click();
  assert.equal(await field(extracted, "來源記錄原文").inputValue(), excerpt); await button(extracted, "預覽家庭共享內容").click();
  await extracted.getByTestId("source-shared-review").getByText("仍須核對：合成候選；未核實時間與孩子關係。", { exact: true }).waitFor();
  assert.equal(await button(extracted, "確認家庭共享").isDisabled(), true); assert.equal(await field(extracted, "來源數值原文").count(), 0);
  await show(extracted, "source-record-form"); await assertFits(extracted, "source reference candidate 320");
  await extracted.screenshot({ path: resolve(directory, "sources-reference-320.png") }); await share(extracted);
  await extracted.getByText("核對記錄已家庭共享（合成預覽）；原文、網址及候選仍屬私人。", { exact: true }).waitFor(); await extracted.close();

  const family = await normalSourcePage(browser, failures);
  await openInput(family); await selectOption(family, "記錄用途", "孩子實際記錄");
  await field(family, "來源數值原文").fill("  大約十四  "); await field(family, "來源數值單位").fill("  kg  "); await field(family, "來源事件時間原文").fill("  昨晚九點多  ");
  await checkbox(family, "內容含約數或約略時間").click(); await review(family);
  assert.equal(await button(family, "確認家庭共享").isDisabled(), true); assert.equal(await checkbox(family, "我確認把以上記錄與獲授權家庭成員共享").isDisabled(), true);
  await checkbox(family, "我確認以上內容確實與這個孩子有關").click(); await share(family);
  await family.getByText("核對記錄已家庭共享（合成預覽）；原文、網址及候選仍屬私人。", { exact: true }).waitFor();
  await button(family, "刪除私人來源").click(); assert.equal(await button(family, "確認刪除來源及連結記錄").isDisabled(), true);
  await checkbox(family, "我明白刪除範圍包含原文及已連結記錄").click(); assert.equal(await button(family, "確認刪除來源及連結記錄").isDisabled(), true);
  await checkbox(family, "我再次確認刪除此來源及連結記錄").click(); await button(family, "確認刪除來源及連結記錄").click();
  await family.getByText("私人來源及連結記錄已模擬刪除。", { exact: true }).waitFor();
  assert.equal(await family.getByTestId("source-list").getByText("媽媽貼上的觀察原文", { exact: true }).count(), 0); await family.close();

  const unknown = await normalSourcePage(browser, failures, 320); await openInput(unknown); await fault(unknown, "家庭共享確認", "結果未知");
  await review(unknown); await share(unknown); await unknown.getByText("提交結果未知。原內容及原操作參考已鎖定，先查核原收據；不能另建一次提交。", { exact: true }).waitFor();
  const reference = await unknown.getByTestId("source-operation").getByText(/合成原操作參考/).innerText(); assert.equal(await field(unknown, "來源記錄原文").isEditable(), false);
  await selectOption(unknown, "模擬來源查核", "仍無確認收據"); await button(unknown, "查核原次結果").click();
  await button(unknown, "沿原內容及參考重試").waitFor(); await readComplete(unknown); assert.equal(await field(unknown, "來源記錄原文").inputValue(), raw);
  await selectOption(unknown, "模擬來源結果", "成功"); await show(unknown, "source-operation"); await assertFits(unknown, "source receipt unknown 320");
  await unknown.screenshot({ path: resolve(directory, "sources-unknown-320.png") }); await button(unknown, "沿原內容及參考重試").click();
  await unknown.getByText("核對記錄已家庭共享（合成預覽）；原文、網址及候選仍屬私人。", { exact: true }).waitFor();
  assert.equal(await unknown.getByTestId("source-operation").getByText(/合成原操作參考/).innerText(), reference); await unknown.close();

  const unavailable = await normalSourcePage(browser, failures); await fault(unavailable, "私人來源保存", "已確認但結果不可讀");
  await field(unavailable, "自備來源原文").fill(raw); await button(unavailable, "保存私人來源").click();
  await unavailable.getByText(/原收據已確認操作，但結果尚未能核對/).waitFor(); assert.equal(await button(unavailable, "沿原內容及參考重試").count(), 0);
  assert.equal(await field(unavailable, "自備來源原文").inputValue(), raw); assert.equal(await field(unavailable, "自備來源原文").isEditable(), false);
  assert.equal(await button(unavailable, "結束已確認操作").isDisabled(), true); await button(unavailable, "查核原次結果").click(); await readComplete(unavailable);
  assert.equal(await field(unavailable, "自備來源原文").inputValue(), raw); await button(unavailable, "結束已確認操作").click(); assert.equal(await field(unavailable, "自備來源原文").inputValue(), ""); await unavailable.close();

  const direct = await normalSourcePage(browser, failures, 320); await openInput(direct); await field(direct, "來源記錄原文").fill(raw); await fault(direct, "AI 提取", "結果未知");
  await checkbox(direct, "我同意把以上原文片段交由模型提取").click(); await button(direct, "提取所選片段").click();
  await direct.getByTestId("source-operation").getByText("結果未知", { exact: true }).waitFor(); assert.equal(await button(direct, "明確查回原版本及原片段").isDisabled(), true);
  await selectOption(direct, "模擬來源查核", "仍在處理"); await button(direct, "查核原次結果").click(); await readComplete(direct);
  assert.equal(await button(direct, "預覽家庭共享內容").isDisabled(), true);
  await selectOption(direct, "模擬來源查核", "仍未查明"); await button(direct, "查核原次結果").click(); await readComplete(direct);
  assert.equal(await button(direct, "提取所選片段").isDisabled(), true); assert.equal(await field(direct, "來源記錄原文").inputValue(), raw);
  await review(direct); await checkbox(direct, "我同意把以上原文片段交由模型提取").click(); await selectOption(direct, "模擬來源結果", "成功");
  await button(direct, "明確查回原版本及原片段").click(); await direct.getByText("有待核對的合成候選，尚未保存成家庭記錄。", { exact: true }).waitFor();
  assert.equal(await field(direct, "來源記錄原文").inputValue(), raw); await direct.close();

  const ended = await normalSourcePage(browser, failures); await openInput(ended); await field(ended, "來源記錄原文").fill(raw); await fault(ended, "AI 提取", "結果未知");
  await checkbox(ended, "我同意把以上原文片段交由模型提取").click(); await button(ended, "提取所選片段").click();
  await ended.getByTestId("source-operation").getByText("結果未知", { exact: true }).waitFor(); await button(ended, "查核原次結果").click(); await readComplete(ended);
  await button(ended, "結束本次查核").click(); assert.equal(await button(ended, "提取所選片段").isDisabled(), true);
  await review(ended); await share(ended); await ended.getByText("核對記錄已家庭共享（合成預覽）；原文、網址及候選仍屬私人。", { exact: true }).waitFor(); await ended.close();

  const conflict = await normalSourcePage(browser, failures); await openInput(conflict); await fault(conflict, "家庭共享確認", "版本衝突"); await review(conflict); await share(conflict);
  await conflict.getByText(/版本已改變，原文及手動草稿保留/).waitFor(); assert.equal(await button(conflict, "明確使用目前版本").isDisabled(), true);
  await button(conflict, "重新讀取來源").click(); await readComplete(conflict); await button(conflict, "明確使用目前版本").click();
  assert.equal(await field(conflict, "來源記錄原文").inputValue(), raw); assert.equal(await conflict.getByTestId("source-shared-review").count(), 0); await conflict.close();

  const scoped = await normalSourcePage(browser, failures); await field(scoped, "自備來源原文").fill(raw);
  await button(scoped, "切換合成預覽情境").click(); await button(scoped, "離線").click(); assert.equal(await field(scoped, "自備來源原文").inputValue(), raw);
  assert.equal(await button(scoped, "保存私人來源").isDisabled(), true); await button(scoped, "一般").click();
  assert.equal(await button(scoped, "保存私人來源").isDisabled(), true); await button(scoped, "重新讀取來源").click(); await readComplete(scoped);
  await tools(scoped); await button(scoped, "保存私人來源").click(); await scoped.getByText("正在模擬提交，尚未確認保存。", { exact: true }).waitFor();
  await button(scoped, "切換來源帳戶，目前媽媽").click(); await scoped.getByText("小昕 · 爸爸的私人來源", { exact: true }).waitFor();
  await scoped.waitForTimeout(450); assert.equal(await scoped.getByTestId("source-operation").count(), 0);
  assert.equal(await field(scoped, "自備來源原文").inputValue(), ""); await field(scoped, "自備來源原文").fill(raw); await tools(scoped);
  await button(scoped, "切換來源 Server，目前合成 A").click(); assert.equal(await field(scoped, "自備來源原文").inputValue(), "");
  await field(scoped, "自備來源原文").fill(raw); await scoped.getByRole("button", { name: /^選擇孩子，目前/ }).click();
  await scoped.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click(); assert.equal(await field(scoped, "自備來源原文").inputValue(), "");
  await tools(scoped); await selectOption(scoped, "來源情境", "唯讀角色"); assert.equal(await button(scoped, "保存私人來源").isDisabled(), true);
  await openInput(scoped, "爸爸貼上的觀察原文"); assert.equal(await field(scoped, "來源記錄原文").count(), 0); assert.equal(await button(scoped, "刪除私人來源").isDisabled(), true);
  await selectOption(scoped, "來源情境", "權限失效"); assert.equal(await scoped.getByTestId("source-details").count(), 0); assert.equal(await field(scoped, "自備來源原文").count(), 0); await scoped.close();

  const photo = await openPreview(browser, "/photos", 320, 844, failures);
  await button(photo, `開啟照片：私人 · ${brand.illustrationFilename}`).click(); await field(photo, "照片記錄原文").fill(raw);
  await selectOption(photo, "照片記錄種類", "身高／體重"); await field(photo, "照片數值原文").fill("  約十四  "); await field(photo, "照片數值單位").fill(" kg ");
  await field(photo, "照片事件時間原文").fill(" 昨晚 "); await checkbox(photo, "內容含約數或約略時間").focus(); await photo.keyboard.press("Space");
  await button(photo, "預覽照片共享內容").click(); await photo.getByTestId("photo-shared-review").waitFor();
  assert.equal(await field(photo, "照片數值原文").inputValue(), "  約十四  "); assert.equal(await button(photo, "確認照片及記錄家庭共享").isDisabled(), true);
  await assertFits(photo, "shared photo fields 320"); await photo.close();
  return "sources: four widths, raw/private save and dates, explicit fetch/excerpt/candidate/reference, child-fact/shared double consent, deletion scope, receipt/direct unknown and original retry, version/draft/access/scope/offline isolation, shared photo fields";
}

export async function verifySourcesText(browser, failures, directory) {
  for (const width of [390, 320]) {
    const page = await normalSourcePage(browser, failures, width); await openInput(page); await selectOption(page, "記錄用途", "孩子實際記錄");
    await field(page, "來源記錄原文").fill(raw); await field(page, "來源數值原文").fill("約十四"); await field(page, "來源數值單位").fill("kg");
    await field(page, "來源事件時間原文").fill("昨晚九點多"); await button(page, "預覽家庭共享內容").click(); await show(page, "source-record-form");
    await page.waitForTimeout(220);
    await page.evaluate(() => { for (const element of document.querySelectorAll("div, span, p, input, textarea")) {
      if (!element.matches("input, textarea") && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
      const computed = getComputedStyle(element); element.style.fontSize = `${parseFloat(computed.fontSize) * 1.5}px`;
      if (computed.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(computed.lineHeight) * 1.5}px`;
    } });
    // Check the settled Paper floating label against the textarea's clipped content area.
    await page.waitForFunction(input => {
      const labels = [...input.parentElement.parentElement.querySelectorAll("div")].filter(item => [...item.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent === "來源記錄原文"));
      return labels.length > 0 && labels.every(item => item.getBoundingClientRect().bottom + 3 <= input.getBoundingClientRect().top);
    }, await field(page, "來源記錄原文").elementHandle());
    await assertFits(page, `source family 150% Web text ${width}`); await show(page, "source-record-form");
    await page.screenshot({ path: resolve(directory, `sources-large-text-${width}.png`) }); await page.close();
  }
  return "sources text: 390/320 synthetic 150% Web text and shared record form reflow; not Android system font acceptance";
}
