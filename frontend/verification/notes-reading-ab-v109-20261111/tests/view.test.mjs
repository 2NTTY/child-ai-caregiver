import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTES} from '../public/notes-data.mjs';
import {createState,transition} from '../public/notes-state.mjs';
import {renderNotes} from '../public/notes-view.mjs';
import {mount} from '../public/app.mjs';
import {createDocument,rootFor,all,byId,byClass} from './dom-double.mjs';
const second=()=>transition(createState(),{type:'READ',id:'pn-example-2'});
const articles=root=>all(root,n=>n.tagName==='ARTICLE');
const indexButton=(root,id)=>all(root,n=>n.tagName==='BUTTON'&&n.getAttribute('data-note-id')===id)[0];
const control=(root,variant)=>byId(root,`variant-${variant}`);
const tail='以及不同版式是否會遺漏同一段內容。';
function setup(){const document=createDocument(),root=rootFor(document),app=mount(root,document);return {document,root,app};}
// V1/V2 catch omission, wrong note mapping, inconsistent provenance and lost final paragraphs.
test('V1 a_full_note',()=>{
 const document=createDocument(),{element,activeHeading}=renderNotes(document,second(),()=>{});
 assert.equal(articles(element).length,1);const article=articles(element)[0];
 assert.equal(byClass(article,'note-body')[0].textContent,NOTES[1].body);
 assert.equal(byClass(article,'note-title')[0].textContent,'比較時保留條件');
 for(const note of NOTES){const button=indexButton(element,note.id);assert.ok(button);assert.ok(button.textContent.includes(note.title));assert.ok(button.textContent.includes(note.originLabel));assert.ok(button.textContent.includes(note.sourceText));}
 assert.equal(indexButton(element,'pn-example-2').getAttribute('aria-current'),'true');
 assert.equal(all(element,n=>n.getAttribute('aria-current')==='true').length,1);
 assert.equal(activeHeading.tagName,'H2');assert.equal(activeHeading.getAttribute('tabindex'),'-1');
 assert.ok(article.textContent.includes('版本 1'));assert.ok(article.textContent.includes('2026/11/07 16:00（香港時間）'));assert.ok(article.textContent.includes('合成對話 02'));
});
test('V2 b_all_notes_full',()=>{
 const document=createDocument(),{element,activeHeading}=renderNotes(document,{layout:'B',activeId:'pn-example-2'},()=>{});
 assert.equal(activeHeading,null);assert.deepEqual(articles(element).map(n=>n.getAttribute('data-note-id')),NOTES.map(n=>n.id));
 for(const [i,article] of articles(element).entries()){
   const note=NOTES[i];assert.equal(byClass(article,'note-body')[0].textContent,note.body);assert.equal(byClass(article,'note-title')[0].textContent,note.title);
   for(const text of [note.originLabel,note.sourceText,'版本 1',note.updatedAtLabel])assert.ok(article.textContent.includes(text));
 }
 const body=byClass(articles(element)[1],'note-body')[0].textContent;assert.equal(body.length,219);assert.equal(body.split('\n\n').length,3);assert.ok(body.endsWith(tail));
 assert.ok(articles(element)[2].textContent.includes('匯入示例，不代表本人確認或授權。'));assert.equal(all(element,n=>n.tagName==='BUTTON').length,0);
});
test('V3 literal_and_long_content',()=>{
 const document=createDocument(),before=JSON.stringify(NOTES),literal='<img src=x onerror=alert(1)>',long=literal+'長'.repeat(3000);
 const notes=NOTES.map(note=>({...note,title:literal,body:long,sourceText:literal,sourceNotice:literal}));
 for(const layout of ['A','B']){
  const {element}=renderNotes(document,{layout,activeId:'pn-example-2'},()=>{},notes);
  for(const article of articles(element)){assert.equal(byClass(article,'note-body')[0].textContent,long);assert.equal(byClass(article,'note-title')[0].textContent,literal);assert.equal(byClass(article,'note-source')[0].textContent,`來源：${literal}`);assert.equal(byClass(article,'source-notice')[0].textContent,literal);}
  assert.equal(all(element,n=>['IMG','SCRIPT'].includes(n.tagName)).length,0);
 }
 assert.equal(JSON.stringify(NOTES),before);
});
test('V4 real_control_roundtrip',()=>{
 const {root,app}=setup();indexButton(root,'pn-example-2').click();control(root,'B').click();control(root,'A').click();
 assert.deepEqual(app.getState(),{layout:'A',activeId:'pn-example-2'});assert.ok(Object.isFrozen(app.getState()));
 assert.equal(byClass(root,'note-body')[0].textContent,NOTES[1].body);assert.ok(root.textContent.includes(tail));assert.ok(root.textContent.includes(NOTES[1].updatedAtLabel));
});
test('V5 read_focus',()=>{
 const {document,root}=setup();indexButton(root,'pn-example-2').click();
 const heading=byClass(root,'note-title')[0];assert.equal(document.activeElement,heading);assert.equal(heading.textContent,'比較時保留條件');
 indexButton(root,'pn-example-2').focus();indexButton(root,'pn-example-2').click();assert.equal(document.activeElement,byClass(root,'note-title')[0]);
 assert.equal(control(root,'A').getAttribute('aria-pressed'),'true');
});
test('V6 layout_focus_stable',()=>{
 const {document,root}=setup(),a=control(root,'A'),b=control(root,'B');
 b.focus();b.click();assert.equal(document.activeElement,b);assert.equal(control(root,'B'),b);assert.equal(control(root,'A'),a);assert.equal(b.getAttribute('aria-pressed'),'true');assert.equal(a.getAttribute('aria-pressed'),'false');
 a.focus();a.click();assert.equal(document.activeElement,a);assert.equal(control(root,'B'),b);assert.equal(control(root,'A'),a);assert.equal(a.getAttribute('aria-pressed'),'true');assert.equal(b.getAttribute('aria-pressed'),'false');
});
test('V7 retired_row_does_not_change_b',()=>{
 const {root,app}=setup(),retired=indexButton(root,'pn-example-1');indexButton(root,'pn-example-2').click();control(root,'B').click();
 const originalArticles=articles(root),state=app.getState();retired.click();assert.equal(app.getState(),state);assert.deepEqual(state,{layout:'B',activeId:'pn-example-2'});assert.deepEqual(articles(root),originalArticles);
});
test('V8 repeat_no_duplication',()=>{
 const {root,app}=setup();indexButton(root,'pn-example-2').click();
 for(let i=0;i<20;i++){control(root,'B').click();control(root,'A').click();}
 assert.equal(all(root,n=>n.getAttribute('data-variant')).length,2);assert.equal(byClass(root,'reading-workspace').length,1);assert.equal(articles(root).length,1);assert.equal(app.getState().activeId,'pn-example-2');
 const ids=all(root,n=>n.getAttribute('id')).map(n=>n.getAttribute('id'));assert.equal(new Set(ids).size,ids.length);assert.equal(all(root,n=>n.getAttribute('hidden')!==null).length,0);
});
test('V9 destroy_retires_callbacks',()=>{
 const {root,app}=setup(),a=control(root,'A'),b=control(root,'B'),note=indexButton(root,'pn-example-2'),before=app.getState();
 app.destroy();assert.equal(root.children.length,0);a.click();b.click();note.click();assert.equal(root.children.length,0);assert.equal(app.getState(),before);app.destroy();assert.equal(root.children.length,0);
});
test('V10 independent_mounts',()=>{
 const first=setup(),secondMount=setup();indexButton(first.root,'pn-example-2').click();control(first.root,'B').click();
 assert.deepEqual(first.app.getState(),{layout:'B',activeId:'pn-example-2'});assert.deepEqual(secondMount.app.getState(),{layout:'A',activeId:'pn-example-1'});
 first.app.destroy();assert.equal(first.root.children.length,0);assert.equal(articles(secondMount.root).length,1);assert.equal(byClass(secondMount.root,'note-body')[0].textContent,NOTES[0].body);
});
