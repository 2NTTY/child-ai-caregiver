import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {DateTime} from 'luxon';
import {openPreview, assertFits, selectOption} from '../preview-browser.mjs';
import {setDateTime} from './tasks-memory.mjs';
const button = (scope, name) => scope.getByRole('button', {name, exact: true});
const checkbox = (scope, name) => scope.getByRole('checkbox', {name, exact: true});
const consent = page => page.getByTestId('contact-consent');
const task = page => page.getByTestId('contact-task-1b457e3a-12c7-4f24-9450-48f9d142a368');
const pending = page => page.getByTestId('contact-pending');
const pushLabel = 'Web Push · 本人瀏覽器（合成）', telegramLabel = 'Telegram · 本人 Telegram（合成）';
const acceptLabel = '我確認保存以上本人接收及後備同意';
async function tools(page) {if (await button(page, '顯示聯絡情境').count()) await button(page, '顯示聯絡情境').click();}
async function fresh(browser, failures, width = 320) {return openPreview(browser, '/contact', width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);}
async function prepareConsent(page) {const card = consent(page); await checkbox(card, '允許透過以下本人渠道接收一般任務提示').click(); await checkbox(card, pushLabel).click(); await checkbox(card, acceptLabel).click();}
async function saveConsent(page) {await button(consent(page), '確認保存本人接收同意').click();}
async function saved(page) {await page.getByText(/^已模擬保存決定並更新資料/).waitFor();}
async function openTask(page) {if (await button(task(page), '管理任務聯絡授權').count()) await button(task(page), '管理任務聯絡授權').click();}
async function reviewHistory(page, id) {const row = page.getByTestId(`contact-request-${id}`); await button(row, '查看這次聯絡紀錄').click(); return row;}

export async function verifyContact(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await fresh(browser, failures, width);
    if (await button(page, '更多頁面').count()) {await button(page, '更多頁面').click(); await button(page, '聯絡授權').click();}
    else {const link = page.getByRole('link', {name: '聯絡授權', exact: true}); assert.equal(await link.getAttribute('href'), '/contact'); await link.focus(); await page.keyboard.press('Enter');}
    await consent(page).waitFor(); await assertFits(page, `contact ${width}`); await page.screenshot({path: resolve(directory, `contact-${width}.png`)}); await page.close();
  }
  const form = await fresh(browser, failures, 390), my = consent(form);
  assert.equal(await button(my, '確認保存本人接收同意').isDisabled(), true);
  await checkbox(my, '允許透過以下本人渠道接收一般任務提示').focus(); await form.keyboard.press('Space');
  await checkbox(my, pushLabel).click(); await checkbox(my, telegramLabel).click(); await checkbox(my, '我也同意具備這個孩子的後備接收資格').click();
  await button(my, '向前移動Telegram').click(); await checkbox(my, acceptLabel).click(); await saveConsent(form); await saved(form);
  await my.getByText('已保存渠道次序：Telegram → Web Push', {exact: true}).waitFor();
  await openTask(form); const card = task(form);
  await checkbox(card, '允許最多一次到期後跟進').click(); await checkbox(card, '只在明確投遞失敗時允許渠道及後備切換').click(); await selectOption(card, '後備接收者', '姨姨（合成）');
  await setDateTime(form, '聯絡授權期限', DateTime.now().setZone('Asia/Hong_Kong').plus({days: 30}).toISODate(), '09:00');
  await checkbox(card, '我確認以上接收者、一般提示及聯絡期限').click(); await button(card, '確認保存任務聯絡授權').click(); await card.getByText(/^已保存授權：開啟 · 版本 2/).waitFor();
  const accepted = await reviewHistory(form, 'preview-contact-accepted'), attempt = accepted.getByTestId('contact-attempt-f4ebd750-6cd4-4fbb-afbc-0a0323113c62');
  await checkbox(attempt, '我確認本人已收到這次一般提示').click(); await button(attempt, '確認本人已收到提示').click(); await attempt.getByText(/^本人已確認收到/).waitFor();
  assert.ok((await attempt.textContent()).includes('渠道已接受')); assert.ok((await card.textContent()).includes('事項：待處理'));
  const unknownHistory = await reviewHistory(form, 'preview-contact-unknown'); assert.ok((await unknownHistory.textContent()).includes('投遞結果未知')); assert.equal(await button(unknownHistory, '確認本人已收到提示').count(), 1);
  const rejected = await reviewHistory(form, 'preview-contact-rejected'); assert.equal(await button(rejected, '確認本人已收到提示').count(), 0);
  const coalesced = await reviewHistory(form, 'preview-contact-coalesced'); assert.ok((await coalesced.textContent()).includes('不表示另一個提示已成功投遞或收到')); assert.equal(await coalesced.getByTestId(/^contact-attempt-/).count(), 0);
  await openTask(form); await assertFits(form, 'contact options 390'); await card.scrollIntoViewIfNeeded(); await form.screenshot({path: resolve(directory, 'contact-task-options-390.png')});
  await checkbox(my, '允許透過以下本人渠道接收一般任務提示').click(); await checkbox(my, acceptLabel).click(); await saveConsent(form); await my.getByText('已保存渠道次序：沒有', {exact: true}).waitFor(); await my.getByText(/^已保存：未允許接收 · 後備資格：未同意/).waitFor(); await form.close();

  const original = await fresh(browser, failures); await tools(original); await selectOption(original, '聯絡決定保存結果', '結果未知'); await prepareConsent(original); await saveConsent(original); await pending(original).waitFor(); await original.getByText(/^保存結果未知/).waitFor();
  await button(original, '查看原提交內容及版本').click(); const body = await original.getByTestId('contact-original-body').textContent(), reference = await pending(original).getByText(/^原操作：/).textContent();
  assert.equal(await button(consent(original), '確認保存本人接收同意').isDisabled(), true); assert.equal(await button(original, '放棄全部未提交選項並載入已保存資料').isDisabled(), true);
  await button(original, '先查原收據及更新聯絡資料').click(); await original.getByText(/^原操作仍然結果未知/).waitFor(); assert.equal(await button(original, '明確重試原聯絡決定').isDisabled(), true);
  await selectOption(original, '聯絡原收據查核結果', '尚無確認收據，原操作仍待處理'); await button(original, '先查原收據及更新聯絡資料').click(); await original.getByText(/^尚無確認收據/).waitFor();
  assert.equal(await button(original, '明確重試原聯絡決定').isDisabled(), true); await checkbox(original, '我已核對目前資料，同意以原識別內容及版本重試').click(); await button(original, '明確重試原聯絡決定').click(); await original.getByText(/^保存結果未知/).waitFor();
  assert.equal(await original.getByTestId('contact-original-body').textContent(), body); assert.equal(await pending(original).getByText(/^原操作：/).textContent(), reference);
  await selectOption(original, '聯絡原收據查核結果', '已確認但未讀回'); await button(original, '先查原收據及更新聯絡資料').click(); await original.getByText(/^原收據已確認保存，最新聯絡資料未讀回/).waitFor(); assert.equal(await button(original, '明確重試原聯絡決定').isDisabled(), true);
  await assertFits(original, 'contact original decision 320'); await pending(original).scrollIntoViewIfNeeded(); await original.screenshot({path: resolve(directory, 'contact-original-320.png')});
  await selectOption(original, '聯絡原收據查核結果', '已確認並讀回'); await button(original, '先查原收據及更新聯絡資料').click(); await original.getByText(/^原收據已模擬確認並讀回/).waitFor(); assert.equal(await pending(original).count(), 0); await original.close();

  const laterVersion = await fresh(browser, failures); await tools(laterVersion); await selectOption(laterVersion, '聯絡決定保存結果', '結果未知'); await prepareConsent(laterVersion); await saveConsent(laterVersion); await laterVersion.getByText(/^保存結果未知/).waitFor();
  await selectOption(laterVersion, '聯絡重讀資料', '同意綁定與任務版本已改變'); await button(laterVersion, '先查原收據及更新聯絡資料').click(); await laterVersion.getByText(/^原操作仍然結果未知/).waitFor();
  await button(laterVersion, '先查原收據及更新聯絡資料').click(); await consent(laterVersion).getByText(/^已保存版本 3/).waitFor();
  await selectOption(laterVersion, '聯絡重讀資料', '同一版本'); await selectOption(laterVersion, '聯絡原收據查核結果', '已確認並讀回'); await button(laterVersion, '先查原收據及更新聯絡資料').click(); await laterVersion.getByText(/^原收據已模擬確認並讀回/).waitFor();
  await consent(laterVersion).getByText(/^已保存版本 3/).waitFor(); await consent(laterVersion).getByText(/^已保存：未允許接收/).waitFor(); await laterVersion.close();

  const versions = await fresh(browser, failures); await tools(versions); await openTask(versions); await checkbox(task(versions), '允許最多一次到期後跟進').click();
  await selectOption(versions, '聯絡重讀資料', '同意綁定與任務版本已改變'); await button(versions, '更新聯絡資料並保留選項').click(); await versions.getByText(/^已重新讀取合成聯絡資料/).waitFor();
  assert.equal(await checkbox(task(versions), '允許最多一次到期後跟進').getAttribute('aria-checked'), 'true'); assert.equal(await button(task(versions), '確認保存任務聯絡授權').isDisabled(), true);
  await checkbox(task(versions), '我已核對這個任務與授權的最新版本').click(); await button(task(versions), '保留選項並採用最新任務授權版本').click();
  await checkbox(task(versions), '只在明確投遞失敗時允許渠道及後備切換').click(); await selectOption(task(versions), '後備接收者', '姨姨（合成）');
  await selectOption(versions, '聯絡重讀資料', '原後備已撤回接收同意'); await button(versions, '更新聯絡資料並保留選項').click(); await task(versions).getByText('後備須已同意接收及後備資格，並啟用已知失敗切換。', {exact: true}).waitFor();
  await selectOption(versions, '聯絡重讀資料', '原任務不在有限清單'); await button(versions, '更新聯絡資料並保留選項').click(); await task(versions).getByText(/^這是保留草稿的原任務/).waitFor(); assert.equal(await checkbox(task(versions), '允許最多一次到期後跟進').getAttribute('aria-checked'), 'true'); assert.equal(await button(task(versions), '確認保存任務聯絡授權').isDisabled(), true); await versions.close();

  const conflict = await fresh(browser, failures); await tools(conflict); await selectOption(conflict, '聯絡決定保存結果', '版本衝突'); await prepareConsent(conflict); await saveConsent(conflict); await conflict.getByText(/^這次決定遇到版本衝突/).waitFor();
  await selectOption(conflict, '聯絡原收據查核結果', '查核結束，沒有待處理原操作'); await selectOption(conflict, '聯絡重讀資料', '同意綁定與任務版本已改變'); await button(conflict, '先查原收據及更新聯絡資料').click(); await conflict.getByText(/^查核已結束，沒有待處理原操作/).waitFor(); assert.equal(await pending(conflict).count(), 0); assert.equal(await button(consent(conflict), '確認保存本人接收同意').isDisabled(), true);
  await checkbox(consent(conflict), '我已核對本人同意的最新版本與渠道').click(); await button(consent(conflict), '保留選項並採用最新同意版本').click(); assert.equal(await button(consent(conflict), '確認保存本人接收同意').isDisabled(), true); await checkbox(consent(conflict), pushLabel).click(); await selectOption(conflict, '聯絡決定保存結果', '成功'); await checkbox(consent(conflict), acceptLabel).click(); await saveConsent(conflict); await saved(conflict); await conflict.close();

  const scope = await fresh(browser, failures); await tools(scope); await prepareConsent(scope); await button(scope, '切換合成預覽情境').click(); await button(scope, '離線').click(); assert.equal(await checkbox(consent(scope), pushLabel).getAttribute('aria-checked'), 'true'); assert.equal(await button(consent(scope), '確認保存本人接收同意').isDisabled(), true);
  await button(scope, '一般').click(); await button(scope, '更新聯絡資料並保留選項').click(); await scope.getByText(/^已重新讀取合成聯絡資料/).waitFor(); assert.equal(await checkbox(consent(scope), pushLabel).getAttribute('aria-checked'), 'true'); assert.equal(await checkbox(consent(scope), acceptLabel).getAttribute('aria-checked'), 'false');
  await selectOption(scope, '聯絡決定保存結果', '結果未知'); await checkbox(consent(scope), acceptLabel).click(); await saveConsent(scope); await scope.getByText(/^正在模擬保存決定/).waitFor(); await button(scope, '切換聯絡預覽帳戶').click(); await scope.waitForTimeout(450); assert.equal(await pending(scope).count(), 0); assert.equal(await checkbox(consent(scope), pushLabel).getAttribute('aria-checked'), 'false');
  await tools(scope); await prepareConsent(scope); await button(scope, '切換聯絡預覽 Server').click(); assert.equal(await checkbox(consent(scope), pushLabel).getAttribute('aria-checked'), 'false');
  await prepareConsent(scope); await scope.getByRole('button', {name: /^選擇孩子，目前/}).click(); await scope.getByRole('radio', {name: '阿樂 · 約 8 歲 · 截至 2026 年 9 月', exact: true}).click(); assert.equal(await checkbox(consent(scope), pushLabel).getAttribute('aria-checked'), 'false');
  await tools(scope); await selectOption(scope, '聯絡資料情境', '失去存取'); assert.equal(await consent(scope).count(), 0); assert.equal(await pending(scope).count(), 0); await scope.close();

  const conditions = await fresh(browser, failures); await tools(conditions); await selectOption(conditions, '聯絡資料情境', '背景聯絡暫停'); await prepareConsent(conditions); await saveConsent(conditions); await saved(conditions); await conditions.getByText(/^背景聯絡 worker 目前未啟用/).waitFor();
  await selectOption(conditions, '聯絡資料情境', '已保存授權過期'); await openTask(conditions); assert.equal(await button(task(conditions), '確認保存任務聯絡授權').isDisabled(), true); await checkbox(task(conditions), '我確認撤回這個任務的已保存聯絡授權').click(); await button(task(conditions), '確認撤回任務聯絡授權').click(); await task(conditions).getByText(/^已保存授權：撤回 · 版本 2/).waitFor();
  await selectOption(conditions, '聯絡資料情境', '負責人未同意渠道'); await openTask(conditions); assert.equal(await button(task(conditions), '確認保存任務聯絡授權').isDisabled(), true);
  await selectOption(conditions, '聯絡資料情境', '沒有本人綁定'); assert.equal(await checkbox(consent(conditions), pushLabel).count(), 0);
  await selectOption(conditions, '聯絡資料情境', '唯讀'); assert.equal(await checkbox(consent(conditions), '允許透過以下本人渠道接收一般任務提示').isDisabled(), true);
  await selectOption(conditions, '聯絡資料情境', '沒有任務或紀錄'); await conditions.getByText('目前沒有載入聯絡紀錄；不代表從未發送。', {exact: true}).waitFor(); await conditions.close();
  return 'contact: four widths/navigation, explicit personal consent and binding order/revoke, task eligibility/backup/expiry/revoke, truthful ledger and self acknowledgement, same original receipt/confirmed-unread/no-pending recovery, stale drafts, worker pause and offline/identity/Server/child/access cleanup; no API calls';
}
export async function verifyContactText(browser, failures, directory) {
  for (const width of [390, 320]) {
    const page = await fresh(browser, failures, width); await prepareConsent(page); await openTask(page);
    await page.evaluate(() => {for (const element of document.querySelectorAll('div,span,p,input,textarea')) {if (!element.matches('input,textarea') && ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue; const computed = getComputedStyle(element); element.style.fontSize = `${parseFloat(computed.fontSize) * 1.5}px`; if (computed.lineHeight !== 'normal') element.style.lineHeight = `${parseFloat(computed.lineHeight) * 1.5}px`;}});
    await assertFits(page, `contact 150% Web text ${width}`); await consent(page).scrollIntoViewIfNeeded(); await page.screenshot({path: resolve(directory, `contact-large-text-${width}.png`)}); await page.close();
  }
  return 'contact text: 390/320 synthetic 150% Web text and shared selection/date controls reflow; not native system font acceptance';
}
