import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Real HTTP parser, projection and shallow component; synthetic responses only, no network or model calls.
const root = path.resolve(import.meta.dirname, '../..'), require = createRequire(import.meta.url), cache = new Map();
const placeholder = new Proxy({}, { get: (_target, key) => String(key) });
const overrides = {
  react: { useId: () => 'synthetic-run', useRef: value => ({ current: value }), useState: value => [value, () => {}] },
  'react-native': { StyleSheet: { create: value => value }, View: 'View' },
  'react-native-paper': { Text: 'Text' },
  '../../theme': { chineseFont: 'synthetic', colors: placeholder, radius: placeholder, readingType: {}, spacing: placeholder, workspaceType: {} },
};
for (const name of ['../EmptyListCard', '../AppStatusBadge', '../AppCheckbox', '../AppIcon', '../AppButton', '../ui',
  '../StatusAnnouncement', '../chat/ChatMessage', '../../motion']) overrides[name] = placeholder;
function load(entry) {
  const file = path.resolve(root, entry);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('.')) return require(name);
    let target = path.resolve(path.dirname(file), name);
    if (!existsSync(target)) target += '.ts';
    return load(target);
  }, module, module.exports);
  return module.exports;
}
const { createProductAgentApi, ProductAgentApiError } = load('src/client/product-agent-api.ts');
const { projectAgentRun } = load('frontend/src/production/agent-projection.ts');
const { AgentRunView } = load('frontend/src/components/agent/AgentRunView.tsx');
const childId = '11111111-1111-4111-8111-111111111111', runId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333', resourceId = '44444444-4444-4444-8444-444444444444';
const at = '2026-10-07T00:00:00Z';
const fixtures = [
  { kind: 'task', value: { kind: 'task_create', values: { title: 'Synthetic task', details: '', kind: 'ordinary',
    assigneeUserId: 'synthetic-user', dueAt: at, timeZone: 'Asia/Hong_Kong' } },
    expected: '此收據代表任務資料已保存；照護事項的完成狀態另行記錄。' },
  { kind: 'memory_fact', value: { kind: 'memory_fact', key: 'Synthetic fact', content: 'Synthetic user-confirmed fact', intendedVisibility: 'private', validUntil: null },
    expected: '此收據代表確認事實已保存；不代表照護事項已完成。' },
  { kind: 'private_source', value: { kind: 'private_source_create',
    input: { kind: 'personal_source', sourceLabel: 'Synthetic source', sourceUrl: null, sourceDateText: null, sourceNotes: '', text: 'Synthetic reference' },
    management: { intention: '', purpose: 'answer_reference', nature: 'unspecified', timeScope: 'unspecified', validityText: '', enabled: false, modelExcerpt: null } },
    expected: '私人來源設定已保存；連結保存不等於取得正文，亦沒有建立家庭事實、提醒或公共知識。' },
  { kind: 'concern', value: { kind: 'concern_create', values: { title: 'Synthetic concern', reason: 'Synthetic reason', observation: 'Synthetic observation',
    observedAt: at, links: { recordId: null, taskId: null, attentionId: null }, followUpAt: null } }, expected: '關注鏈已保存。' },
  { kind: 'concern', value: { kind: 'concern_change', concernId: resourceId,
    change: { action: 'archive', expectedVersion: 1, authorityVersion: 'synthetic-authority', confirm: true } }, expected: '關注鏈已保存。' },
  { kind: 'family_document', value: { kind: 'family_document_change', documentId: resourceId,
    change: { action: 'patch', expectedVersion: 1, authorityVersion: 'synthetic-authority',
      edits: [{ op: 'set_metadata', title: 'Synthetic document title' }] } },
    expected: '指定修改已保存到同一份家庭文件；請按目前來源及版本核對正文。' },
];
function response(fixture, kind = fixture.kind) {
  return { result: { runId, provenance: null, status: 'completed', stopReason: null, text: 'Synthetic response',
    citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
    proposals: [{ id: proposalId, runId, childId, version: 2, status: 'accepted', createdAt: at, expiresAt: at,
      value: fixture.value, targetLabel: 'Synthetic target', result: { kind, id: resourceId, version: 1 } }] } };
}
async function read(fixture, kind = fixture.kind) {
  const api = createProductAgentApi('/api', async (_url, init) => {
    assert.equal(init.method, 'GET');
    return Response.json(response(fixture, kind));
  });
  return api.getRun(childId, runId, new AbortController().signal, 'synthetic-user');
}
function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return { ...value, props: { ...value.props, children: expand(value.props?.children) } };
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : !value || typeof value !== 'object' ? [] : [value, ...nodes(value.props?.children)];
const content = value => Array.isArray(value) ? value.map(content).join('') : value && typeof value === 'object' ? content(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function proposalText(result) {
  const run = projectAgentRun(result, childId, at);
  const tree = expand(AgentRunView({ model: { online: true, readState: 'ready', busy: null, run, loadedAt: at,
    sharedConfirmed: {}, pendingDecision: null, notice: null }, actions: {} }));
  const proposal = nodes(tree).find(node => node.props?.testID === `agent-proposal-${proposalId}`);
  assert.ok(proposal, 'the accepted proposal is actually rendered');
  return content(proposal);
}

for (const fixture of fixtures) test(`${fixture.value.kind} renders the explicit ${fixture.kind} receipt after parsing and projection`, async () => {
  const result = await read(fixture), text = proposalText(result);
  assert.equal(result.proposals[0].result.kind, fixture.kind);
  assert.ok(text.includes(fixture.expected), `Receipt text must include: ${fixture.expected}\nReceived: ${text}`);
  if (fixture.kind !== 'memory_fact') assert.ok(!text.includes('確認事實已保存'));
  if (fixture.kind === 'concern') {
    assert.ok(!text.includes('此收據代表確認事實'));
    assert.ok(!text.includes('照護事項已完成'));
  }
});

test('untrusted unknown and mismatched receipt kinds are rejected by the real HTTP parser', async () => {
  for (const kind of ['unexpected', 'toString', 'memory_fact']) {
    await assert.rejects(read(fixtures[3], kind), ProductAgentApiError);
  }
});

test('an unsupported in-memory receipt never falls back to a confirmed fact', () => {
  const result = response(fixtures[3], 'unexpected').result, text = proposalText(result);
  assert.ok(text.includes('保存收據種類未能辨識，請重新讀取核對。'));
  assert.ok(!text.includes('確認事實已保存'));
  assert.ok(!text.includes('關注鏈已保存'));
});
