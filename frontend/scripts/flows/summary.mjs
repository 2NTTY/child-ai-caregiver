import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {openPreview, assertFits, selectOption} from '../preview-browser.mjs';
const button = (page, name) => page.getByRole('button', {name, exact: true});
const field = (page, name) => page.getByRole('textbox', {name, exact: true});
const checkbox = (page, name) => page.getByRole('checkbox', {name, exact: true});
const prep = page => page.getByTestId('summary-preparation');
const raw = '  想核對自己的日常觀察；保留草稿兩端空白。  ';
async function tools(page) {if (await button(page, '顯示摘要情境').count()) await button(page, '顯示摘要情境').click();}
async function fresh(browser, failures, width = 320) {return openPreview(browser, '/summary', width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);}
async function prepare(page) {await field(page, '到診問題 1').fill(raw); await checkbox(page, '我確認把以上到診準備與有權家庭成員共享').click();}
async function saved(page) {await page.getByText(/^已模擬保存家庭共享到診準備/).waitFor();}
export async function verifySummary(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await fresh(browser, failures, width);
    if (await button(page, '更多頁面').count()) {await button(page, '更多頁面').click(); await button(page, '照顧摘要').click();}
    else {const link = page.getByRole('link', {name: '照顧摘要', exact: true}); assert.equal(await link.getAttribute('href'), '/summary'); await link.focus(); await page.keyboard.press('Enter');}
    await prep(page).waitFor(); await assertFits(page, `summary ${width}`);
    await page.screenshot({path: resolve(directory, `summary-${width}.png`)}); await page.close();
  }
  const form = await fresh(browser, failures, 390);
  assert.equal(await button(form, '確認保存家庭共享到診準備').isDisabled(), true);
  await button(form, '新增到診問題').click(); await field(form, '到診問題 2').fill(raw); await button(form, '移除到診問題 1').click();
  assert.equal(await field(form, '到診問題 1').inputValue(), raw, 'Removing an earlier row must preserve the remaining RHF field');
  await button(form, '新增到診準備').click(); await field(form, '到診準備 2').fill('帶備核對問題');
  await checkbox(form, '到診準備 2 已完成').focus(); await form.keyboard.press('Space');
  await checkbox(form, '我已逐項核對問題、準備清單及目前摘要來源').click();
  await field(form, '到診問題 1').fill(raw + '補充'); assert.equal(await checkbox(form, '我已逐項核對問題、準備清單及目前摘要來源').getAttribute('aria-checked'), 'false');
  await checkbox(form, '我已逐項核對問題、準備清單及目前摘要來源').click();
  assert.equal(await field(form, '到診問題 1').inputValue(), raw + '補充');
  assert.ok((await form.getByTestId('summary-save-review').textContent()).includes((raw + '補充').trim()));
  await checkbox(form, '我確認把以上到診準備與有權家庭成員共享').focus(); await form.keyboard.press('Space');
  await prep(form).scrollIntoViewIfNeeded(); await assertFits(form, 'summary dynamic preparation'); await form.screenshot({path: resolve(directory, 'summary-form-390.png')});
  await button(form, '確認保存家庭共享到診準備').click(); await saved(form); await prep(form).getByText(/仍與全部來源吻合/).waitFor(); await form.close();

  const period = await fresh(browser, failures); await field(period, '摘要開始日').fill('2030-10-01'); await selectOption(period, '摘要期間', '一日');
  await period.getByText(/^新選項尚未套用/).waitFor(); await button(period, '產生／更新摘要並保留草稿').click(); await period.getByText(/^已重新讀取合成摘要/).waitFor();
  await period.getByText('期間：2030-10-01 至 2030-10-02（不包括結束日） · Asia/Hong_Kong', {exact: true}).waitFor();
  await button(period, '查看期間記錄及來源').click(); const source = period.getByTestId('summary-record-preview-summary-sleep-a'); await button(source, '展開記錄來源').click(); await source.getByText('確認／更正原因：更正原觀察（合成）', {exact: true}).waitFor(); await button(source, '查看原記錄及完整更正歷史').click(); await period.waitForURL('**/care'); await period.close();

  const unknown = await fresh(browser, failures); await tools(unknown); await selectOption(unknown, '摘要保存結果', '結果未知'); await prepare(unknown); await button(unknown, '確認保存家庭共享到診準備').click();
  await unknown.getByTestId('summary-pending').waitFor(); await unknown.getByText(/^保存結果未知/).waitFor(); const original = await unknown.getByTestId('summary-pending').textContent();
  await button(unknown, '先查原收據及更新摘要').click(); await unknown.getByText(/^原操作仍然結果未知/).waitFor(); assert.equal(await button(unknown, '以原操作明確重試到診準備').isDisabled(), true);
  await selectOption(unknown, '摘要原收據查核結果', '尚無確認收據'); await button(unknown, '先查原收據及更新摘要').click(); await unknown.getByText(/^尚無確認收據/).waitFor();
  assert.equal(await unknown.getByTestId('summary-pending').textContent(), original, 'Receipt lookup must preserve the original reference, content and versions');
  assert.equal(await button(unknown, '放棄草稿並載入已保存準備').isDisabled(), true); assert.equal(await field(unknown, '摘要開始日').isEditable(), false);
  await selectOption(unknown, '摘要保存結果', '成功'); await checkbox(unknown, '我已核對目前摘要，同意用原操作識別及內容重試').click(); await button(unknown, '以原操作明確重試到診準備').click(); await saved(unknown); assert.equal(await unknown.getByTestId('summary-pending').count(), 0); await unknown.close();

  const confirmed = await fresh(browser, failures); await tools(confirmed); await selectOption(confirmed, '摘要保存結果', '保存已確認但摘要未讀回'); await prepare(confirmed); await button(confirmed, '確認保存家庭共享到診準備').click(); await confirmed.getByText(/^原保存已確認，但最新摘要未能讀取/).waitFor();
  assert.equal(await button(confirmed, '以原操作明確重試到診準備').isDisabled(), true); await selectOption(confirmed, '摘要原收據查核結果', '已確認並讀回'); await button(confirmed, '先查原收據及更新摘要').click(); await confirmed.getByText(/^原保存收據已模擬確認/).waitFor(); await prep(confirmed).getByText(/^已保存版本 2/).waitFor(); assert.equal(await confirmed.getByTestId('summary-pending').count(), 0); await confirmed.close();

  const conflict = await fresh(browser, failures); await tools(conflict); await selectOption(conflict, '摘要保存結果', '版本衝突'); await prepare(conflict); await button(conflict, '確認保存家庭共享到診準備').click(); await conflict.getByText(/^這次保存有版本衝突/).waitFor();
  await selectOption(conflict, '摘要重讀資料', '來源及家庭準備已改變'); await button(conflict, '產生／更新摘要並保留草稿').click(); await conflict.getByText(/^已重新讀取合成摘要/).waitFor();
  assert.equal(await field(conflict, '到診問題 1').inputValue(), raw); assert.equal(await button(conflict, '確認保存家庭共享到診準備').isDisabled(), true);
  await prep(conflict).getByText('已保存問題 1：另一位家庭成員更新的已保存問題（合成）', {exact: true}).waitFor();
  await checkbox(conflict, '我已核對最新來源及共享準備，保留草稿並採用目前依據').click(); await button(conflict, '明確改用目前摘要依據').click(); assert.equal(await field(conflict, '到診問題 1').inputValue(), raw);
  await checkbox(conflict, '我確認把以上到診準備與有權家庭成員共享').click(); assert.equal(await button(conflict, '確認保存家庭共享到診準備').isDisabled(), false); await conflict.close();

  const appointment = await fresh(browser, failures); await tools(appointment); await appointment.getByRole('button', {name: /^到診預約安排：/}).click(); await appointment.getByRole('radio', {name: /^到診預約安排選項：核對家庭到診安排/}).click();
  await selectOption(appointment, '摘要重讀資料', '原預約已不在清單'); await button(appointment, '產生／更新摘要並保留草稿').click(); await appointment.getByText(/^已重新讀取合成摘要/).waitFor(); await appointment.getByText(/^原預約已不在目前待處理清單/).waitFor();
  await checkbox(appointment, '我已核對最新來源及共享準備，保留草稿並採用目前依據').click(); await button(appointment, '明確改用目前摘要依據').click(); assert.equal(await checkbox(appointment, '我確認把以上到診準備與有權家庭成員共享').isDisabled(), true);
  await selectOption(appointment, '到診預約安排', '沒有指定預約'); assert.equal(await checkbox(appointment, '我確認把以上到診準備與有權家庭成員共享').isDisabled(), false); await appointment.close();

  const scope = await fresh(browser, failures); await tools(scope); await field(scope, '到診問題 1').fill(raw); await button(scope, '切換合成預覽情境').click(); await button(scope, '離線').click(); assert.equal(await field(scope, '到診問題 1').inputValue(), raw); assert.equal(await button(scope, '確認保存家庭共享到診準備').isDisabled(), true);
  await button(scope, '一般').click(); await button(scope, '產生／更新摘要並保留草稿').click(); await scope.getByText(/^已重新讀取合成摘要/).waitFor(); assert.equal(await field(scope, '到診問題 1').inputValue(), raw);
  await checkbox(scope, '我確認把以上到診準備與有權家庭成員共享').click(); await button(scope, '確認保存家庭共享到診準備').click(); await scope.getByText(/^正在模擬保存家庭共享準備/).waitFor(); await button(scope, '切換摘要預覽帳戶').click(); await prep(scope).waitFor(); await scope.waitForTimeout(450); await prep(scope).getByText(/^已保存版本 1/).waitFor(); assert.equal(await scope.getByTestId('summary-pending').count(), 0);
  await tools(scope); await field(scope, '到診問題 1').fill(raw); await button(scope, '切換摘要預覽 Server').click(); assert.notEqual(await field(scope, '到診問題 1').inputValue(), raw);
  await field(scope, '到診問題 1').fill(raw); await scope.getByRole('button', {name: /^選擇孩子，目前/}).click(); await scope.getByRole('radio', {name: '阿樂 · 約 8 歲 · 截至 2026 年 9 月', exact: true}).click(); assert.notEqual(await field(scope, '到診問題 1').inputValue(), raw);
  await tools(scope); await selectOption(scope, '摘要資料情境', '失去存取'); assert.equal(await prep(scope).count(), 0); assert.equal(await scope.getByTestId('summary-pending').count(), 0); await scope.close();
  const limits = await fresh(browser, failures); await tools(limits); await selectOption(limits, '摘要資料情境', '期間超限'); await limits.getByText(/^期間記錄太多/).waitFor(); assert.equal(await limits.getByTestId('summary-counts').count(), 0); await selectOption(limits, '摘要資料情境', '孩子記錄超限'); await limits.getByText(/^孩子記錄超出摘要入口上限/).waitFor(); assert.equal(await limits.getByTestId('summary-counts').count(), 0); await selectOption(limits, '摘要資料情境', '沒有期間記錄'); await limits.getByText('此期間沒有可列出的數值統計。零記錄不代表事件沒有發生。', {exact: true}).waitFor(); await selectOption(limits, '摘要資料情境', '唯讀'); assert.equal(await field(limits, '到診問題 1').isEditable(), false); await limits.close();
  return 'summary: four widths/navigation, period and source versions, stable dynamic fields, contract-normalized review and explicit sharing, original receipt/confirmed-unread recovery, stale basis/appointment review, limits and offline/identity/Server/child/access cleanup; no API calls';
}
export async function verifySummaryText(browser, failures, directory) {
  for (const width of [390, 320]) {
    const page = await fresh(browser, failures, width); await field(page, '到診問題 1').fill(raw); await button(page, '新增到診準備').click(); await field(page, '到診準備 2').fill('需要保留清楚的原始觀察與核對問題。'); await page.waitForTimeout(220);
    await page.evaluate(() => {for (const element of document.querySelectorAll('div,span,p,input,textarea')) {if (!element.matches('input,textarea') && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue; const computed = getComputedStyle(element); element.style.fontSize = `${parseFloat(computed.fontSize) * 1.5}px`; if (computed.lineHeight !== 'normal') element.style.lineHeight = `${parseFloat(computed.lineHeight) * 1.5}px`;}});
    await page.waitForFunction(input => {const labels = [...input.parentElement.parentElement.querySelectorAll('div')].filter(item => [...item.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent === '到診問題 1')); return labels.length && labels.every(item => item.getBoundingClientRect().bottom + 3 <= input.getBoundingClientRect().top);}, await field(page, '到診問題 1').elementHandle());
    await assertFits(page, `summary 150% Web text ${width}`); await field(page, '到診問題 1').scrollIntoViewIfNeeded(); await page.screenshot({path: resolve(directory, `summary-large-text-${width}.png`)}); await page.close();
  }
  return 'summary text: 390/320 synthetic 150% Web text, stable dynamic fields and shared multiline label/control reflow; not native font acceptance';
}
