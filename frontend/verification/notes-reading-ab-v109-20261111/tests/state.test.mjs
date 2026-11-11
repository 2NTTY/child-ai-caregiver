import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTES} from '../public/notes-data.mjs';
import {createState, transition} from '../public/notes-state.mjs';

// Independent literal expectations: catches missing paragraphs or altered sample copy.
const fixed = {version:1,updatedAt:'2026-11-07T08:00:00Z',updatedAtLabel:'2026/11/07 16:00（香港時間）'};
const expected = [
 {id:'pn-example-1',title:'先列重點',body:'請先用兩三句列出重點，再補充必要的說明。標題和正文分開，讓我一眼找到要讀的部分。這只是固定排版示例。',originLabel:'本人交代',sourceText:'合成對話 01',sourceNotice:'',...fixed},
 {id:'pn-example-2',title:'比較時保留條件',body:'比較兩個方案時，請先交代它們各自適合的情況，再說明主要差別。若某個做法只有在特定條件下適用，請把條件放在同一段，不要只留下結論。\n\n較長的說明可以分成短段，每段只處理一個重點。需要比較的項目請用相同順序呈現，讓讀者來回查看時不必重新找位置。若資訊還不完整，就直接說明缺少甚麼，不要把假設寫成已確認的事實。\n\n最後保留一段簡短總結，方便讀完後回頭核對。這段文字完全是固定合成內容，用來比較長文是否容易閱讀，以及不同版式是否會遺漏同一段內容。',originLabel:'本人交代',sourceText:'合成對話 02',sourceNotice:'',...fixed},
 {id:'pn-example-3',title:'段落與標題',body:'長一點的回覆可以分段，標題要能說明下一段在談甚麼。請保留正文原有的意思，不要因為版面較窄就省略句子。這則內容只是匯入來源的合成排版示例，沒有代表任何人的實際交代。',originLabel:'匯入交代',sourceText:'合成匯入 01',sourceNotice:'匯入示例，不代表本人確認或授權。',...fixed}
];
const read = id => ({type:'READ',id});
const layout = value => ({type:'LAYOUT',value});
test('S1 fixed_fixture_exact',()=>{
 assert.deepEqual(NOTES,expected); assert.deepEqual(NOTES.map(n=>n.body.length),[50,219,81]);
 assert.equal(NOTES[1].body.split('\n\n').length,3);
 assert.ok(Object.isFrozen(NOTES)); assert.ok(NOTES.every(Object.isFrozen));
});
test('S2 initial_reading_state',()=>{
 const s=createState(); assert.deepEqual(s,{layout:'A',activeId:'pn-example-1'}); assert.ok(Object.isFrozen(s));
});
test('S3 retain_second_note_across_layouts',()=>{
 const before=JSON.stringify(NOTES); let s=transition(createState(),read('pn-example-2'));
 assert.deepEqual(s,{layout:'A',activeId:'pn-example-2'}); assert.ok(Object.isFrozen(s));
 s=transition(s,layout('B')); assert.deepEqual(s,{layout:'B',activeId:'pn-example-2'});
 s=transition(s,layout('A')); assert.deepEqual(s,{layout:'A',activeId:'pn-example-2'});
 assert.equal(JSON.stringify(NOTES),before);
});
test('S4 repeat_is_noop',()=>{
 let s=createState(); const before=JSON.stringify(NOTES);
 assert.equal(transition(s,layout('A')),s); assert.equal(transition(s,read('pn-example-1')),s);
 s=transition(s,layout('B')); assert.equal(transition(s,layout('B')),s);
 for(let i=0;i<20;i++){s=transition(s,layout('A'));s=transition(s,layout('B'));}
 assert.deepEqual(s,{layout:'B',activeId:'pn-example-1'}); assert.equal(JSON.stringify(NOTES),before);
});
test('S5 reject_unknown_values',()=>{
 const s=createState(), before=JSON.stringify(NOTES);
 for(const event of [null,{},undefined,{type:'unknown'},layout('X'),layout(null),read(),read(''),read('missing')])assert.equal(transition(s,event),s);
 assert.equal(JSON.stringify(NOTES),before);
});
test('S6 b_rejects_read',()=>{
 const s=transition(transition(createState(),read('pn-example-2')),layout('B'));
 assert.equal(transition(s,read('pn-example-1')),s); assert.equal(s.activeId,'pn-example-2');
});
test('S7 fresh_state_resets_only_memory',()=>{
 const before=JSON.stringify(NOTES), prior=transition(transition(createState(),read('pn-example-2')),layout('B'));
 assert.deepEqual(createState(),{layout:'A',activeId:'pn-example-1'});
 assert.deepEqual(prior,{layout:'B',activeId:'pn-example-2'});assert.equal(JSON.stringify(NOTES),before);
});
