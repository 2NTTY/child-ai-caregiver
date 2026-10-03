import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brand } from '../src/branding.ts';
import { launchPreviewBrowser, openPreview, assertFits, selectOption } from './preview-browser.mjs';

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? 'verification/fe-w35-commercial');
const browser = await launchPreviewBrowser(), failures = [], passed = [];
const widths = (process.env.FRONTEND_FORM_WIDTHS ?? '1440,320').split(',').map(Number);
const requested = new Set((process.env.FRONTEND_FORM_CASES ?? 'tasks,memory,photos,sources,source-records,preferences,model').split(','));
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = (page, name) => page.getByRole('textbox', { name, exact: true });
async function focused(page, control) {
  const id = await control.getAttribute('id');
  assert.ok(id, 'The actual control has a stable ID');
  await page.waitForFunction(value => document.activeElement?.id === value, id);
}
async function described(control) {
  const ids = (await control.getAttribute('aria-describedby'))?.split(/\s+/).filter(Boolean) ?? [];
  assert.ok(ids.length, 'Invalid controls must reference their field message');
  assert.equal(await control.getAttribute('aria-invalid'), 'true');
  assert.equal(await control.evaluate((element, values) => values.every(id => !!document.getElementById(id)?.textContent?.trim()), ids), true);
}
async function capture(page, name, width) {
  await assertFits(page, `${name} errors ${width}`);
  await page.getByTestId('form-error-summary').filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, `${name}-errors-${width}.png`) });
}
try {
  await mkdir(directory, { recursive: true });
  for (const width of widths) {
    const height = width === 320 ? 720 : 992;
    if (requested.has('tasks')) {
    const tasks = await openPreview(browser, '/tasks', width, height, failures);
    await button(tasks, '新增共享事項').click();
    await button(tasks, '預覽家庭共享內容').click();
    await focused(tasks, text(tasks, '事項標題')); await described(text(tasks, '事項標題'));
    await button(tasks, '修正安排時間').click();
    await focused(tasks, button(tasks, '選擇安排時間')); await described(button(tasks, '選擇安排時間'));
    await capture(tasks, 'tasks', width); await tasks.close();
    passed.push(`tasks ${width}: first error and actual date trigger focus`);
    }

    if (requested.has('memory')) {
    const memory = await openPreview(browser, '/memory', width, height, failures);
    await button(memory, '新增候選').click(); await button(memory, '預覽私人候選').click();
    await focused(memory, text(memory, '事實欄目')); await described(text(memory, '事實欄目'));
    await button(memory, '修正事實內容').click(); await focused(memory, text(memory, '事實內容'));
    await capture(memory, 'memory', width); await memory.close();
    passed.push(`memory ${width}: first error, summary target and field message`);
    }

    if (requested.has('photos')) {
    const photos = await openPreview(browser, '/photos', width, height, failures);
    await button(photos, `開啟照片：私人 · ${brand.illustrationFilename}`).click();
    await text(photos, '照片記錄原文').fill('  家長確認約數原文  ');
    await text(photos, '照片數值原文').fill('  約 95.2  '); await text(photos, '照片數值單位').fill('');
    await button(photos, '預覽照片共享內容').click();
    await focused(photos, text(photos, '照片數值單位')); await described(text(photos, '照片數值單位'));
    assert.equal(await text(photos, '照片數值原文').inputValue(), '  約 95.2  ');
    await button(photos, '修正照片數值單位').click(); await focused(photos, text(photos, '照片數值單位'));
    await capture(photos, 'photos', width); await photos.close();
    passed.push(`photos ${width}: first pointer submit, unit focus and unmodified raw value`);
    }

    if (requested.has('sources')) {
    const sources = await openPreview(browser, '/sources', width, height, failures);
    await button(sources, '清除草稿並新增來源').click();
    await text(sources, '來源名稱').fill(''); await button(sources, '保存私人來源').click();
    await focused(sources, text(sources, '來源名稱')); await described(text(sources, '來源名稱'));
    await button(sources, '修正自備來源原文').click(); await focused(sources, text(sources, '自備來源原文'));
    await capture(sources, 'sources', width); await sources.close();
    passed.push(`sources ${width}: first error and original text target`);
    }

    if (requested.has('source-records')) {
    const sourceRecord = await openPreview(browser, '/sources', width, height, failures);
    await button(sourceRecord, '查看私人來源：媽媽貼上的觀察原文').click();
    await selectOption(sourceRecord, '記錄用途', '孩子實際記錄');
    await text(sourceRecord, '來源記錄原文').fill('  家長核對原文  ');
    await text(sourceRecord, '來源數值原文').fill('  大約十四  ');
    await text(sourceRecord, '來源數值單位').fill('');
    await button(sourceRecord, '預覽家庭共享內容').click();
    await focused(sourceRecord, text(sourceRecord, '來源數值單位')); await described(text(sourceRecord, '來源數值單位'));
    assert.equal(await text(sourceRecord, '來源數值原文').inputValue(), '  大約十四  ');
    await capture(sourceRecord, 'source-records', width); await sourceRecord.close();
    passed.push(`source-records ${width}: shared field focus and unmodified raw value`);
    }

    if (requested.has('preferences')) {
    const settings = await openPreview(browser, '/settings', width, height, failures);
    await settings.getByRole('tab', { name: '應用偏好', exact: true }).click();
    await text(settings, '安靜時段開始預覽').fill('invalid'); await button(settings, '預覽通知偏好').click();
    await focused(settings, text(settings, '安靜時段開始預覽')); await described(text(settings, '安靜時段開始預覽'));
    await button(settings, '修正安靜時段開始').click(); await focused(settings, text(settings, '安靜時段開始預覽'));
    await capture(settings, 'preferences', width); await settings.close();
    passed.push(`preferences ${width}: first error and summary target focus`);
    }

    if (requested.has('model')) {
    const model = await openPreview(browser, '/settings', width, height, failures);
    await button(model, '管理模型設定').click(); await selectOption(model, '模型模式', '我的個人密鑰');
    await model.getByLabel('個人 API 密鑰', { exact: true }).fill('synthetic-ui-key-never-for-network');
    const fee = model.getByRole('checkbox', { name: '我同意個人服務的費用及資料外送', exact: true });
    assert.equal(await button(model, '保存模型設定').isDisabled(), true, 'Explicit fee consent is required before saving');
    await fee.press('Space');
    await model.waitForFunction(() => document.querySelector('[role="checkbox"][aria-label="我同意個人服務的費用及資料外送"]')?.getAttribute('aria-checked') === 'true');
    await fee.press('Space');
    await button(model, '修正費用及資料外送同意').click(); await focused(model, fee); await described(fee);
    await fee.press('Space'); await model.waitForFunction(() => document.querySelector('[role="checkbox"][aria-label="我同意個人服務的費用及資料外送"]')?.getAttribute('aria-checked') === 'true');
    await text(model, '個人每日呼叫上限').fill('-1'); await button(model, '保存模型設定').click();
    await focused(model, text(model, '個人每日呼叫上限')); await described(text(model, '個人每日呼叫上限'));
    assert.equal(await model.getByLabel('個人 API 密鑰', { exact: true }).inputValue(), 'synthetic-ui-key-never-for-network', 'Invalid local input is not a submitted request');
    await model.getByRole('tab', { name: '個人與帳戶', exact: true }).click(); await model.getByRole('tab', { name: '模型設定', exact: true }).click();
    assert.equal(await model.getByLabel('個人 API 密鑰', { exact: true }).inputValue(), '', 'Hidden model panel clears the secret');
    assert.equal((await model.getByTestId('status-announcement').allTextContents()).some(value => value.includes('synthetic-ui-key')), false);
    await assertFits(model, `model ${width}`); await model.close();
    passed.push(`model ${width}: consent checkbox, limit focus, field messages and hidden-tab secret cleanup`);
    }
    if (requested.has('scope')) {
    const page = await openPreview(browser, '/settings', width, height, failures);
    await page.getByRole('tab', {name:'應用偏好',exact:true}).click();
    const start = text(page,'安靜時段開始預覽');
    await start.fill('21:15');
    await page.getByRole('button',{name:/^選擇孩子，目前/}).click();
    await page.getByRole('radio',{name:/^阿樂 · /}).click();
    await button(page,'選擇孩子，目前阿樂').waitFor();
    assert.equal(await page.getByTestId('leave-preview-dialog').count(),0);
    assert.equal(await start.inputValue(),'21:15','Personal preference draft survives child selection');
    await selectOption(page,'模擬提交結果','結果未知');
    await button(page,'預覽通知偏好').click(); await button(page,'模擬保存本人偏好').click();
    await page.getByRole('heading',{name:'尚未確認操作結果',exact:true}).waitFor();
    const original = await page.getByText(/合成操作參考：/).innerText();
    await page.getByRole('button',{name:/^選擇孩子，目前/}).click();
    await page.getByRole('radio',{name:/^小昕 · /}).click();
    await button(page,'選擇孩子，目前小昕').waitFor();
    assert.equal(await page.getByTestId('leave-preview-dialog').count(),0);
    assert.equal(await page.getByText(/合成操作參考：/).innerText(),original,'Pending personal operation keeps its original reference');
    await page.getByRole('link',{name:brand.homeLabel,exact:true}).click();
    await page.getByRole('heading',{name:'先處理原操作',exact:true}).waitFor();
    assert.equal(await button(page,'捨棄草稿並離開').count(),0,'Unknown operations cannot be discarded by route navigation');
    await button(page,'留在此頁查核').click();
    assert.equal(await page.getByText(/合成操作參考：/).innerText(),original);
    await page.close(); passed.push(`scope ${width}: personal draft and pending operation survive child selection, unknown still blocks leaving route`);
    }
    console.log(passed.filter(value => value.includes(` ${width}:`)).join('\n'));
  }
  assert.deepEqual(failures, []);
} catch (error) {
  failures.push(String(error)); throw error;
} finally {
  await writeFile(resolve(directory, process.env.FRONTEND_FORM_PROOF_FILE ?? 'form-checks.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'Synthetic local frontend, no real API or device acceptance', passed, failures }, null, 2) + '\n');
  await browser.close();
}
