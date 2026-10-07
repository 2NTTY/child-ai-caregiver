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
