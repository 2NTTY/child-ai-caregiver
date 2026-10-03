import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchPreviewBrowser,openPreview,assertFits,selectOption} from './preview-browser.mjs';

const directory=resolve(process.env.FRONTEND_PROOF_DIR??'verification/fe-w34-home-records');
const browser=await launchPreviewBrowser(),failures=[],passed=[],metrics=[];
const settle=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const visibleText=(page,text,options)=>page.getByText(text,options).and(page.locator(':not([data-testid="status-announcement"])'));
async function scenario(page,label){const toggle=page.getByRole('button',{name:'切換合成預覽情境',exact:true});await toggle.click();await page.getByRole('button',{name:label,exact:true}).click();await toggle.click();}
try {
 await mkdir(directory,{recursive:true});
 for(const width of [1440,1024,390,320]) {
  const page=await openPreview(browser,'/',width,width>=1024?992:width===390?844:720,failures);
  assert.equal(await page.getByTestId('home-focus').count(),1);
  assert.equal(await page.getByTestId('context-rail').count(),0,'A home overview does not need a duplicate default pane');
  assert.equal(await page.getByRole('textbox',{name:/問我關於孩子|撰寫對話/}).count(),0);
  assert.equal(await page.getByText('資料概況',{exact:true}).count(),0);
  assert.equal(await page.getByText('待辦示例 · 尚未建立正式任務',{exact:true}).count(),0);
  await page.getByText('今天暫無指定事項',{exact:true}).waitFor();
  await assertFits(page,`home reading ${width}`);
  await page.screenshot({path:resolve(directory,`home-${width}.png`)});
  await scenario(page,'今日事項未能取得');
  await page.getByTestId('home-focus').getByText('暫未能確認今日事項',{exact:true}).waitFor();
  assert.equal(await page.getByText('今天暫無指定事項',{exact:true}).count(),0,'Unavailable is not none');
  await assertFits(page,`unavailable home ${width}`);
  await scenario(page,'今日任務示例');
  await page.getByTestId('home-focus').getByRole('button',{name:'查看任務與預約',exact:true}).waitFor();
  await scenario(page,'成長提示示例');
  await page.getByTestId('home-focus').getByText('依據：前端合成樣本，沒有真來源證據',{exact:true}).waitFor();
  await scenario(page,'結果未知');
  const focus=page.getByTestId('home-focus');await focus.getByRole('button',{name:'查核這次結果',exact:true}).click();
  assert.equal(await focus.getByRole('button',{name:/重送|建立待辦/}).count(),0);
  await scenario(page,'設定未完成');
  await page.getByRole('button',{name:'了解如何使用',exact:true}).waitFor();
  if(width>=650) {await page.getByRole('button',{name:'問育兒問題',exact:true}).click();await page.getByRole('textbox',{name:'撰寫對話問題',exact:true}).waitFor();}
  passed.push(`home ${width}: one supplied focus; none/unavailable/task/growth/unknown; no checklist-derived priority, duplicate overview or question field; optional guide`);
  await page.close();

  const care=await openPreview(browser,'/care',width,width>=1024?992:width===390?844:720,failures);
  const scroll=care.getByTestId('care-page-scroll');
  const list=care.getByTestId('care-record-list');
  const rows=list.getByRole('button',{name:/^查看/});const row=rows.nth(2);await row.waitFor();
  await row.evaluate(e=>e.scrollIntoView({block:'center'}));await settle(care);
  const before=await scroll.evaluate(e=>e.scrollTop),rowName=await row.getAttribute('aria-label');
  await row.click();await care.getByRole('heading',{name:'記錄詳情',exact:true}).waitFor();
  const split=await list.count()===1;
  if(split) {assert.ok(await care.getByText(/正在查看/).count());}
  await care.screenshot({path:resolve(directory,`record-detail-${width}.png`)});
  await care.getByRole('button',{name:'返回記錄',exact:true}).click();
  const returned=care.getByTestId('care-record-list').getByRole('button',{name:rowName,exact:true});await returned.waitFor();await settle(care);
  const after=await scroll.evaluate(e=>e.scrollTop);
  if(!split){assert.ok(Math.abs(after-before)<=2,`Return must preserve scroll: ${before} -> ${after}`);assert.equal(await returned.evaluate(e=>document.activeElement===e),true);}
  assert.equal(await returned.getByText(/上次查看/).count(),1);
  metrics.push({width,split,before,after,rowName});
  const search=care.getByRole('textbox',{name:'搜尋照顧記錄',exact:true});await search.fill('記錄');
  await care.getByRole('button',{name:'搜尋記錄',exact:true}).click();await visibleText(care,'目前條件：記錄',{exact:false}).waitFor();
  await care.getByTestId('care-record-list').getByRole('button',{name:'查看睡眠記錄',exact:true}).click();await care.getByRole('button',{name:'返回記錄',exact:true}).click();
  assert.equal(await search.inputValue(),'記錄');
  await care.getByRole('button',{name:'新增記錄',exact:true}).click();await care.getByRole('button',{name:'預覽共享內容',exact:true}).click();
  await care.getByTestId('form-error-summary').waitFor();
  const raw=care.getByRole('textbox',{name:'記錄原文草稿',exact:true});await care.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='記錄原文草稿');assert.equal(await raw.evaluate(e=>e===document.activeElement),true);
  assert.equal(await raw.getAttribute('aria-invalid'),'true');
  const help=await raw.getAttribute('aria-describedby');assert.ok(help);assert.equal(await care.evaluate(id=>!!document.getElementById(id),help),true);
  await care.getByTestId('form-error-summary').getByRole('button',{name:'修正資料來源',exact:true}).click();
  const source=care.getByRole('textbox',{name:'資料來源草稿',exact:true});await care.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='資料來源草稿');assert.equal(await source.evaluate(e=>e===document.activeElement),true);
  const rawValue='  原文及大約九點，保留空白。  ';await raw.fill(rawValue);await source.fill('由家長提供');
  await care.getByRole('textbox',{name:'事件時間草稿',exact:true}).fill('大約九點');
  await care.getByRole('button',{name:'預覽共享內容',exact:true}).click();
  await care.getByRole('button',{name:'確認家庭共享並模擬提交',exact:true}).waitFor();assert.equal(await raw.inputValue(),rawValue);
  await assertFits(care,`care reading and validation ${width}`);
  passed.push(`care ${width}: pane-based list/detail; selected/visited marker; exact narrow return and preserved search; real field errors, help links and first-invalid/summary focus; unchanged raw values`);
  await care.close();
 }
 assert.deepEqual(failures,[]);await writeFile(resolve(directory,'home-care-checks.json'),JSON.stringify({passed,metrics,failures},null,2)+'\n');console.log(JSON.stringify({passed,metrics,failures}));
} finally {await browser.close();}
