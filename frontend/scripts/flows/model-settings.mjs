import { brand } from "../../src/branding.ts";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";
const sample = "synthetic-ui-key-never-for-network";
const keyInput = page => page.getByLabel("個人 API 密鑰", { exact: true });
const saveButton = page => page.getByRole("button", { name: "保存模型設定", exact: true });
const fee = page => page.getByRole("checkbox", { name: "我同意個人服務的費用及資料外送", exact: true });
async function modelPage(browser, failures, width = 390) {
  const page = await openPreview(browser, "/settings", width, width < 400 ? 844 : 992, failures);
  await assertFits(page, `settings account ${width}`);
  await page.getByRole("button", { name: "管理模型設定", exact: true }).click();
  await page.getByText(`最後讀到的版本：3 · ${brand.platformServiceLabel}`, { exact: true }).waitFor();
  return page;
}
async function personal(page) { await selectOption(page, "模型模式", "我的個人密鑰"); }
async function consent(page) { await fee(page).focus(); await page.keyboard.press("Space"); }
async function tools(page) { await page.getByRole("button", { name: "顯示模型情境工具", exact: true }).click(); }
async function showForm(page, title = "使用方式") {
  await page.getByText(title, { exact: true }).evaluate(element => {
    let parent = element.parentElement;
    while (parent) {
      if (["auto", "scroll"].includes(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop += element.getBoundingClientRect().top - parent.getBoundingClientRect().top - 16; break;
      }
      parent = parent.parentElement;
    }
  });
}
async function settleKeyLabel(page) {
  // Paper animates its floating label; capture the settled field rather than an intermediate frame.
  await page.waitForFunction(input => {
    const labels = [...input.parentElement.parentElement.querySelectorAll("div")].filter(item =>
      [...item.childNodes].some(node => node.nodeType === Node.TEXT_NODE && /^(個人|替換) API 密鑰$/u.test(node.textContent.trim())));
    return labels.length > 0 && labels.every(item => item.getBoundingClientRect().top < input.getBoundingClientRect().top - 3);
  }, await keyInput(page).elementHandle());
}
export async function verifyModelSettings(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await modelPage(browser, failures, width);
    await personal(page); assert.equal(await keyInput(page).getAttribute("type"), "password");
    assert.equal(await saveButton(page).isDisabled(), true);
    await keyInput(page).fill(sample); assert.equal(await saveButton(page).isDisabled(), true);
    await consent(page);
    await page.getByLabel("個人每日呼叫上限", { exact: true }).fill("1000");
    await page.getByLabel("每次 Agent 生成上限", { exact: true }).fill("12");
    await page.getByLabel("每次查詢向量上限", { exact: true }).fill("6");
    await assertFits(page, `model settings personal ${width}`); await showForm(page); await settleKeyLabel(page);
    await page.screenshot({ path: resolve(directory, `model-settings-${width}.png`) }); await page.close();
  }
  const page = await modelPage(browser, failures);
  await personal(page); await keyInput(page).fill(sample); await consent(page);
  const background = page.getByRole("checkbox", { name: "另行允許背景任務使用此密鑰", exact: true });
  assert.equal(await background.getAttribute("aria-checked"), "false"); await background.click();
  await page.getByLabel("個人每日呼叫上限", { exact: true }).fill("1001");
  await saveButton(page).click(); await page.getByText("請輸入 1–1000 的整數。", { exact: true }).waitFor();
  await page.getByLabel("個人每日呼叫上限", { exact: true }).fill("120");
  await saveButton(page).focus(); await page.keyboard.press("Enter");
  await page.getByText("模型設定已保存；密鑰輸入已清除。", { exact: false }).and(page.locator(':not([data-testid="status-announcement"])')).waitFor();
  assert.equal(await keyInput(page).inputValue(), ""); assert.equal(await fee(page).getAttribute("aria-checked"), "false");
  assert.equal(await background.getAttribute("aria-checked"), "true");
  await showForm(page, "本人模型設定"); await page.screenshot({ path: resolve(directory, "model-settings-saved-390.png") });
  await page.getByRole("button", { name: "檢查已保存密鑰", exact: true }).click();
  await page.getByText("模型資料可讀取。實際生成、查詢向量、收費及剩餘配額仍未驗證。", { exact: true }).waitFor();
  await tools(page); await selectOption(page, "模型資料查核結果", "429 查核限流");
  await page.getByRole("button", { name: "檢查已保存密鑰", exact: true }).click();
  await page.getByText("查核太頻密（429）", { exact: false }).and(page.locator(':not([data-testid="status-announcement"])')).waitFor();
  await page.getByRole("button", { name: "收起模型情境工具", exact: true }).click();
  await tools(page); await selectOption(page, "模型服務可用性", "個人服務不可用");
  assert.equal(await saveButton(page).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "檢查已保存密鑰", exact: true }).isDisabled(), true);
  await selectOption(page, "模型服務可用性", "AI 總開關停用");
  assert.equal(await page.getByRole("button", { name: "檢查已保存密鑰", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "刪除個人密鑰", exact: true }).click();
  const removal = page.getByRole("button", { name: "確認刪除並停用", exact: true });
  assert.equal(await removal.isDisabled(), true);
  await page.getByRole("checkbox", { name: "我確認刪除密鑰並停用 AI", exact: true }).click();
  await removal.click(); await page.getByText("個人密鑰已刪除，AI 已停用。", { exact: false }).and(page.locator(':not([data-testid="status-announcement"])')).waitFor();
  await page.getByText("最後讀到的版本：5 · 停用 AI", { exact: true }).waitFor(); await page.close();

  for (const [option, message, version] of [
    ["結果未知（稍後讀到新版本）", "保存結果未知。", 4],
    ["結果未知（稍後仍是原版本）", "保存結果未知。", 3], ["版本衝突", "版本已改變。", 4], ["失敗（未保存）", "這次設定未被接納", 3],
  ]) {
    const current = await modelPage(browser, failures, 320); await personal(current); await tools(current);
    await selectOption(current, "模型保存結果", option); await keyInput(current).fill(sample); await consent(current);
    await current.getByLabel("個人每日呼叫上限", { exact: true }).fill("130");
    await saveButton(current).click(); await current.getByText(message, { exact: false }).and(current.locator(':not([data-testid="status-announcement"])')).waitFor();
    assert.equal(await keyInput(current).inputValue(), "");
    assert.equal(await current.getByLabel("個人每日呼叫上限", { exact: true }).inputValue(), "130");
    assert.equal(await saveButton(current).isDisabled(), true);
    if (option.startsWith("結果未知")) {
      await current.getByRole("button", { name: "收起模型情境工具", exact: true }).click();
      await showForm(current, "本人模型設定"); await current.screenshot({ path: resolve(directory, `model-settings-unknown-${version}-320.png`) });
    }
    await current.getByRole("button", { name: "重新讀取模型設定", exact: true }).click();
    await current.getByText(/^(目前設定及版本已讀取。|已讀取目前設定；)/).waitFor();
    await current.getByText(new RegExp(`最後讀到的版本：${version} ·`)).waitFor();
    await assertFits(current, `model settings ${option}`); await current.close();
  }
  const scoped = await modelPage(browser, failures);
  await personal(scoped); await keyInput(scoped).fill(sample);
  await scoped.getByRole("button", { name: /^選擇孩子，目前/ }).click();
  await scoped.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月", exact: true }).click();
  await scoped.getByRole("button", { name: "選擇孩子，目前阿樂", exact: true }).waitFor();
  assert.equal(await scoped.getByTestId("leave-preview-dialog").count(), 0, "Personal model draft is not a child-scoped draft");
  assert.equal(await keyInput(scoped).inputValue(), sample);
  await scoped.getByRole("button", { name: "切換合成預覽情境", exact: true }).click();
  await scoped.getByRole("button", { name: "離線", exact: true }).click(); assert.equal(await keyInput(scoped).inputValue(), "");
  await scoped.getByRole("button", { name: "一般", exact: true }).click();
  await scoped.getByRole("button", { name: "重新讀取模型設定", exact: true }).click();
  await scoped.getByText("目前設定及版本已讀取。", { exact: false }).and(scoped.locator(':not([data-testid="status-announcement"])')).waitFor();
  await personal(scoped); await tools(scoped); await keyInput(scoped).fill(sample); await consent(scoped);
  await saveButton(scoped).click(); await scoped.getByText("正在保存模型設定…", { exact: true }).waitFor();
  await scoped.getByRole("button", { name: "切換模型合成帳戶", exact: true }).click();
  await scoped.getByText("適用於爸爸", { exact: false }).waitFor();
  await scoped.getByText(`最後讀到的版本：3 · ${brand.platformServiceLabel}`, { exact: true }).waitFor();
  await personal(scoped); assert.equal(await keyInput(scoped).inputValue(), "");
  await keyInput(scoped).fill(sample); await scoped.getByRole("button", { name: "切換模型合成 Server", exact: true }).click();
  await scoped.getByText("合成 Server B", { exact: false }).waitFor();
  await scoped.getByText(`最後讀到的版本：3 · ${brand.platformServiceLabel}`, { exact: true }).waitFor();
  await personal(scoped); assert.equal(await keyInput(scoped).inputValue(), "");
  await selectOption(scoped, "模型保存結果", "身份或權限改變"); await keyInput(scoped).fill(sample); await consent(scoped);
  await saveButton(scoped).click(); await scoped.getByText("本人身份或權限已改變，請重新登入。", { exact: true }).waitFor();
  assert.equal(await keyInput(scoped).count(), 0);
  const stored = await scoped.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
  assert.equal(stored.includes(sample), false); await scoped.close();
  return "model settings: four sizes, keyboard/consent/budgets, metadata-only check/429, removal, unknown/version reread, known failure drafts, child/account/Server/offline isolation and no key storage";
}

export async function verifyModelSettingsText(browser, failures, directory) {
  for (const width of [390, 320]) {
    const page = await modelPage(browser, failures, width); await personal(page); await keyInput(page).fill(sample);
    await page.getByLabel("個人每日呼叫上限", { exact: true }).focus();
    await showForm(page); await settleKeyLabel(page);
    // Synthetic Web text reflow only; this does not verify Android system font scaling.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("div, span, p, input, textarea")) {
        if (!element.matches("input, textarea") && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
        const computed = getComputedStyle(element);
        element.style.fontSize = `${parseFloat(computed.fontSize) * 1.5}px`;
        if (computed.lineHeight !== "normal") element.style.lineHeight = `${parseFloat(computed.lineHeight) * 1.5}px`;
      }
    });
    await assertFits(page, `model settings 150% Web text ${width}`);
    await showForm(page); await page.screenshot({ path: resolve(directory, `model-settings-large-text-${width}.png`) });
    await page.close();
  }
  return "model settings text: 390/320 synthetic 150% Web text and field reflow; not Android font acceptance";
}
