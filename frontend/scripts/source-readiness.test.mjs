import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceReadiness } from '../src/shared-input-view-model.ts';

test('private source readiness separates saved links, body consent, disabled and stale snapshots from vector indexing', () => {
  const current = Object.freeze({ online: true, load: 'ready', readFresh: true, fresh: true, access: 'editable' });
  const body = 'Synthetic source body for the authorized excerpt.';
  const input = Object.freeze({ kind: 'personal_source', text: body, sha256: 'synthetic-hash', fetchState: 'ready',
    management: Object.freeze({ enabled: true, modelExcerpt: 'authorized excerpt' }) });
  const cases = [
    [{ text: '', sha256: null, fetchState: 'not_requested', management: null }, current, '尚未取得正文', 'neutral'],
    [{ management: { enabled: true, modelExcerpt: null } }, current, '尚未授權 Agent', 'neutral'],
    [{}, current, '可供 Agent 讀取', 'success'],
    [{ management: { enabled: false, modelExcerpt: 'authorized excerpt' } }, { ...current, readFresh: false }, '已停用', 'neutral'],
    [{}, { ...current, readFresh: false }, '來源狀態待核對', 'warning'],
    [{ text: '', sha256: null, fetchState: 'running' }, current, '正在取得正文', 'info'],
    [{ text: '', sha256: null, fetchState: 'failed' }, current, '取得失敗', 'error'],
    [{ text: '', sha256: null, fetchState: 'unknown' }, current, '取得結果待核對', 'warning'],
    [{ sha256: null }, current, '正文完整性待核對', 'warning'],
    [{ management: { enabled: true, modelExcerpt: 'not present' } }, current, '授權片段待核對', 'warning'],
    [{ text: 'x'.repeat(6001), management: { enabled: true, modelExcerpt: 'x'.repeat(6001) } }, current, '授權片段超出讀取上限', 'warning'],
    [{ kind: 'public_source' }, current, '可供 Agent 讀取', 'success'],
  ];
  for (const [patch, model, label, tone] of cases) {
    assert.deepEqual(sourceReadiness({ ...input, ...patch }, model), { label, tone, indexLabel: '未建立向量索引' });
  }
});
