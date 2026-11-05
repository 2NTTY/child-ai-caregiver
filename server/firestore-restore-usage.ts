import { privateSummaryReservationSchema, summaryGrantRecordSchema, privateSummaryAttemptSchema, summaryLineageRecordSchema } from './private-summary-work.ts';
import { firestoreAgentRunSchema } from './firestore-agent-runs.ts';
import { agentBudgetFingerprint } from './agent-budget.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { firestoreUsageRecoverySchemas as usage } from './firestore-ai-usage.ts';
import { firestoreRootBudgetRecoverySchema as budget } from './firestore-root-budget.ts';
import type { FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirebaseBackupDocument } from './firestore-backup.ts';

const envelopeSchema = z.object({ format: z.string(), version: z.literal(1), ciphertext: z.string().min(1) }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function check(ok: boolean) { if (!ok) throw Object.assign(new Error('Restore usage binding rejected'), { code: 'restore_usage_binding', status: 409 }); }
export function isRestoreProtocolOrUsage(namespace: string, path: string) {
  return ['_sessions/', '_adk/', '_root_budget/', '_ai_usage/'].some(suffix => path.startsWith(namespace + suffix));
}
/** Keep spent quota, including operations after the snapshot. Protocol sessions are deliberately not resumed. */
export function restoreFirestoreUsage(options: FirestoreDomainOptions, snapshots: readonly FirebaseBackupDocument[],
  current: readonly FirebaseBackupDocument[], businessRunIds: readonly string[]): FirebaseBackupDocument[] {
  const { cipher, projectId, namespace } = options, roots = new Map(businessRunIds.map(id => [hash(id), id]));
  const records = new Map<string, FirebaseBackupDocument>();
  const open = (row: FirebaseBackupDocument, format: string, aad: string) => {
    const env = envelopeSchema.parse(row.data); check(env.format === format);
    return JSON.parse(cipher.decrypt(env.ciphertext, aad)) as unknown;
  };
  const seal = (path: string, format: string, aad: string, value: unknown) => ({ path,
    data: { format, version: 1, ciphertext: cipher.encrypt(canonical(value), aad) } });
  for (const row of [...snapshots, ...current]) {
    const [collection, id, extra] = row.path.split('/'); if (collection !== namespace + '_ai_usage') continue;
    check(extra === undefined && /^(attempt|daily)_[a-f0-9]{64}$/u.test(id));
    const format = 'yuban-ai-daily-usage', aad = canonical([format, 1, projectId, collection, id]);
    const raw = open(row, format, aad), old = records.get(row.path);
    if (id.startsWith('attempt_')) {
      const value = usage.attempt.parse(raw); check(id === 'attempt_' + hash(canonical([value.request.rootRunId, value.request.attemptKey])));
      roots.set(hash(value.request.rootRunId), value.request.rootRunId);
      if (old) {
        const prior = usage.attempt.parse(open(old, format, aad));
        check(canonical(prior.request) === canonical(value.request) && prior.day === value.day && prior.billingSource === value.billingSource);
        check(!prior.record || !value.record || canonical(prior.record) === canonical(value.record));
        if (prior.record && !value.record) continue;
      }
      records.set(row.path, seal(row.path, format, aad, value));
    } else {
      const value = usage.counter.parse(raw), prior = old ? usage.counter.parse(open(old, format, aad)) : value;
      const merged = Object.fromEntries(Object.keys(value).map(key => [key, Math.max(value[key as keyof typeof value], prior[key as keyof typeof prior])]));
      records.set(row.path, seal(row.path, format, aad, usage.counter.parse(merged)));
    }
  }
  for (const row of [...snapshots, ...current]) {
    const [collection, id, extra] = row.path.split('/'); if (collection !== namespace + '_root_budget') continue;
    check(extra === undefined && /^[a-f0-9]{64}$/u.test(id));
    const rootId = roots.get(id);
    if (rootId === undefined) {
      // Legacy adapter-only budgets have no business run. Preserve their pinned ciphertext, never issue a new admission.
      const saved = envelopeSchema.parse(row.data); check(saved.format === 'yuban-root-budget');
      records.set(row.path, { path: row.path, data: saved }); continue;
    }
    const format = 'yuban-root-budget', aad = JSON.stringify([format, 1, projectId, collection, rootId]);
    const value = budget.parse(open(row, format, aad)), old = records.get(row.path);
    if (old) {
      const prior = budget.parse(open(old, format, aad)); check(prior.bindingFingerprint === value.bindingFingerprint);
      check(value.used.modelCalls >= prior.used.modelCalls && value.used.toolCalls >= prior.used.toolCalls && value.used.queryEmbeddings >= prior.used.queryEmbeddings);
    }
    records.set(row.path, seal(row.path, format, aad, { ...value, status: 'stopped' }));
  }
  return [...records.values()];
}

/** Summary-only integrity gate. It never changes the generic root/daily accounting algorithm. */
export function assertPrivateSummaryProtocolEvidence(options: FirestoreDomainOptions,
  snapshots: readonly FirebaseBackupDocument[], current: readonly FirebaseBackupDocument[], restored: readonly FirebaseBackupDocument[],
  summaryRecords: readonly import('./firestore-restore-codec.ts').FirestoreRestoreDecoded[]): void {
  const fail = () => { throw Object.assign(new Error('Restore summary protocol evidence rejected'), { code: 'restore_summary_protocol_evidence', status: 409 }); };
  const require: (ok: unknown) => asserts ok = (ok) => { if (!ok) fail(); };
  const { cipher, projectId, namespace } = options;
  const reservationById = new Map<string, z.infer<typeof privateSummaryReservationSchema>>();
  for (const row of summaryRecords) if (row.context.kind === 'private-summary-reservation') {
    const value = privateSummaryReservationSchema.parse(row.value), prior = reservationById.get(value.reservationId);
    require(!prior || canonical(prior) === canonical(value)); reservationById.set(value.reservationId, value);
  }
  const reservations = [...reservationById.values()];
  const legacyScopes = new Map<string, ReturnType<typeof summaryLineageRecordSchema.parse>['scope']>();
  for (const row of summaryRecords) if (row.context.kind === 'private-summary-lineage') {
    const lineage = summaryLineageRecordSchema.parse(row.value);
    if (lineage.owner.kind !== 'legacy_fast') continue;
    const prior = legacyScopes.get(lineage.owner.runId);
    require(!prior || canonical(prior) === canonical(lineage.scope));
    legacyScopes.set(lineage.owner.runId, lineage.scope);
  }
  const grantRecords = new Map(summaryRecords.filter(row => row.context.kind === 'private-summary-grant').map(row => {
    const value = summaryGrantRecordSchema.parse(row.value); return [value.id, value] as const;
  }));
  const attempts = summaryRecords.filter(row => row.context.kind === 'private-summary-attempt').map(row => privateSummaryAttemptSchema.parse(row.value));
  const runs = summaryRecords.filter(row => row.context.kind === 'agent-run').map(row => firestoreAgentRunSchema.parse(row.value));
  const fastRuns = runs.filter(run => run.summaryFast);
  for (const run of fastRuns) {
    const scope = { ownerUserId: run.ownerUserId, workspaceId: run.workspaceId, childId: run.childId, storageEpoch: run.storageEpoch };
    const prior = legacyScopes.get(run.id); require(!prior || canonical(prior) === canonical(scope)); legacyScopes.set(run.id, scope);
  }
  type Evidence = { kind: 'unsettled' | 'zero_claim' | 'zero_reserved' | 'response' | 'terminal'; attempt: typeof attempts[number];
    model?: Extract<typeof reservations[number], { kind: 'model' }>; tool?: Extract<typeof reservations[number], { kind: 'tool' }> };
  // One classification mirrors the original claim/terminal writers. A receipt is never proof of a missing accounting graph.
  const evidence: Evidence[] = attempts.map(attempt => {
    const receipt = attempt.receipt;
    if (!receipt) return { kind: 'unsettled', attempt };
    const run = runs.find(value => value.id === attempt.runId && canonical(value.summaryEffect ?? null) === canonical(receipt));
    require(run?.result && canonical(run.summaryWork) === canonical(attempt.binding));
    const owned = reservations.filter(value => value.attemptId === attempt.id);
    const model = owned.find((value): value is Extract<typeof value, { kind: 'model' }> => value.kind === 'model');
    const tool = owned.find((value): value is Extract<typeof value, { kind: 'tool' }> => value.kind === 'tool');
    let kind: Evidence['kind'];
    if (receipt.kind === 'superseded' && attempt.modelReservationId === null) {
      require(receipt.reason === 'already_covered' && attempt.plan === null && attempt.rootContext === null && owned.length === 0);
      kind = 'zero_claim';
    } else if (receipt.kind === 'no_effect' && receipt.dispatchOutcome === 'not_dispatched') {
      kind = attempt.modelReservationId === null ? 'zero_claim' : 'zero_reserved';
      require(!tool && (kind === 'zero_claim' ? attempt.plan === null && owned.length === 0 : owned.length === 1));
    } else kind = receipt.kind === 'no_effect' ? 'response' : 'terminal';
    if (kind !== 'zero_claim') {
      require(attempt.plan && attempt.rootContext && model && model.reservationId === attempt.modelReservationId
        && model.runId === run.id && model.workId === attempt.binding.workId && model.grantRecordId === attempt.grantRecordId
        && model.requestFingerprint === attempt.plan.requestFingerprint);
      if (kind === 'response' || kind === 'terminal')
        require(model.originalAttemptKey === 'model:' + agentBudgetFingerprint([run.id, run.trigger, 'first-model']));
    }
    if (kind === 'terminal') require(model && tool && owned.length === 2 && tool.units === 1 && tool.runId === run.id
      && tool.workId === attempt.binding.workId && tool.grantRecordId === attempt.grantRecordId
      && tool.originalAttemptKey === model.originalAttemptKey + ':tool-batch');
    else require(!tool && owned.length === (kind === 'zero_claim' ? 0 : 1));
    const counts = { modelCalls: kind === 'response' || kind === 'terminal' ? 1 : 0, toolCalls: kind === 'terminal' ? 1 : 0, queryEmbeddings: 0 };
    const tools = kind === 'terminal' ? [{ name: 'stage_private_summary', status: 'succeeded' }] : [];
    const stopReason = receipt.kind === 'no_effect' ? receipt.stopReason : null;
    require(run.state === (receipt.kind === 'no_effect' ? 'stopped' : 'completed') && run.stopReason === stopReason
      && run.result.status === (receipt.kind === 'no_effect' ? 'stopped' : 'completed') && run.result.stopReason === stopReason
      && run.result.countsKnown === true && canonical(run.result.counts) === canonical(counts) && canonical(run.result.tools) === canonical(tools));
    const grant = grantRecords.get(attempt.grantRecordId); require(grant);
    require(canonical(run.result.provenance) === canonical(attempt.rootContext
      ? { packVersion: grant.grant.promptPackVersion, recipeId: 'memory-refresh', model: grant.grant.model } : null));
    return { kind, attempt, model, tool };
  });
  if (!reservations.length && !legacyScopes.size && !evidence.length) return;
  const requiredRunIds = new Set(evidence.filter(value => ['zero_reserved', 'response', 'terminal'].includes(value.kind)).map(value => value.attempt.runId));
  for (const run of fastRuns) if (run.summaryFast!.noDispatch) requiredRunIds.add(run.id);
  const runIds = new Set([...reservations.map(value => value.runId), ...legacyScopes.keys(), ...attempts.map(value => value.runId)]);
  const decodedRoot = (row: FirebaseBackupDocument, runId: string) => {
    const env = envelopeSchema.parse(row.data); require(env.format === 'yuban-root-budget');
    const collection = namespace + '_root_budget';
    const value = budget.parse(JSON.parse(cipher.decrypt(env.ciphertext, JSON.stringify(['yuban-root-budget', 1, projectId, collection, runId]))));
    const keys = new Set<string>(), used = { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 };
    for (const entry of value.attempts) {
      require(!keys.has(entry.request.key)); keys.add(entry.request.key);
      used[entry.request.kind === 'model' ? 'modelCalls' : entry.request.kind === 'embedding' ? 'queryEmbeddings' : 'toolCalls'] += entry.request.units;
    }
    require(canonical(used) === canonical(value.used));
    for (const key of ['modelCalls', 'toolCalls', 'queryEmbeddings'] as const) require(used[key] <= value.limits[key]);
    for (const attempt of attempts.filter(attempt => attempt.runId === runId && attempt.rootContext !== null)) {
      const context = attempt.rootContext!;
      require(value.bindingFingerprint === hash(canonical(context.binding)) && value.generation === context.generation
        && value.deadlineAtMs === context.binding.deadlineAtMs && canonical(value.limits) === canonical(context.binding.limits));
    }
    for (const run of fastRuns.filter(run => run.id === runId && run.summaryFast!.rootContext)) {
      const context = run.summaryFast!.rootContext!;
      require(value.bindingFingerprint === hash(canonical(context.binding)) && value.generation === context.generation
        && value.deadlineAtMs === context.binding.deadlineAtMs && canonical(value.limits) === canonical(context.binding.limits));
    }
    return value;
  };
  for (const runId of runIds) {
    const path = namespace + '_root_budget/' + hash(runId), sources = [...snapshots, ...current].filter(row => row.path === path);
    if (!sources.length) {
      require(!requiredRunIds.has(runId));
      continue; // An unsettled T2 reservation may precede root initialization; its spent work reservation remains.
    }
    const output = restored.find(row => row.path === path); require(output);
    const target = decodedRoot(output!, runId); require(target.status === 'stopped');
    for (const run of fastRuns.filter(run => run.id === runId && run.summaryFast!.noDispatch)) {
      const fast = run.summaryFast!; require(fast.rootContext && !fast.selected);
      const originalRoots = sources.map(row => decodedRoot(row, runId));
      require(originalRoots.every(value => value.attempts.length === 0
        && canonical(value.used) === canonical({ modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 })));
      require(originalRoots.some(value => value.status === 'stopped' && fast.noDispatch!.evidenceId === agentBudgetFingerprint({
        format: 'private-summary-fast-no-dispatch/v1', runId: run.id,
        scope: { ownerUserId: run.ownerUserId, workspaceId: run.workspaceId, childId: run.childId, storageEpoch: run.storageEpoch },
        authorizationVersion: run.authorizationVersion, workerGeneration: run.workerGeneration, trigger: run.trigger,
        target: fast.target, lineageKey: fast.lineageKey, manifestHash: fast.manifestHash, candidate: fast.candidate,
        rootContextFingerprint: agentBudgetFingerprint(fast.rootContext),
        root: { generation: value.generation, deadlineAtMs: value.deadlineAtMs, limits: value.limits, used: value.used, status: value.status, attempts: [] },
        reason: 'input_limit' })));
    }
    for (const proof of evidence) if (proof.attempt.runId === runId && proof.kind !== 'unsettled') {
      const dispatched = proof.kind === 'response' || proof.kind === 'terminal';
      const expected = { modelCalls: dispatched ? 1 : 0, toolCalls: proof.kind === 'terminal' ? 1 : 0, queryEmbeddings: 0 };
      require(canonical(target.used) === canonical(expected) && target.attempts.length === (proof.kind === 'terminal' ? 2 : dispatched ? 1 : 0));
      for (const reservation of dispatched ? [proof.model!, ...(proof.tool ? [proof.tool] : [])] : [])
        require(target.attempts.some(entry => entry.request.key === reservation.originalAttemptKey
          && entry.request.fingerprint === reservation.requestFingerprint && entry.request.units === reservation.units
          && entry.request.kind === (reservation.kind === 'model' ? 'model' : 'tool_batch')));
    }
    const original = new Map<string, typeof target.attempts[number]>();
    for (const row of sources) {
      const value = decodedRoot(row, runId);
      require(canonical([value.bindingFingerprint, value.generation, value.deadlineAtMs, value.limits])
        === canonical([target.bindingFingerprint, target.generation, target.deadlineAtMs, target.limits]));
      for (const entry of value.attempts) {
        const prior = original.get(entry.request.key);
        if (prior) {
          require(canonical(prior.request) === canonical(entry.request));
          if (prior.outcome.status === 'known' && entry.outcome.status === 'known') require(canonical(prior.outcome) === canonical(entry.outcome));
          if (prior.outcome.status === 'known' || prior.outcome.status === 'unknown' && entry.outcome.status === 'reserved') continue;
        }
        original.set(entry.request.key, entry);
      }
    }
    for (const entry of original.values()) {
      const saved = target.attempts.find(candidate => candidate.request.key === entry.request.key);
      require(saved && canonical(saved.request) === canonical(entry.request));
      if (entry.outcome.status === 'known') require(saved!.outcome.status === 'known' && canonical(saved!.outcome) === canonical(entry.outcome));
      if (entry.outcome.status === 'unknown') require(saved!.outcome.status !== 'reserved');
    }
  }
  const dailyCollection = namespace + '_ai_usage';
  const openDaily = (row: FirebaseBackupDocument) => {
    const id = row.path.split('/')[1]!, env = envelopeSchema.parse(row.data); require(env.format === 'yuban-ai-daily-usage');
    return JSON.parse(cipher.decrypt(env.ciphertext, canonical(['yuban-ai-daily-usage', 1, projectId, dailyCollection, id]))) as unknown;
  };
  const dailyAttempts = restored.filter(row => row.path.startsWith(dailyCollection + '/attempt_')).map(row => ({ row, value: usage.attempt.parse(openDaily(row)) }));
  for (const run of fastRuns) if (run.summaryFast!.noDispatch)
    require(!dailyAttempts.some(row => row.value.request.rootRunId === run.id));
  for (const proof of evidence) if (proof.kind !== 'unsettled') {
    if (proof.kind === 'zero_claim' || proof.kind === 'zero_reserved') {
      require(!dailyAttempts.some(row => row.value.request.rootRunId === proof.attempt.runId));
    } else {
      const model = proof.model!, path = dailyCollection + '/attempt_' + hash(canonical([model.runId, model.originalAttemptKey]));
      const daily = dailyAttempts.find(row => row.row.path === path)?.value;
      require(daily && canonical(daily.request) === canonical(model.originalDailyRequest) && daily.record?.outcome === 'succeeded');
    }
  }
  const touched = new Set<string>();
  for (const { value } of dailyAttempts) {
    const scope = legacyScopes.get(value.request.rootRunId);
    if (!scope) continue;
    require(value.request.userId === scope.ownerUserId && value.request.childId === scope.childId);
    for (const userId of [null, value.request.userId]) touched.add(canonical([value.billingSource, value.day, userId]));
  }
  for (const reservation of reservations) if (reservation.kind === 'model') {
    const path = dailyCollection + '/attempt_' + hash(canonical([reservation.runId, reservation.originalAttemptKey]));
    const daily = dailyAttempts.find(row => row.row.path === path)?.value;
    if (!daily) continue; // Only unsettled T2 or accounting-only history may lack a daily admission.
    const grant = grantRecords.get(reservation.grantRecordId); require(grant);
    require(canonical(daily.request) === canonical(reservation.originalDailyRequest) && daily.billingSource === grant!.grant.billingSource);
    for (const userId of [null, daily.request.userId]) touched.add(canonical([daily.billingSource, daily.day, userId]));
  }
  for (const key of touched) {
    const [billingSource, day, userId] = JSON.parse(key) as [string, string, string | null];
    const path = dailyCollection + '/daily_' + hash(canonical([billingSource, day, userId])), row = restored.find(row => row.path === path); require(row);
    const actual = usage.counter.parse(openDaily(row!)), lower = { attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 };
    for (const { value } of dailyAttempts) if (value.billingSource === billingSource && value.day === day && (userId === null || value.request.userId === userId)) {
      lower.attempts++;
      const record = value.record; if (!record) continue;
      lower.inputTokens += record.inputTokens ?? 0;
      if (record.kind === 'embedding') { if (record.inputTokens !== null && record.billableCharacters !== null) lower.known++; }
      else {
        lower.outputTokens += record.outputTokens ?? 0; lower.cachedTokens += record.cachedTokens ?? 0;
        if (record.inputTokens !== null && record.outputTokens !== null && record.cachedTokens !== null) lower.known++;
      }
    }
    for (const field of ['attempts', 'inputTokens', 'outputTokens', 'cachedTokens', 'known'] as const) require(actual[field] >= lower[field]);
  }
}
