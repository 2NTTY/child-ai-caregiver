import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import { createStorageCipher, type StorageCipher } from '../server/storage-crypto.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { sealRecoveryLocator, openRecoveryEnvelope, FirestoreRecoveryEnvelopeError, type FirestoreRecoveryContext,
  type FirestoreRecoveryEnvelopeIdentity } from '../server/firestore-recovery-envelope.ts';
import { workRecoveryAad, type WorkRecoveryKind, type WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { canonicalJson } from '../server/online-routing.ts';
import { canonical } from '../server/firestore-session-codec.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const projectId = 'synthetic-recovery-project', namespace = 'synthetic_recovery';
const scope: WorkRecoveryScope = { ownerUserId: 'private-owner@example.test', workspaceId: '00000000-0000-4000-8000-000000000001',
  childId: '00000000-0000-4000-8000-000000000002', storageEpoch: '00000000-0000-4000-8000-000000000003' };
const NIL = '00000000-0000-0000-0000-000000000000', value = { text: 'Private original body', count: 7 };
const valueSchema = z.object({ text: z.string(), count: z.number().int() }).strict();
const cipher = createStorageCipher(Buffer.alloc(32, 87)), options = { cipher, projectId, namespace };
const snapshot = (envelope: unknown) => ({ exists: true, data: () => envelope }) as DocumentSnapshot;
const rejects = (code: string) => (error: any) => error?.code === code;
function domain(kind = 'task', id = 'private-operation@example.test', recordVersion = 7) {
  const context: FirestoreRecoveryContext = { family: 'domain', kind, id, scope, envelopeVersion: 1, recordVersion,
    aad: canonicalJson(['yuban-firestore-domain', 1, projectId, namespace, kind, id, scope, recordVersion]) };
  const ciphertext = cipher.encrypt(canonicalJson(value), context.aad), envelope: FirestoreRecoveryEnvelopeIdentity = { family: 'domain', version: 1, recordVersion, ciphertext };
  return { context, envelope, locator: sealRecoveryLocator({ ...options, ciphertext, context }) };
}
function authorityAad(kind: string, id: string, currentScope: WorkRecoveryScope, version: 1 | 2) {
  if (!kind.startsWith('authority-')) return workRecoveryAad(projectId, namespace, kind as WorkRecoveryKind | 'daily', id, currentScope, version);
  const binding = kind === 'authority-invitation' ? null
    : kind === 'authority-identity' || kind === 'authority-owner' || kind === 'authority-operation' && currentScope.childId === NIL
      ? { ownerUserId: currentScope.ownerUserId } : currentScope;
  return JSON.stringify(['yuban-work-recovery', 2, projectId, namespace, kind, id, binding]);
}
function locatorAad(ciphertext: string) { return canonicalJson(['yuban-recovery-locator', 1, projectId, namespace,
  createHash('sha256').update(ciphertext, 'utf8').digest('hex')]); }

test('recovery locator uses real AES and domain roundtrip preserves original AAD, ordinary caller scope and legacy reads', () => {
  const calls: { text: string; aad: string }[] = [], tracked: StorageCipher = { decrypt: cipher.decrypt,
    encrypt(text, aad) { calls.push({ text, aad }); return cipher.encrypt(text, aad); } };
  const data = new FirestoreDomainData({ ...options, cipher: tracked, database: firestoreDomainFixture().database });
  for (const kind of ['task', 'document-operation', 'synthetic-local-kind']) {
    const expected = domain(kind), envelope = data.seal(kind, expected.context.id, scope, valueSchema, value, 7);
    assert.equal(envelope.format, 'yuban-firestore-domain'); assert.equal(envelope.version, 1); assert.ok(envelope.recovery);
    assert.deepEqual(calls.at(-2), { text: canonicalJson(value), aad: expected.context.aad });
    assert.equal(cipher.decrypt(envelope.ciphertext, expected.context.aad), canonicalJson(value));
    const recovered = openRecoveryEnvelope({ ...options, envelope: { family: 'domain', version: 1, recordVersion: 7, ciphertext: envelope.ciphertext }, locator: envelope.recovery });
    assert.deepEqual(recovered, { context: expected.context, value });
    assert.equal(JSON.stringify(envelope.recovery).includes(scope.ownerUserId), false);
    assert.equal(JSON.stringify(envelope.recovery).includes(value.text), false);
    assert.deepEqual(data.open(kind, expected.context.id, scope, valueSchema, snapshot(envelope)), value);
    assert.throws(() => data.open(kind, expected.context.id, { ...scope, ownerUserId: 'other-private-owner' }, valueSchema, snapshot(envelope)), rejects('invalid_document'));
    const { recovery: _recovery, ...legacy } = envelope;
    assert.deepEqual(data.open(kind, expected.context.id, scope, valueSchema, snapshot(legacy)), value);
    assert.throws(() => openRecoveryEnvelope({ ...options, envelope: { family: 'domain', version: 1, recordVersion: 7, ciphertext: legacy.ciphertext }, locator: undefined }), rejects('recovery_locator_missing'));
  }
});

test('authority recovery locator reconstructs the actual canonical and auxiliary kind/version binding rules', () => {
  const accountScope = { ...scope, workspaceId: NIL, childId: NIL, storageEpoch: NIL };
  const cases: { kind: string; version: 1 | 2; scope?: WorkRecoveryScope }[] = [
    { kind: 'control', version: 1 }, { kind: 'account', version: 1 }, { kind: 'workspace', version: 1 }, { kind: 'child', version: 1 },
    { kind: 'event', version: 1 }, { kind: 'event', version: 2 }, { kind: 'daily', version: 1 },
    { kind: 'authority-invitation', version: 2 }, { kind: 'authority-identity', version: 2 }, { kind: 'authority-owner', version: 2 },
    { kind: 'authority-operation', version: 2, scope: accountScope }, { kind: 'authority-operation', version: 2 },
    { kind: 'authority-child-detail', version: 2 }, { kind: 'authority-work-detail', version: 2 },
  ];
  for (const entry of cases) {
    const context: FirestoreRecoveryContext = { family: 'authority', kind: entry.kind, id: 'private-canonical-id', scope: entry.scope ?? scope,
      envelopeVersion: entry.version, aad: authorityAad(entry.kind, 'private-canonical-id', entry.scope ?? scope, entry.version) };
    const ciphertext = cipher.encrypt(canonical(value), context.aad), locator = sealRecoveryLocator({ ...options, ciphertext, context });
    assert.deepEqual(openRecoveryEnvelope({ ...options, envelope: { family: 'authority', version: entry.version, ciphertext }, locator }), { context, value });
  }
  for (const [kind, version] of [['child', 2], ['daily', 2], ['authority-owner', 1], ['authority-unknown', 2]] as const) {
    const context: FirestoreRecoveryContext = { family: 'authority', kind, id: 'private-canonical-id', scope, envelopeVersion: version,
      aad: authorityAad(kind, 'private-canonical-id', scope, version) };
    const ciphertext = cipher.encrypt(canonical(value), context.aad);
    assert.throws(() => sealRecoveryLocator({ ...options, ciphertext, context }), rejects('recovery_binding'));
    const locator = { format: 'yuban-recovery-locator', version: 1, ciphertext: cipher.encrypt(canonicalJson(context), locatorAad(ciphertext)) };
    assert.throws(() => openRecoveryEnvelope({ ...options, envelope: { family: 'authority', version, ciphertext }, locator }), rejects('recovery_binding'));
  }
});

test('recovery rejects locator substitution, changed project/namespace/cipher/version/recordVersion and missing or unknown formats', () => {
  const first = domain(), second = domain('task-revision', 'another-private-id', 8);
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: first.envelope, locator: second.locator }), rejects('recovery_locator_ciphertext'));
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: second.envelope, locator: first.locator }), rejects('recovery_locator_ciphertext'));
  for (const patch of [{ projectId: 'different-project' }, { namespace: 'different_namespace' }]) {
    assert.throws(() => openRecoveryEnvelope({ ...options, ...patch, envelope: first.envelope, locator: first.locator }), rejects('recovery_locator_ciphertext'));
  }
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: { ...first.envelope, ciphertext: first.envelope.ciphertext.slice(0, -4) + 'AAAA' }, locator: first.locator }), rejects('recovery_locator_ciphertext'));
  for (const envelope of [{ ...first.envelope, version: 2 }, { ...first.envelope, recordVersion: 8 }, { ...first.envelope, family: 'authority' },
    { ...first.envelope, recordVersion: undefined }]) {
    assert.throws(() => openRecoveryEnvelope({ ...options, envelope: envelope as FirestoreRecoveryEnvelopeIdentity, locator: first.locator }), rejects('recovery_binding'));
  }
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: first.envelope, locator: null }), rejects('recovery_locator_missing'));
  for (const locator of [{ ...first.locator, format: 'unknown' }, { ...first.locator, version: 2 }, { ...first.locator, plaintext: 'unexpected' }, {}]) {
    assert.throws(() => openRecoveryEnvelope({ ...options, envelope: first.envelope, locator }), rejects('recovery_locator_invalid'));
  }
  const changedScope = { ...first.context, scope: { ...scope, childId: '00000000-0000-4000-8000-000000000099' } };
  const forged = { ...first.locator, ciphertext: cipher.encrypt(canonicalJson(changedScope), locatorAad(first.envelope.ciphertext)) };
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: first.envelope, locator: forged }), rejects('recovery_binding'));
  const wrongVersion = { ...first.context, recordVersion: 8, aad: domain('task', first.context.id, 8).context.aad };
  const wrongVersionLocator = { ...first.locator, ciphertext: cipher.encrypt(canonicalJson(wrongVersion), locatorAad(first.envelope.ciphertext)) };
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: { ...first.envelope, recordVersion: 8 }, locator: wrongVersionLocator }), rejects('recovery_ciphertext'));
  const nonJson = cipher.encrypt('not JSON', first.context.aad), locator = sealRecoveryLocator({ ...options, ciphertext: nonJson, context: first.context });
  assert.throws(() => openRecoveryEnvelope({ ...options, envelope: { ...first.envelope, ciphertext: nonJson }, locator }), rejects('recovery_ciphertext'));
  try { openRecoveryEnvelope({ ...options, envelope: first.envelope, locator: second.locator }); assert.fail('Expected rejection'); }
  catch (error) {
    assert.ok(error instanceof FirestoreRecoveryEnvelopeError);
    assert.equal(JSON.stringify({ code: error.code, message: error.message, stack: error.stack }).includes(value.text), false);
    assert.equal(error.message.includes(first.envelope.ciphertext), false); assert.equal(error.message.includes(scope.ownerUserId), false);
  }
});

test('domain seal includes locator in the final byte bound and retains the existing document-too-large error', () => {
  const maximum = 384 * 1024, fake = firestoreDomainFixture();
  // A synthetic cipher isolates byte accounting; authentication behavior above uses real AES exclusively.
  const padded: StorageCipher = { decrypt: cipher.decrypt, encrypt(text, aad) {
    return aad.startsWith('["yuban-recovery-locator"') ? cipher.encrypt(text, aad) : 'x'.repeat(maximum - 100);
  } };
  const data = new FirestoreDomainData({ ...options, cipher: padded, database: fake.database });
  assert.throws(() => data.seal('task', 'private-operation', scope, valueSchema, value), (error: any) => error?.code === 'document_too_large' && error.status === 413);
  const real = new FirestoreDomainData({ ...options, database: fake.database });
  assert.throws(() => real.seal('task', 'private-operation', scope, valueSchema, { ...value, text: 'x'.repeat(192 * 1024) }), rejects('document_too_large'));
  const tooLong = domain(); assert.throws(() => sealRecoveryLocator({ ...options, ciphertext: tooLong.envelope.ciphertext,
    context: { ...tooLong.context, id: 'x'.repeat(2049) } }), rejects('recovery_context_invalid'));
});
