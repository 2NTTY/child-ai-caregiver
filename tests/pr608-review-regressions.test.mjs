import assert from "node:assert/strict";
import test from "node:test";
import * as m from "../server/chat-delivery-review.ts";
const base={kind:'operation',visibility:'private',sources:[],scope:{}};
const ops=[{kind:'action_receipt',state:'succeeded',tool:'create_ordinary_reminder',summary:'散步'},{kind:'action_receipt',state:'succeeded',tool:'change_ordinary_reminder',summary:'cancel: 買菜'}];
const opDraft=(text,verifiedOperations=ops)=>({...base,verifiedOperations,paragraphs:[{text,citationIds:[]}]});
test('mixed executed action receipts retain their individual action families',()=>assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒散步。已取消提醒買菜。')),true));
test('mixed receipt mismatch is rejected',()=>assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒買菜。已取消提醒散步。')),false));
test('unexecuted and unreported receipts cannot justify claims',()=>{
 assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒散步。已取消提醒買菜。',ops.slice(0,1))),false);
 assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒散步。已取消提醒買菜。',ops.map(o=>({...o,state:'failed'})))),false);
});
const record=text=>({...base,kind:'record_restatement',paragraphs:[{text,citationIds:['record:1']}],sources:[{citationId:'record:1',classification:'private',excerpt:'寶寶今日飲了 120 ml 奶。',excerptComplete:true}]});
test('grounded historical milk quantity does not require official evidence',()=>assert.equal(m.chatDeliveryPassNeedsSources(record('寶寶今日飲了 120 ml 奶。')),false));
test('dosing, advice and invented milk amounts still require evidence',()=>{
 for(const text of ['寶寶今日飲了 150 ml 奶。','建議寶寶今日飲 120 ml 奶。','寶寶今日服了 5 ml 藥水。'])assert.equal(m.chatDeliveryPassNeedsSources(record(text)),true,text);
});
test('grounded milk citation creates citation obligation, not official obligation',()=>{
 const reasons=[];m.requiresChatDeliveryReview(record('寶寶今日飲了 120 ml 奶。'),{require:r=>reasons.push(r)});
 assert.deepEqual(reasons,['citation']);
 const bad=record('寶寶今日飲了 120 ml 奶。');bad.sources=[];const rejected=[];
 m.requiresChatDeliveryReview(bad,{require:r=>rejected.push(r)});assert.deepEqual(rejected,['official_citation']);
});
test('same quantity receipt cannot be reused across multiple clauses',()=>{
 const receipts=[{kind:'action_receipt',state:'succeeded',tool:'save_ordinary_record',summary:'餵奶 120 ml'}];
 assert.equal(m.isPureVerifiedOperationSummary(opDraft('已記錄餵奶 120 ml。已記錄餵奶 120 ml。',receipts)),false);
});
test('grounding exceptions do not exempt care labels or unrelated directives',()=>{
 const d=record('寶寶今日飲了 120 ml 奶。');d.kind='caregiving';assert.equal(m.chatDeliveryPassNeedsSources(d),true);
 for(const text of ['寶寶今日飲了 120 ml 奶。停止飲水。','寶寶今日飲了 120 ml 奶。每次 5 ml。','寶寶今日飲了 120 ml 奶。已取消提醒買菜。'])assert.equal(m.chatDeliveryPassNeedsSources(record(text)),true,text);
});
test('a cancel receipt cannot fund a second create claim',()=>{
 const receipts=[{kind:'action_receipt',state:'succeeded',tool:'create_ordinary_reminder',summary:'散步 1 次'},{kind:'action_receipt',state:'succeeded',tool:'change_ordinary_reminder',summary:'cancel: 散步 1 次'}];
 assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒散步 1 次。已設定提醒散步 1 次。',receipts)),false);
 assert.equal(m.isPureVerifiedOperationSummary(opDraft('已設定提醒散步 1 次。已取消提醒散步 1 次。',receipts)),true);
});
test('historical milk records support time detail, English and mixed factual paragraphs',()=>{
 for (const text of ['寶寶今天上午飲了 120 ml 奶。','Baby drank 120 ml of milk today.','寶寶飲了120ml奶，下午睡午覺。']) {
  const d=record(text);d.paragraphs[0].citationIds=['care-record:1'];d.sources[0].citationId='care-record:1';d.sources[0].excerpt=text;
  assert.equal(m.chatDeliveryPassNeedsSources(d),false,text);
 }
});
test('source-supported dose or directive remains clinical even when source repeats it',()=>{
 for (const text of ['Baby should drink 120 ml of milk today.','寶寶飲了120ml奶，應該停止飲水。','寶寶今日服了 5 ml 藥水。','Baby drank milk and took 5 mg aspirin.','每次飲 120 ml 奶。']) {
  const d=record(text);d.sources[0].excerpt=text;assert.equal(m.chatDeliveryPassNeedsSources(d),true,text);
 }
});
