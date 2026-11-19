import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchPreviewBrowser, openPreview, assertFits } from './preview-browser.mjs';

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? 'verification/answer-source-cards');
await mkdir(directory, {recursive: true});
const browser = await launchPreviewBrowser(), failures = [], passed = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await openPreview(browser, '/chat', width, width === 1440 ? 992 : 844, failures);
    const answer = page.getByTestId('chat-answer');
    const draft = page.getByRole('textbox', {name: '撰寫對話問題', exact: true});
    await draft.fill('保留未發送問題');
    const cards = answer.getByTestId(/^citation-card-/);
    assert.equal(await cards.count(), 3);
    const original = page.getByTestId('app-dialog');
    for (let i = 0; i < await cards.count(); i++) {
      const card = cards.nth(i), [title, excerpt] = (await card.innerText()).split('\n').filter(Boolean);
      assert.ok(title && excerpt);
      await card.focus();
      await page.keyboard.press('Enter');
      await original.getByRole('heading', {name: title, exact: true}).waitFor();
      await original.getByText(excerpt, {exact: true}).waitFor();
      await original.getByRole('button', {name: '關閉', exact: true}).click();
      await original.waitFor({state: 'hidden'});
    }
    await answer.getByRole('button', {name: /^查看引用【1】/}).click();
    await original.getByRole('button', {name: '版本與核對資料'}).click();
    await original.getByText('preview-records-v1', {exact: true}).waitFor();
    await original.getByRole('button', {name: '關閉', exact: true}).click();
    assert.equal(await draft.inputValue(), '保留未發送問題');
    await assertFits(page, `Chat citation cards at ${width}`);
    await answer.getByTestId('answer-source-panel').screenshot({path: resolve(directory, `cards-${width}.png`)});
    passed.push(width);
    await page.close();
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({passed, failures, scope: 'Synthetic preview only'}, null, 2));
} finally {
  await browser.close();
}
