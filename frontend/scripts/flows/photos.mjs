import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
const checkbox = (page, name) => page.getByRole("checkbox", { name, exact: true });
const record = page => page.getByRole("textbox", { name: "照片記錄原文", exact: true });
const raw = "  約九點多休息；仍須核對。  ";
async function tools(page) { if (await button(page, "顯示照片情境").count()) await button(page, "顯示照片情境").click(); }
async function fault(page, phase, outcome) { await tools(page); await selectOption(page, "模擬問題階段", phase); await selectOption(page, "模擬照片結果", outcome); }
async function openPrivate(page) { await button(page, "開啟照片：私人 · 育伴港美術示例.png").click(); await record(page).waitFor(); }
async function review(page) { await record(page).fill(raw); await button(page, "預覽照片共享內容").click(); await page.getByTestId("photo-shared-review").waitFor(); }
async function confirm(page) { await checkbox(page, "我確認原照片及這份記錄與孩子所屬家庭共享").click(); await button(page, "確認照片及記錄家庭共享").click(); }
async function imageLoaded(page) { await page.waitForFunction(() => [...document.images].filter(image => image.src.startsWith("blob:")).every(image => image.complete && image.naturalWidth > 0)); }

export async function verifyPhotos(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/photos", width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
    await assertFits(page, `photos ${width}`);
    await openPrivate(page); await review(page);
    assert.equal(await button(page, "確認照片及記錄家庭共享").isDisabled(), true);
    await assertFits(page, `photos review ${width}`);
    if (width < 650) for (const name of ["重新讀取照片", "預覽照片共享內容", "確認照片及記錄家庭共享"]) {
      const bounds = await button(page, name).boundingBox(); assert.ok(bounds.width >= 48 && bounds.height >= 48, `photo target ${name} ${width}`);
    }
    await page.getByTestId("photo-original").evaluate(element => element.scrollIntoView({ block: "start" }));
    // Let Paper's floating-label animation settle before capturing the actual layout.
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(directory, `photos-${width}.png`) });
    await page.close();
  }
  const flow = await openPreview(browser, "/photos", 390, 844, failures);
  await openPrivate(flow); await review(flow); await fault(flow, "家庭共享確認", "版本衝突"); await confirm(flow);
  await flow.getByText("版本衝突 · 尚未保存", { exact: true }).waitFor(); assert.equal(await record(flow).inputValue(), raw);
  assert.equal(await button(flow, "使用目前版本並保留草稿").count(), 0);
  await button(flow, "重新讀取照片").click(); await button(flow, "使用目前版本並保留草稿").click(); assert.equal(await record(flow).inputValue(), raw);
  await fault(flow, "家庭共享確認", "結果未知"); await button(flow, "預覽照片共享內容").click(); await confirm(flow);
  await flow.getByText("結果未知 · 先查核", { exact: true }).waitFor(); assert.equal(await record(flow).isEditable(), false);
  const reference = await flow.getByTestId("photo-operation").getByText(/合成操作參考/).innerText();
  await selectOption(flow, "模擬照片查核", "仍未查明"); await button(flow, "查核原照片操作").click(); assert.equal(await record(flow).inputValue(), raw);
  await selectOption(flow, "模擬照片查核", "仍無確認結果"); await button(flow, "查核原照片操作").click();
  assert.equal(await record(flow).isEditable(), false); await selectOption(flow, "模擬照片結果", "成功"); await button(flow, "明確重試原內容及原操作").click();
  await flow.getByText("已確認（合成預覽）", { exact: true }).waitFor();
  assert.equal(await flow.getByTestId("photo-operation").getByText(/合成操作參考/).innerText(), reference);
  assert.equal(await record(flow).count(), 0); await flow.getByTestId("photo-original").getByText(/已連結確認記錄/).waitFor();
  await button(flow, "刪除照片及連結記錄").click(); assert.equal(await button(flow, "確認刪除照片").isDisabled(), true);
  await checkbox(flow, "我已核對照片與連結記錄的刪除範圍").click(); assert.equal(await button(flow, "確認刪除照片").isDisabled(), true);
  await checkbox(flow, "我確認要刪除這份照片及連結記錄").click(); await button(flow, "確認刪除照片").click();
  await flow.getByText(/附件及連結確認記錄已模擬移除/).waitFor(); await assertFits(flow, "photo deletion"); await flow.close();

  const ai = await openPreview(browser, "/photos", 320, 720, failures);
  await openPrivate(ai); await record(ai).fill(raw); await fault(ai, "AI 提取", "結果未知");
  assert.equal(await button(ai, "提取照片內容").isDisabled(), true);
  await checkbox(ai, "我同意把原照片交由 Gemini 提取；候選仍需核對").click(); await button(ai, "提取照片內容").click();
  await ai.getByText("結果未知 · 先查核", { exact: true }).waitFor(); assert.equal(await record(ai).inputValue(), raw);
  await selectOption(ai, "模擬照片查核", "仍無確認結果"); await button(ai, "查核同一照片附件").click();
  assert.equal(await button(ai, "提取照片內容").isDisabled(), true); assert.equal(await button(ai, "明確重試原內容及原操作").count(), 0);
  assert.equal(await record(ai).isEditable(), true); await button(ai, "預覽照片共享內容").click();
  await checkbox(ai, "我確認原照片及這份記錄與孩子所屬家庭共享").click(); assert.equal(await button(ai, "確認照片及記錄家庭共享").isDisabled(), false);
  await assertFits(ai, "photo unknown extraction manual review 320"); await ai.getByTestId("photo-record-form").evaluate(element => element.scrollIntoView({ block: "start" }));
  await ai.screenshot({ path: resolve(directory, "photos-320-manual-review.png") }); await ai.close();

  const file = await openPreview(browser, "/photos", 390, 844, failures);
  const input = file.locator('input[type="file"]'); const payload = await readFile(resolve("assets/brand/favicon.png"));
  await input.setInputFiles({ name: "照顧原圖.png", mimeType: "image/png", buffer: payload }); await record(file).waitFor(); await imageLoaded(file);
  await record(file).fill(raw); await file.getByRole("textbox", { name: "照片來源", exact: true }).fill("  由我上傳  ");
  await input.setInputFiles({ name: "錯誤格式.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await file.getByText(/只接受 JPEG／PNG 原照片/).waitFor(); assert.equal(await record(file).inputValue(), raw);
  await tools(file); await button(file, "使用品牌示例原圖").click(); await file.getByRole("heading", { name: "取代本頁原檔與草稿？", exact: true }).waitFor();
  await button(file, "保留目前草稿").click(); assert.equal(await record(file).inputValue(), raw);
  await input.setInputFiles({ name: "另選原圖.png", mimeType: "image/png", buffer: payload }); await button(file, "確認取代本頁").click(); await imageLoaded(file);
  assert.equal(await record(file).inputValue(), ""); await record(file).fill(raw);
  await file.getByRole("textbox", { name: "照片來源", exact: true }).fill("  由我上傳  ");
  await fault(file, "原檔上傳", "失敗"); await button(file, "私人保存原照片").click();
  await file.getByText("失敗 · 原輸入保留", { exact: true }).waitFor(); assert.equal(await record(file).inputValue(), raw);
  await button(file, "重新讀取照片").click();
  await input.setInputFiles({ name: "另一張照片.png", mimeType: "image/png", buffer: await readFile(resolve("assets/brand/logo-horizontal.png")) });
  await file.getByText(/原檔與附件的類型、大小或 SHA-256 不符/).waitFor(); assert.equal(await record(file).inputValue(), raw);
  await fault(file, "原檔上傳", "結果未知"); await button(file, "繼續上傳同一原檔").click(); await file.getByText("結果未知 · 先查核", { exact: true }).waitFor();
  await selectOption(file, "模擬照片查核", "已查回結果"); await button(file, "查核同一照片附件").click();
  await file.getByText(/原照片已模擬私人保存/).waitFor(); assert.equal(await record(file).inputValue(), raw); await imageLoaded(file);
  assert.ok((await file.getByTestId("photo-original").getByText(/來源：/).textContent()).includes("來源：  由我上傳  ；"));
  await fault(file, "AI 提取", "成功"); await checkbox(file, "我同意把原照片交由 Gemini 提取；候選仍需核對").click(); await button(file, "提取照片內容").click();
  await file.getByTestId("photo-candidate").waitFor(); assert.equal(await record(file).inputValue(), raw);
  await button(file, "採用候選並取代本頁草稿").click(); assert.match(await record(file).inputValue(), /昨日下午/);
  assert.ok(!(await file.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).includes(raw));
  await file.close();

  const scoped = await openPreview(browser, "/photos", 1024, 992, failures);
  await tools(scoped); await button(scoped, "使用品牌示例原圖").click(); await record(scoped).fill(raw);
  await button(scoped, "切換合成預覽情境").click(); await button(scoped, "離線").click(); assert.equal(await record(scoped).inputValue(), raw); assert.equal(await button(scoped, "私人保存原照片").isDisabled(), true);
  await button(scoped, "一般").click(); await fault(scoped, "私人附件建立", "已確認但結果不可讀"); await button(scoped, "私人保存原照片").click();
  await scoped.getByText("原操作已確認 · 結果不可讀", { exact: true }).waitFor(); assert.equal(await record(scoped).inputValue(), raw);
  await button(scoped, "結束待查並核對清單").click(); assert.equal(await button(scoped, "私人保存原照片").isDisabled(), true);
  await button(scoped, "選擇孩子，目前小昕").click(); await scoped.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
  assert.equal(await record(scoped).count(), 0); await scoped.getByText("阿樂的照片", { exact: true }).waitFor();
  await tools(scoped);
  await selectOption(scoped, "照片情境", "唯讀角色"); assert.equal(await button(scoped, "開啟照片：私人 · 育伴港美術示例.png").count(), 0);
  await button(scoped, "開啟照片：共享 · 育伴港美術示例.png").click(); assert.equal(await button(scoped, "刪除照片及連結記錄").count(), 0);
  await selectOption(scoped, "照片情境", "權限失效"); await scoped.getByRole("heading", { name: "已無權查看這個孩子", exact: true }).waitFor(); assert.equal(await scoped.getByTestId("photo-list").count(), 0); await scoped.close();

  const home = await openPreview(browser, "/", 320, 720, failures);
  await button(home, "快速照片記錄").focus(); await home.keyboard.press("Enter"); await home.getByTestId("photo-list").waitFor();
  await button(home, "更多頁面").click(); await button(home, "照片與記錄").click(); assert.equal(new URL(home.url()).pathname, "/photos"); await assertFits(home, "photo menu 320"); await home.close();
  return "photos: four-width layout/targets; file integrity/replacement; raw drafts; conflict; same-operation retry; unknown extraction manual review; two-step deletion; offline/scope/read-only/revocation; mobile entry";
}
