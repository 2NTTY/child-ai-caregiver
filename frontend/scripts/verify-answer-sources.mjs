import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchPreviewBrowser,openPreview,assertFits,selectOption} from './preview-browser.mjs';
const directory=resolve(process.env.FRONTEND_PROOF_DIR??'verification/fe-w33-reading');await mkdir(directory,{recursive:true});
const browser=await launchPreviewBrowser(),failures=[],passed=[],appearance=[],returns=[],hints=[];
const titles=['記錄時間及原文（合成示例）','睡前流程討論（合成示例）','來源日期及適用範圍（合成示例）'];
const sourceTab=(answer,number,title)=>answer.getByRole('button',{name:`來源【${number}】：${title}`,exact:true});
const sourceButtons=answer=>answer.getByRole('button',{name:/^來源【/});
async function instantJump(marker,panel){await marker.scrollIntoViewIfNeeded();const handle=await panel.elementHandle();await marker.evaluate((element,panel)=>{let parent=panel.parentElement;while(parent){const style=getComputedStyle(parent);if(['auto','scroll'].includes(style.overflowY)&&parent.scrollHeight>parent.clientHeight){const desired=parent.scrollTop+panel.getBoundingClientRect().top-parent.getBoundingClientRect().top;element.click();const expected=Math.min(parent.scrollHeight-parent.clientHeight,Math.max(0,desired));if(Math.abs(parent.scrollTop-expected)>1)throw new Error(`Citation click did not immediately locate its own source panel: ${parent.scrollTop} != ${expected}`);return;}parent=parent.parentElement;}throw new Error('No vertical source viewport');},handle);}
async function visibleHeader(details,title){await details.getByText(title,{exact:true}).evaluate(async element=>{await new Promise(resolve=>requestAnimationFrame(resolve));const bounds=element.getBoundingClientRect();let parent=element.parentElement;while(parent){const style=getComputedStyle(parent);if(['auto','scroll'].includes(style.overflowY)&&parent.scrollHeight>parent.clientHeight){const frame=parent.getBoundingClientRect();if(bounds.top<frame.top-1||bounds.bottom>frame.bottom+1)throw new Error('Opened source heading is outside a scroll viewport');}parent=parent.parentElement;}});}
async function horizontalState(tab){return tab.evaluate(element=>{let parent=element.parentElement;while(parent){const style=getComputedStyle(parent);if(parent.hasAttribute('data-overlayscrollbars-viewport')||['auto','scroll'].includes(style.overflowX)){const bounds=element.getBoundingClientRect(),frame=parent.getBoundingClientRect();return {left:parent.scrollLeft,overflow:parent.scrollWidth>parent.clientWidth+1,inside:bounds.left>=frame.left-1&&bounds.right<=frame.right+1,width:frame.width};}parent=parent.parentElement;}throw new Error('No horizontal source viewport');});}
async function located(tab){assert.equal(await tab.evaluate(element=>element===document.activeElement),true);assert.equal((await horizontalState(tab)).inside,true);await tab.evaluate(element=>{const bounds=element.getBoundingClientRect();let parent=element.parentElement;while(parent){const style=getComputedStyle(parent);if(['auto','scroll'].includes(style.overflowY)&&parent.scrollHeight>parent.clientHeight){const frame=parent.getBoundingClientRect();if(bounds.top<frame.top-1||bounds.bottom>frame.bottom+1)throw new Error('Source tab is outside its vertical viewport');return;}parent=parent.parentElement;}});}
async function quoteState(marker){return marker.evaluate(element=>{
 const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);let parent=element.parentElement;
 while(parent){if(['auto','scroll'].includes(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){
  const frame=parent.getBoundingClientRect(),max=parent.scrollHeight-parent.clientHeight;
  return {scroll:parent.scrollTop,expected:Math.min(max,Math.max(0,parent.scrollTop+bounds.top+bounds.height/2-frame.top-parent.clientHeight/2)),
   visible:bounds.top>=frame.top-1&&bounds.bottom<=frame.bottom+1,focused:element===document.activeElement,
   outline:style.outlineStyle,outlineWidth:style.outlineWidth,width:bounds.width,height:bounds.height};
 }parent=parent.parentElement;}throw new Error('No quote viewport');
});}
async function returnToQuote(answer,marker,width,scenario,keyboard=false){
 const button=answer.getByRole('button',{name:'返回引用句',exact:true});await button.scrollIntoViewIfNeeded();
 const before=await quoteState(marker);
 if(keyboard){await button.focus();await answer.page().keyboard.press('Enter');}else await button.click();
 const after=await quoteState(marker);
 assert.ok(Math.abs(after.scroll-before.expected)<=1,`Return must locate the original quote context: ${JSON.stringify({before,after})}`);
 assert.equal(after.visible,true);assert.equal(after.focused,true);assert.equal(after.outline,'solid');assert.equal(after.outlineWidth,'1px');
 assert.deepEqual([after.width,after.height],[before.width,before.height],'The return indicator must not change inline layout');
 await marker.evaluate(element=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.ok(Math.abs((await quoteState(marker)).scroll-after.scroll)<=1,'Returning must not be pulled back to the source or latest message');
 returns.push({width,scenario,activation:keyboard?'Enter':'pointer',before,after});
}
async function sourceHintState(answer){
 const row=answer.getByTestId('answer-source-tab-row'),handle=await row.elementHandle();
 await answer.page().waitForFunction(row=>{
  const viewport=row.querySelector('[data-testid="answer-source-tabs"]');
  return !!row.querySelector('[data-testid="answer-source-scroll-hint"]')===(viewport.scrollWidth-viewport.clientWidth-viewport.scrollLeft>1);
 },handle);
 const state=await row.evaluate(element=>{
  const viewport=element.querySelector('[data-testid="answer-source-tabs"]'),hint=element.querySelector('[data-testid="answer-source-scroll-hint"]');
  const bar=viewport.parentElement.querySelector('.os-scrollbar-horizontal'),bounds=element.getBoundingClientRect(),frame=viewport.getBoundingClientRect(),tip=hint?.getBoundingClientRect(),barStyle=bar&&getComputedStyle(bar);
  return {left:viewport.scrollLeft,width:viewport.clientWidth,content:viewport.scrollWidth,rowWidth:bounds.width,height:bounds.height,
   more:!!hint,slot:!!element.querySelector('[data-testid="answer-source-hint-slot"]'),barFound:!!bar,
   barVisible:!!bar&&barStyle.display!=='none'&&barStyle.visibility!=='hidden'&&Number(barStyle.opacity)>0&&bar.getBoundingClientRect().height>0,
   separate:!tip||tip.left>=frame.right-1&&tip.right<=bounds.right+1,hitWidth:tip?.width,hitHeight:tip?.height};
 });
 assert.equal(state.barFound,true,'Inspect the existing source scrollbar instance rather than missing the element');
 assert.equal(state.barVisible,false,'Source titles must not share a horizontal scrollbar');
 assert.equal(state.separate,true,'The right-side hint must occupy its own area outside the source viewport');
 assert.ok(state.height>=48);
 if(state.more)assert.deepEqual([state.hitWidth,state.hitHeight],[48,48]);
 if(state.content<=state.width+1){assert.equal(state.more,false);assert.equal(state.slot,false,'Fitting sources must not reserve hint space');}
 return state;
}
async function sourceAppearance(answer,count){
 const panel=answer.getByTestId('answer-source-panel');
 const style=await panel.evaluate(element=>{const s=getComputedStyle(element);return {background:s.backgroundColor,border:s.borderTopWidth,radius:s.borderRadius,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],height:element.getBoundingClientRect().height};});
 assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.border,'0px');assert.equal(style.radius,'0px');assert.deepEqual(style.padding,['0px','0px','0px','0px']);assert.ok(style.height>=100);
 const tabs=await sourceButtons(answer).evaluateAll(elements=>elements.map(element=>{const s=getComputedStyle(element),b=element.getBoundingClientRect();return {height:b.height,background:s.backgroundColor};}));
 assert.equal(tabs.length,count);assert.ok(tabs.every(tab=>tab.height>=48&&tab.background==='rgba(0, 0, 0, 0)'));
 const dividers=await answer.getByTestId('answer-source-separator').evaluateAll(elements=>elements.map(element=>{const b=element.getBoundingClientRect(),before=element.previousElementSibling.getBoundingClientRect(),after=element.nextElementSibling.getBoundingClientRect();return {width:b.width,height:b.height,between:b.left>=before.right-1&&b.right<=after.left+1};}));
 assert.equal(dividers.length,count-1);assert.ok(dividers.every(divider=>divider.width===1&&divider.height===20&&divider.between));
 return {panel:style,tabs:tabs.length,separators:dividers.length,hint:await sourceHintState(answer)};
}
try{
 for(const width of [1440,1024,390,320]){
  const page=await openPreview(browser,'/chat',width,width>=1024?992:width===390?844:720,failures);
  await page.emulateMedia({reducedMotion:'no-preference'});
  const answer=page.getByTestId('chat-answer'),footer=answer.getByTestId('answer-sources'),details=answer.getByTestId('source-details-panel');
  const draft=page.getByRole('textbox',{name:'撰寫對話問題',exact:true});
  await draft.evaluate(element=>element.dataset.instanceProbe='original-input');
  assert.equal(await page.getByRole('button',{name:/^預填本地示例/}).count(),0);
  await page.getByTestId('composer-suggestions-toggle').click();
  assert.equal(await page.getByRole('button',{name:/^預填本地示例/}).count(),3);
  await draft.focus();assert.equal(await page.getByRole('button',{name:/^預填本地示例/}).count(),0);
  await draft.fill('保留原問題草稿');assert.equal(await draft.getAttribute('data-instance-probe'),'original-input');
  assert.equal(await page.getByTestId('composer-suggestions-toggle').getAttribute('aria-disabled'),'true');
  assert.equal(await footer.getByTestId('answer-source-panel').count(),1);assert.equal(await footer.getByRole('tablist').count(),0);
  assert.equal(await sourceButtons(footer).count(),3);assert.equal(await footer.getByRole('button',{name:/^查看來源/}).count(),0);
  assert.equal(await details.count(),0);assert.equal(await footer.evaluate(element=>getComputedStyle(element).borderTopWidth),'1px');
  const initialAppearance=await sourceAppearance(answer,3);
  if(width===390){
   await page.setViewportSize({width:1440,height:992});const wide=await sourceHintState(answer);assert.equal(wide.more,false);assert.equal(wide.slot,false);
   await page.setViewportSize({width,height:844});const narrow=await sourceHintState(answer);assert.equal(narrow.more,true);
   hints.push({width,scenario:'resize from overflow to fitting sources and back',wide,narrow});
  }
  for(let index=0;index<3;index++){
   const tab=sourceTab(answer,index+1,titles[index]);assert.ok((await tab.innerText()).includes(titles[index]));
   await instantJump(answer.getByRole('button',{name:`查看引用【${index+1}】：${titles[index]}`,exact:true}),footer.getByTestId('answer-source-panel'));
   await located(tab);assert.equal(await details.count(),0);assert.equal(await tab.getAttribute('aria-expanded'),'false');
  }
  const originalThird=answer.getByRole('button',{name:`查看引用【3】：${titles[2]}`,exact:true});
  await returnToQuote(answer,originalThird,width,'short reply with collapsed sources');
  await originalThird.click();
  await sourceTab(answer,3,titles[2]).click();assert.equal(await details.count(),1);
  await returnToQuote(answer,originalThird,width,'quote with open source');
  assert.equal(await sourceTab(answer,3,titles[2]).getAttribute('aria-expanded'),'true');
  await page.screenshot({path:resolve(directory,`returned-quote-${width}.png`)});
  await sourceTab(answer,3,titles[2]).click();assert.equal(await details.count(),0);
  await footer.evaluate(element=>{element.style.marginTop='1800px';});
  await instantJump(answer.getByRole('button',{name:`查看引用【1】：${titles[0]}`,exact:true}),footer.getByTestId('answer-source-panel'));
  await located(sourceTab(answer,1,titles[0]));assert.equal(await details.count(),0);
  assert.equal((await sourceAppearance(answer,3)).panel.height,initialAppearance.panel.height,'Returning to a citation must not change the source header height');
  const originalMarker=answer.getByRole('button',{name:`查看引用【1】：${titles[0]}`,exact:true});
  await returnToQuote(answer,originalMarker,width,'1800px extended reply');
  await instantJump(originalMarker,footer.getByTestId('answer-source-panel'));
  await sourceTab(answer,3,titles[2]).click();assert.equal(await details.count(),1);
  await returnToQuote(answer,originalMarker,width,'original quote after switching the detail source',true);
  assert.equal(await sourceTab(answer,3,titles[2]).getAttribute('aria-expanded'),'true');
  await sourceTab(answer,3,titles[2]).click();assert.equal(await details.count(),0);
  await footer.evaluate(element=>{element.style.marginTop='';});
  const third=sourceTab(answer,3,titles[2]);await third.click();await details.getByText(titles[2],{exact:true}).waitFor();await visibleHeader(details,titles[2]);
  assert.equal(await third.getAttribute('aria-expanded'),'true');await third.click();assert.equal(await details.count(),0);
  assert.equal(await third.getAttribute('aria-expanded'),'false');
  await sourceTab(answer,1,titles[0]).click();await sourceTab(answer,2,titles[1]).focus();await page.keyboard.press('Enter');
  await details.getByText(titles[1],{exact:true}).waitFor();assert.equal(await details.count(),1);await visibleHeader(details,titles[1]);
  assert.equal(await details.getByTestId('source-detail-group').count(),2);
  for(const label of ['引用內容','日期與適用範圍'])assert.equal(await details.getByRole('heading',{name:label,exact:true}).count(),1);
  assert.equal(await details.getByText('原來源版本校驗',{exact:true}).count(),0);
  await details.getByRole('button',{name:'版本與核對資料',exact:true}).click();
  assert.equal(await details.getByTestId('source-detail-group').count(),3);
  assert.equal(await details.getByText('原來源版本校驗',{exact:true}).count(),1);
  await details.getByRole('button',{name:'版本與核對資料',exact:true}).click();
  const groups=await details.getByTestId('source-detail-group').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).borderTopWidth));assert.deepEqual(groups,['0px','1px']);
  await sourceHintState(answer);
  assert.equal(await sourceButtons(footer).count(),3);assert.equal(await page.getByTestId('app-dialog').count(),0);
  await assertFits(page,`single source panel ${width}`);await page.screenshot({path:resolve(directory,`single-source-panel-${width}.png`)});
  await sourceTab(answer,2,titles[1]).focus();
  await page.keyboard.press('Enter');assert.equal(await details.count(),0);
  await page.screenshot({path:resolve(directory,`collapsed-sources-${width}.png`)});
  assert.equal(await draft.inputValue(),'保留原問題草稿');
  await page.getByTestId('agent-preview-toggle').click();
  await page.getByRole('button',{name:'顯示 Agent 情境工具',exact:true}).click();
  await selectOption(page,'Agent 運行情境','多個來源（12 項）');
  await page.getByRole('button',{name:'查看來源與候選',exact:true}).click();
  const run=page.getByTestId('agent-run-view');await run.getByText('已結束',{exact:true}).waitFor();
  const many=run.getByTestId('agent-answer'),manyDetails=many.getByTestId('source-details-panel');
  assert.equal(await sourceButtons(many).count(),12);assert.equal(await many.getByTestId('answer-source-panel').count(),1);
  const manyAppearance=await sourceAppearance(many,12);appearance.push({width,preview:initialAppearance,agent:manyAppearance});
  const lastTitle='來源片段與版本的版式示例 12',firstTitle='來源片段與版本的版式示例 1';
  const last=sourceTab(many,12,lastTitle),first=sourceTab(many,1,firstTitle);
  assert.equal((await horizontalState(first)).overflow,true);
  const hint=many.getByRole('button',{name:'查看更多來源',exact:true});
  const beforeHint=await sourceHintState(many);assert.equal(beforeHint.more,true);
  await hint.click();const pointerHint=await sourceHintState(many);assert.ok(pointerHint.left>beforeHint.left);assert.equal(await manyDetails.count(),0);
  assert.match(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),/^來源【/,'The hint must focus the newly revealed source, not a disappearing control');
  await hint.focus();await page.keyboard.press('Enter');const keyboardHint=await sourceHintState(many);assert.ok(keyboardHint.left>pointerHint.left);assert.equal(await manyDetails.count(),0);
  await page.screenshot({path:resolve(directory,`source-scroll-hint-${width}.png`)});
  await instantJump(many.getByRole('button',{name:`查看引用【12】：${lastTitle}`,exact:true}),many.getByTestId('answer-source-panel'));await located(last);
  const end=(await horizontalState(last)).left;assert.ok(end>0);assert.equal(await manyDetails.count(),0);
  const ended=await sourceHintState(many);assert.equal(ended.more,false);assert.equal(ended.width,beforeHint.width,'Reaching the end must not resize the source viewport');
  await instantJump(many.getByRole('button',{name:`查看引用【1】：${firstTitle}`,exact:true}),many.getByTestId('answer-source-panel'));await located(first);
  assert.ok((await horizontalState(first)).left<end);
  const restored=await sourceHintState(many);assert.equal(restored.more,true);
  const viewport=many.getByTestId('answer-source-tabs');await viewport.evaluate(element=>element.scrollLeft=0);
  const frame=await viewport.boundingBox();await page.mouse.move(frame.x+frame.width/2,frame.y+frame.height/2);await page.mouse.wheel(220,0);
  await page.waitForFunction(element=>element.scrollLeft>0,await viewport.elementHandle());const wheel=await sourceHintState(many);
  hints.push({width,scenario:'12 sources: pointer, Enter, wheel, end and return',before:beforeHint,pointer:pointerHint,keyboard:keyboardHint,end:ended,restored,wheel});
  await first.evaluate(element=>{let parent=element.parentElement;while(parent){if(['auto','scroll'].includes(getComputedStyle(parent).overflowX)){parent.scrollLeft=parent.scrollWidth;return;}parent=parent.parentElement;}});
  assert.ok((await horizontalState(last)).left>0);assert.equal((await horizontalState(last)).inside,true,JSON.stringify(await last.evaluate(element=>{let parent=element.parentElement;while(parent){if(['auto','scroll'].includes(getComputedStyle(parent).overflowX)){const b=element.getBoundingClientRect(),f=parent.getBoundingClientRect();return {left:parent.scrollLeft,scrollWidth:parent.scrollWidth,clientWidth:parent.clientWidth,tabLeft:b.left,tabRight:b.right,frameLeft:f.left,frameRight:f.right};}parent=parent.parentElement;}})));
  await last.click();await manyDetails.getByText(lastTitle,{exact:true}).waitFor();await visibleHeader(manyDetails,lastTitle);await assertFits(page,`12 horizontally scrolling sources ${width}`);
  assert.equal(await details.count(),0);
  await sourceTab(answer,1,titles[0]).click();await details.getByText(titles[0],{exact:true}).waitFor();
  assert.equal(await manyDetails.count(),1);assert.equal(await last.getAttribute('aria-expanded'),'true');
  await instantJump(answer.getByRole('button',{name:`查看引用【2】：${titles[1]}`,exact:true}),answer.getByTestId('answer-source-panel'));
  await details.getByText(titles[1],{exact:true}).waitFor();assert.equal(await manyDetails.getByText(lastTitle,{exact:true}).count(),1);
  await sourceTab(answer,2,titles[1]).click();assert.equal(await details.count(),0);assert.equal(await manyDetails.count(),1);
  await manyDetails.getByText(lastTitle,{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(directory,`many-sources-${width}.png`)});
  await last.click();assert.equal(await manyDetails.count(),0);
  if(width<1024){await many.locator('[dir="auto"]').evaluateAll(elements=>{for(const element of elements){const style=getComputedStyle(element);element.style.fontSize=parseFloat(style.fontSize)*1.5+'px';if(style.lineHeight!=='normal')element.style.lineHeight=parseFloat(style.lineHeight)*1.5+'px';}});await assertFits(page,`150% source text ${width}`);}
  assert.equal(await draft.inputValue(),'保留原問題草稿');
  passed.push(`reading ${width}: reusable chat and Agent source disclosures, hidden source scrollbar and separate 48px right hint, pointer/Enter reveal with source focus, native horizontal wheel, end hint removal without width change and reappearance on return, independent messages and 12 sources, citation jump/return including 1800px extended reply, unchanged draft and source disclosure${width<1024?', enlarged text':''}`);
  await page.close();
 }
 assert.deepEqual(failures,[]);await writeFile(resolve(directory,'source-tabs-checks.json'),JSON.stringify({at:new Date().toISOString(),scope:'Synthetic frontend only; conditional right source hint, native scroll/focus, resize, pointer/keyboard and reused citation return checks; no API/model calls or device acceptance',passed,appearance,hints,returns,failures},null,2)+'\n');
 console.log(JSON.stringify({passed,failures}));
}finally{await browser.close();}
