/**
 * Focused motion acceptance for the isolated, synthetic frontend.
 * Run only after the work-package browser verification has been authorized.
 * Uses public UI actions and presentation data-* probes; never a Server API.
 *
 * BROWSER_EXECUTABLE=/usr/bin/chromium \
 * FRONTEND_PREVIEW_URL=http://localhost:8083 \
 * FRONTEND_TEST_VERSION=<reviewed-version> \
 * node scripts/verify-motion-system.mjs [layout|navigation|summary|care|tasks|photos|contact|states|child|reduced|dialog|chat]
 *
 * A failure stops the batch. Pass only the failed/affected group for an approved
 * local rerun; earlier evidence is never overwritten (one directory per run).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { launchPreviewBrowser, openPreview, assertFits, selectOption } from './preview-browser.mjs';
import { brand } from '../src/branding.ts';

const root = resolve(process.env.FRONTEND_MOTION_PROOF_DIR ?? 'verification/fe-w37-motion');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(root, runId);
const widths = [1440, 1024, 390, 320];
const routes = ['/', '/care', '/photos', '/sources', '/growth', '/summary', '/contact', '/profile', '/family', '/memory', '/tasks', '/settings', '/chat', '/guide', '/login'];
const requested = new Set(process.argv.slice(2));
const results = [], failures = [], traces = [];
let browser, activePage, activeGroup;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const field = (page, name) => page.getByRole('textbox', { name, exact: true });
const visibleText = (page, text, exact = false) => page.getByText(text, { exact }).and(page.locator(':not([data-testid="status-announcement"])'));
const heightFor = width => width >= 1024 ? 992 : width === 390 ? 844 : 720;
const identityMatrix = value => !value || value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)' || value === 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)';

async function fresh(path, width = 1440) {
  if (activePage && !activePage.isClosed()) await activePage.close();
  activePage = await openPreview(browser, path, width, heightFor(width), failures);
  await activePage.emulateMedia({ reducedMotion: 'no-preference' });
  await settled(activePage);
  return activePage;
}

async function frames(page, count = 2) {
  await page.evaluate(count => new Promise(resolve => {
    const next = () => --count <= 0 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), count);
}

async function settled(page) {
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-motion-phase]')].some(element =>
    ['covering', 'swapping', 'revealing', 'entering', 'exiting', 'resizing'].includes(element.dataset.motionPhase)) &&
    !document.querySelector('[data-motion-exiting="true"], [data-motion-flip="true"], [data-motion-entering="true"]'));
  await frames(page);
}

async function assertNoResidue(page, label) {
  await settled(page);
  const residue = await page.evaluate(() => ({
    overlays: document.querySelectorAll('[data-motion-overlay="true"]').length,
    temporary: [...document.querySelectorAll('[data-motion-region], [data-motion-row]')]
      .filter(element => {
        const style = getComputedStyle(element);
        return element.dataset.motionExiting === 'true' || element.dataset.motionFlip === 'true' ||
          element.dataset.motionEntering === 'true' || element.inert || style.opacity === '0';
      }).map(element => ({ region: element.dataset.motionRegion, row: element.dataset.motionRow, phase: element.dataset.motionPhase })),
    detachedFocus: !!document.activeElement && !document.activeElement.isConnected,
  }));
  assert.equal(residue.overlays, 0, `${label}: curtain remains after settling`);
  assert.deepEqual(residue.temporary, [], `${label}: temporary presentation state remains`);
  assert.equal(residue.detachedFocus, false, `${label}: focus targets a removed node`);
}

// One observer records frame geometry and synchronous DOM commits. It does not
// change app state, animation timings, styles, or business callbacks.
async function startTrace(page, label) {
  await page.evaluate(label => {
    globalThis.__fe37MotionTrace?.stop();
    const ids = new WeakMap(); let nextId = 0, stopped = false, frame;
    const started = performance.now(), snapshots = [];
    const nodeId = element => { if (!ids.has(element)) ids.set(element, ++nextId); return ids.get(element); };
    const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    const snapshot = reason => {
      if (stopped) return;
      const regions = [...document.querySelectorAll('[data-motion-kind], [data-testid="motion-route"], [data-testid="motion-child-scope"]')].map(element => {
        const rect = box(element), overlay = [...element.querySelectorAll('[data-motion-overlay="true"]')].find(item => item.closest('[data-motion-kind]') === element);
        const overlayBox = overlay ? box(overlay) : null;
        return {
          node: nodeId(element), region: element.dataset.motionRegion ?? element.dataset.testid ?? element.closest('[data-testid="chat-timeline-entry"]')?.id ?? `${element.dataset.motionKind}:${nodeId(element)}`,
          kind: element.dataset.motionKind, phase: element.dataset.motionPhase, content: element.dataset.motionContent,
          generation: element.dataset.motionScopeGeneration, rect,
          transform: getComputedStyle(element).transform,
          overlay: overlay ? { rect: overlayBox, hidden: overlay.getAttribute('aria-hidden'),
            color: getComputedStyle(overlay).backgroundColor,
            covers: overlayBox.x <= rect.x + 2 && overlayBox.y <= rect.y + 2 &&
              overlayBox.x + overlayBox.width >= rect.x + rect.width - 2 &&
              overlayBox.y + overlayBox.height >= rect.y + rect.height - 2,
          } : null,
        };
      });
      const rows = [...document.querySelectorAll('[data-motion-row]')].map(element => {
        const list = element.closest('[data-motion-kind="list"]'), rect = box(element), listRect = list && box(list);
        return { id: element.dataset.motionRow, node: nodeId(element), list: list?.dataset.motionRegion,
          y: listRect ? rect.y - listRect.y : rect.y, x: listRect ? rect.x - listRect.x : rect.x, height: rect.height,
          exiting: element.dataset.motionExiting === 'true', flip: element.dataset.motionFlip === 'true',
          entering: element.dataset.motionEntering === 'true', transform: getComputedStyle(element).transform,
          hidden: element.getAttribute('aria-hidden'), inert: element.inert, pointerEvents: getComputedStyle(element).pointerEvents };
      });
      const input = document.activeElement;
      snapshots.push({ t: performance.now() - started, reason, regions, rows,
        focus: input ? { node: nodeId(input), label: input.getAttribute('aria-label'), connected: input.isConnected,
          value: 'value' in input ? input.value : undefined, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd } : null,
        careText: document.querySelector('[data-testid="care-record-list"]')?.textContent?.slice(0, 800),
        childLabel: [...document.querySelectorAll('[aria-label^="選擇孩子，目前"]')].map(item => item.getAttribute('aria-label')),
      });
    };
    const observer = new MutationObserver(() => snapshot('commit'));
    observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true,
      attributeFilter: ['data-motion-phase', 'data-motion-content', 'data-motion-exiting', 'data-motion-flip', 'data-motion-entering', 'data-motion-scope-generation', 'aria-label'] });
    const loop = () => { snapshot('frame'); if (!stopped && performance.now() - started < 12000) frame = requestAnimationFrame(loop); };
    const stop = () => { snapshot('end'); stopped = true; cancelAnimationFrame(frame); observer.disconnect(); return { label, snapshots }; };
    globalThis.__fe37MotionTrace = { stop };
    snapshot('start'); frame = requestAnimationFrame(loop);
  }, label);
}

async function stopTrace(page) {
  await frames(page);
  const trace = await page.evaluate(() => { const trace = globalThis.__fe37MotionTrace.stop(); delete globalThis.__fe37MotionTrace; return trace; });
  traces.push(trace);
  await writeFile(resolve(output, `${String(traces.length).padStart(2, '0')}-${trace.label}.json`), JSON.stringify(trace, null, 2) + '\n');
  return trace;
}

function timeline(trace, identity) {
  const match = /^(.*)#(\d+)$/.exec(identity);
  return trace.snapshots.flatMap(snapshot => snapshot.regions
    .filter(item => match ? item.region === match[1] && item.node === Number(match[2]) : item.region === identity)
    .map(item => ({ ...item, t: snapshot.t, reason: snapshot.reason })));
}
function motionRegions(trace, kind = 'reveal') {
  return [...new Set(trace.snapshots.flatMap(snapshot => snapshot.regions
    .filter(item => item.kind === kind && ['covering', 'swapping', 'revealing'].includes(item.phase))
    .map(item => `${item.region}#${item.node}`)))];
}
function assertCurtainCommit(trace, region) {
  const samples = timeline(trace, region), initial = samples[0]?.content;
  assert.ok(samples.some(sample => sample.phase === 'covering'), `${region}: covering phase not observed`);
  assert.ok(samples.some(sample => sample.phase === 'revealing'), `${region}: revealing phase not observed`);
  const swap = samples.find(sample => sample.content !== undefined && sample.content !== initial);
  assert.ok(swap, `${region}: no changed presented content was observed`);
  assert.ok(swap.overlay?.covers, `${region}: changed content committed before the solid curtain covered the region`);
  for (const sample of samples.filter(sample => sample.overlay)) assert.equal(sample.overlay.hidden, 'true', `${region}: decorative curtain must be hidden from accessibility`);
  assert.ok(samples.filter(sample => sample.t < swap.t).every(sample => sample.content === initial), `${region}: content changed before the covered commit`);
  const revealed = samples.find(sample => sample.phase === 'revealing');
  assert.notEqual(revealed.content, initial, `${region}: reveal began with the old result`);
}

async function preserveNode(locator) {
  const handle = await locator.elementHandle();
  assert.ok(handle, 'Expected a mounted node');
  return async () => assert.equal(await locator.evaluate((element, original) => element === original && original.isConnected, handle), true, 'Unrelated node was remounted');
}

async function enableTools(page, name) { const toggle = button(page, name); if (await toggle.count()) await toggle.click(); }
async function screenshot(page, name) { await page.screenshot({ path: resolve(output, `${name}.png`) }); }

async function layout() {
  for (const width of widths) for (const path of routes) {
    const page = await fresh(path, width);
    await assertFits(page, `${path} ${width}`);
    await assertNoResidue(page, `initial ${path} ${width}`);
    if (['/', '/care'].includes(path)) await screenshot(page, `${path === '/' ? 'home' : 'care'}-${width}`);
    results.push({ check: 'static shell reflow', path, width });
  }
}

async function navigation() {
  const page = await fresh('/chat');
  const input = field(page, '撰寫對話問題');
  await input.fill('切換工具後保留的問題草稿');
  const keepSidebar = await preserveNode(page.getByTestId('web-sidebar'));
  const keepHeader = await preserveNode(page.getByTestId('header-actions'));
  await startTrace(page, 'top-level-navigation');
  for (const [path, label] of [['/care', '照顧記錄'], ['/tasks', '任務與預約'], ['/summary', '照顧摘要'], ['/chat', '與 Agent 對話']]) {
    const link = page.getByRole('link', { name: label, exact: true });
    await link.click();
    await page.waitForURL(url => url.pathname === path);
  }
  await settled(page); const trace = await stopTrace(page);
  await keepSidebar(); await keepHeader();
  assert.equal(await input.inputValue(), '切換工具後保留的問題草稿');
  assert.ok(timeline(trace, 'motion-route').length || trace.snapshots.some(snapshot => snapshot.regions.some(region => region.kind === 'route')), 'Route presentation boundary was not observed');
  await assertNoResidue(page, 'rapid tool navigation');
}

async function summary() {
  const page = await fresh('/summary');
  // New RHF inputs mount after the list motion commit; append focus must wait for that ref.
  for (const [add, fieldName, remove] of [
    ['新增到診問題', '到診問題 2', '移除到診問題 2'],
    ['新增到診準備', '到診準備 2', '移除到診準備 2'],
  ]) {
    await button(page, add).click();
    const appended = field(page, fieldName); await appended.waitFor(); await settled(page);
    assert.equal(await appended.evaluate(element => element === document.activeElement), true, `${add} did not focus its committed new input`);
    await button(page, remove).click(); await settled(page);
    assert.equal(await appended.count(), 0, 'Temporary append-focus fixture row was not removed');
  }
  await enableTools(page, '顯示摘要情境');
  await selectOption(page, '摘要重讀資料', '來源及家庭準備已改變');
  const input = field(page, '到診問題 1'), raw = '  更新結果期間保留的到診草稿與游標。  ';
  await input.fill(raw); await input.focus();
  await input.evaluate(element => element.setSelectionRange(4, 10));
  const keepInput = await preserveNode(input), keepPreparation = await preserveNode(page.getByTestId('summary-preparation'));
  const refresh = button(page, '產生／更新摘要並保留草稿');
  const keepRefresh = await preserveNode(refresh);
  await startTrace(page, 'summary-covered-commit');
  // Dispatch the existing button's click while editing, so this tests whether
  // the result update steals focus rather than whether a pointer click does.
  await refresh.evaluate(element => element.click());
  assert.deepEqual(await input.evaluate(element => ({ disabled: element.disabled, readOnly: element.readOnly, focus: document.activeElement === element, start: element.selectionStart, end: element.selectionEnd })), { disabled: false, readOnly: true, focus: true, start: 4, end: 10 }, 'A summary read must lock edits without disabling or blurring the draft');
  await visibleText(page, '已重新讀取合成摘要').waitFor(); await settled(page);
  const trace = await stopTrace(page), regions = motionRegions(trace);
  assert.ok(regions.length, 'Changed summary did not produce a result curtain');
  for (const region of regions) assertCurtainCommit(trace, region);
  await keepInput(); await keepPreparation(); await keepRefresh();
  assert.equal(await input.inputValue(), raw);
  assert.deepEqual(await input.evaluate(element => ({ focus: document.activeElement === element, start: element.selectionStart, end: element.selectionEnd })), { focus: true, start: 4, end: 10 });
  await assertNoResidue(page, 'summary update');
  await selectOption(page, '摘要重讀資料', '同一來源及準備');
  await startTrace(page, 'summary-same-content');
  await refresh.click(); await refresh.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="產生／更新摘要並保留草稿"]')?.getAttribute('aria-disabled') || document.querySelector('[aria-label="產生／更新摘要並保留草稿"]')?.getAttribute('aria-disabled') === 'false');
  await settled(page);
  const unchanged = await stopTrace(page);
  assert.deepEqual(motionRegions(unchanged), [], 'Same summary content replayed a curtain');
  assert.equal(await input.inputValue(), raw);
}

async function care() {
  const page = await fresh('/care');
  const list = page.getByTestId('care-record-list');
  await button(list, '載入下一頁').click();
  await button(list, '查看預約資料').waitFor();
  assert.equal(await list.locator('[data-motion-row]').count(), 6, 'Care fixture needs six motion rows');
  await button(list, '查看身高記錄').click();
  await button(page, '永久刪除此記錄及歷史').click();
  await page.getByRole('checkbox', { name: '我明白會永久刪除此記錄及全部歷史', exact: true }).click();
  const keepSearch = await preserveNode(field(page, '搜尋照顧記錄'));
  await startTrace(page, 'care-middle-delete-flip');
  await button(page, '確認並模擬永久刪除記錄').click();
  await page.getByRole('heading', { name: '已確認刪除（預覽）', exact: true }).waitFor();
  await settled(page); const trace = await stopTrace(page);
  const start = trace.snapshots[0].rows, deleted = 'preview-care-height';
  assert.equal(start.length, 6);
  const end = trace.snapshots.at(-1).rows;
  assert.equal(end.length, 5); assert.ok(!end.some(row => row.id === deleted));
  const exit = trace.snapshots.flatMap(snapshot => snapshot.rows.filter(row => row.id === deleted && row.exiting));
  assert.ok(exit.length, 'Only the deleted care row should visibly exit');
  assert.ok(exit.every(row => row.hidden === 'true' && (row.inert || row.pointerEvents === 'none')), 'Exiting row remains accessible or interactive');
  for (const row of start.filter(row => row.id !== deleted)) {
    const final = end.find(item => item.id === row.id);
    assert.equal(final?.node, row.node, `Surviving care row ${row.id} was remounted`);
    const samples = trace.snapshots.flatMap(snapshot => snapshot.rows.filter(item => item.id === row.id));
    assert.ok(samples.every(item => !item.entering), `Existing care row ${row.id} replayed entry`);
    if (start.indexOf(row) < 2) {
      assert.ok(samples.every(item => !item.flip), `Unmoved upper care row ${row.id} participated in FLIP`);
      assert.ok(Math.abs(final.y - row.y) <= 2, `Upper care row ${row.id} moved relative to the list`);
    } else {
      assert.ok(samples.some(item => item.flip), `Moved lower care row ${row.id} did not use FLIP`);
      assert.ok(final.y < row.y - 2, `Lower care row ${row.id} did not settle upward`);
    }
  }
  await keepSearch();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '查看公園觀察', 'Deleting the selected record must focus the next surviving row');
  await assertNoResidue(page, 'care deletion'); await screenshot(page, 'care-delete-1440');

  // One real existing correction checks the local read-only result boundary.
  await button(list, '查看睡眠記錄').click();
  await button(page, '更正這筆記錄').click();
  const raw = '昨晚大約九時休息，今早七時左右醒來。';
  await field(page, '記錄原文草稿').fill(raw); await field(page, '更正原因草稿').fill('核對原觀察（合成測試）');
  await button(page, '預覽共享內容').click();
  await startTrace(page, 'care-local-correction');
  await button(page, '確認家庭共享並模擬提交').click();
  await page.getByRole('heading', { name: '已確認保存（預覽）', exact: true }).waitFor();
  await settled(page); const correction = await stopTrace(page);
  assert.ok(motionRegions(correction).length, 'Changed record did not reveal the changed read-only result');
  for (const region of motionRegions(correction)) assertCurtainCommit(correction, region);
  assert.ok((await list.innerText()).includes(raw));
  assert.deepEqual(correction.snapshots.at(-1).rows.map(row => row.id), correction.snapshots[0].rows.map(row => row.id), 'A local correction must retain every previously loaded record');
  await assertNoResidue(page, 'care correction');

  // The same loaded-prefix invariant also applies when a real existing create
  // action inserts a row according to the product's established ordering.
  await button(page, '新增記錄').click();
  await field(page, '記錄原文草稿').fill('合成新增記錄；原已載入記錄仍保留。');
  await field(page, '資料來源草稿').fill('動效驗收合成來源');
  await button(page, '預覽共享內容').click();
  await startTrace(page, 'care-create-prefix');
  await button(page, '確認家庭共享並模擬提交').click();
  await page.getByRole('heading', { name: '已確認保存（預覽）', exact: true }).waitFor();
  await settled(page); const creation = await stopTrace(page);
  const oldIds = creation.snapshots[0].rows.map(row => row.id), createdIds = creation.snapshots.at(-1).rows.map(row => row.id);
  assert.equal(createdIds.length, oldIds.length + 1, 'Creating a record must retain the loaded prefix and add exactly one record');
  assert.ok(oldIds.every(id => createdIds.includes(id)), 'Creating a record dropped a previously loaded record');
  await assertNoResidue(page, 'care creation');

  const narrow = await fresh('/care', 390), scroll = narrow.getByTestId('care-page-scroll');
  const row = button(narrow.getByTestId('care-record-list'), '查看身高記錄');
  await row.evaluate(element => element.scrollIntoView({ block: 'center' })); await frames(narrow);
  const before = await scroll.evaluate(element => element.scrollTop);
  await startTrace(narrow, 'care-narrow-round-trip');
  await row.click(); await narrow.getByRole('heading', { name: '記錄詳情', exact: true }).waitFor(); await settled(narrow);
  await button(narrow, '返回記錄').click(); await row.waitFor(); await settled(narrow);
  const roundTrip = await stopTrace(narrow);
  const translations = roundTrip.snapshots.flatMap(snapshot => snapshot.regions).map(region => {
    const match = /^matrix\(([^)]+)\)$/.exec(region.transform ?? '');
    return { kind: region.kind, x: match ? Number(match[1].split(',')[4]) : 0 };
  });
  assert.ok(translations.some(sample => sample.kind === 'detail-forward' && sample.x > 1), 'Narrow details must enter from the right');
  assert.ok(translations.some(sample => sample.kind === 'detail-back' && sample.x < -1), 'Narrow return must enter from the left');
  assert.ok(Math.abs(await scroll.evaluate(element => element.scrollTop) - before) <= 2, 'Narrow detail return lost the list scroll anchor');
  assert.equal(await row.evaluate(element => element === document.activeElement), true, 'Narrow detail return did not restore the source-row focus');
  await assertNoResidue(narrow, 'narrow record round trip');
}

async function tasks() {
  const page = await fresh('/tasks');
  await selectOption(page, '事項狀態', '待處理');
  const row = button(page, '查看事項：記錄這星期的身高'); await row.click();
  await button(page, '回報已完成').click(); await button(page, '預覽家庭共享內容').click();
  await page.getByRole('checkbox', { name: '我已核對內容、負責人、時間及版本，確認這次家庭共享安排', exact: true }).click();
  await startTrace(page, 'task-completion-filter-exit');
  await button(page, '確認家庭共享並模擬保存').click();
  await page.getByRole('heading', { name: '已保存', exact: true }).waitFor(); await settled(page);
  const trace = await stopTrace(page), original = trace.snapshots[0].rows;
  assert.equal(await row.count(), 0, 'Completed task remains in the pending filter');
  assert.ok(trace.snapshots.some(snapshot => snapshot.rows.some(item => item.exiting)), 'Filtered completion did not exit its own row');
  for (const remaining of trace.snapshots.at(-1).rows) assert.equal(remaining.node, original.find(row => row.id === remaining.id)?.node, 'Task completion remounted an unrelated row');
  await assertNoResidue(page, 'task filtered completion');

  const create = await fresh('/tasks', 390);
  await button(create, '新增共享事項').click();
  await field(create, '事項標題').fill('新增動態驗收的合成事項');
  await selectOption(create, '負責人', '媽媽（擁有人 · 合成）');
  await button(create, '選擇安排時間').click();
  await field(create, '安排時間日期').fill('2026-10-05'); await field(create, '安排時間時間').fill('09:00');
  await button(create, '選用安排時間').click();
  await button(create, '預覽家庭共享內容').click();
  await create.getByRole('checkbox', { name: '我已核對內容、負責人、時間及版本，確認這次家庭共享安排', exact: true }).click();
  await startTrace(create, 'task-new-id-only');
  await button(create, '確認家庭共享並模擬建立').click();
  await button(create, '查看事項：新增動態驗收的合成事項').waitFor(); await settled(create);
  const addition = await stopTrace(create), initial = addition.snapshots[0].rows;
  const last = addition.snapshots.at(-1).rows, initialIds = new Set(initial.map(row => row.id));
  const newRows = last.filter(row => !initialIds.has(row.id));
  assert.equal(newRows.length, 1, 'One authorized create must add exactly one task ID');
  assert.ok(addition.snapshots.some(snapshot => snapshot.rows.some(row => row.id === newRows[0].id && row.entering)), 'New task did not enter');
  for (const existing of initial) {
    assert.equal(last.find(row => row.id === existing.id)?.node, existing.node, 'Adding a task remounted an existing row');
    assert.ok(addition.snapshots.every(snapshot => !snapshot.rows.some(row => row.id === existing.id && row.entering)), 'Adding a task replayed an existing row');
  }
  await assertNoResidue(create, 'task create');
}

async function photos() {
  const page = await fresh('/photos');
  await button(page, `開啟照片：私人 · ${brand.illustrationFilename}`).click();
  const input = field(page, '照片記錄原文'), raw = '  候選更新時保留人工草稿。  ';
  await input.fill(raw); const keepInput = await preserveNode(input);
  await enableTools(page, '顯示照片情境');
  await selectOption(page, '模擬問題階段', 'AI 提取'); await selectOption(page, '模擬照片結果', '成功');
  await page.getByRole('checkbox', { name: '我同意把原照片交由 Gemini 提取；候選仍需核對', exact: true }).click();
  await startTrace(page, 'photo-candidate-only');
  await button(page, '提取照片內容').click(); await button(page, '採用候選並取代本頁草稿').waitFor(); await settled(page);
  const trace = await stopTrace(page);
  assert.ok(motionRegions(trace).length, 'Photo candidate did not use a local result reveal');
  await keepInput(); assert.equal(await input.inputValue(), raw);
  assert.equal(await button(page, '採用候選並取代本頁草稿').count(), 1, 'Candidate update incorrectly consumed adoption');
  await button(page, '採用候選並取代本頁草稿').click(); assert.match(await input.inputValue(), /昨日下午/);
  assert.equal(await page.getByText('已確認（合成預覽）', { exact: true }).count(), 0, 'Adopting a candidate must not pretend the family record was saved');
  await assertNoResidue(page, 'photo candidate adoption');
}

async function contact() {
  const page = await fresh('/contact');
  await page.getByRole('checkbox', { name: '允許透過以下本人渠道接收一般任務提示', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Web Push · 本人瀏覽器（合成）', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Telegram · 本人 Telegram（合成）', exact: true }).click();
  await settled(page);
  const rows = page.locator('[data-motion-region="contact-consent-bindings"] [data-motion-row]');
  const ids = () => rows.evaluateAll(elements => elements.map(element => element.dataset.motionRow));
  const original = await ids(); assert.equal(original.length, 2);
  await startTrace(page, 'contact-draft-reorder-remove-focus');
  await button(page, '向前移動Telegram').click(); await settled(page);
  assert.deepEqual(await ids(), [...original].reverse(), 'Contact reorder changed stable binding identities');
  assert.equal(await button(page, '移除Telegram接收選項').evaluate(element => element === document.activeElement), true, 'Moving to index0 left focus on the newly disabled move control');
  await button(page, '向前移動Web Push').click(); await settled(page);
  assert.deepEqual(await ids(), original, 'Moving back failed to restore the established channel order');
  await button(page, '移除Web Push接收選項').click(); await settled(page);
  assert.deepEqual(await ids(), [original[1]], 'Removing one draft channel changed the survivor');
  assert.equal(await button(page, '移除Telegram接收選項').evaluate(element => element === document.activeElement), true, 'Removing the first draft channel lost survivor focus');
  await button(page, '移除Telegram接收選項').click(); await settled(page);
  assert.deepEqual(await ids(), [], 'Removing the final draft channel left a row');
  assert.equal(await page.getByRole('checkbox', { name: 'Telegram · 本人 Telegram（合成）', exact: true }).evaluate(element => element === document.activeElement), true, 'Final channel removal did not focus the checkbox fallback');
  await stopTrace(page); await assertNoResidue(page, 'contact draft reorder and removal');
  // These are local draft changes only: do not save consent or invoke notification APIs.
}

async function states() {
  for (const [outcome, message] of [['未獲接受', '這次保存未獲接受'], ['結果未知', '保存結果未知']]) {
    const page = await fresh('/summary', 390);
    await enableTools(page, '顯示摘要情境'); await selectOption(page, '摘要保存結果', outcome);
    const input = field(page, '到診問題 1'), raw = `  ${outcome}仍須保留的原草稿。  `;
    await input.fill(raw); const keepInput = await preserveNode(input);
    await page.getByRole('checkbox', { name: '我確認把以上到診準備與有權家庭成員共享', exact: true }).click();
    await startTrace(page, outcome === '結果未知' ? 'summary-unknown' : 'summary-failed');
    await button(page, '確認保存家庭共享到診準備').click(); await visibleText(page, message).waitFor(); await settled(page);
    const trace = await stopTrace(page);
    assert.deepEqual(motionRegions(trace), [], `${outcome} must not play a successful result reveal`);
    await keepInput(); assert.equal(await input.inputValue(), raw);
    if (outcome === '結果未知') {
      const reference = await page.getByTestId('summary-pending').innerText();
      await button(page, '先查原收據及更新摘要').click();
      await visibleText(page, '原操作仍然結果未知').waitFor();
      assert.equal(await page.getByTestId('summary-pending').innerText(), reference, 'Unknown lookup changed the original operation, content or version');
      assert.equal(await button(page, '以原操作明確重試到診準備').isDisabled(), true, 'Unknown lookup unlocked a second write');
    }
    await assertNoResidue(page, `summary ${outcome}`);
  }
}

async function child() {
  const page = await fresh('/care', 390);
  await startTrace(page, 'child-a-b-a');
  await page.getByRole('button', { name: '選擇孩子，目前小昕', exact: true }).first().click();
  await page.getByRole('radio', { name: '阿樂 · 約 8 歲 · 截至 2026 年 9 月', exact: true }).click();
  await page.getByRole('button', { name: '選擇孩子，目前阿樂', exact: true }).first().click();
  await page.getByRole('radio', { name: /小昕 ·/ }).click();
  await button(page, '查看睡眠記錄').waitFor(); await settled(page);
  const trace = await stopTrace(page);
  assert.ok(motionRegions(trace, 'scope').length, 'Child switching did not use the scope boundary');
  for (const snapshot of trace.snapshots) {
    const label = snapshot.childLabel.join(' '), content = snapshot.careText ?? '';
    if (label.includes('目前阿樂')) assert.ok(!content.includes('睡眠記錄'), 'A new child label exposed the old child record list');
    if (label.includes('目前小昕')) assert.ok(!content.includes('課後觀察'), 'Returning to A exposed B records');
  }
  assert.equal(await button(page, '查看課後觀察').count(), 0);
  await assertNoResidue(page, 'rapid child return');
}

async function reduced() {
  const page = await fresh('/summary', 390);
  await enableTools(page, '顯示摘要情境'); await selectOption(page, '摘要重讀資料', '來源及家庭準備已改變');
  const input = field(page, '到診問題 1'); await input.fill('播放途中降低動畫，草稿保留');
  await startTrace(page, 'reduced-motion-mid-flight');
  await button(page, '產生／更新摘要並保留草稿').click();
  await page.locator('[data-motion-phase="covering"]').first().waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(page);
  await stopTrace(page); await assertNoResidue(page, 'reduced during curtain');
  assert.equal(await input.inputValue(), '播放途中降低動畫，草稿保留');
  await startTrace(page, 'reduced-motion-start');
  await button(page, '產生／更新摘要並保留草稿').click();
  await page.waitForFunction(() => {
    const element = document.querySelector('[aria-label="產生／更新摘要並保留草稿"]');
    return element && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  });
  await settled(page); const trace = await stopTrace(page);
  assert.deepEqual(motionRegions(trace), [], 'System reduced-motion still played a curtain');
  assert.ok(trace.snapshots.every(snapshot => snapshot.regions.every(region => !region.overlay)), 'Reduced-motion left a covering layer');
  for (const snapshot of trace.snapshots) for (const region of snapshot.regions) assert.ok(identityMatrix(region.transform), 'Reduced-motion kept a translated presentation region');
  await page.setViewportSize({ width: 320, height: 720 }); await frames(page); await assertFits(page, 'reduced summary 320');
  await assertNoResidue(page, 'reduced summary after resize');
}

async function dialog() {
  const page = await fresh('/profile', 320);
  const trigger = button(page, '刪除整位孩子（預覽）'); await trigger.focus();
  await startTrace(page, 'dialog-open-cancel');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  await field(page, '核對刪除孩子稱呼').fill('未提交的合成輸入');
  await field(page, '核對刪除孩子稱呼').focus();
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Dialog focus escaped to the background');
  }
  await assertFits(page, 'dialog 320'); await screenshot(page, 'dialog-320');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await settled(page);
  await stopTrace(page);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Dialog dismissal lost trigger focus');
  assert.equal(await button(page, '切換至小昕').count(), 1, 'Cancel submitted the destructive action');
  await assertNoResidue(page, 'dialog cancel');

  // React mutation-phase focus restoration must not undo drawer dismissal.
  const drawerPage = await fresh('/summary', 390);
  const draft = field(drawerPage, '到診問題 1'); await draft.fill('側欄配置合成草稿');
  const drawerTrigger = button(drawerPage, '開啟資訊側欄'); await drawerTrigger.focus();
  await startTrace(drawerPage, 'drawer-escape-focus');
  await drawerPage.keyboard.press('Enter');
  const drawer = drawerPage.getByRole('dialog', { name: '照顧上下文', exact: true }); await drawer.waitFor();
  await button(drawerPage, '關閉資訊側欄').focus();
  await drawerPage.keyboard.press('Shift+Tab');
  assert.equal(await drawer.evaluate(element => element.contains(document.activeElement)), true, 'Drawer reverse Tab escaped its focus trap');
  await drawerPage.keyboard.press('Tab');
  assert.equal(await button(drawerPage, '關閉資訊側欄').evaluate(element => element === document.activeElement), true, 'Drawer forward Tab did not wrap to its first control');
  await drawerPage.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
  assert.equal(await drawerTrigger.evaluate(element => element === document.activeElement), true, 'Drawer Escape did not immediately restore trigger focus');
  await settled(drawerPage); await stopTrace(drawerPage);
  assert.equal(await drawerTrigger.evaluate(element => element === document.activeElement), true, 'Drawer exit completion lost trigger focus');
  assert.equal(await draft.inputValue(), '側欄配置合成草稿', 'Drawer dismissal lost the existing draft');
  await assertNoResidue(drawerPage, 'drawer Escape');
}

async function chat() {
  const page = await fresh('/chat', 390), scroll = page.getByTestId('chat-timeline-scroll');
  const input = field(page, '撰寫對話問題'); await input.fill('新回覆期間保留的聊天草稿');
  const keepInput = await preserveNode(input), keepComposer = await preserveNode(page.getByTestId('chat-composer'));
  const scrollBounds = await scroll.boundingBox();
  await page.mouse.move(scrollBounds.x + 8, scrollBounds.y + scrollBounds.height / 2); await page.mouse.wheel(0, -6000);
  const disclosure = page.getByTestId('agent-preview-toggle');
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  await enableTools(page, '顯示 Agent 情境工具');
  await startTrace(page, 'chat-single-entry-stream');
  await button(page, '加入回覆狀態示例').click();
  const reply = page.getByTestId('chat-timeline-entry').last(); await reply.getByText('思考中', { exact: true }).waitFor();
  const id = await reply.getAttribute('id'), keepReply = await preserveNode(reply);
  await reply.getByTestId('chat-message-phase').getByText('正在回覆', { exact: true }).waitFor();
  await reply.getByRole('button', { name: '停止回覆', exact: true }).click();
  await reply.getByTestId('chat-message-phase').getByText('已停止 · 回覆未完成', { exact: true }).waitFor(); await settled(page);
  const trace = await stopTrace(page);
  await keepReply(); await keepInput(); await keepComposer();
  assert.equal(await input.inputValue(), '新回覆期間保留的聊天草稿');
  const samples = trace.snapshots.flatMap(snapshot => snapshot.rows.filter(row => row.id === id || id?.endsWith(row.id)));
  if (samples.length) {
    let previous = false, entries = 0;
    for (const sample of samples) { if (sample.entering && !previous) entries++; previous = sample.entering; }
    assert.equal(entries, 1, 'The new reply must enter exactly once; streaming must not replay it');
  } else {
    const regions = trace.snapshots.flatMap(snapshot => snapshot.regions.filter(region => region.region === id));
    assert.ok(regions.length, 'New-message entry has no observable presentation boundary');
    let previous = false, entries = 0;
    for (const sample of regions) { const entering = sample.phase === 'entering'; if (entering && !previous) entries++; previous = entering; }
    assert.equal(entries, 1, 'The same reply ID must enter exactly once across streaming updates');
  }
  await assertNoResidue(page, 'stopped streaming message');
}

const groups = { layout, navigation, summary, care, tasks, photos, contact, states, child, reduced, dialog, chat };
for (const group of requested) assert.ok(group in groups, `Unknown motion group: ${group}`);

async function sourceManifest() {
  const entries = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (/\.(tsx?|mts|mjs|json|css)$/.test(item.name)) entries.push({ path: relative(process.cwd(), path), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    }
  }
  for (const path of ['src', 'app']) await visit(resolve(path));
  for (const path of ['package.json', 'package-lock.json', 'app.json', 'scripts/verify-motion-system.mjs', 'scripts/preview-browser.mjs']) entries.push({ path, sha256: createHash('sha256').update(await readFile(resolve(path))).digest('hex') });
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

await mkdir(output, { recursive: true });
const manifest = await sourceManifest();
await writeFile(resolve(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const report = { at: new Date().toISOString(), previewUrl: process.env.FRONTEND_PREVIEW_URL ?? 'http://localhost:8082',
  version: process.env.FRONTEND_TEST_VERSION ?? 'c51dd52e0cdea03b1d412a10d08ac6761e010d9b plus source-manifest working copy',
  scope: 'Local synthetic frontend only. No Server, model, notification, real-child data, native device, or screen-reader acceptance.',
  widths, requested: requested.size ? [...requested] : Object.keys(groups), results, failures, skipped: [], browser: null };
try {
  browser = await launchPreviewBrowser(); report.browser = await browser.version();
  for (const [name, run] of Object.entries(groups)) {
    if (requested.size && !requested.has(name)) continue;
    activeGroup = name;
    await run();
    assert.deepEqual(failures, [], `Browser/API errors during ${name}`);
    results.push({ check: name, status: 'passed' }); console.log(`${name}: passed`);
  }
} catch (error) {
  failures.push({ group: activeGroup, message: error.message, stack: error.stack });
  if (activePage && !activePage.isClosed()) {
    try { await screenshot(activePage, `failure-${activeGroup}`); } catch {}
    try { if (await activePage.evaluate(() => !!globalThis.__fe37MotionTrace)) await stopTrace(activePage); } catch {}
  }
  const names = report.requested; report.skipped = names.slice(names.indexOf(activeGroup) + 1);
  process.exitCode = 1; console.error(error.stack);
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${output}`);
}
