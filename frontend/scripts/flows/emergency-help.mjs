import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {openPreview, assertFits} from '../preview-browser.mjs';
export async function verifyEmergencyHelp(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, '/chat', width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
    assert.equal(await page.getByTestId('emergency-help').count(), 0);
    const question = page.getByTestId('chat-question'), answer = page.getByTestId('chat-answer');
    await question.waitFor(); await answer.waitFor();
    for (const row of [question, answer]) {
      assert.equal(await row.evaluate(element => element.childElementCount), 1, `No avatar gutter at ${width}`);
      assert.equal(await row.locator('svg').count(), 0);
    }
    const questionBounds = await question.boundingBox(), answerBounds = await answer.boundingBox();
    const questionBubble = await question.locator(':scope > div').boundingBox(), answerCard = await answer.locator(':scope > div').boundingBox();
    assert.ok(Math.abs(questionBounds.x + questionBounds.width - questionBubble.x - questionBubble.width) < 1, `Question aligns right at ${width}`);
    assert.ok(Math.abs(answerBounds.x - answerCard.x) < 1 && Math.abs(answerBounds.width - answerCard.width) < 1, `Answer uses the full row at ${width}`);
    assert.ok(answerBounds.y >= questionBounds.y + questionBounds.height + 15, `Messages do not overlap at ${width}`);
    await assertFits(page, `chat without avatars/help card ${width}`);
    await page.screenshot({path: resolve(directory, `chat-layout-${width}.png`)});
    const draft = '請幫我整理已確認的睡眠記錄。';
    await page.getByRole('textbox', {name: '撰寫對話問題', exact: true}).fill(draft);
    await page.getByRole('button', {name: '預覽輸入', exact: true}).click();
    const local = page.getByTestId('chat-local-message'); await local.waitFor();
    assert.ok((await local.textContent()).includes(draft)); assert.ok((await local.textContent()).includes('本地預覽 · 未送出'));
    assert.equal(await local.evaluate(element => element.childElementCount), 1); assert.equal(await local.locator('svg').count(), 0);
    assert.equal(await page.getByRole('textbox', {name: '撰寫對話問題', exact: true}).inputValue(), '');
    await page.getByRole('button', {name: '切換合成預覽情境', exact: true}).click(); await page.getByRole('button', {name: '離線', exact: true}).click();
    assert.equal(await page.getByTestId('emergency-help').count(), 0);
    await assertFits(page, `chat offline ${width}`); await page.close();
  }
  return 'chat presentation: four widths without the permanent emergency-help card or message avatars; right-aligned questions, full-width answers, no overlap, local draft preview and offline layout; no API or model calls';
}
