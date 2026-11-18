import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialLivePages } from '../server/official-live-pages.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { snapshotLiveRead } from '../server/live-source-citation.ts';

test('live lookup reads the registered publisher, returns its exact passage and rechecks withdrawal', async () => {
  const page = SOURCE_WATCHES.find(item => item.id === 'fhs-child-vision')!;
  let enabled = true;
  const urls: string[] = [];
  const original = '兒童健康資訊。請妥善保管視力檢查通知，按指定日期攜同前往。';
  const reader = createOfficialLivePages({
    sourceIds: [page.id, 'chp-recent'],
    mayRead: async () => enabled,
    fetchSource: async definition => {
      urls.push(definition.url);
      return { status: 'ok', items: [{ title: '視力檢查', text: original, url: definition.url,
        sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: '二零二六年' }] };
    },
  });
  const signal = new AbortController().signal;
  const [hit] = await reader.search('視力檢查通知', signal, 'official_guidance');
  assert.ok(hit);
  assert.equal(hit.original.slice(hit.start, hit.end).includes('視力檢查通知'), true);
  assert.deepEqual(urls, [page.url]);
  assert.equal(await reader.mayUse(hit, signal), true);
  enabled = false;
  assert.equal(await reader.mayUse(hit, signal), false);
  assert.deepEqual(await reader.search('視力檢查通知', signal, 'official_guidance'), []);
  assert.equal(urls.length, 1);
});

test('a first lookup follows an actual department directory entry without subscribing or disclosing the question', async () => {
  const directory = 'https://www.dh.gov.hk/tc_chi/main/main.html';
  const page = 'https://www.dh.gov.hk/tc_chi/main/main_shs/main_shs.html';
  const requested: string[] = [];
  let enabled = true;
  const reader = createOfficialLivePages({ sourceIds: ['dh-services'], mayRead: async () => enabled,
    directoryTransport: async (url, validate) => {
      assert.equal(validate(url).href, url);
      assert.throws(() => validate('https://www.dh.gov.hk/tc_chi/unrelated.html'));
      requested.push(url);
      assert.ok([directory, page].includes(url));
      const html = url === directory ? '<div id="mainContent"><a href="main_shs/main_shs.html">學生健康服務</a><a href="https://example.org/">學生健康服務</a></div>'
        : '<div id="mainContent"><h2>學生健康服務</h2><p>學生健康服務提供身體檢驗及健康評估。</p></div>';
      return { status: 'response', response: { status: 200, contentType: 'text/html', body: Buffer.from(html) } };
    } });
  const signal = new AbortController().signal;
  const [hit] = await reader.search('學生健康服務有甚麼檢驗？', signal, 'official_guidance');
  assert.ok(hit);
  assert.deepEqual(requested, [directory, page]);
  const citation = snapshotLiveRead(hit);
  assert.equal(citation.url, page);
  assert.equal(citation.series, undefined);
  assert.equal(citation.publisher, '香港特別行政區政府衞生署');
  assert.equal(await reader.mayUse(citation, signal), true);
  assert.equal(await reader.mayUse({ ...citation, url: directory }, signal), false);
  enabled = false;
  assert.equal(await reader.mayUse(citation, signal), false);
  assert.deepEqual(await reader.search('學生健康服務', signal, 'official_guidance'), []);
  assert.equal(requested.length, 2);
});
