import assert from "node:assert/strict";
import test from "node:test";
import { productToolSelection } from "../server/product-tool-selection.ts";

const t5 = "請只處理這個新的純合成任務。替目前的合成验收小星 A 建立普通待辦『[合成驗收 T5] 準備故事書』，分派給我本人 dot 專用驗收帳戶 20261006，預定完成時間是2026年10月8日香港時間19:30。內容是『純合成驗收：把故事書放進交接袋』。只記在站內待辦；不要任何到期提示、外部通知、電話、訊息或背景跟進。";
test("a new explicit task uses current user intent without title data, negative notifications or previous fact instructions", () => {
  const selected = productToolSelection(["請保存這則重要健康事實候選，待我核對，不要發送通知。", t5]);
  assert.equal(selected.includeDocuments, false); assert.equal(selected.includeConcerns, false); assert.equal(selected.includeContact, false);
  assert.equal(selected.includeTaskProposals, true);
  assert.deepEqual(selected.ordinaryToolNames, ["read_care_records", "read_private_instructions", "create_ordinary_reminder", "change_ordinary_reminder"]);
});

test("positive multiple intents and unlabelled quoted requirements keep their capabilities", () => {
  const selected = productToolSelection(["請建立待辦『帶書』，另請整理準備文件、追蹤持續關注，並發送通知。"]);
  assert.equal(selected.includeDocuments, true); assert.equal(selected.includeConcerns, true); assert.equal(selected.includeContact, true);
  assert.equal(selected.includeTaskProposals, true);
  assert.equal(productToolSelection(["請建立待辦『帶書』，另請處理『整理準備文件』。"]).includeDocuments, true);
});

test("literal prohibitions do not disable positive requests to remember or act without another question", () => {
  assert.equal(productToolSelection(["不要忘記提醒我帶書"]).includeTaskProposals, true);
  assert.equal(productToolSelection(["不用問我，直接建立待辦『帶書』"]).includeTaskProposals, true);
  assert.equal(productToolSelection(["建立待辦『不要忘記整理文件與通知老師』"]).includeTaskProposals, true);
  assert.equal(productToolSelection(["建立待辦『不要忘記整理文件與通知老師』"]).includeContact, false);
  assert.equal(productToolSelection(["請記錄喝奶120ml，不要發送通知，也不要建立待辦。"]).includeTaskProposals, false);
  assert.equal(productToolSelection(["請記錄喝奶120ml，不要發送通知，也不要建立待辦。"]).includeContact, false);
  assert.ok(productToolSelection(["不要通知我但請記錄喝奶120ml"]).ordinaryToolNames.includes("save_ordinary_record"));
  assert.equal(productToolSelection(["不用建立提醒但請整理成長報告"]).includeDocuments, true);
});

test("only short explicit references reuse prior user intent and neutral reads do not expose mutation groups", () => {
  assert.equal(productToolSelection(["請建立待辦『帶書』", "就這樣"]).includeTaskProposals, true);
  assert.equal(productToolSelection(["請建立待辦『帶書』", "改成明天19:30"]).includeTaskProposals, true);
  const selected = productToolSelection(["請記錄奶量、建立待辦並通知我", "請核對目前資料"]);
  assert.deepEqual(selected.ordinaryToolNames, ["read_care_records", "read_private_instructions"]);
  assert.equal(selected.includeTaskProposals, false); assert.equal(selected.includeContact, false);
  assert.equal(selected.includeDocuments, false); assert.equal(selected.includeConcerns, false); assert.equal(selected.includePrivateSources, false);
});

test("modified ordinary-task clauses keep titles and details as data without selecting care records", () => {
  for (const text of [
    "請新增這個純合成普通待辦。為小星建立「整理繪本袋」。內容是「把繪本放入交接袋」。只在站內記錄，不要發送外部通知。",
    "這項普通待辦請幫我安排，標題是「整理交接文件」，內容是「記錄奶量表放在袋內」。請只在站內保存此待辦。",
    "麻煩幫小星新增一項明天要做的普通任務「準備故事書」，內容是「把交接文件放好」。僅在站內存檔即可。",
  ]) {
    const selected = productToolSelection([text]);
    assert.equal(selected.includeDocuments, false, text);
    assert.equal(selected.includeTaskProposals, true, text);
    assert.ok(selected.ordinaryToolNames.includes("create_ordinary_reminder"));
    assert.ok(selected.ordinaryToolNames.includes("change_ordinary_reminder"));
    assert.ok(!selected.ordinaryToolNames.includes("save_ordinary_record"), text);
    assert.ok(!selected.ordinaryToolNames.includes("revise_ordinary_record"), text);
  }
});

test("task disposition does not erase explicit parallel care records or quoted instructions outside task labels", () => {
  const task = "請新增這個普通待辦，建立「整理交接袋」，內容是「把文件放好」。只在站內記錄。";
  for (const extra of ["另外記錄孩子喝奶120ml。", "另外記錄寶寶今日主動收好玩具。", "另外只在站內記錄孩子喝奶120ml。"]) {
    const selected = productToolSelection([task + extra]);
    assert.ok(selected.ordinaryToolNames.includes("save_ordinary_record"), extra);
    assert.equal(selected.includeDocuments, false);
    assert.equal(selected.includeTaskProposals, true);
  }
  assert.equal(productToolSelection([task + "另外請執行『整理準備文件』。"]).includeDocuments, true);
  assert.ok(productToolSelection(["只在站內記錄寶寶今日微笑。"]).ordinaryToolNames.includes("save_ordinary_record"));
});

test("a labelled task cannot consume a separate quoted document, private source or contact intent", () => {
  assert.equal(productToolSelection(["請新增普通待辦「帶書」，另外請建立「成長報告」。"]).includeDocuments, true);
  assert.equal(productToolSelection(["請建立待辦「帶書」，另外新增「私人來源 https://example.com」。"]).includePrivateSources, true);
  assert.equal(productToolSelection(["請建立待辦「帶書」，另外安排「聯絡老師」。"]).includeContact, true);
  assert.equal(productToolSelection(["請建立待辦「帶書」並建立「成長報告」。"]).includeDocuments, true);
  assert.equal(productToolSelection(["請新增普通待辦帶水樽。建立「成長報告」。"]).includeDocuments, true);
  assert.equal(productToolSelection(["請新增普通待辦「帶書」，另外新增普通待辦「整理成長報告」。"]).includeDocuments, false);
  assert.equal(productToolSelection(["請新增普通待辦「帶書」。標題是「準備故事書，整理交接袋」。內容是「將文件放好」。只在站內記錄。"]).includeDocuments, false);
});
