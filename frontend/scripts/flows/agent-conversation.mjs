import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits, selectOption } from "../preview-browser.mjs";

const taskTitle = "核對這一星期的作息記錄";
const factTitle = "下次討論先核對原文";
const taskId = "agent-proposal-preview-conversation-preview-child-1-task";
const shared = page => page.getByRole("checkbox", { name: `我已核對內容及對象，明確同意寫入家庭共享資料: ${taskTitle}`, exact: true });
const accept = (page, title = taskTitle) => page.getByRole("button", { name: `明確接受此事項：${title}`, exact: true });
const runView = page => page.getByTestId("agent-run-view");
async function loadConversation(page) {
  await page.getByRole("button", { name: "查看來源與候選", exact: true }).click();
  await runView(page).getByText("已結束", { exact: true }).waitFor();
  assert.equal(await runView(page).getByTestId("agent-answer").count(), 1, "A reread must render one answer with its own source state");
}
async function tools(page) {
  if (await page.getByRole("button", { name: "顯示 Agent 情境工具", exact: true }).count()) await page.getByRole("button", { name: "顯示 Agent 情境工具", exact: true }).click();
}
async function captureResult(page, directory, name) {
  await runView(page).getByText("Agent 運行結果", { exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: resolve(directory, name) });
}

export async function verifyAgentConversation(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/chat", width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
    assert.equal(await runView(page).count(), 0, "Run result requires an explicit manual read");
    const draft = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    await draft.fill("  保留問題原文，不覆蓋草稿。  ");
    assert.equal(await page.getByRole("button", { name: "先列出想問的問題", exact: true }).isDisabled(), true);
    await loadConversation(page);
    assert.equal(await accept(page).isDisabled(), true);
    assert.equal(await accept(page, factTitle).isDisabled(), false, "Private fact does not ask for family sharing");
    await runView(page).getByRole("tab", { name: "來源分頁【1】：來源片段與版本的版式示例", exact: true }).click();
    await runView(page).getByTestId("source-details-panel").getByText("合成時間，非官方發布日期", { exact: true }).waitFor();
    await runView(page).getByRole("tab", { name: "來源分頁【1】：來源片段與版本的版式示例", exact: true }).click();
    assert.equal(await runView(page).getByTestId("source-details-panel").count(), 0, "The same source tab collapses its details");
    await assertFits(page, `Agent source and candidate ${width}`);
    await shared(page).focus(); await page.keyboard.press("Space");
    assert.equal(await shared(page).getAttribute("aria-checked"), "true");
    await accept(page).focus(); await page.keyboard.press("Enter");
    await page.getByTestId(taskId).getByText("已接受", { exact: true }).waitFor();
    assert.equal(await page.getByTestId(taskId).getByText("候選版本：2", { exact: true }).count(), 1);
    assert.equal(await accept(page).count(), 0, "Terminal candidate cannot be accepted twice");
    assert.equal(await draft.inputValue(), "  保留問題原文，不覆蓋草稿。  ");
    await assertFits(page, `Agent accepted receipt ${width}`);
    await captureResult(page, directory, `agent-result-${width}.png`);
    if (width === 1440) await runView(page).screenshot({ path: resolve(directory, "agent-result-card.png") });
    if (width === 1440) {
      await tools(page); await selectOption(page, "模擬原運行讀取", "原候選已略過");
      await page.getByRole("button", { name: "重新讀取運行結果", exact: true }).click();
      await page.getByTestId(taskId).getByText("已接受", { exact: true }).waitFor();
      assert.equal(await page.getByTestId(taskId).getByText("候選版本：2", { exact: true }).count(), 1, "Synthetic terminal receipt is immutable too");
    }
    await page.close();
  }

  const unknown = await openPreview(browser, "/chat", 1440, 992, failures);
  await loadConversation(unknown); await tools(unknown);
  await selectOption(unknown, "模擬候選決定結果", "結果未知");
  await shared(unknown).click(); await accept(unknown).click();
  await unknown.getByText("原確認結果待查核", { exact: true }).waitFor();
  const retry = unknown.getByRole("button", { name: "明確重試原確認", exact: true });
  assert.equal(await retry.isDisabled(), true);
  assert.equal(await accept(unknown, factTitle).isDisabled(), true, "Unknown blocks a different new decision too");
  await unknown.getByRole("button", { name: "讀取原運行並核對", exact: true }).click();
  await unknown.getByText("原候選仍待確認；這不能證明原寫入未發生。", { exact: false }).waitFor();
  assert.equal(await shared(unknown).getAttribute("aria-checked"), "false", "Reread requires fresh sharing review");
  assert.equal(await retry.isDisabled(), true);
  await shared(unknown).click();
  assert.equal(await retry.isDisabled(), false);
  await captureResult(unknown, directory, "agent-unknown-1440.png");
  await selectOption(unknown, "模擬候選決定結果", "合成收據成功");
  await retry.click(); await unknown.getByTestId(taskId).getByText("已接受", { exact: true }).waitFor();
  assert.equal(await unknown.getByTestId(taskId).getByText("候選版本：2", { exact: true }).count(), 1, "Retry retains original version and decision");
  await accept(unknown, factTitle).click();
  await unknown.getByTestId("agent-proposal-preview-conversation-preview-child-1-fact").getByText("已接受", { exact: true }).waitFor();
  await unknown.close();

  const conflict = await openPreview(browser, "/chat", 1024, 992, failures);
  await loadConversation(conflict); await tools(conflict);
  await selectOption(conflict, "模擬候選決定結果", "確認基準衝突");
  await shared(conflict).click(); await accept(conflict).click();
  await conflict.getByText("原確認結果待查核", { exact: true }).waitFor();
  await selectOption(conflict, "模擬原運行讀取", "候選版本已變更");
  await conflict.getByRole("button", { name: "讀取原運行並核對", exact: true }).click();
  await conflict.getByText("舊決定已停用。重新核對最新內容", { exact: false }).waitFor();
  assert.equal(await conflict.getByRole("button", { name: "明確重試原確認", exact: true }).count(), 0);
  assert.equal(await conflict.getByTestId(taskId).getByText("候選版本：2", { exact: true }).count(), 1);
  assert.equal(await accept(conflict, "已更新的候選內容（合成）").isDisabled(), true);
  await assertFits(conflict, "New confirmation basis 1024");
  await conflict.close();

  const boundary = await openPreview(browser, "/chat", 390, 844, failures);
  await loadConversation(boundary); await tools(boundary);
  await selectOption(boundary, "模擬候選決定結果", "結果未知");
  await shared(boundary).click(); await accept(boundary).click();
  await boundary.getByText("原確認結果待查核", { exact: true }).waitFor();
  await selectOption(boundary, "模擬原運行讀取", "讀取失敗");
  await boundary.getByRole("button", { name: "讀取原運行並核對", exact: true }).click();
  await boundary.getByText("未能讀取原運行；上一批結果暫不展示", { exact: false }).waitFor();
  assert.equal(await boundary.getByRole("button", { name: "明確重試原確認", exact: true }).isDisabled(), true);
  assert.equal(await boundary.getByTestId(taskId).count(), 0);
  await selectOption(boundary, "模擬原運行讀取", "原候選未出現在回覆");
  await boundary.getByRole("button", { name: "讀取原運行並核對", exact: true }).click();
  await boundary.getByText("原運行未包含這個候選，不能推斷", { exact: false }).waitFor();
  assert.equal(await boundary.getByRole("button", { name: "明確重試原確認", exact: true }).isDisabled(), true);
  await selectOption(boundary, "執行結果身份示例", "另一帳戶樣本");
  assert.equal(await runView(boundary).count(), 0, "Identity scope clears prior private result immediately");
  await loadConversation(boundary);
  await boundary.getByRole("button", { name: /選擇孩子，目前/ }).click();
  await boundary.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月" }).click();
  assert.equal(await runView(boundary).count(), 0, "Child switch does not display previous run/citations/confirmation");
  await loadConversation(boundary);
  await tools(boundary);
  await selectOption(boundary, "模擬原運行讀取", "權限或登入失效");
  assert.equal(await runView(boundary).getByTestId("agent-answer").count(), 1, "Changing controls must not duplicate the answer");
  await runView(boundary).getByRole("tab", { name: "來源分頁【1】：來源片段與版本的版式示例", exact: true }).click();
  await runView(boundary).getByTestId("source-details-panel").waitFor();
  await boundary.getByRole("button", { name: "重新讀取運行結果", exact: true }).click();
  await boundary.getByText("已失去讀取此運行的權限", { exact: false }).waitFor();
  assert.equal(await boundary.getByText("來源片段與版本的版式示例", { exact: true }).count(), 0);
  assert.equal(await runView(boundary).getByTestId("source-details-panel").count(), 0, "Access loss also unmounts open source details");
  assert.equal(await boundary.getByRole("button", { name: /^明確接受此事項：/ }).count(), 0);
  await assertFits(boundary, "Private access loss 390"); await boundary.close();

  const narrow = await openPreview(browser, "/chat", 320, 720, failures);
  const inbox = narrow.getByTestId("agent-inbox-view");
  assert.equal(await inbox.getByRole("button", { name: /^查看私人背景結果：/ }).count(), 0);
  await inbox.getByRole("button", { name: "讀取私人背景結果", exact: true }).click();
  await inbox.getByRole("button", { name: "查看私人背景結果：最近一次運行（合成）", exact: true }).click();
  await runView(narrow).getByText("已結束", { exact: true }).waitFor();
  await inbox.getByRole("button", { name: "收起私人背景結果", exact: true }).click();
  assert.equal(await runView(narrow).count(), 0);
  await tools(narrow); await selectOption(narrow, "Agent 運行情境", "確認期限已過");
  await loadConversation(narrow);
  assert.equal(await accept(narrow).isDisabled(), true);
  assert.equal(await narrow.getByRole("button", { name: `略過此事項：${taskTitle}`, exact: true }).isDisabled(), true);
  await selectOption(narrow, "Agent 運行情境", "運行結果及統計未知");
  await narrow.getByRole("button", { name: "查看來源與候選", exact: true }).click();
  await runView(narrow).getByText("本次運行結果未知，請讀取原運行核對；未知不能當作已成功或已完成。", { exact: true }).waitFor();
  await runView(narrow).getByRole("button", { name: "查看運行詳情", exact: true }).click();
  await runView(narrow).getByText("統計未知，不能當作零用量", { exact: false }).waitFor();
  await assertFits(narrow, "Unknown counts and tool details 320");
  await captureResult(narrow, directory, "agent-unknown-320.png");
  await selectOption(narrow, "Agent 運行情境", "任務變更及共享記憶");
  await loadConversation(narrow);
  assert.equal(await narrow.getByText("新負責人", { exact: true }).count(), 1);
  assert.equal(await narrow.getByText("覆核為", { exact: true }).count(), 1);
  assert.equal(await narrow.getByTestId(/^agent-proposal-/).count(), 5);
  await assertFits(narrow, "Task changes and shared fact 320"); await narrow.close();
  return "Agent conversation: four-width manual read/keyboard shared acceptance/private fact/source metadata/draft guard; unknown original retry/conflict/missing read/permission and child identity clearing/manual inbox/expiry/unknown statistics/full task-change projection";
}
