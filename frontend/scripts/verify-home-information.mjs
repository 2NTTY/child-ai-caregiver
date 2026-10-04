import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchPreviewBrowser, openPreview, assertFits } from './preview-browser.mjs';

const directory = resolve(process.env.FRONTEND_PROOF_DIR ?? 'verification/home-information-layout');
const browser = await launchPreviewBrowser(), failures = [], checks = [];
async function scenario(page, label) {
  const toggle = page.getByRole('button', { name: '切換合成預覽情境', exact: true });
  await toggle.click(); await page.getByRole('button', { name: label, exact: true }).click(); await toggle.click();
}
async function quickGeometry(page) {
  return page.getByTestId('home-quick-actions').evaluate(element => {
    const b = element.getBoundingClientRect();
    const scroll = document.querySelector('[data-testid="mobile-home-scroll"]')?.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, viewport: innerHeight, scrollBottom: scroll?.bottom,
      buttons: [...element.querySelectorAll('[role="button"]')].map(button => {
        const r = button.getBoundingClientRect(), center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { label: button.getAttribute('aria-label'), width: r.width, height: r.height, top: r.top, bottom: r.bottom,
          unobscured: !!center && button.contains(center) };
      }) };
  });
}
function assertQuick(geometry) {
  assert.equal(geometry.buttons.length, 4);
  assert.ok(geometry.buttons.every(button => button.width >= 48 && button.height >= 48 && button.top >= 0 && button.bottom <= geometry.viewport && button.unobscured), JSON.stringify(geometry));
  assert.ok(geometry.scrollBottom <= geometry.top + 1, 'The home scroller must end before the quick toolbar, without overlay occlusion');
}
try {
  await mkdir(directory, { recursive: true });
  for (const [width, height] of [[1440, 992], [1024, 992], [390, 844], [320, 720]]) {
    const page = await openPreview(browser, '/', width, height, failures);
    await page.getByRole('heading', { name: '現在要處理', exact: true }).waitFor();
    await page.getByRole('heading', { name: '持續關注', exact: true }).waitFor();
    assert.equal(await page.getByTestId('home-recent-records').count(), 0, 'A raw recent-record stream is not the ongoing section');
    if (width < 650) { const initial = await quickGeometry(page); assertQuick(initial); checks.push({ width, stage: 'initial', quick: initial }); }
    await assertFits(page, `home overview ${width}`);
    await page.screenshot({ path: resolve(directory, `home-initial-${width}.png`) });
    if (width < 650) {
      await page.waitForFunction(() => document.querySelector('[data-testid="mobile-home-greeting"]')?.getAttribute('aria-hidden') === 'true');
      const settled = await quickGeometry(page); assertQuick(settled); checks.push({ width, stage: 'docked', quick: settled });
    }
    await page.screenshot({ path: resolve(directory, `home-${width}.png`) });
    await scenario(page, '今日任務示例');
    const primary = page.getByTestId('home-focus');
    const primaryIds = await primary.locator('[data-testid^="home-overview-item-"]').evaluateAll(elements => elements.map(element => element.dataset.testid));
    assert.equal(primaryIds.length, 1);
    await page.getByRole('button', { name: '開啟資訊側欄', exact: true }).click();
    const rail = page.getByTestId('context-rail');
    await rail.getByRole('tab', { name: '待辦／提醒', exact: true }).waitFor();
    const fullIds = await rail.getByTestId('rail-attention').locator('[data-testid^="home-overview-item-"]').evaluateAll(elements => elements.map(element => element.dataset.testid));
    assert.equal(fullIds.length, 3); assert.equal(fullIds[0], primaryIds[0]);
    await rail.getByRole('tab', { name: '待辦／提醒', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await rail.getByRole('tab', { name: '照顧上下文', exact: true }).getAttribute('aria-selected'), 'true');
    await rail.getByText('過敏資料：未提供', { exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await rail.getByRole('tab', { name: '待辦／提醒', exact: true }).getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: resolve(directory, `rail-${width}.png`) });
    if (width >= 1280) await page.getByRole('button', { name: '收起資訊側欄', exact: true }).click();
    else await rail.getByRole('button', { name: '關閉資訊側欄', exact: true }).click();
    await scenario(page, '今日事項未能取得');
    await primary.getByText('暫未能確認待辦與提醒', { exact: true }).waitFor();
    assert.equal(await primary.getByText('目前合成快照沒有指定待處理事項。', { exact: true }).count(), 0);
    await scenario(page, '結果未知');
    await primary.getByRole('button', { name: '查核這次結果', exact: true }).click();
    assert.equal(await primary.getByRole('button', { name: /重送|建立任務/ }).count(), 0);
    await scenario(page, '一般');
    if (width < 650) {
      const styles = await page.locator('body *').evaluateAll(elements => elements.map(element => ({ element, font: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight) })).filter(item => item.element.children.length === 0).map(({element, font, line}) => {
        element.style.fontSize = `${font * 2}px`; if (Number.isFinite(line)) element.style.lineHeight = `${line * 2}px`; return true;
      }));
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const enlarged = await quickGeometry(page); assertQuick(enlarged); await assertFits(page, `200% text ${width}`);
      await page.getByTestId('mobile-home-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
      assertQuick(await quickGeometry(page));
      await page.screenshot({ path: resolve(directory, `home-text-200-${width}.png`) });
      checks.push({ width, stage: '200% text and scroll', quick: enlarged, textNodes: styles.length });
    }
    checks.push({ width, sameProjection: { primaryIds, fullIds }, unavailableDistinct: true, unknownOriginalOperation: true, tabsKeyboard: true });
    await page.close();
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ checks, failures }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, failures }));
} finally { await browser.close(); }
