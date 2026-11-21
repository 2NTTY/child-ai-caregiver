import { z } from 'zod';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { domainReject, FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreRegisteredSourceCards, RegisteredSourceJob } from './firestore-registered-source-cards.ts';
import type { createFirestoreSourceCardDocuments } from './firestore-source-card-documents.ts';
import type { acquireSourceCardBatch, SourceCardResult, SourceCardBatchResult, SourceCardAccess, SourceCardInput } from './source-card-acquire.ts';
import { sourceAccessGate, type RegisteredSourceResult } from '../src/shared/registered-source-card.ts';
import type { SourceScanBatch } from './source-card-frontier.ts';

const outcomes = { login: 'needs_login', mfa: 'mfa_required', captcha: 'captcha_required', purchase: 'payment_required' } as const;
type Cards = Pick<FirestoreRegisteredSourceCards, 'due' | 'claim' | 'get' | 'finish' | 'withCurrentCheck' | 'credentialFor' | 'renew'>;
type Documents = Pick<ReturnType<typeof createFirestoreSourceCardDocuments>, 'ingest' | 'checkResult' | 'retryBatch' | 'pruneStaging'>;
type CurrentAuth = (uid: string) => Promise<{ userId: string; disabled: boolean; emailVerified: boolean }>;
type SingleBatch = Extract<SourceCardResult, { status: 'ok' }> & { consumed?: never; next?: never };
type Acquirer = (...args: Parameters<typeof acquireSourceCardBatch>) => Promise<SourceCardBatchResult | SingleBatch>;
const checkBasis = z.tuple([z.int().positive(), z.uuid(), z.uuid()]);

function acquisitionScope(job: Pick<RegisteredSourceJob, 'cardId' | 'url' | 'kind' | 'allowedPath'>): SourceCardInput {
  return { cardId: job.cardId, entryUrl: job.url, kind: job.kind, ...(job.allowedPath ? { allowedPath: job.allowedPath } : {}) };
}
function rejected(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && [403, 404, 409].includes(Number(error.status));
}

export function createRegisteredSourceWorker(options: FirestoreDomainOptions & {
  cards: Cards; documents: Documents; currentAuth: CurrentAuth; acquire?: Acquirer;
}) {
  const { cards, documents } = options, data = new FirestoreDomainData(options);
  async function schedule() {
    for (const candidate of await cards.due(8)) {
      try {
        const job = await cards.claim(candidate);
        if (!job) continue;
        await cards.withCurrentCheck(job, async b => {
          const queued = await prepareFirestoreBackgroundWork(data, b.transaction, {
            kind: 'source-card-check', scope: b.scope,
            resourceId: job.cardId, basis: JSON.stringify([job.revision, job.checkId, job.leaseToken]), generation: b.generation,
            authorizationVersion: b.authorizationVersion
          }, new Date().toISOString());
          queued.commit();
        });
      } catch (error) {
        if (!rejected(error)) throw error;
      }
    }
    await documents.pruneStaging();
  }
  async function process(work: FirestoreBackgroundWork, signal: AbortSignal) {
    const stopped = { state: 'stopped' as const };
    if (work.kind !== 'source-card-check' || signal.aborted) return stopped;
    const [revision, checkId, leaseToken] = checkBasis.parse(JSON.parse(work.basis));
    const owner = work.scope.ownerUserId, card = await cards.get(owner, work.resourceId);
    if (!card?.enabled || !card.checking || card.revision !== revision) return stopped;
    const job: RegisteredSourceJob = {
      ownerUserId: owner, cardId: card.cardId, revision, checkId, leaseToken,
      kind: card.kind, url: card.url, ...(card.allowedPath ? { allowedPath: card.allowedPath } : {}), credentialRef: card.credentialRef
    };
    async function authorize(cardId: string) {
      if (signal.aborted || cardId !== job.cardId) return false;
      const user = await options.currentAuth(owner);
      if (user.userId !== owner || user.disabled || !user.emailVerified || signal.aborted) return false;
      return cards.withCurrentCheck(job, async b => b.generation === work.generation && b.authorizationVersion === work.authorizationVersion
        && b.scope.workspaceId === work.scope.workspaceId && b.scope.storageEpoch === work.scope.storageEpoch && !signal.aborted);
    }
    try {
      if (!await authorize(job.cardId)) return stopped;
      await cards.renew(job);
      const hint = card.hint?.status === 'pending' && card.hint.afterCheckId !== checkId ? card.hint : undefined;
      const startUrl = hint?.url ?? job.url;
      const progress = await documents.checkResult(job, startUrl);
      let result: RegisteredSourceResult = progress.result;
      let reading = progress.reading;
      if (progress.items.length) {
        const access: SourceCardAccess = {
          authorize, async credentialFor(cardId) {
            if (!job.credentialRef || !await authorize(cardId)) return null;
            const credential = await cards.credentialFor(job);
            return credential?.origin === new URL(job.url).origin ? credential : null;
          }
        };
        const acquire: Acquirer = options.acquire ?? (await import('./source-card-acquire.ts')).acquireSourceCardBatch;
        const input = acquisitionScope(job);
        input.methods = card.methods;
        input.hint = hint;
        if (job.credentialRef) {
          const credential = await cards.credentialFor(job);
          if (!credential || credential.origin !== new URL(job.url).origin || new URL(credential.loginUrl).origin !== credential.origin)
            return stopped;
          input.login = { url: credential.loginUrl };
        }
        const acquired = await acquire(input, access, signal, { revision: job.revision, checkId: job.checkId, items: progress.items });
        if (!await authorize(job.cardId)) return stopped;
        if (acquired.status === 'failed' && acquired.reason === 'unavailable' && await documents.retryBatch(job, progress.sequence, startUrl))
          return { state: 'deferred' as const, nextAt: new Date(Date.now() + 60_000).toISOString() };
        let issue: SourceScanBatch['issue'];
        if (acquired.status === 'needs_user' && !job.credentialRef && progress.items[0]!.url !== job.url)
          issue = hint ? 'unverified_hint' : outcomes[acquired.reason];
        if (acquired.status === 'failed' && acquired.reason !== 'authorization' && acquired.reason !== 'scope') issue = acquired.reason;
        if (acquired.status === 'ok' || issue) {
          try {
            const accepted = acquired.status === 'ok' ? acquired : null;
            if (accepted && accepted.consumed === undefined && progress.sequence) domainReject('source_document_invalid', 400);
            const batch = accepted?.consumed !== undefined ? accepted : { consumed: 1, next: [] };
            const extra = !hint && !progress.sequence && job.kind !== 'document'
              ? card.methods?.filter(method => method.url !== job.url).map(method => ({ url: method.url })) : undefined;
            const committed = await documents.ingest(job, accepted?.originals ?? [], signal, {
              sequence: progress.sequence, items: progress.items, consumed: batch.consumed, next: batch.next, extra, issue, startUrl,
              candidate: accepted && 'candidate' in accepted ? accepted.candidate : undefined,
              redirects: accepted && 'redirects' in accepted ? accepted.redirects : undefined
            });
            if (committed.pending) return { state: 'deferred' as const, nextAt: new Date(Date.now() + 1000).toISOString() };
            result = committed.result;
            reading = committed.reading;
          } catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'source_document_invalid')) throw error;
            result = { ...(progress.sequence ? progress.result : {}), status: 'failed' };
          }
        } else {
          result = { ...(progress.sequence ? progress.result : {}), status: acquired.status === 'needs_user' ? outcomes[acquired.reason] : 'failed' };
          if (acquired.status === 'needs_user') reading = { ...reading, gap: { reason: outcomes[acquired.reason], url: progress.items[0]!.url } };
        }
      }
      signal.throwIfAborted();
      if (reading?.gap) {
        const gate = sourceAccessGate.safeParse(reading.gap.reason);
        result = { ...result, status: gate.success ? gate.data : 'failed' };
      }
      await cards.finish(job, result, reading);
      return { state: 'completed' as const };
    } catch (error) {
      if (signal.aborted || rejected(error)) return stopped;
      // An uncertain ingestion/finish may already have committed. The same check ID
      // resumes after the lease expires and reads its receipt before fetching.
      return { state: 'unknown' as const };
    }
  }
  return { schedule, process };
}
