import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialLivePages } from '../server/official-live-pages.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';

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
