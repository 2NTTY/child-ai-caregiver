import assert from "node:assert/strict";
import test from "node:test";
import { careCaptureMatchesSearch, careRecordMatchesReview, emptyCareForm } from "../../care-view-model.ts";

test("Capture search respects the applied kind and preserves raw source text", () => {
  const capture = {title:"睡眠片段",originalText:"  昨晚大概九點半睡  ",sourceLabel:"家長私人文字",proposedValues:{...emptyCareForm(),kind:"sleep",text:"約 21:30 入睡。"}};
  assert.equal(careCaptureMatchesSearch(capture," 九點半 ","sleep"),true);
  assert.equal(careCaptureMatchesSearch(capture,"九點半","feeding"),false);
  assert.equal(careCaptureMatchesSearch(capture,"21:30","all"),true);
  assert.equal(capture.originalText,"  昨晚大概九點半睡  ");
});
test("A confirmed record never enters the candidate-only queue", () => {
  for (const version of [1,2,3]) assert.equal(careRecordMatchesReview({current:{version}},"pending"),false);
});
test("Corrected classification uses the actual revision and does not infer corrections from text", () => {
  assert.equal(careRecordMatchesReview({current:{version:1,values:{text:"更正"}}},"corrected"),false);
  assert.equal(careRecordMatchesReview({current:{version:2}},"corrected"),true);
  assert.equal(careRecordMatchesReview({current:{version:1}},"all"),true);
});
