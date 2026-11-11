// Focused red wrapper: exact changed-document case body copied from remaining-chat-selection.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {host} from './host.mjs';
import {chatScreen} from './chat-harness.mjs';
for(const variant of ['original','journal','uiux-upgrade']){
 test(`${variant} changed document and retired messages cannot restore a choice`,async()=>{
  const h=host();h.ids.route.value='chat';h.ids['left-version'].value=variant;h.setAnswer(true);await h.click('apply');await h.load('left','/chat');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,false);
  const old=h.emit('left','/chat',2);h.emit('left','/chat',3,{documentId:'c'.repeat(32)});await h.frame('left').fire('load');await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);assert.match(h.ids['left-source'].textContent,/文件已重新載入/);
  await h.event('message',old);await chatScreen(h,'left',{ready:true});assert.equal(h.ids['left-pick'].disabled,true);
 });

}
