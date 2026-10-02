import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchPreviewBrowser, openPreview, assertFits, selectOption } from './preview-browser.mjs';
const directory=resolve(process.env.FRONTEND_PROOF_DIR??'verification/fe-w29-chat');await mkdir(directory,{recursive:true});
const browser=await launchPreviewBrowser(),failures=[],passed=[],metrics=[];
const geometry=scroll=>scroll.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight,gap:el.scrollHeight-el.clientHeight-el.scrollTop}));
async function bottom(scroll){await scroll.page().waitForFunction(()=>{const el=document.querySelector('[data-testid="chat-timeline-scroll"]');return el&&el.scrollHeight-el.clientHeight-el.scrollTop<=2;});}
async function readUp(page,scroll,amount){const box=await scroll.boundingBox();await page.mouse.move(box.x+5,box.y+box.height/2);await page.mouse.wheel(0,-amount);await page.getByRole('button',{name:'回到最新',exact:true}).waitFor();}
async function tools(page,scroll){await readUp(page,scroll,6000);const toggle=page.getByRole('button',{name:'顯示 Agent 情境工具',exact:true});if(await toggle.count())await toggle.click();}
const lastReply=page=>page.getByTestId('chat-timeline-entry').last().getByTestId('chat-message');
try{
 for(const width of (process.env.FRONTEND_CHAT_WIDTHS?.split(',').map(Number)??[1440,1024,390,320])){
  const page=await openPreview(browser,'/chat',width,width>=1024?992:width===390?844:720,failures),scroll=page.getByTestId('chat-timeline-scroll');
  await bottom(scroll);assert.equal(await page.getByTestId('chat-timeline-entry').count(),6);
  await page.getByRole('button',{name:'查看較早記錄（8 則）',exact:true}).waitFor();
  const input=page.getByRole('textbox',{name:'撰寫對話問題',exact:true});await input.fill(`新問題 ${width}`);await page.getByRole('button',{name:'預覽輸入',exact:true}).click();
  await page.getByTestId('chat-timeline-entry').last().getByText(`新問題 ${width}`,{exact:true}).waitFor();await bottom(scroll);assert.equal(await page.getByTestId('chat-timeline-entry').count(),6);
  const older=page.getByRole('button',{name:'查看較早記錄（9 則）',exact:true});await older.scrollIntoViewIfNeeded();
  const oldFirst=page.getByTestId('chat-timeline-entry').first(),oldId=await oldFirst.getAttribute('id'),oldY=(await oldFirst.boundingBox()).y;
  await older.click();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="chat-timeline-entry"]').length===12);
  const same=page.locator(`[id="${oldId}"]`);await page.waitForTimeout(80);const anchorShift=(await same.boundingBox()).y-oldY;assert.ok(Math.abs(anchorShift)<=2,`History prepend moved reading anchor ${anchorShift}px`);
  await page.getByRole('button',{name:'查看較早記錄（3 則）',exact:true}).click();assert.equal(await page.getByTestId('chat-timeline-entry').count(),15);assert.equal(await page.getByTestId('chat-history-start').count(),1);
  await scroll.evaluate(el=>el.scrollTop=0);await page.screenshot({path:resolve(directory,`history-${width}.png`)});
  await page.getByRole('button',{name:'回到最新',exact:true}).click();await bottom(scroll);assert.equal(await page.getByTestId('chat-timeline-entry').count(),6);
  await input.fill('保留串流時的草稿');await tools(page,scroll);await page.getByRole('button',{name:'加入回覆狀態示例',exact:true}).click();
  const reply=lastReply(page);await reply.getByText('思考中',{exact:true}).waitFor();await bottom(scroll);
  await reply.evaluate(el=>el.dataset.instanceProbe='same-message');assert.equal(await reply.getByTestId('answer-sources').count(),0);assert.equal(await reply.getByTestId('chat-process-details').count(),0);
  await reply.getByTestId('chat-process-toggle').click();await reply.getByTestId('chat-process-details').waitFor();
  await reply.getByText('正在回覆',{exact:true}).waitFor();await page.waitForTimeout(180);const partial=await reply.innerText();await page.waitForTimeout(180);assert.notEqual(await reply.innerText(),partial);
  await bottom(scroll);await page.screenshot({path:resolve(directory,`streaming-${width}.png`)});
  await readUp(page,scroll,280);
  await page.getByTestId('chat-answer').getByRole('button',{name:/^查看引用【1】/}).evaluate(el=>el.click());await page.waitForTimeout(80);
  const reading=await geometry(scroll);assert.ok(reading.gap>40,'Citation did not stay above the active reply');
  const visibleAnchor=await scroll.evaluate(el=>{const top=el.getBoundingClientRect().top;const item=[...el.querySelectorAll('[data-testid="chat-timeline-entry"]')].find(item=>item.getBoundingClientRect().bottom>top+4);return {id:item.id,y:item.getBoundingClientRect().top};});
  await reply.getByText('回覆已結束',{exact:true}).waitFor();await page.waitForTimeout(100);
  const readingAfterFinal=await geometry(scroll);assert.ok(Math.abs(readingAfterFinal.top-reading.top)<=2,'Streaming interrupted history reading');
  const afterAnchor=await page.locator(`[id="${visibleAnchor.id}"]`).boundingBox();assert.ok(Math.abs(afterAnchor.y-visibleAnchor.y)<=2,'Streaming shifted the visible history entry');
  assert.equal(await reply.getAttribute('data-instance-probe'),'same-message');assert.equal(await reply.getByTestId('chat-process-details').count(),1);
  assert.ok((await reply.innerText()).includes('示例參考來源'));assert.equal(await reply.getByTestId('answer-source-panel').count(),1);assert.equal(await input.inputValue(),'保留串流時的草稿');
  await reply.getByRole('button',{name:/^查看引用【1】/}).evaluate(el=>el.click());await page.waitForTimeout(100);
  await bottom(scroll);assert.equal(await page.getByRole('button',{name:'回到最新',exact:true}).count(),0,'A citation at the tail leaves the return button visible at the bottom');
  await reply.getByTestId('chat-process-toggle').click();assert.equal(await reply.getByTestId('chat-process-details').count(),0);
  await readUp(page,scroll,80);await page.getByRole('button',{name:'回到最新',exact:true}).click();await bottom(scroll);
  const composer=await page.getByTestId('chat-composer').boundingBox(),viewport=await scroll.boundingBox();assert.ok(viewport.y+viewport.height<=composer.y+1,'Timeline and composer overlap');
  await page.screenshot({path:resolve(directory,`completed-${width}.png`)});await assertFits(page,`timeline ${width}`);
  metrics.push({width,initialVisible:6,totalBeforeStream:15,historyAnchorShiftPx:anchorShift,readingBefore:reading,readingAfterFinal,returnedToLatest:await geometry(scroll),sameMessageInstance:true,finalSnapshotHasSource:true,citationDuringStreamHoldsPosition:true,tailCitationButtonHidden:true,composerSeparate:true});
  if(width===390){
   await tools(page,scroll);await page.getByRole('button',{name:'加入回覆狀態示例',exact:true}).click();await lastReply(page).getByText('正在回覆',{exact:true}).waitFor();
   await lastReply(page).getByRole('button',{name:'停止回覆',exact:true}).click();await lastReply(page).getByText('已停止 · 回覆未完成',{exact:true}).waitFor();const stopped=await lastReply(page).innerText();await page.waitForTimeout(450);assert.equal(await lastReply(page).innerText(),stopped);assert.equal(await lastReply(page).getByTestId('answer-sources').count(),0);
   const stateColors={};
   for(const [option,label]of [['回覆失敗','回覆失敗'],['結果未知','結果未知 · 待查核'],['等候確認','等候你的確認']]){
    await tools(page,scroll);await selectOption(page,'聊天回覆狀態示例',option);await page.getByRole('button',{name:'加入回覆狀態示例',exact:true}).click();await lastReply(page).getByText(label,{exact:true}).waitFor();assert.equal(await lastReply(page).getByRole('button',{name:'停止回覆',exact:true}).count(),0);
    stateColors[option]=await lastReply(page).getByText(label,{exact:true}).evaluate(el=>getComputedStyle(el).color);
    if(option==='回覆失敗')await page.screenshot({path:resolve(directory,'failed-390.png')});
   }
   assert.notEqual(stateColors['回覆失敗'],stateColors['結果未知']);metrics.at(-1).stateColors=stateColors;
   await tools(page,scroll);await selectOption(page,'聊天回覆狀態示例','逐字輸出及工具過程');await page.getByRole('button',{name:'加入回覆狀態示例',exact:true}).click();await lastReply(page).getByText('思考中',{exact:true}).waitFor();
   const oldStreamId=await lastReply(page).getAttribute('id');await page.getByRole('button',{name:'選擇孩子，目前小昕',exact:true}).first().click();await page.getByRole('radio',{name:'阿樂 · 約 8 歲 · 截至 2026 年 9 月',exact:true}).click();
   await page.getByRole('button',{name:'選擇孩子，目前阿樂',exact:true}).first().waitFor();await page.waitForTimeout(1000);assert.equal(await page.locator(`[id="${oldStreamId}"]`).count(),0);assert.equal(await page.getByTestId('chat-message-phase').count(),0);assert.equal(await page.getByTestId('chat-local-message').count(),0);
   await input.fill('較大文字草稿');await page.addStyleTag({content:"input,textarea,[dir='auto']{font-size:150%!important;}"});await assertFits(page,'chat 390 enlarged text');await page.screenshot({path:resolve(directory,'chat-390-large-text.png')});
   passed.push('390: stop freezes partial text, failed/unknown/confirmation stay distinct and do not execute; child remount removes old messages, active timers and progress; enlarged text fits');
  }
  passed.push(`${width}: bottom chronological window, local submit follows newest, progressive loaded history with retained anchor, return-to-latest, same streaming message and disclosure state, reader wheel pauses follow through final snapshot, final sources and preserved draft, no composer overlap`);
  await page.close();
 }
 assert.deepEqual(failures,[]);await writeFile(resolve(directory,'chat-timeline-checks.json'),JSON.stringify({at:new Date().toISOString(),scope:'Synthetic local chat rendering, history and timed display updates only. No model, tools, API, transport, persistence or native-device acceptance.',passed,metrics,failures},null,2)+'\n');console.log(JSON.stringify({passed,failures}));
}finally{await browser.close();}
