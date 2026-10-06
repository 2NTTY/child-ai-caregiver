import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";

export async function setDateTime(page, label, date, time) {
  await page.getByRole("button", { name: `選擇${label}`, exact: true }).click();
  await page.getByRole("textbox", { name: `${label}日期`, exact: true }).fill(date);
  await page.getByRole("textbox", { name: `${label}時間`, exact: true }).fill(time);
  await page.getByRole("button", { name: `選用${label}`, exact: true }).click();
}

export async function verifyTasks(browser, failures, directory) {
  const page = await openPreview(browser, "/tasks", 320, 720, failures);
  await page.getByRole("button", { name: "查看事項：整理上星期的照顧觀察", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "改期／轉派", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "回報已完成", exact: true }).count(), 0);
  await page.getByRole("button", { name: "關閉詳情", exact: true }).click();
  await page.getByRole("button", { name: "新增共享事項", exact: true }).click();
  await page.getByRole("button", { name: "預覽家庭共享內容", exact: true }).click();
  await page.getByText("請填寫標題，最多 160 字。", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "事項標題", exact: true }).fill("下星期核對學校安排");
  await selectOption(page, "負責人", "媽媽（擁有人 · 合成）");
  await setDateTime(page, "安排時間", "2026-10-01", "09:00");
  await page.getByRole("button", { name: "預覽家庭共享內容", exact: true }).click();
  const scope = page.getByRole("checkbox", { name: "我已核對內容、負責人、時間及版本，確認這次家庭共享安排", exact: true });
  await scope.focus(); await page.keyboard.press("Space");
  assert.equal(await scope.getAttribute("aria-checked"), "true");
  await assertFits(page, "task creation confirmation 320");
  await page.getByRole("button", { name: "顯示情境工具", exact: true }).click();
  await selectOption(page, "模擬提交結果", "結果未知");
  await page.getByRole("button", { name: "確認家庭共享並模擬建立", exact: true }).click();
  await page.getByRole("heading", { name: "尚未確認操作結果", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查看事項：下星期核對學校安排", exact: true }).count(), 0);
  await selectOption(page, "模擬查核結果", "已確認並讀回");
  await page.getByRole("button", { name: "查核原操作", exact: true }).click();
  await page.getByRole("heading", { name: "已保存", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查看事項：下星期核對學校安排", exact: true }).count(), 1);
  await page.getByRole("button", { name: "關閉詳情", exact: true }).click();
  await page.getByRole("button", { name: "查看事項：核對到診準備是否完成", exact: true }).click();
  await page.getByRole("button", { name: "明確覆核終態", exact: true }).click();
  await selectOption(page, "明確終態", "覆核為已取消");
  await page.getByRole("textbox", { name: "原因（必填）", exact: true }).fill("家人已核對，這次安排取消");
  await page.getByRole("button", { name: "預覽家庭共享內容", exact: true }).click();
  await scope.click();
  await selectOption(page, "模擬提交結果", "成功");
  await page.getByRole("button", { name: "確認家庭共享並模擬保存", exact: true }).click();
  await page.getByRole("heading", { name: "已保存", exact: true }).waitFor();
  await page.getByText("這項事項已結束，不能直接重開。如需另做，請明確新增另一項事項。", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(directory, "tasks-320-terminal.png") });
  await page.close();
  return "tasks: terminal actions stay closed/date-time selection/keyboard scope/unknown creation/explicit needs-review resolution at 320";
}

export async function verifyMemory(browser, failures, directory) {
  const page = await openPreview(browser, "/memory", 1440, 992, failures);
  await page.getByRole("tab", { name: "私人摘要", exact: true }).click();
  await page.getByText("覆蓋的私人訊息（3 則）", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "已確認與候選", exact: true }).click();
  const candidate = page.getByTestId("memory-fact-preview-child-1-memory-candidate");
  await candidate.getByRole("button", { name: "核對及確認", exact: true }).click();
  await page.getByRole("button", { name: "預覽確認", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "確認為已核對事實", exact: true }).isEnabled(), false);
  await page.getByRole("checkbox", { name: "我已核對將公開的家庭共享內容及來源", exact: true }).click();
  await selectOption(page, "模擬提交結果", "結果未知");
  await page.getByRole("button", { name: "確認為已核對事實", exact: true }).click();
  await page.getByRole("heading", { name: "尚未確認操作結果", exact: true }).waitFor();
  await candidate.getByText("擬確認範圍：家庭共享；目前仍是私人候選。", { exact: true }).waitFor();
  await selectOption(page, "模擬查核結果", "已確認並讀回");
  await page.getByRole("button", { name: "查核原操作", exact: true }).click();
  await page.getByRole("heading", { name: "已保存", exact: true }).waitFor();
  await candidate.getByText("家庭共享 · 版本 2", { exact: false }).waitFor();
  await page.getByRole("tab", { name: "私人摘要", exact: true }).click();
  await page.getByText("目前沒有有效摘要。記憶改動後，舊摘要會失效；本頁沒有公開摘要生成或寫入操作。", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "話題", exact: true }).click();
  const answered = page.getByTestId("memory-topic-preview-child-1-memory-answered");
  await answered.getByRole("button", { name: "按原因重開", exact: true }).click();
  await page.getByRole("textbox", { name: "明確重開原因", exact: true }).fill("家長想補充新的情況");
  await page.getByRole("button", { name: "預覽重開話題", exact: true }).click();
  await selectOption(page, "模擬提交結果", "成功");
  await page.getByRole("button", { name: "確認另建新話題", exact: true }).click();
  await answered.getByText("已建立新的關聯話題；這項原終態保留。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "合成情境工具", exact: true }).click();
  await selectOption(page, "記憶角色", "唯讀成員");
  await page.getByRole("tab", { name: "已確認與候選", exact: true }).click();
  const shared = page.getByTestId("memory-fact-preview-child-1-memory-shared");
  assert.equal(await shared.getByRole("button", { name: "更正內容", exact: true }).count(), 0);
  await selectOption(page, "孩子存取權", "已失效");
  await page.getByTestId("read-state-unavailable").getByText("這位孩子的記憶、摘要、版本與草稿已清除；未完成的合成操作不會再改動清單。", { exact: true }).waitFor();
  assert.equal(await candidate.count(), 0);
  await page.close();
  const narrow = await openPreview(browser, "/memory", 320, 720, failures);
  await narrow.getByRole("button", { name: "新增候選", exact: true }).click();
  await assertFits(narrow, "memory editor 320");
  await narrow.screenshot({ path: resolve(directory, "memory-320-editor.png") });
  await narrow.close();
  return "memory: explicit family confirmation/unknown preserves candidate/summary invalidation/terminal reopening/viewer and access boundaries/320 editor";
}
