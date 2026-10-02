import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { launchPreviewBrowser, openPreview, selectOption, assertFits } from './preview-browser.mjs';
const browser = await launchPreviewBrowser();
const failures = [], results = [];
const destination = 'verification/fe-w30-contract-review';
await fs.mkdir(destination, { recursive: true });
try {
  // One responsive/runtime check per static screen; stateful scenarios below stay bounded.
  for (const width of [1440,1024,390,320]) {
    const page = await openPreview(browser, '/', width, 920, failures);
    for (const path of ['/','/chat','/care','/tasks','/memory','/sources','/photos','/family','/profile','/growth','/summary','/contact','/settings','/guide','/more','/motion-preview']) {
      await page.goto(`http://localhost:8083${path}`, {waitUntil:'domcontentloaded'});
      await page.getByTestId('frontend-preview-ready').waitFor();
      await page.getByText('介面預覽 · 合成資料 · 未接駁 Server',{exact:true}).waitFor();
      await assertFits(page,`${path} ${width}`);
      results.push({path,width,runtimeAndLayout:'passed'});
    }
    await page.close();
  }
  assert.deepEqual(failures,[]);
  await fs.writeFile(`${destination}/layout-checks.json`,JSON.stringify({at:new Date().toISOString(),results,failures},null,2));
  console.log('64 responsive/runtime checks passed');
  const page = await openPreview(browser,'/sources',390,920,failures);
  await page.getByLabel('自備來源原文',{exact:true}).fill('未保存的本地合成原文');
  const prevented = await page.evaluate(() => { const event = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; });
  assert.equal(prevented,true);
  await page.getByRole('link',{name:'主頁',exact:true}).last().click();
  await page.getByTestId('leave-preview-dialog').waitFor();
  await page.getByRole('button',{name:'繼續編輯',exact:true}).click();
  assert.equal(await page.getByLabel('自備來源原文',{exact:true}).inputValue(),'未保存的本地合成原文');
  await page.getByRole('link',{name:'主頁',exact:true}).last().click();
  await page.getByRole('button',{name:'捨棄草稿並離開',exact:true}).click();
  await page.waitForURL('**/');
  results.push({sourceDirty:'route cancel retains raw; explicit discard; beforeunload passed'});
  await page.goto('http://localhost:8083/settings');
  await page.getByRole('tab',{name:'應用偏好',exact:true}).click();
  await page.getByRole('switch',{name:'預約提醒例外預覽'}).click();
  await page.getByRole('button',{name:'預覽通知偏好',exact:true}).click();
  await selectOption(page,'模擬提交結果','結果未知');
  await page.getByRole('button',{name:'模擬保存本人偏好',exact:true}).click();
  await page.getByText('結果未知；須查核同一個原操作，不可建立第二次提交。',{exact:true}).waitFor();
  const reference = await page.getByText(/合成操作參考：preview-operation-/).textContent();
  await page.getByRole('tab',{name:'個人與帳戶',exact:true}).click();
  await page.getByRole('tab',{name:'應用偏好',exact:true}).click();
  assert.equal(await page.getByText(/合成操作參考：preview-operation-/).textContent(),reference);
  await page.getByRole('link',{name:'主頁',exact:true}).last().click();
  await page.getByText('先處理原操作',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'捨棄草稿並離開',exact:true}).count(),0);
  await page.getByRole('button',{name:'留在此頁查核',exact:true}).click();
  await selectOption(page,'模擬查核結果','尚無確認收據');
  await page.getByRole('button',{name:'查核原操作',exact:true}).click();
  await page.getByRole('button',{name:'重試同一原操作',exact:true}).waitFor();
  await selectOption(page,'模擬提交結果','成功');
  await page.getByRole('button',{name:'重試同一原操作',exact:true}).click();
  await page.getByText('模擬已保存；只改變本次預覽，沒有 Server 收據。',{exact:true}).waitFor();
  assert.equal(await page.getByText(/合成操作參考：preview-operation-/).textContent(),reference);
  results.push({preferences:'unknown retained across tab; nav blocked; original retry keeps reference'});
  await page.screenshot({path:`${destination}/preferences-recovery-390.png`});
  await page.close();
  assert.deepEqual(failures,[]);
  await fs.writeFile(`${destination}/ui-checks.json`,JSON.stringify({at:new Date().toISOString(),results,failures,scope:'local synthetic preview; no formal API/E2E/device calls'},null,2));
  console.log(JSON.stringify({passed:results.length,failures}));
} finally {await browser.close();}
