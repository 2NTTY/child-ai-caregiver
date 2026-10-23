import { brand } from "../../src/branding.ts";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";

export async function verifyAgentEntry(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/", width, width >= 1024 ? 992 : 844, failures);
    const entry = page.getByRole("link", { name: "與 Agent 對話", exact: true });
    assert.equal(await entry.count(), 1, "One Agent navigation entry per layout");
    assert.equal(await entry.getAttribute("href"), "/chat", "Use an actual Expo Router navigation link");
    if (width >= 1024) {
      const sidebar = page.getByTestId("web-sidebar");
      assert.equal(await sidebar.getByRole("link", { name: "與 Agent 對話", exact: true }).count(), 1);
      assert.equal(await page.getByTestId("agent-entry").locator("svg").count(), 2);
      const bounds = await entry.boundingBox();
      const settingsBounds = await sidebar.getByRole("link", { name: "設定", exact: true }).boundingBox();
      assert.ok(bounds.height >= 72 && bounds.width >= 190, "Prominent Agent touch area");
      assert.ok(bounds.y + bounds.height <= settingsBounds.y && bounds.y >= 600, "Agent entry is pinned above settings");
      await sidebar.screenshot({ path: resolve(directory, "sidebar-" + width + ".png") });
    } else assert.equal(await page.getByTestId("agent-entry").count(), 0, "Compact layout keeps its bottom chat tab");
    await assertFits(page, "Agent entry " + width);
    await entry.focus(); await entry.press("Enter");
    const question = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    await question.waitFor();
    assert.equal(await page.getByRole("link", { name: "與 Agent 對話", exact: true }).getAttribute("aria-current"), "page");
    await question.fill("保留我的照顧問題");
    await page.getByRole("link", { name: brand.homeLabel, exact: true }).click();
    await page.getByRole("link", { name: "與 Agent 對話", exact: true }).click();
    assert.equal(await question.inputValue(), "保留我的照顧問題");
    await page.screenshot({ path: resolve(directory, "agent-chat-" + width + ".png") });
    await page.close();
  }
  return "Agent entry: single navigation/pinned primary touch area/SVG/keyboard navigation/current page/draft preservation/four Web sizes";
}

export async function verifyShell(browser, failures, directory) {
  const page = await openPreview(browser, "/", 1440, 992, failures);
  await page.getByRole("button", { name: "收起資訊側欄", exact: true }).click();
  assert.equal(await page.getByText("資訊與提醒", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "開啟資訊側欄", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("資訊與提醒", { exact: true }).waitFor();
  const check = page.getByRole("checkbox", { name: "在預覽中標記核對本週睡眠觀察", exact: true });
  await check.focus(); await page.keyboard.press("Space");
  assert.equal(await check.getAttribute("aria-checked"), "true");
  await page.getByRole("button", { name: "切換合成預覽情境", exact: true }).click();
  await page.getByRole("button", { name: "結果未知", exact: true }).click();
  await page.getByRole("button", { name: "開啟訊息提示：1 項合成狀態需留意", exact: true }).click();
  await page.getByText("合成預覽 · 未接駁站內通知或 Web Push", { exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "查核原操作", exact: true }).click();
  await page.getByText("結果未知：正式操作須以原 opId 查核，不能自動重送。", { exact: false }).waitFor();
  await page.getByRole("button", { name: "首次登入", exact: true }).click();
  await page.getByRole("link", { name: "使用引導", exact: true }).waitFor();
  await page.getByRole("button", { name: "前往使用引導", exact: true }).click();
  await page.getByRole("button", { name: "模擬設定已完成", exact: true }).click();
  assert.equal(await page.getByRole("link", { name: "使用引導", exact: true }).count(), 0);
  await page.getByRole("link", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "開啟使用引導", exact: true }).click();
  await page.getByText("隨時回來查看使用方法", { exact: true }).waitFor();
  await page.getByRole("link", { name: brand.homeLabel, exact: true }).click();
  await page.getByText("把每天的細節，慢慢整理清楚。", { exact: true }).waitFor();
  await page.close();

  const phone = await openPreview(browser, "/", 390, 844, failures);
  const quick = phone.getByRole("button", { name: /^快速(記錄情況|記錄睡眠|身高體重|照片記錄)$/ });
  const quickRows = await quick.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
  assert.equal(quickRows.length, 4); assert.equal(new Set(quickRows).size, 1, "390 homepage uses four quick actions on one row");
  assert.equal(await phone.getByText("問我關於孩子的問題…", { exact: true }).count(), 0);
  assert.equal(await phone.getByRole("button", { name: /^準備問題：/ }).count(), 0);
  await phone.getByRole("link", { name: "與 Agent 對話", exact: true }).click();
  await phone.getByRole("textbox", { name: "撰寫對話問題", exact: true }).waitFor();
  assert.equal(await phone.getByRole("textbox", { name: "撰寫對話問題", exact: true }).inputValue(), "");
  await phone.getByRole("textbox", { name: "撰寫對話問題", exact: true }).fill("保留我的原問題");
  await phone.getByRole("link", { name: "主頁", exact: true }).click();
  await phone.getByRole("link", { name: "與 Agent 對話", exact: true }).click();
  assert.equal(await phone.getByRole("textbox", { name: "撰寫對話問題", exact: true }).inputValue(), "保留我的原問題");
  await phone.getByRole("link", { name: "主頁", exact: true }).click();
  await phone.getByRole("button", { name: "開啟資訊側欄", exact: true }).click();
  await assertFits(phone, "phone right rail 390");
  await phone.getByRole("button", { name: "收起資訊側欄", exact: true }).click();
  await phone.getByRole("button", { name: "快速記錄睡眠", exact: true }).click();
  await phone.getByRole("textbox", { name: "記錄原文草稿", exact: true }).waitFor();
  await phone.getByRole("button", { name: "記錄種類：睡眠", exact: true }).waitFor();
  await phone.screenshot({ path: resolve(directory, "care-390-quick-draft.png") });
  await phone.close();
  const small = await openPreview(browser, "/", 320, 720, failures);
  await assertFits(small, "phone homepage 320");
  await small.screenshot({ path: resolve(directory, "home-320.png") }); await small.close();
  const full = await openPreview(browser, "/", 390, 1880, failures);
  await assertFits(full, "phone reference layout 390");
  await full.screenshot({ path: resolve(directory, "home-390-full-layout.png") }); await full.close();
  return "shell: single rail toggle/keyboard checklist/bell/first-login guide/settings re-entry/logo/phone reference layout/question draft preservation/quick draft";
}

export async function verifySettings(browser, failures, directory) {
  const page = await openPreview(browser, "/settings", 320, 720, failures);
  await page.getByRole("tab", { name: "應用偏好", exact: true }).click();
  const zone = page.getByRole("button", { name: "時區：香港時間", exact: true });
  await zone.focus(); await page.keyboard.press("Enter");
  await page.getByLabel("時區選項：倫敦時間", { exact: true }).waitFor();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[aria-modal="true"]')), true, "Tab must stay inside the modal");
  }
  await page.keyboard.press("Escape");
  assert.equal(await zone.getAttribute("aria-expanded"), "false");
  assert.equal(await zone.evaluate(element => document.activeElement === element), true);
  await selectOption(page, "時區", "香港時間");
  await page.getByRole("button", { name: "選擇安靜時段開始預覽", exact: true }).click();
  await assertFits(page, "compact time picker 320");
  const inputs = page.getByPlaceholder("00", { exact: true });
  assert.equal(await inputs.count(), 2);
  // The library formats leading zeros on focus. Use actual click/select/keyboard events after focus settles.
  for (const [index, value] of [[0, "21"], [1, "15"]]) {
    await inputs.nth(index).click(); await inputs.nth(index).press("ControlOrMeta+A"); await inputs.nth(index).pressSequentially(value);
  }
  await page.getByRole("button", { name: "選用時間", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "安靜時段開始預覽", exact: true }).inputValue(), "21:15");
  await page.getByRole("textbox", { name: "安靜時段結束預覽", exact: true }).fill("21:15");
  await page.getByRole("button", { name: "預覽通知偏好", exact: true }).click();
  await page.getByText("開始及結束時間須不同。", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "安靜時段結束預覽", exact: true }).fill("08:00");
  await selectOption(page, "模擬提交結果", "失敗");
  await page.getByRole("button", { name: "預覽通知偏好", exact: true }).click();
  await page.getByRole("button", { name: "模擬保存本人偏好", exact: true }).click();
  await page.getByRole("heading", { name: "未能保存", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "安靜時段開始預覽", exact: true }).inputValue(), "21:15");
  await selectOption(page, "模擬提交結果", "結果未知");
  await page.getByRole("button", { name: "預覽通知偏好", exact: true }).click();
  await page.getByRole("button", { name: "模擬保存本人偏好", exact: true }).click();
  await page.getByRole("heading", { name: "尚未確認操作結果", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "安靜時段開始預覽", exact: true }).isEditable(), false);
  await selectOption(page, "模擬查核結果", "已確認並讀回");
  await page.getByRole("button", { name: "查核原操作", exact: true }).click();
  await page.getByRole("heading", { name: "已保存", exact: true }).waitFor();
  await page.screenshot({ path: resolve(directory, "settings-320-saved.png") });
  await page.close();
  return "settings: keyboard selection/Escape focus return/compact mature time picker/validation/failure draft/unknown lookup at 320";
}

export async function verifyDatesAndIsolation(browser, failures, directory) {
  const page = await openPreview(browser, "/tasks", 320, 720, failures);
  await page.getByRole("button", { name: "新增共享事項", exact: true }).click();
  await page.getByRole("button", { name: "選擇安排時間", exact: true }).click();
  await page.getByRole("textbox", { name: "安排時間日期", exact: true }).fill("2026-10-01");
  await page.getByRole("textbox", { name: "安排時間時間", exact: true }).fill("09:00");
  await page.getByRole("button", { name: "選擇安排時間日期", exact: true }).click();
  await assertFits(page, "mature date picker 320");
  await page.getByRole("button", { name: "確認日期", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "安排時間日期", exact: true }).inputValue(), "2026-10-01");
  await page.getByRole("button", { name: "選擇安排時間時間", exact: true }).click();
  await assertFits(page, "nested compact time picker 320");
  await page.getByRole("button", { name: "選用時間", exact: true }).click();
  await page.getByRole("textbox", { name: "安排時間時間", exact: true }).focus();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "選擇安排時間", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "安排時間日期", exact: true }).count(), 0);
  await page.close();

  const profile = await openPreview(browser, "/profile", 390, 844, failures);
  const raw = profile.getByRole("textbox", { name: "約數年齡原值", exact: true });
  await raw.fill("約三歲多");
  await profile.getByRole("button", { name: "切換合成預覽情境", exact: true }).click();
  await profile.getByRole("button", { name: "離線", exact: true }).click();
  assert.equal(await raw.inputValue(), "約三歲多");
  assert.equal(await profile.getByRole("button", { name: "預覽家庭共享內容", exact: true }).isEnabled(), false);
  await profile.getByRole("button", { name: "一般", exact: true }).click();
  await profile.getByRole("button", { name: "重新讀取及核對", exact: true }).waitFor();
  await profile.getByRole("button", { name: "尚無孩子", exact: true }).click();
  await profile.getByRole("button", { name: "新增孩子", exact: true }).click();
  await profile.getByRole("textbox", { name: "新增孩子稱呼", exact: true }).fill("  朗朗  ");
  await profile.getByRole("button", { name: "預覽新增孩子", exact: true }).click();
  await profile.getByRole("button", { name: "確認並模擬新增孩子", exact: true }).click();
  await profile.getByRole("button", { name: "選擇孩子，目前朗朗", exact: true }).waitFor();
  await profile.getByRole("button", { name: "更多頁面", exact: true }).click();
  await profile.getByRole("button", { name: "照顧記錄", exact: true }).click();
  await profile.getByText("已載入範圍沒有符合條件的已確認記錄。", { exact: true }).waitFor();
  await profile.getByRole("link", { name: "任務與預約", exact: true }).click();
  await profile.getByText("這個狀態沒有事項。", { exact: true }).waitFor();
  await profile.getByRole("link", { name: "記憶與話題", exact: true }).click();
  assert.equal(await profile.getByTestId("memory-fact-preview-child-1-memory-shared").count(), 0);
  await profile.screenshot({ path: resolve(directory, "memory-390-new-child.png") });
  await profile.close();
  return "shared: calendar/nested time picker/Escape at 320/offline draft/online reread/new child without another child's fixtures";
}

export async function verifyLogin(browser, failures) {
  const page = await openPreview(browser, "/login", 320, 720, failures);
  await page.getByRole("button", { name: "登入（預覽）", exact: true }).click();
  await page.getByText("請輸入有效電郵地址。這是本地表單檢查。", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "電郵地址", exact: true }).fill("parent@example.test");
  await page.getByRole("textbox", { name: "密碼", exact: true }).fill("SYNTHETIC-NOT-A-CREDENTIAL");
  await page.getByRole("button", { name: "顯示密碼", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "密碼", exact: true }).evaluate(element => element.type), "text");
  await page.getByRole("button", { name: "登入（預覽）", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByText("表單格式已通過；此預覽沒有連接 Server，未有登入。", { exact: true }).waitFor();
  await assertFits(page, "login validation 320");
  await page.close();
  return "login: accessible local validation/password visibility/keyboard submission without a Server request at 320";
}
