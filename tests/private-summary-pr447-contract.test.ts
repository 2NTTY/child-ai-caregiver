import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { LlmRequest, Session } from '@google/adk';
import { FinishReason } from '@google/genai';
import { ZodError } from 'zod';
import { summarySaveSchema } from '../server/memory-validation.ts';
import { saveSummary } from '../server/memory-summary.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';
import { privateSummaryRootFixture } from './helpers/private-summary-root.ts';
import { makeSummaryChatSource, summaryManifestSchema, summaryManifestHash, summaryAttemptId } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { createPrivateSummaryPartMaintenance } from '../server/private-summary-part-maintenance.ts';
import { createPrivateSummaryTerminalVerifier } from '../server/private-summary-terminal.ts';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { claimedRunAssembly } from '../server/agent-run-assembly.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { agentRequestCharacters } from '../server/agent-model-gateway.ts';
import { AGENT_LIMITS } from '../server/agent-budget.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { readAiConfig } from '../server/ai-config.ts';

function partial(messageId: string) {
  return { messageId, index: 0, total: 2, isLast: false, sourceHash: 'c'.repeat(64),
    startOffset: 0, endOffset: 1, cumulativeSummary: 'Synthetic first fragment' };
}

test('shared whole-summary validation and the SQL writer reject partial progress before any query', async () => {
  const messageId = randomUUID(), complete = { previousVersion: 0, basis: 'b'.repeat(64),
    text: 'Synthetic completed summary', coveredMessageIds: [messageId] };
  assert.equal(summarySaveSchema.safeParse(complete).success, true);
  const raw = { ...complete, part: partial(messageId) };
  assert.equal(summarySaveSchema.safeParse(raw).success, false);
  let queries = 0;
  const client = { async query() { queries++; throw new Error('Partial progress reached SQL'); } } as unknown as PoolClient;
  await assert.rejects(saveSummary(client, createStorageCipher(Buffer.alloc(32, 41)), 'owner', randomUUID(), raw),
    error => error instanceof ZodError && error.issues.some(issue => issue.code === 'unrecognized_keys'));
  assert.equal(queries, 0);
});

test('the Firestore whole-summary writer refuses partial progress without changing head or covering another message', async () => {
  const f = await privateSummaryFixture();
  const first = (await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic first original'))!;
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic second original never supplied to a partial fold'))!;
  const input = (await f.memory.prepareSummary('owner', f.childId))!;
  const before = JSON.stringify([...f.fake.records]);
  await assert.rejects(f.memory.saveSummary('owner', f.childId, { previousVersion: input.previousVersion, basis: input.basis,
    text: 'Synthetic first fragment', coveredMessageIds: [first.id, second.id], part: partial(first.id) }), { code: 'invalid_input' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
  assert.equal((await f.memory.summary('owner', f.childId))!.summary, null);
  assert.deepEqual((await f.memory.prepareSummary('owner', f.childId))!.messages.map(message => message.id), [first.id, second.id]);
});

test('a fresh manifest cannot add a second covered ID even when its ordered complete source unit is also supplied', async () => {
  const f = await privateSummaryFixture();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic first original');
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic second original'))!;
  const selected = await f.select(), original = selected.revision.manifest;
  assert.equal(summaryManifestSchema.safeParse(original).success, true);
  const nextKey = (BigInt(original.units[0].kind === 'chat_text' ? original.units[0].sortKey : '0') + 1n).toString().padStart(19, '0');
  const extra = makeSummaryChatSource(second, nextKey).source;
  const forged = { ...original, coveredMessageIds: [...original.coveredMessageIds, second.id], units: [...original.units, extra] };
  assert.equal(summaryManifestSchema.safeParse(forged).success, false);
  assert.throws(() => summaryManifestHash(forged as typeof original), ZodError);
  const before = JSON.stringify([...f.fake.records]);
  await assert.rejects(f.revalidate({ ...selected.revision, manifest: forged as typeof original,
    manifestHash: firestoreDomainHash(forged) }), { code: 'invalid_input' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('the actual durable Runner completes maximum escaped owner metadata and accumulator using one original synthetic grant', async () => {
  const userId = '\u0001'.repeat(256), original = '"'.repeat(4853) + '\u0001'.repeat(5147);
  assert.equal([...original].length, 10000);
  const f = await privateSummaryRootFixture(original, userId);
  // A fixture-only whole-work policy is fixed before admission, never renewed to hide exhaustion.
  f.grant.limits = { modelCalls: 32, toolCalls: 32 };
  const prompt = await loadAgentPrompt('memory-refresh', 'tool_cycle',
    ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract']);
  f.grant.promptPackVersion = prompt.packVersion; f.profile.promptPackVersion = prompt.packVersion;
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const policy = { ...f.policy, async resolveNextPartDueAt() { return { kind: 'due' as const, dueAt }; } };
  await f.barrier();
  const initial = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy });
  const started = await initial.start(userId, f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected original work');
  await f.saveProfile(started.work.grantRecordId);
  const fragments: { text: string; range: { startUtf16: number; endUtf16: number }; accumulator: string | null }[] = [];
  const requests: LlmRequest[] = [], outputLimits: number[] = [];
  let cleanups = 0;
  for (let step = 0; step < f.grant.limits.modelCalls; step++) {
    const prior = await initial.readState(userId, f.childId, started.work.id);
    if (prior.work.state === 'completed') break;
    const attemptId = summaryAttemptId({ workId: prior.work.id, sourceRevision: prior.work.sourceRevision,
      step: prior.work.chain.committedParts, attempt: prior.work.nextAttempt });
    const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_summary_root' });
    const daily = new FirestoreAiUsage({ ...f.options, namespace: 'synthetic_summary_daily', billingSource: 'platform' });
    let work!: ReturnType<typeof createFirestorePrivateSummaryWork>;
    class ObservedSessions extends FirestoreSessionService {
      override async cleanupCreatedSession(session: Session) {
        assert.ok(await work.readEffect(userId, f.childId, attemptId), 'Commit the original effect before native cleanup');
        cleanups++; return super.cleanupCreatedSession(session);
      }
    }
    const sessions = new ObservedSessions({ ...f.options, namespace: 'synthetic_summary_session' });
    work = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy,
      terminalVerifier: createPrivateSummaryTerminalVerifier({ root, daily, sessions }) });
    const config = readAiConfig(f.profile.env);
    const assembly = claimedRunAssembly(config, { nativeSessionService: sessions, rootBudget: root, dailyUsage: daily,
      profile: { ...f.profile, config } }, null, false, false, true);
    const runtime = createAgentRuntime({ ...assembly, config, usage: {
      async reserve() { throw new Error('Legacy quota path is forbidden'); }, async record() { throw new Error('Legacy quota path is forbidden'); },
    }, provider: { async generate(request) {
      assert.ok(agentRequestCharacters(request) <= AGENT_LIMITS.inputCharacters, 'The full outgoing native request must fit');
      assert.ok(JSON.stringify(request.config?.systemInstruction).includes(JSON.stringify(JSON.stringify(userId).slice(1, -1)).slice(1, -1)),
        'The actual Runner request must retain the legal maximum escaped owner metadata');
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      const payload = JSON.parse(request.contents[0].parts![0].text!);
      fragments.push(payload.fragment); outputLimits.push(payload.outputTextLimit);
      assert.equal(payload.fragment.text, original.slice(payload.fragment.range.startUtf16, payload.fragment.range.endUtf16));
      assert.equal(payload.fragment.accumulator, prior.work.accumulator?.text ?? null);
      assert.ok(payload.outputTextLimit > 0);
      if (step > 0) assert.equal(payload.fragment.accumulator, '\u0001'.repeat(outputLimits[step - 1]));
      return { content: { role: 'model', parts: [{ functionCall: { id: `synthetic-stage-${step}`, name: 'stage_private_summary',
        args: { text: '\u0001'.repeat(payload.outputTextLimit) } } }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
    const maintain = createPrivateSummaryPartMaintenance({ ...f.options, memory: f.memory, work, root, runtime });
    await f.withWorkLease(prior.work.id, async reference => {
      const result = await maintain({ userId, childId: f.childId, workId: prior.work.id, reference, authorize: async () => true });
      assert.equal(result.state, 'completed', JSON.stringify(result));
      assert.ok(result.receipt);
      const current = await work.readState(userId, f.childId, prior.work.id);
      assert.equal(current.work.id, started.work.id); assert.equal(current.work.grantRecordId, started.work.grantRecordId);
      assert.deepEqual(current.usage.used, { modelCalls: step + 1, toolCalls: step + 1 });
      assert.equal(current.work.chain.committedParts, step + 1);
      if (result.receipt.kind === 'part_committed') assert.equal((await f.memory.summary(userId, f.childId))!.summary, null);
    });
  }
  const final = await initial.readState(userId, f.childId, started.work.id);
  assert.equal(final.work.state, 'completed'); assert.equal(final.work.finalReceipt?.kind, 'published');
  assert.ok(requests.length > 1, 'This exact legal metadata/source case must genuinely continue across durable parts');
  assert.equal(fragments.map(fragment => fragment.text).join(''), original);
  assert.equal(fragments[0].range.startUtf16, 0);
  for (let index = 1; index < fragments.length; index++) assert.equal(fragments[index].range.startUtf16, fragments[index - 1].range.endUtf16);
  assert.equal(fragments.at(-1)!.range.endUtf16, original.length);
  assert.equal(f.resolutions(), 1); assert.equal(cleanups, requests.length);
  assert.deepEqual((await f.memory.summary(userId, f.childId))!.summary!.coveredMessageIds, [f.message.id]);
  assert.equal(await f.memory.prepareMaintenance(userId, f.childId), null);
});
