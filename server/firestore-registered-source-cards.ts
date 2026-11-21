import { randomUUID } from 'node:crypto';
import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { registeredSourceCommandSchema, registeredSourceResultSchema, sourceAccessGate,
  type RegisteredSourceCard, type RegisteredSourceResult } from '../src/shared/registered-source-card.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthority, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { sourceCardScope } from './source-card-page.ts';
import { applyReadingReport, type SourceReadingReport } from './source-reading-evidence.ts';
import { sourceCardRecord, sourceCredentialCommand, sourceCredentialRecord, sourceOperationRecord,
  sourceRecordId, sourceCardId, sourceRevision, sourceCardMetadata, sourceListTag, type SourceRecord, type LiveSource } from './registered-source-records.ts';

export interface SourceCheckCandidate { ownerUserId: string; cardId: string; revision: number }
export interface RegisteredSourceJob extends SourceCheckCandidate {
  checkId: string; leaseToken: string; url: string; kind: RegisteredSourceCard['kind']; allowedPath?: string; credentialRef: string | null;
}
const LEASE_MS = 15 * 60000;
const iso = (time: number) => new Date(time).toISOString();
const id = (value: unknown) => domainParse(z.uuid(), value);
const view = (row: SourceRecord | null): RegisteredSourceCard | null =>
  row && !row.removed ? { ...row.card, checking: row.lease !== null } : null;
const expired = (): never => domainReject('source_check_expired');

export function createFirestoreRegisteredSourceCards(options: FirestoreAuthorityOptions & { authority?: Pick<FirestoreAuthority, 'runTransaction'> }) {
  const data = new FirestoreDomainData(options), authority = options.authority ?? createFirestoreAuthority(options);
  const now = options.serverClock ?? Date.now;
  const cardRef = (key: string) => data.ref('source_cards', 'registered-source-card', key);
  const vault = (key: string) => data.ref('source_credentials', 'registered-source-credential', key);
  function decodeCard(binding: FirestoreAuthorityTransaction, key: string, snap: DocumentSnapshot) {
    const row = data.open('registered-source-card', key, binding.scope, sourceCardRecord, snap);
    if (snap.ref.path !== cardRef(key).path || key !== sourceRecordId(binding.scope.ownerUserId, sourceCardId(row))
      || snap.get('recordVersion') !== sourceRevision(row)) domainReject('source_card_binding', 500);
    return row;
  }
  async function read(binding: FirestoreAuthorityTransaction, cardId: string) {
    const key = sourceRecordId(binding.scope.ownerUserId, cardId), snap = await binding.transaction.get(cardRef(key));
    return snap.exists ? decodeCard(binding, key, snap) : null;
  }
  function save(binding: FirestoreAuthorityTransaction, row: SourceRecord) {
    const key = sourceRecordId(binding.scope.ownerUserId, sourceCardId(row));
    binding.transaction.set(cardRef(key), { ...data.tags(binding.scope), ...sourceCardMetadata(binding.scope, row),
      ...data.seal('registered-source-card', key, binding.scope, sourceCardRecord, row, sourceRevision(row)) });
  }
  function deleteCredential(binding: FirestoreAuthorityTransaction, credentialRef: string | null) {
    if (credentialRef) binding.transaction.delete(vault(sourceRecordId(binding.scope.ownerUserId, credentialRef)));
  }
  function get(owner: string, cardId: string) {
    return authority.runTransaction(owner, null, async binding => view(await read(binding, id(cardId))));
  }
  function list(owner: string, cursor: string | null = null) {
    if (cursor !== null) domainParse(z.string().regex(/^[a-f0-9]{64}$/u), cursor, 'invalid_cursor');
    return authority.runTransaction(owner, null, async binding => {
      let query = data.collection('source_cards').where('targetTag', '==', sourceListTag(binding.scope)).orderBy(FieldPath.documentId()).limit(51);
      if (cursor) query = query.startAfter(cursor);
      const rows = await binding.transaction.get(query), items: RegisteredSourceCard[] = [];
      for (const snap of rows.docs.slice(0, 50)) {
        const recovered = recover(snap);
        if (firestoreDomainHash(recovered.scope) !== firestoreDomainHash(binding.scope)) domainReject('source_card_binding', 500);
        const item = view(recovered.row);
        if (!item) domainReject('source_card_binding', 500);
        items.push(item);
      }
      return { items, nextCursor: rows.size > 50 ? rows.docs[49]!.id : null };
    });
  }
  function mutate(owner: string, cardId: string, operationId: string, expectedRevision: number, intent: unknown,
    apply: (binding: FirestoreAuthorityTransaction, current: LiveSource | null) => SourceRecord) {
    const key = sourceRecordId(owner, operationId), opRef = data.ref('source_card_ops', 'registered-source-operation', key);
    // Only the encrypted receipt contains the intent digest, including for credential replacement.
    const digest = firestoreDomainHash(['registered-source-intent/v1', owner, cardId, operationId, intent]);
    return authority.runTransaction(owner, null, async binding => {
      const existing = await binding.transaction.get(opRef), row = await read(binding, cardId);
      if (existing.exists) {
        const receipt = data.open('registered-source-operation', key, binding.scope, sourceOperationRecord, existing);
        if (receipt.cardId !== cardId || receipt.operationId !== operationId || receipt.digest !== digest) domainReject('operation_conflict');
        return { card: view(row) };
      }
      if (row?.removed || !row && expectedRevision !== 0) domainReject('source_card_not_found', 404);
      if ((row ? sourceRevision(row) : 0) !== expectedRevision) domainReject('source_card_changed');
      const updated = apply(binding, row);
      save(binding, updated);
      binding.transaction.create(opRef, { ...data.tags(binding.scope), ...data.seal('registered-source-operation', key,
        binding.scope, sourceOperationRecord, { operationId, cardId, digest }) });
      return { card: view(updated) };
    });
  }
  async function command(owner: string, raw: unknown) {
    const input = domainParse(registeredSourceCommandSchema, raw), { cardId, expectedRevision } = input;
    return mutate(owner, cardId, input.operationId, expectedRevision, input, (binding, row) => {
      const revision = expectedRevision + 1, at = iso(now());
      if (input.action === 'create') return { removed: false, accessRevision: 1, lease: null, finished: null, card: { ...input.settings,
        cardId, revision, enabled: true, credentialRef: null, nextCheckAt: at, lastCheckedAt: null, lastResult: null } };
      if (!row) domainReject('source_card_not_found', 404);
      const card = row.card;
      if (input.action === 'skip_gap') {
        if (!card.gap || card.gap.checkId !== input.checkId) domainReject('source_card_changed');
        return { ...row, card: { ...card, gap: { ...card.gap, skipped: true } } };
      }
      if (input.action === 'suggest_location') {
        if (!card.enabled || card.kind === 'document' || sourceAccessGate.safeParse(card.lastResult?.status).success) domainReject('source_hint_unavailable', 409);
        if (input.checkId !== card.gap?.checkId) domainReject('source_card_changed');
        try { sourceCardScope({ cardId, kind: card.kind, entryUrl: card.url, allowedPath: card.allowedPath })(input.url); }
        catch { domainReject('source_hint_scope', 400); }
        if (card.hint?.status === 'pending' && card.hint.url !== input.url) domainReject('source_hint_pending', 409);
        if (card.hint?.status === 'pending') return row;
        if (card.methods?.length === 8 && !card.methods.some(m => m.url === input.url)) domainReject('source_method_limit', 409);
        return { ...row, card: { ...card, revision: row.lease ? card.revision : revision, nextCheckAt: at, hint: { url: input.url, status: 'pending',
          ...(row.lease ? { afterCheckId: row.lease.checkId } : {}), ...(card.gap ? { checkId: card.gap.checkId, covers: card.gap.url } : {}) } } };
      }
      if (input.action === 'remove') {
        deleteCredential(binding, card.credentialRef);
        return { removed: true, cardId, revision };
      }
      if (input.action === 'check_now' && !card.enabled) domainReject('source_card_paused');
      // A manual request during a live check joins that check instead of restarting ingestion.
      if (input.action === 'check_now' && row.lease) return row;
      if (input.action === 'set_enabled' && input.enabled === card.enabled) return row;
      const enabled = input.action === 'set_enabled' ? input.enabled : card.enabled;
      const { allowedPath, methods, gap, hint, ...base } = card;
      const settings = input.action === 'update' ? input.settings : { ...(allowedPath ? { allowedPath } : {}) };
      const sourceChanged = input.action === 'update' && (input.settings.url !== card.url || input.settings.kind !== card.kind || input.settings.allowedPath !== allowedPath);
      if (sourceChanged) deleteCredential(binding, card.credentialRef);
      const accessRevision = (row.accessRevision ?? 1) + Number(sourceChanged || enabled !== card.enabled);
      return { removed: false, accessRevision, lease: null, finished: null, card: { ...base, ...settings, revision, enabled,
        ...(!sourceChanged && enabled ? { ...(methods ? { methods } : {}), ...(gap ? { gap } : {}), ...(hint ? { hint } : {}) } : {}),
        credentialRef: sourceChanged ? null : card.credentialRef,
        ...(sourceChanged ? { lastResult: null, lastCheckedAt: null } : {}),
        nextCheckAt: enabled && (input.action !== 'update' || sourceChanged || card.nextCheckAt !== null) ? at : null } };
    });
  }
  async function credential(owner: string, rawId: string, raw: unknown) {
    const cardId = id(rawId), input = domainParse(sourceCredentialCommand, raw);
    return mutate(owner, cardId, input.operationId, input.expectedRevision, ['credential', input], (binding, row) => {
      if (!row) domainReject('source_card_not_found', 404);
      const card = row.card, credentialRef = input.action === 'replace' ? randomUUID() : null;
      deleteCredential(binding, card.credentialRef);
      if (input.action === 'replace' && credentialRef) {
        const key = sourceRecordId(owner, credentialRef), origin = new URL(card.url).origin, loginUrl = input.loginUrl ?? card.url;
        if (new URL(loginUrl).origin !== origin) domainReject('source_login_origin', 400);
        binding.transaction.create(vault(key), { ...data.tags(binding.scope), ...data.seal('registered-source-credential', key,
          binding.scope, sourceCredentialRecord, { cardId, credentialRef, origin, loginUrl, username: input.username, password: input.password }) });
      }
      const { methods, gap, hint, ...settings } = card;
      return { removed: false, accessRevision: (row.accessRevision ?? 1) + 1, lease: null, finished: null, card: { ...settings, revision: card.revision + 1,
        credentialRef, nextCheckAt: card.enabled ? iso(now()) : null } };
    });
  }
  function recover(snap: DocumentSnapshot) {
    const raw = snap.data()!;
    const { context, value } = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const row = domainParse(sourceCardRecord, value, 'source_card_binding', 500), ownerUserId = context.scope.ownerUserId;
    const cardId = sourceCardId(row), revision = sourceRevision(row), key = sourceRecordId(ownerUserId, cardId);
    if (context.kind !== 'registered-source-card' || context.id !== key || cardRef(key).path !== snap.ref.path || revision !== context.recordVersion)
      domainReject('source_card_binding', 500);
    return { candidate: { ownerUserId, cardId, revision }, scope: context.scope, row };
  }
  async function due(limit = 50) {
    domainParse(z.int().positive().max(1000), limit);
    const query = data.collection('source_cards').where('dueAt', '<=', iso(now())).orderBy('dueAt').limit(limit);
    const result = await options.database.runTransaction(tx => tx.get(query), { readOnly: true });
    return result.docs.map(snap => recover(snap).candidate);
  }
  function jobFor(ownerUserId: string, row: LiveSource): RegisteredSourceJob {
    const { cardId, revision, url, kind, allowedPath, credentialRef } = row.card;
    return { ownerUserId, cardId, revision, url, kind, ...(allowedPath ? { allowedPath } : {}), credentialRef, checkId: row.lease!.checkId, leaseToken: row.lease!.token };
  }
  async function claim(candidate: SourceCheckCandidate) {
    try {
      return await authority.runTransaction(candidate.ownerUserId, null, async binding => {
        const row = await read(binding, id(candidate.cardId)), time = now();
        if (!row || row.removed || !row.card.enabled || row.card.revision !== candidate.revision || !row.card.nextCheckAt
          || Date.parse(row.card.nextCheckAt) > time || row.lease && Date.parse(row.lease.until) > time) return null;
        const resumeId = row.card.hint?.status === 'pending' ? row.card.hint.checkId : undefined;
        const lease = { checkId: row.lease?.checkId ?? resumeId ?? randomUUID(), token: randomUUID(), until: iso(time + LEASE_MS),
          generation: binding.generation, authorizationVersion: binding.authorizationVersion };
        const next = { ...row, lease };
        save(binding, next);
        return jobFor(candidate.ownerUserId, next);
      });
    } catch (error) {
      if (!(error instanceof FirestoreAuthorityError) || !['account_inactive', 'account_not_ready'].includes(error.code)) throw error;
      // Defer only the dispatch index. A revoked account cannot monopolize a bounded queue page.
      await options.database.runTransaction(async tx => {
        const ref = cardRef(sourceRecordId(candidate.ownerUserId, candidate.cardId)), snap = await tx.get(ref);
        const routingTime = snap.get('dueAt'), time = now();
        if (snap.exists && typeof routingTime === 'string' && Date.parse(routingTime) <= time && snap.get('recordVersion') === candidate.revision)
          tx.update(ref, { dueAt: iso(time + LEASE_MS) });
      });
      return null;
    }
  }
  function checkLease(binding: FirestoreAuthorityTransaction, job: RegisteredSourceJob, row: SourceRecord | null): LiveSource {
    if (!row || row.removed || !row.card.enabled || !row.lease || Date.parse(row.lease.until) <= now()
      || row.lease.generation !== binding.generation || row.lease.authorizationVersion !== binding.authorizationVersion
      || firestoreDomainHash(jobFor(binding.scope.ownerUserId, row)) !== firestoreDomainHash(job)) return expired();
    return row;
  }
  function withCurrentCheck<T>(job: RegisteredSourceJob, run: (binding: FirestoreAuthorityTransaction, accessRevision: number) => Promise<T>) {
    return authority.runTransaction(job.ownerUserId, null, async binding => {
      const row = checkLease(binding, job, await read(binding, id(job.cardId)));
      return run(binding, row.accessRevision ?? 1);
    });
  }
  function credentialFor(job: RegisteredSourceJob) {
    return withCurrentCheck(job, async binding => {
      if (!job.credentialRef) return null;
      const key = sourceRecordId(job.ownerUserId, job.credentialRef), snap = await binding.transaction.get(vault(key));
      if (!snap.exists) return expired();
      const record = data.open('registered-source-credential', key, binding.scope, sourceCredentialRecord, snap);
      if (record.cardId !== job.cardId || record.credentialRef !== job.credentialRef || record.origin !== new URL(job.url).origin
        || new URL(record.loginUrl).origin !== record.origin) return expired();
      return { kind: 'form' as const, origin: record.origin, loginUrl: record.loginUrl, username: record.username, password: record.password };
    });
  }
  function renew(job: RegisteredSourceJob) {
    return authority.runTransaction(job.ownerUserId, null, async binding => {
      const row = checkLease(binding, job, await read(binding, id(job.cardId)));
      save(binding, { ...row, lease: { ...row.lease!, until: iso(now() + LEASE_MS) } });
    });
  }
  function finish(job: RegisteredSourceJob, raw: RegisteredSourceResult, report?: SourceReadingReport) {
    const result = domainParse(registeredSourceResultSchema, raw);
    return authority.runTransaction(job.ownerUserId, null, async binding => {
      const current = await read(binding, id(job.cardId));
      if (current && !current.removed && current.finished?.checkId === job.checkId
        && current.finished.token === job.leaseToken && firestoreDomainHash(current.finished.result) === firestoreDomainHash(result)) return;
      const row = checkLease(binding, job, current), time = now();
      const automatic = ['changed', 'unchanged', 'failed'].includes(result.status);
      const updated = report ? applyReadingReport(row.card, report, job.checkId) : row.card;
      if (updated.hint?.status === 'pending' && updated.hint.afterCheckId === job.checkId) {
        const { afterCheckId, ...hint } = updated.hint;
        updated.hint = hint;
        updated.revision++;
      }
      const nextCheckAt = automatic ? iso(updated.hint?.status === 'pending' ? time : time + row.card.frequencyMinutes * 60000) : null;
      save(binding, { removed: false, accessRevision: (row.accessRevision ?? 1) + Number(!automatic), lease: null, finished: { checkId: job.checkId, token: job.leaseToken, result },
        card: { ...updated, lastCheckedAt: iso(time), lastResult: result, nextCheckAt } });
    });
  }
  return { get, list, command, credential, due, claim, credentialFor, finish, renew, withCurrentCheck };
}
export type FirestoreRegisteredSourceCards = ReturnType<typeof createFirestoreRegisteredSourceCards>;
