import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchPreviewBrowser,openPreview,assertFits} from './preview-browser.mjs';

const directory=resolve(process.env.FRONTEND_PROOF_DIR??'verification/fe-w33-reading');
await mkdir(directory,{recursive:true});
const browser=await launchPreviewBrowser(),failures=[],passed=[];
try {
 for(const width of [1440,900,390,320]) {
  const page=await openPreview(browser,'/chat',width,width===900?600:844,failures);
  assert.equal(await page.getByTestId('context-rail').count(),0,'Reading route starts without a second pane');
  const source=page.getByTestId('chat-answer');
  const prose=await source.getByText(/可以先把已確認的睡眠記錄/).evaluate(element=>({size:getComputedStyle(element).fontSize,line:getComputedStyle(element).lineHeight}));
  assert.deepEqual(prose,{size:'16px',line:'26px'});
  const trigger=page.getByRole('button',{name:'開啟資訊側欄',exact:true});await trigger.click();
  if(width<1280) {
   const drawer=page.getByRole('dialog',{name:'照顧上下文',exact:true});await drawer.waitFor();
   assert.equal(await drawer.getAttribute('aria-modal'),'true');
   assert.equal(await drawer.getByRole('button',{name:'關閉資訊側欄',exact:true}).count(),1);
   await drawer.getByRole('button',{name:'關閉資訊側欄',exact:true}).focus();
   for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.equal(await drawer.evaluate(element=>element.contains(document.activeElement)),true,'Drawer focus must remain inside');}
   await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});
   await page.waitForFunction(()=>document.activeElement===document.querySelector('[aria-label="開啟資訊側欄"]'));
   assert.equal(await trigger.evaluate(element=>element===document.activeElement),true,'Drawer returns focus to its trigger');
  } else {
   await page.getByRole('button',{name:'收起資訊側欄',exact:true}).click();
   await page.getByRole('link',{name:'照顧記錄',exact:true}).click();
   assert.equal(await page.getByTestId('context-rail').count(),0,'Workspace starts with its general rail closed');
   await page.getByRole('link',{name:'與 Agent 對話',exact:true}).click();
   assert.equal(await page.getByTestId('context-rail').count(),0,'Manual route choice survives navigation');
  }
  if(width===900) {
   const sidebar=page.getByTestId('web-sidebar');
   for(const name of ['家庭協調','記憶與話題','設定','與 Agent 對話']) {
    const item=sidebar.getByRole('link',{name,exact:true});await item.scrollIntoViewIfNeeded();
    const [bounds,frame]=await Promise.all([item.boundingBox(),sidebar.boundingBox()]);
    assert.ok(bounds.y>=frame.y-1&&bounds.y+bounds.height<=frame.y+frame.height+1,`${name} remains reachable in a short window`);
   }
  }
  await assertFits(page,`reading foundation ${width}`);
  await page.goto(new URL('/settings',process.env.FRONTEND_PREVIEW_URL).toString());
  const tabs=page.getByRole('tablist',{name:'設定分類',exact:true});await tabs.waitFor();
  const selected=tabs.getByRole('tab',{selected:true});
  assert.equal(await selected.getAttribute('tabindex'),'0');
  assert.equal(await tabs.locator('[tabindex="0"]').count(),1);
  await selected.focus();await page.keyboard.press('ArrowRight');
  assert.equal(await tabs.getByRole('tab',{name:'孩子設定',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');
  assert.equal(await tabs.getByRole('tab',{name:'資料與私隱',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('Home');
  const account=tabs.getByRole('tab',{name:'個人與帳戶',exact:true});
  assert.equal(await account.getAttribute('aria-selected'),'true');
  for(const tab of await tabs.getByRole('tab').all()) {
   const panel=page.locator(`[id="${await tab.getAttribute('aria-controls')}"]`);
   assert.equal(await panel.count(),1);
   assert.equal(await panel.getAttribute('aria-labelledby'),await tab.getAttribute('id'));
  }
  const draft=page.getByRole('textbox',{name:'顯示名稱預覽草稿',exact:true});await draft.fill('保留本人名稱草稿');
  await tabs.getByRole('tab',{name:'應用偏好',exact:true}).click();
  await account.click();assert.equal(await draft.inputValue(),'保留本人名稱草稿');
  await assertFits(page,`settings tabs ${width}`);
  passed.push(`${width}: reading type, closed workspace rail, short navigation or modal focus/Escape/return, roving tabs with stable panels and retained drafts`);
  await page.screenshot({path:resolve(directory,`foundation-${width}.png`)});await page.close();
 }
 assert.deepEqual(failures,[]);
 await writeFile(resolve(directory,'foundation-checks.json'),JSON.stringify({at:new Date().toISOString(),scope:'Isolated synthetic frontend; local layout, keyboard and disclosure checks only; no formal API, device or screen-reader acceptance.',passed,failures},null,2)+'\n');
 console.log(JSON.stringify({passed,failures}));
}finally{await browser.close();}
