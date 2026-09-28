import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchPreviewBrowser, openPreview, assertFits, selectOption } from "./preview-browser.mjs";
import { verifyProfile, verifyFamily } from "./flows/profile-family.mjs";
import { verifyTasks, verifyMemory } from "./flows/tasks-memory.mjs";
import { verifyShell, verifySettings, verifyDatesAndIsolation, verifyLogin } from "./flows/shell-settings.mjs";
import { verifyDeletion } from "./flows/deletion.mjs";

const directory = resolve("verification/fe-w06");
await mkdir(directory, { recursive: true });
const browser = await launchPreviewBrowser();
const failures = [];
const passed = [];
const requested = new Set(process.argv.slice(2));
const run = name => !requested.size || requested.has(name);
const routes = ["/", "/care", "/profile", "/family", "/memory", "/tasks", "/settings", "/chat", "/guide", "/login"];
try {
  if (run("layout")) {
    for (const width of [1440, 1024, 390, 320]) for (const path of routes) {
      const page = await openPreview(browser, path, width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
      await assertFits(page, `${path} ${width}`);
      await page.screenshot({ path: resolve(directory, `${path === "/" ? "home" : path.slice(1)}-${width}.png`) });
      passed.push(`layout ${path} ${width}`); console.log(passed.at(-1)); await page.close();
    }
  }
  if (run("care")) {
    const page = await openPreview(browser, "/care", 1440, 992, failures);
    await page.getByRole("textbox", { name: "搜尋照顧記錄", exact: true }).fill("公園");
    await page.getByRole("button", { name: "搜尋記錄", exact: true }).click();
    await page.getByText("這一頁未找到符合內容，但仍有未掃描的記錄；請載入下一頁。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "載入下一頁", exact: true }).click();
    const list = page.getByTestId("care-record-list");
    await list.getByRole("button", { name: "查看公園觀察", exact: true }).waitFor();
    assert.ok(!page.url().includes("公園"), "Search text must not enter the URL");
    await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
    await list.getByRole("button", { name: "查看睡眠記錄", exact: true }).click();
    await page.getByRole("button", { name: "查看更正歷史", exact: true }).click();
    await page.getByText("版本 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "載入更早版本", exact: true }).click();
    await page.getByText("版本 1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "更正這筆記錄", exact: true }).click();
    const raw = "  大約九點多入睡；仍須核對。  ";
    await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).fill(raw);
    await page.getByRole("textbox", { name: "更正原因草稿", exact: true }).fill("核對照顧者原文");
    await page.getByRole("button", { name: "顯示情境工具", exact: true }).click();
    await selectOption(page, "模擬提交結果", "版本衝突");
    await page.getByRole("button", { name: "預覽共享內容", exact: true }).click();
    await page.getByRole("button", { name: "確認家庭共享並模擬提交", exact: true }).click();
    await page.getByText("版本衝突 · 尚未保存", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).inputValue(), raw);
    await page.getByRole("button", { name: "保留草稿並使用最新版本", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).inputValue(), raw);
    await selectOption(page, "模擬提交結果", "失敗");
    await page.getByRole("button", { name: "預覽共享內容", exact: true }).click();
    await page.getByRole("button", { name: "確認家庭共享並模擬提交", exact: true }).click();
    await page.getByText("模擬失敗：已知沒有保存。", { exact: false }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).inputValue(), raw);
    await selectOption(page, "模擬提交結果", "結果未知");
    await page.getByRole("button", { name: "預覽共享內容", exact: true }).click();
    await page.getByRole("button", { name: "確認家庭共享並模擬提交", exact: true }).click();
    await page.getByRole("button", { name: "模擬查核原操作", exact: true }).waitFor();
    const reference = await page.getByText("合成操作參考：", { exact: false }).textContent();
    assert.equal(await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).isEditable(), false);
    await page.getByRole("button", { name: "模擬查核原操作", exact: true }).click();
    await page.getByRole("button", { name: "模擬查核原操作", exact: true }).waitFor();
    assert.equal(await page.getByText("合成操作參考：", { exact: false }).textContent(), reference);
    await page.screenshot({ path: resolve(directory, "care-1440-unknown.png") });
    await selectOption(page, "模擬查核結果", "已保存");
    await page.getByRole("button", { name: "模擬查核原操作", exact: true }).click();
    await page.getByText("模擬已保存；只更新本次照顧記錄預覽", { exact: false }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "記錄原文草稿", exact: true }).count(), 0);
    await page.getByRole("button", { name: /選擇孩子，目前/ }).click();
    await page.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月" }).click();
    await page.getByRole("button", { name: "查看課後觀察", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看睡眠記錄", exact: true }).count(), 0);
    await page.getByRole("button", { name: "顯示情境工具", exact: true }).click();
    await selectOption(page, "記錄情境", "唯讀角色");
    assert.equal(await page.getByRole("button", { name: "新增記錄", exact: true }).isDisabled(), true);
    await selectOption(page, "記錄情境", "權限失效");
    await page.getByText("已無權查看這個孩子", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看課後觀察", exact: true }).count(), 0);
    passed.push("care: paged search/history/conflict/failure/same-operation lookup/child isolation/permission loss");
    console.log(passed.at(-1)); await page.close();
    const narrow = await openPreview(browser, "/care", 320, 720, failures);
    await narrow.getByRole("button", { name: "新增記錄", exact: true }).click();
    await narrow.getByRole("button", { name: "預覽共享內容", exact: true }).click();
    await narrow.getByText("請填寫記錄原文。", { exact: true }).waitFor();
    await assertFits(narrow, "care form 320");
    await narrow.getByRole("textbox", { name: "記錄原文草稿", exact: true }).fill("飯後分享今天的事情");
    await narrow.getByRole("textbox", { name: "資料來源草稿", exact: true }).fill("由我觀察");
    await narrow.getByRole("button", { name: "預覽共享內容", exact: true }).focus();
    await narrow.keyboard.press("Enter");
    await narrow.getByText("待確認 · 尚未保存", { exact: true }).waitFor();
    await assertFits(narrow, "care confirmation 320");
    await narrow.screenshot({ path: resolve(directory, "care-320-confirmation.png") });
    passed.push("care: 320 form validation and keyboard confirmation"); console.log(passed.at(-1)); await narrow.close();
  }
  for (const [name, verify] of [["profile", verifyProfile], ["family", verifyFamily], ["tasks", verifyTasks], ["memory", verifyMemory], ["shell", verifyShell], ["settings", verifySettings], ["shared", verifyDatesAndIsolation], ["login", verifyLogin], ["deletion", verifyDeletion]]) {
    if (run(name)) { passed.push(await verify(browser, failures, directory)); console.log(passed.at(-1)); }
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, `checks-${requested.size ? [...requested].join("-") : "all"}.json`), JSON.stringify({ scope: "Synthetic frontend only; no Server or device acceptance", at: new Date().toISOString(), passed, failures }, null, 2) + "\n");
} finally { await browser.close(); }
