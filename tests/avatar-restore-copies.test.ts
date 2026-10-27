import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseRestoreApply } from '../server/firebase-restore-apply.ts';
import { sealAvatarRestoreRecord } from '../server/firestore-restore-avatar-codec.ts';
import { firebaseBackupDocumentDigest } from '../server/firestore-backup.ts';
import { avatarRestoreFixture } from './helpers/avatar-restore-memory.ts';
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

test('avatar copy set spans more than 200 entries using bounded scan pages, with no population cap', async () => {
  const f = avatarRestoreFixture(), values = Array.from({ length: 201 }, (_, i) => f.value(i));
  await f.copies.stage(values);
  const inventory = await f.copies.inventory(f.identity, { phase: 'none', ids: new Set() }, () => {});
  assert.equal(inventory.phase, 'copying'); assert.equal(inventory.payloads.length, 201);
  assert.equal(f.objects.size, 0); assert.equal(f.inspections(), 0);
});

test('lost claim reply permits only a confirmed same-invocation write; unreadable or later claims retain the original intent', async () => {
  const confirmed = avatarRestoreFixture(), confirmedValue = confirmed.value(), descriptor = confirmed.stored(confirmedValue);
  await confirmed.copies.stage([confirmedValue]); let confirmedWrites = 0;
  const write = async () => { confirmedWrites++; confirmed.objects.set(descriptor.objectName, descriptor); return descriptor; };
  confirmed.fake.loseReply();
  assert.deepEqual(await confirmed.copies.execute(confirmedValue, write), descriptor);
  assert.deepEqual(await confirmed.copies.execute(confirmedValue, write), descriptor);
  assert.equal(confirmedWrites, 1); assert.equal((await confirmed.copies.freeze(confirmed.identity)).rows.length, 1);

  const f = avatarRestoreFixture(), value = f.value(); await f.copies.stage([value]); let writes = 0;
  const run = f.database.runTransaction.bind(f.database); let transactions = 0;
  f.database.runTransaction = (callback, options) => {
    if (++transactions === 2) return Promise.reject(new Error('Synthetic claim readback unavailable'));
    return run(callback, options);
  };
  f.fake.loseReply(); await assert.rejects(f.copies.execute(value, async () => { writes++; return f.stored(value); }));
  f.database.runTransaction = run;
  assert.equal(writes, 0);
  await assert.rejects(f.copies.execute(value, async () => { writes++; return f.stored(value); }), code('recovery_avatar_copy_unknown'));
  assert.equal(writes, 0); assert.equal((await f.copies.inventory(f.identity, { phase: 'none', ids: new Set() }, () => {})).payloads.length, 1);
  await f.copies.stage([value]); // Does not reset writing to prepared.
  await assert.rejects(f.copies.execute(value, async () => { writes++; return f.stored(value); }), code('recovery_avatar_copy_unknown'));
  assert.equal(writes, 0);
});

test('lost object reply reconciles only exact original address, never repeats copy or changes generation', async () => {
  const f = avatarRestoreFixture(), value = f.value(), descriptor = f.stored(value); await f.copies.stage([value]); let writes = 0;
  f.unavailable(true);
  await assert.rejects(f.copies.execute(value, async () => { writes++; f.objects.set(descriptor.objectName, descriptor); throw new Error('Synthetic lost write reply'); }));
  f.unavailable(false);
  assert.deepEqual(await f.copies.execute(value, async () => { writes++; return descriptor; }), descriptor);
  assert.equal(writes, 1); const frozen = await f.copies.freeze(f.identity);
  assert.equal(frozen.rows.length, 1); assert.equal(frozen.rows[0]!.responsibility.descriptor!.generation, descriptor.generation);
});

test('checkpoint inventory rejects foreign/unsupported partial-final pages before either fast path', async () => {
  const f = avatarRestoreFixture(), value = f.value(); await f.copies.stage([value]);
  f.fake.records.set(f.options.namespace + '_restore_operations/page-' + f.identity + '-0', { unsupported: true });
  await assert.rejects(f.copies.inventory(f.identity, { phase: 'none', ids: new Set() }, () => {}), code('recovery_checkpoint_inventory_unconfirmed'));
  assert.equal(f.objects.size, 0);
});

test('another target bucket/set cannot rewrite or extend an already durable copy set', async () => {
  const f = avatarRestoreFixture(), value = f.value(); await f.copies.stage([value]);
  await assert.rejects(f.copies.stage([{ ...value, targetBucket: 'synthetic-other-bucket' }]), code('recovery_avatar_copy_binding'));
  await assert.rejects(f.copies.stage([value, f.value(2)]), code('recovery_avatar_copy_binding'));
  assert.equal((await f.copies.inventory(f.identity, { phase: 'none', ids: new Set() }, () => {})).payloads.length, 1);
});


test('handoff activates with current before restartable multi-batch retirement; orphan copies retain exact cleanup', async () => {
  const f = avatarRestoreFixture(), values = Array.from({ length: 5 }, (_, i) => f.value(i)); await f.copies.stage(values);
  for (const value of values) await f.copies.execute(value, async () => { const descriptor = f.stored(value); f.objects.set(descriptor.objectName, descriptor); return descriptor; });
  const frozen = await f.copies.freeze(f.identity);
  const records = frozen.rows.map(row => sealAvatarRestoreRecord(f.data, 'avatar-cleanup', { ...row.responsibility, reason: 'superseded' }));
  const finalInventory = new Map(records.map(row => [row.path, firebaseBackupDocumentDigest(row).sha256]));
  const apply = createFirebaseRestoreApply(f.options), final = { synthetic: 'exact checkpoint' };
  await apply.stage(f.identity, [], records, [], final);
  let validations = 0;
  await apply.resume(f.identity, async () => {}, async () => {
    validations++; for (const record of records) assert.deepEqual(f.fake.records.get(record.path), record.data);
  }, { prepare: (hash, completed) => f.copies.handoff(frozen, hash, finalInventory, completed),
    activate: (tx, hash) => f.copies.prepareActivation(tx, frozen, hash) });
  assert.equal(validations, 2); assert.equal((await f.copies.inventory(f.identity, await apply.checkpointState(f.identity), () => {})).phase, 'activated');
  f.fake.loseReply(); await assert.rejects(f.copies.retire(f.identity));
  const partial = await f.copies.inventory(f.identity, await apply.checkpointState(f.identity), () => {});
  assert.equal(partial.payloads.length, 3); // Two deletes and durable retirement cursor committed together.
  await f.copies.retire(f.identity);
  assert.deepEqual([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_restore_operations/')),
    [f.options.namespace + '_restore_operations/current']);
  for (const record of records) assert.deepEqual(f.fake.records.get(record.path), record.data);
  assert.equal(f.objects.size, 5); // Only normalized object responsibilities transfer; retirement never deletes live objects.
});

test('whole cleanup-document hash covers forged query metadata and blocks activation without losing intents', async () => {
  const f = avatarRestoreFixture(), value = f.value(); await f.copies.stage([value]);
  await f.copies.execute(value, async () => f.stored(value)); const frozen = await f.copies.freeze(f.identity);
  const cleanup = sealAvatarRestoreRecord(f.data, 'avatar-cleanup', frozen.rows[0]!.responsibility);
  const finalInventory = new Map([[cleanup.path, firebaseBackupDocumentDigest(cleanup).sha256]]), apply = createFirebaseRestoreApply(f.options);
  await apply.stage(f.identity, [], [cleanup], [], { synthetic: 'hash-bound' });
  await assert.rejects(apply.resume(f.identity, async () => {}, async () => {
    const row = f.fake.records.get(cleanup.path); f.fake.records.set(cleanup.path, { ...row, complete: true });
  }, { prepare: (hash, completed) => f.copies.handoff(frozen, hash, finalInventory, completed),
    activate: (tx, hash) => f.copies.prepareActivation(tx, frozen, hash) }), code('recovery_avatar_copy_handoff_missing'));
  assert.equal(f.fake.records.has(f.options.namespace + '_restore_operations/current'), false);
  assert.equal((await f.copies.inventory(f.identity, await apply.checkpointState(f.identity), () => {})).payloads.length, 1);
});

test('a current row cannot bypass copying phase via the existing fast path', async () => {
  const f = avatarRestoreFixture(), value = f.value(); await f.copies.stage([value]);
  f.fake.records.set(f.options.namespace + '_restore_operations/current', { synthetic: 'premature current' });
  const apply = createFirebaseRestoreApply(f.options);
  await assert.rejects(f.copies.inventory(f.identity, await apply.checkpointState(f.identity), () => {}), code('recovery_avatar_copy_phase'));
});
