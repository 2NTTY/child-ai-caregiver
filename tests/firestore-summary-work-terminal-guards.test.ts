import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryTerminalFixture as fixture } from './helpers/private-summary-terminal.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestorePrivateSummaryWork, type SummaryTerminalVerifier } from '../server/firestore-private-summary-work.ts';
import { privateSummaryAttemptSchema, privateSummaryWorkSchema } from '../server/private-summary-work.ts';
import { workRecoveryDocumentId, workRecoveryAad } from '../server/firestore-work-continuation-recovery.ts';

async function withPart(callback: (f: Awaited<ReturnType<typeof fixture>>, p: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['part']>>) => Promise<void>, failure = false) {
  const f = await fixture();
  await f.withWorkLease(f.work.id, async reference => {
    const p = await f.part(f.work, reference, undefined, failure ? 'failure' : 'terminal'); await f.root.stop(p.context); await callback(f, p);
  });
}

test('original interrupted execution settles after its deadline and lease end without reopening or extending either', async () => {
  const f = await fixture(); let part: Awaited<ReturnType<typeof f.part>> | undefined;
  await f.withWorkLease(f.work.id, async reference => { part = await f.part(f.work, reference); await f.root.stop(part.context); });
  const p = part!, originalDeadline = p.claimed.claim.expiresAt;
  const runs = createFirestoreAgentRuns({ ...f.options, chat: f.chat, memory: f.memory, serverClock: () => Date.parse(originalDeadline) + 1 });
  const interrupted = await runs.result('owner', f.childId, p.input.runId, { async read(_b, _run, result) { return result; } });
  assert.ok(interrupted); assert.equal(interrupted.status, 'unknown'); assert.equal(interrupted.stopReason, 'interrupted');
  const store = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs, policy: f.policy,
    terminalVerifier: f.verifier, serverClock: () => Date.parse(originalDeadline) + 1 });
  const receipt = await store.finishPart(p.finish); assert.equal(receipt.kind, 'published');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const run = await f.runs.read(b, p.input.runId); assert.equal(run.expiresAt, originalDeadline); assert.equal(run.state, 'completed');
  });
  assert.equal((await f.root.read(p.context)).status, 'stopped');
});

test('forged scope and a canceled original run cannot settle even with complete native evidence', async () => {
  await withPart(async (f, p) => {
    for (const scope of [{ ...p.input.scope, workspaceId: randomUUID() }, { ...p.input.scope, authorizationVersion: '999' },
      { ...p.input.scope, dataVersion: randomUUID() + ':1' }])
      await assert.rejects(f.build().finishPart({ ...p.finish, scope }), { code: 'private_summary_authority_changed' });
    await f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, p.input.runId); f.runs.write(b, { ...run, state: 'stopped', stopReason: 'cancelled' });
    });
    const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.build().finishPart(p.finish), { code: 'private_summary_terminal_binding' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('revocation and a changed authoritative worker generation reject domain settlement without reclassifying unknown usage', async () => {
  for (const change of ['revoke', 'generation'] as const) await withPart(async (f, p) => {
    if (change === 'revoke') await f.authority.setAccountState({ userId: 'owner', operationId: randomUUID(), state: 'revoked' });
    else {
      const nil = '00000000-0000-0000-0000-000000000000', scope = { ownerUserId: 'control', workspaceId: nil, storageEpoch: nil, childId: nil };
      const ref = f.options.database.collection(f.options.namespace).doc(workRecoveryDocumentId('control', 'current'));
      const aad = workRecoveryAad(f.options.projectId, f.options.namespace, 'control', 'current', scope);
      const prior = f.fake.records.get(ref.path), value = JSON.parse(f.options.cipher.decrypt(prior.ciphertext, aad));
      // Synthetic administrative epoch change using the original compatible encrypted codec, never a production write.
      f.fake.records.set(ref.path, { format: prior.format, version: prior.version,
        ciphertext: f.options.cipher.encrypt(JSON.stringify({ ...value, generation: randomUUID() }), aad) });
    }
    const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.build().finishPart(p.finish), { code: change === 'revoke' ? 'account_inactive' : 'private_summary_authority_changed' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
    assert.deepEqual((await f.root.read(p.context)).used, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  });
});

test('source changes and deletion after paid observation supersede the old revision without publishing or retaining stale output', async () => {
  for (const change of ['revise', 'delete'] as const) {
    let factId = '', version = 0;
    const values = { key: 'Synthetic preference', content: 'Original', source: { kind: 'manual' as const, description: 'Synthetic' }, validUntil: null };
    const f = await fixture(async f => {
      const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
      const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
      factId = fact.id; version = fact.version;
    });
    await f.withWorkLease(f.work.id, async reference => {
      const p = await f.part(f.work, reference); await f.root.stop(p.context);
      if (change === 'delete') await f.memory.delete('owner', f.childId, 'facts', factId, version);
      else await f.memory.reviseFact('owner', f.childId, factId, { expectedVersion: version, confirm: true, confirmShared: false,
        values: { ...values, content: 'Changed after model observation' }, reason: 'Synthetic correction' });
      const receipt = await f.build().finishPart(p.finish);
      assert.deepEqual(receipt, { kind: 'superseded', reason: 'source_changed', workId: f.work.id, sourceRevision: 1, attemptId: p.input.attemptId });
      const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
      assert.equal(state.work.state, change === 'delete' ? 'suppressed' : 'invalidated'); assert.equal(state.work.activeAttemptId, null);
      assert.equal(state.work.finalReceipt, null); assert.deepEqual(state.work.chain, f.work.chain); assert.equal(attempt.resultText, null);
      assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 1 }); assert.equal(state.work.grantRecordId, f.work.grantRecordId);
      assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 0);
    });
  }
});

test('an observed response proof cannot report no original model reservation count', async () => {
  await withPart(async (f, p) => {
    const verifier: SummaryTerminalVerifier = { async verify(b, input) {
      const proof = await f.verifier.verify(b, input); assert.equal(proof.kind, 'no_effect');
      return proof.kind === 'no_effect' ? { ...proof, counts: { ...proof.counts, modelCalls: 0 } } : proof;
    } };
    const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.build({ terminalVerifier: verifier }).finishPart({ ...p.finish,
      result: { ...p.result, counts: { ...p.result.counts, modelCalls: 0 } } }), { code: 'private_summary_terminal_binding' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
  }, true);
});

test('committed chain digest and published coverage are bound to the original plan and immutable manifest', async () => {
  await withPart(async (f, p) => {
    await f.build().finishPart(p.finish);
    const original = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
    for (const bad of [{ ...original, chainLink: { ...original.chainLink!, next: 'f'.repeat(64) } },
      { ...original, receipt: { ...original.receipt!, coveredMessageIds: [randomUUID()] } }]) {
      await f.authority.runTransaction('owner', f.childId, async b => {
        const run = await f.runs.read(b, p.input.runId);
        f.runs.write(b, { ...run, summaryEffect: bad.receipt! });
        b.transaction.set(f.data.ref('private_summary_attempts', 'private-summary-attempt', original.id), { ...f.data.tags(b.scope),
          ...f.data.seal('private-summary-attempt', original.id, b.scope, privateSummaryAttemptSchema, bad) });
      });
      await assert.rejects(f.build().readAttempt('owner', f.childId, original.id), { code: 'private_summary_chain_binding' });
    }
  });
});

test('restore-suspended work and absent native terminal history cannot be promoted by a repeated finish call', async () => {
  await withPart(async (f, p) => {
    await f.sessions.deleteSession(p.key); const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.build().finishPart(p.finish), { code: 'private_summary_terminal_unknown' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
    const state = await f.build().readState('owner', f.childId, f.work.id);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const work = { ...state.work, version: state.work.version + 1, state: 'restore_suspended' as const };
      b.transaction.set(f.data.ref('private_summary_works', 'private-summary-work', work.id), { ...f.data.tags(b.scope), workState: work.state, completionWakeState: 'none',
        ...f.data.seal('private-summary-work', work.id, b.scope, privateSummaryWorkSchema, work, work.version) });
    });
    await assert.rejects(f.build().finishPart(p.finish), { code: 'private_summary_terminal_binding' });
  });
});

test('competing complete finish requests return one original effect and do not double-count work or summary versions', async () => {
  await withPart(async (f, p) => {
    const results = await Promise.all([f.build().finishPart(p.finish), f.build().finishPart(p.finish)]);
    assert.deepEqual(results[0], results[1]); assert.equal(results[0].kind, 'published');
    assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 1);
    assert.deepEqual((await f.build().readState('owner', f.childId, f.work.id)).usage.used, { modelCalls: 1, toolCalls: 1 });
  });
});
