import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { releaseCheck } from '../scripts/firestore-release-check.mjs';

const source = readFileSync(new URL('../scripts/firestore-indexes.mjs', import.meta.url), 'utf8');
const { shape, canonical } = runInNewContext(source.slice(source.indexOf('const canonical ='), source.indexOf('const sessionIndexes =')) + '\n({shape, canonical});');
const base = 'https://firestore.googleapis.com/v1/projects/ai-caregivers-for-children/databases/yuban-firebase-20261011';
const resource = 'projects/ai-caregivers-for-children/databases/yuban-firebase-20261011';
const scalar = { collectionGroup: 'yuban_authority_documents', queryScope: 'COLLECTION', fields: [{ fieldPath: 'scopeTag', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }] };
const vector = { collectionGroup: 'yuban_authority_knowledge_chunks', queryScope: 'COLLECTION', fields: [{ fieldPath: 'versionId', order: 'ASCENDING' }, { fieldPath: 'embedding', vectorConfig: { dimension: 1024, flat: {} } }] };
const exclusion = { collectionGroup: 'yuban_authority_documents', fieldPath: 'ciphertext', indexes: [] };
const override = { collectionGroup: 'yuban_authority_documents', fieldPath: 'scopeTag', indexes: [{ queryScope: 'COLLECTION', order: 'ASCENDING' }] };
const desired = { indexes: [scalar, vector], fieldOverrides: [exclusion, override] };
const currentIndex = (entry, state = 'READY') => ({ ...entry, name: resource + '/collectionGroups/' + entry.collectionGroup + '/indexes/id', state });
const field = entry => ({ name: resource + '/collectionGroups/' + entry.collectionGroup + '/fields/' + entry.fieldPath,
  indexConfig: { usesAncestorConfig: false, indexes: entry.indexes.map(({ queryScope, ...configuration }) => ({ queryScope, fields: [{ fieldPath: entry.fieldPath, ...configuration }], state: 'READY' })) } });

function fake(responses) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    assert.ok(String(url).startsWith(base + '/collectionGroups/'));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.body, undefined);
    const reply = responses.shift();
    assert.ok(reply, 'Unexpected extra Firestore request');
    return Response.json(reply.value, { status: reply.status ?? 200 });
  };
  return { requests, check: (manifest = desired) => releaseCheck(manifest, { shape, canonical, token: 'test-token', fetchImpl }) };
}

test('release readiness follows every index page and checks explicit field overrides using GET only', async () => {
  const readyVector = currentIndex(vector);
  readyVector.fields = [{ fieldPath: 'versionId', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' }, vector.fields[1]];
  const stub = fake([{ value: { indexes: [currentIndex(scalar)], nextPageToken: 'next+page/value' } }, { value: { indexes: [readyVector] } }, { value: field(exclusion) }, { value: field(override) }]);
  const report = await stub.check();
  assert.equal(report.state, 'ready');
  assert.equal(report.pages, 2);
  assert.equal(report.indexes, 2);
  assert.equal(report.fieldOverrides, 2);
  assert.equal(new URL(stub.requests[1].url).searchParams.get('pageToken'), 'next+page/value');
  assert.equal(stub.requests.length, 4);
});

test('missing, creating and repair-required indexes block release with distinct counts', async () => {
  for (const [indexes, expected] of [
    [[], { missing: 2, pending: 0, failed: 0 }],
    [[currentIndex(scalar, 'CREATING'), currentIndex(vector, 'NEEDS_REPAIR')], { missing: 0, pending: 1, failed: 1 }],
  ]) {
    const stub = fake([{ value: { indexes } }, { value: field(exclusion) }, { value: field(override) }]);
    const report = await stub.check();
    assert.equal(report.state, 'not_ready');
    assert.deepEqual({ missing: report.missing, pending: report.pending, failed: report.failed }, expected);
  }
});

test('vector dimension mismatch blocks release', async () => {
  const wrong = currentIndex(vector);
  wrong.fields = [vector.fields[0], { fieldPath: 'embedding', vectorConfig: { dimension: 768, flat: {} } }];
  const stub = fake([{ value: { indexes: [currentIndex(scalar), wrong] } }]);
  const report = await stub.check({ indexes: [scalar, vector], fieldOverrides: [] });
  assert.equal(report.state, 'not_ready');
  assert.equal(report.missing, 1);
});

test('inherited, reverting, mismatched and unready field configuration blocks release', async () => {
  for (const indexConfig of [
    { usesAncestorConfig: true, indexes: [] },
    { reverting: true, indexes: [] },
    { indexes: [{ queryScope: 'COLLECTION', fields: [{ fieldPath: 'ciphertext', order: 'ASCENDING' }], state: 'READY' }] },
    { indexes: [{ queryScope: 'COLLECTION', fields: [{ fieldPath: 'scopeTag', order: 'ASCENDING' }], state: 'CREATING' }] },
  ]) {
    const entry = indexConfig.indexes[0]?.fields[0]?.fieldPath === 'scopeTag' ? override : exclusion;
    const stub = fake([{ value: {} }, { value: { indexConfig } }]);
    const report = await stub.check({ indexes: [], fieldOverrides: [entry] });
    assert.equal(report.state, 'not_ready');
    assert.equal(report.fieldProblems, 1);
  }
});

test('a missing field override blocks release instead of applying a patch', async () => {
  const stub = fake([{ value: {} }, { status: 404, value: { error: { message: 'private' } } }]);
  const report = await stub.check({ indexes: [], fieldOverrides: [exclusion] });
  assert.equal(report.state, 'not_ready');
  assert.equal(report.fieldProblems, 1);
  assert.equal(stub.requests.length, 2);
});

test('permission failures and remote bodies cannot appear as readiness or leak token/body', async () => {
  const stub = fake([{ status: 403, value: { error: { message: 'private-body test-token' } } }]);
  await assert.rejects(stub.check(), error => error.message === 'firestore_permission_denied' && error.code === 403 && !String(error).includes('test-token'));
});

test('repeated pagination tokens stop instead of silently ignoring remaining indexes', async () => {
  const stub = fake([{ value: { nextPageToken: 'again' } }, { value: { nextPageToken: 'again' } }]);
  await assert.rejects(stub.check(), /firestore_pagination_invalid/u);
  assert.equal(stub.requests.length, 2);
});

test('missing token fails before any fetch and CLI requires no installed GoogleAuth dependency', async () => {
  await assert.rejects(releaseCheck(desired, { shape, canonical, token: '', fetchImpl: () => assert.fail('Unexpected network') }), /site_access_token_required/u);
  const result = spawnSync(process.execPath, ['scripts/firestore-indexes.mjs', '--release-check'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SITE_ACCESS_TOKEN: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).reason, 'site_access_token_required');
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/u);
});

test('actual CLI validates the entire checked-in manifest and returns nonzero for an unfinished index', () => {
  // Preload only replaces the external HTTP boundary; execute the real entry,
  // manifest validation, comparators, paging and field override checks.
  const preload = `
    import { readFileSync } from 'node:fs';
    const manifest = JSON.parse(readFileSync('deploy/firebase/firestore.indexes.json','utf8'));
    const resource = '${resource}';
    globalThis.fetch = async (input, options) => {
      if (options.method !== 'GET' || options.body !== undefined) throw Error('mutation_detected');
      const url = new URL(input);
      if (url.origin !== 'https://firestore.googleapis.com') throw Error('unexpected_endpoint');
      if (url.pathname.endsWith('/indexes')) {
        const offset = Number(url.searchParams.get('pageToken') || 0);
        const indexes = manifest.indexes.slice(offset,offset+100).map((entry,i) => ({...entry,name:resource+'/collectionGroups/'+entry.collectionGroup+'/indexes/i'+(offset+i),state:offset+i===0?(process.env.SITE_TEST_INDEX_STATE || 'READY'):'READY'}));
        return Response.json({indexes,...(offset+100<manifest.indexes.length?{nextPageToken:String(offset+100)}:{})});
      }
      const pieces = url.pathname.split('/');
      const entry = manifest.fieldOverrides.find(value=>value.collectionGroup===decodeURIComponent(pieces.at(-3)) && value.fieldPath===decodeURIComponent(pieces.at(-1)));
      if (!entry) throw Error('unexpected_field');
      return Response.json({name:resource+'/collectionGroups/'+entry.collectionGroup+'/fields/'+entry.fieldPath,indexConfig:{usesAncestorConfig:false,indexes:entry.indexes.map(({queryScope,...configuration})=>({queryScope,fields:[{fieldPath:entry.fieldPath,...configuration}],state:'READY'}))}});
    };
  `;
  for (const state of ['READY', 'CREATING']) {
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), 'scripts/firestore-indexes.mjs', '--release-check'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, SITE_ACCESS_TOKEN: 'test-token', SITE_TEST_INDEX_STATE: state }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, state === 'READY' ? 0 : 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.state, state === 'READY' ? 'ready' : 'not_ready');
    assert.equal(report.indexes, 179);
    assert.equal(report.fieldOverrides, 175);
    assert.equal(report.pages, 2);
    assert.equal(report.pending, state === 'READY' ? 0 : 1);
  }
});
