import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderFamilyDocumentPdf } from '../server/family-document-pdf.ts';

// Local synthetic rendering only. Requires the repository font, installed dependencies and Poppler.
const output = resolve(process.argv[2] ?? '/tmp/yuban-document-pdf-check');
await mkdir(output, { recursive: true });
const source = await readFile(new URL('../server/family-document-sources.ts', import.meta.url), 'utf8');
const coverage = source.match(/coverageNote: "([^"]+)"/u)?.[1];
assert.ok(coverage && coverage.length > 100, 'exercise the actual long, unspaced CJK coverage text');
const snapshot = {
  id: '00000000-0000-4000-8000-000000000003', version: 1, generatedAt: '2026-10-07T04:00:00.000Z', sourceBasis: 'synthetic',
  title: '合成驗收：第四季家庭成長', summary: '按已確認家庭共享資料整理；沒有推斷診斷、能力或完整期間統計。', ageLabel: '年齡未確認',
  period: { from: '2026-10-01', to: '2026-12-31' }, eventDate: null, coverageNote: coverage,
  sections: [{ id: 'undated-concerns', title: '目前持續關注（未提供觀察日期；未計入期間）', kind: 'notes', domain: 'concerns',
    items: Array.from({ length: 18 }, (_, index) => ({ id: `concern:synthetic:${index + 1}`,
      text: `合成項目 ${index + 1}：整理玩具的日常習慣。\n尚未提供共享觀察日期。`, sourceIds: ['concern:synthetic'] })) }],
  sources: [{ id: 'concern:synthetic', resourceId: 'synthetic', kind: 'concern', version: 1, label: '家庭持續關注', text: '合成關注：整理玩具的日常習慣。', at: null }],
  changes: ['首次建立共享資料快照。'],
};
const before = structuredClone(snapshot);
const bytes = await renderFamilyDocumentPdf(snapshot, { snapshotId: snapshot.id, snapshotVersion: 1, authorityVersion: 'synthetic:1', purpose: 'handoff', includeSources: true, includeRevision: false });
assert.deepEqual(snapshot, before, 'PDF layout must not mutate the selected stored snapshot');
const pdf = resolve(output, 'synthetic-coverage.pdf'), bboxFile = resolve(output, 'synthetic-coverage.bbox.html');
await writeFile(pdf, bytes);
execFileSync('pdftotext', ['-bbox-layout', pdf, bboxFile]);
const bbox = await readFile(bboxFile, 'utf8');
execFileSync('pdftotext', ['-layout', pdf, resolve(output, 'synthetic-coverage.txt')]);
// Save every actual page for visual review before any assertion can fail.
execFileSync('pdftoppm', ['-r', '100', '-png', pdf, resolve(output, 'synthetic-coverage')]);
const words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/gu)];
assert.ok(words.length > 10, 'inspect real rendered text, not a composition mock');
const plain = words.map(word => word[5]).join('').replace(/\s/gu, '');
for (const sentence of coverage.split('。').filter(Boolean)) assert.ok(plain.includes(sentence.replace(/\s/gu, '')), 'missing coverage sentence: ' + sentence);
assert.ok(plain.includes('尚未提供共享觀察日期。'));
const overflow = words.filter(word => Number(word[1]) < 37.9 || Number(word[3]) > 557.4);
assert.deepEqual(overflow.map(word => ({ text: word[5], xMin: word[1], xMax: word[3] })), [], 'all text stays inside the A4 content margins');
const pages = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/gu)];
assert.equal(pages.length, 2, 'one compact two-page fixture exercises fixed footers across a page break');
const footerChecks = pages.map((page, index) => {
  const pageWords = [...page[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/gu)];
  const footerWords = pageWords.filter(word => Number(word[2]) >= Number(page[2]) - 52);
  const actual = footerWords.map(word => word[5]).join('').replace(/\s/gu, '');
  const expected = `育伴港 · 家庭共享資料整理，非診斷或發展評估 · ${index + 1} / ${pages.length}`.replace(/\s/gu, '');
  const minY = footerWords.length ? Math.min(...footerWords.map(word => Number(word[2]))) : null;
  const maxY = footerWords.length ? Math.max(...footerWords.map(word => Number(word[4]))) : null;
  const bodyMaxY = Math.max(...pageWords.filter(word => !footerWords.includes(word)).map(word => Number(word[4])));
  const boundsPassed = minY !== null && maxY !== null && maxY - minY >= 8 && maxY <= Number(page[2]) - 23.9
    && minY >= Number(page[2]) - 52 && bodyMaxY < minY;
  return { page: index + 1, expected, actual, passed: actual === expected && boundsPassed, minY, maxY, bodyMaxY, boundsPassed };
});
for (const item of snapshot.sections.flatMap(section => section.items)) {
  assert.ok(plain.includes(item.text.replace(/\s/gu, '')), 'complete body item survives pagination: ' + item.id);
}
const result = { status: footerChecks.every(check => check.passed) ? 'passed' : 'failed', pdfBytes: bytes.length, pages: pages.length,
  coverageCharacters: coverage.length, checkedWords: words.length, maxTextX: Math.max(...words.map(word => Number(word[3]))),
  snapshotUnchanged: true, bodyItems: 18, footerChecks, bounds: { minX: 38, maxX: 557.28 }, models: 0, databaseCalls: 0 };
await writeFile(resolve(output, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
assert.ok(footerChecks.every(check => check.passed), 'each rendered PDF page includes the complete disclaimer and correct page number');
