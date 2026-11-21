import { windowReadingSchema, type WindowReading } from "./knowledge-pdf-windows.ts";
import { extractKnowledgePdf } from "./knowledge-pdf.ts";
import type { createFirestoreKnowledgeOriginals } from "./firestore-knowledge-originals.ts";
import type { DocumentReference, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import {
  backgroundKnowledgeRunRequestSchema, backgroundKnowledgeRunResultSchema, backgroundKnowledgeWorkBudgetSchema,
  type BackgroundKnowledgeRunRequest, type BackgroundKnowledgeRunResult, type BackgroundKnowledgeWorkBudget,
} from "../src/shared/background-knowledge-maintenance.ts";
import type { BackgroundKnowledgeCandidate, BackgroundKnowledgeDurableOperation, BackgroundKnowledgePublishReceipt } from "./background-knowledge-maintenance.ts";
import { KnowledgeDailyAdmissionRefused } from "./agent-model-gateway.ts";
import { EmbeddingAdmissionDeferred } from "./embedding-failure.ts";
import { backgroundKnowledgeReviewMatchesCandidate, KnowledgeModelQuotaPending } from "./background-knowledge-maintenance.ts";
import { destinationReviewSchema, nativePdfProvenanceSchema, type PreparedKnowledgeMaintenance } from "./background-knowledge-model.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgePublicationFence } from "./firestore-knowledge.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { matchesRegisteredRetainedDraft, retainedDraftProvenanceSchema, type RetainedDraftRevision } from './knowledge-retained-draft.ts';
import { reviewedParentCode, type BoundReviewedWindow } from './fhs-reviewed-window.ts';
import { parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { backgroundKnowledgeReviewBindingSchema } from "../src/shared/background-knowledge-maintenance.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.number().int().positive();
const receiptSchema = z.strictObject({ observationHash: hash, state: z.literal("committed") });
const workSchema = z.strictObject({
  request: backgroundKnowledgeRunRequestSchema, configHash: hash, publicationConfigHash:hash.optional(), reusedOrganizationFrom: hash.optional(), deadlineAtMs: time,
  windowed: z.literal(true).optional(),
  windowRangeLimit: z.literal(8).optional(),
  quotaPhase:z.literal('model').optional(), waitingForQuotaDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  lease: z.strictObject({ token: z.uuid(), untilMs: time }).nullable(),
  budget: backgroundKnowledgeWorkBudgetSchema, result: backgroundKnowledgeRunResultSchema.nullable(),
  retainedPromptFailure: backgroundKnowledgeRunResultSchema.optional(),
  receipt: receiptSchema.nullable(), preparedHash: hash.nullable(),
});
type Work = z.infer<typeof workSchema>;

export function canResumeRetainedPromptFailure(row: Work | null | undefined, revision?: RetainedDraftRevision) {
  return Boolean(row && revision && row.result?.status === 'candidate_held' && row.result.code === 'knowledge_retained_page_request_changed'
    && !row.result.published && row.result.observationHash === revision.observationHash
    && row.request.watchId === revision.sourceId && row.result.watchId === revision.sourceId && row.request.publishMode === 'live'
    && row.budget.modelCalls === 0 && !row.lease && !row.preparedHash && !row.receipt && !row.retainedPromptFailure && !row.waitingForQuotaDay
    && matchesRegisteredRetainedDraft(revision, revision.priorOperationFingerprint ?? revision.operationFingerprint, row.request.operationFingerprint));
}
const stageSchema = z.strictObject({
  rootRunId: hash.optional(), requestHash: hash, state: z.enum(["pending", "ready", "unknown", "daily_refused"]), refusedDay: z.iso.date().optional(), text: z.string().max(128000).nullable(),
}).refine(row => (row.state === "ready") === (row.text !== null)
  && (row.state === "daily_refused") === (row.refusedDay !== undefined));
const preparedSchema = z.strictObject({
  candidateHash: hash,
  prepared: z.strictObject({
    source: z.unknown().transform(parseKnowledgeSource), versionHash: hash,
    assessment: knowledgeReviewAssessmentSchema, review: backgroundKnowledgeReviewBindingSchema,
    provenance: z.strictObject({ packVersion: z.string().min(1).max(30), organizeAttemptKey: z.string().max(150), reviewAttemptKey: z.string().max(150), retainedDraft: retainedDraftProvenanceSchema.optional(), nativePdf: nativePdfProvenanceSchema.optional(), destinationReview: destinationReviewSchema.optional(), windows: z.array(windowReadingSchema).min(1).max(32).optional() }),
  }),
});
/** Restore keeps immutable evidence, binding and spent allowance across the snapshot boundary. */
export const knowledgeWorkRecoverySchema = z.union([workSchema, stageSchema, preparedSchema, windowReadingSchema,
  z.strictObject({key:z.string().min(1).max(180)}),
  z.strictObject({sourceId:z.string().min(1).max(80),parentHash:hash,first:z.number().int().positive(),
    count:z.number().int().positive().max(16),method:z.literal("pdfjs-dist/6.4.299-extractPages/1"),
    total:z.number().int().positive(),contentHash:hash})]);

export class FirestoreKnowledgeWorkError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "FirestoreKnowledgeWorkError"; this.code = code; }
}
function reject(code: string): never { throw new FirestoreKnowledgeWorkError(code); }
type Options = FirestoreDomainOptions & {
  pdfReader?: typeof extractKnowledgePdf;
  readControl(tx: Transaction): Promise<{ enabled: boolean; generation: string }>;
};
const MAX_PAYLOAD_BYTES = 512 * 1024;

/** A single explicit continuation inherits the original allowance and cannot itself spawn a repair. */
export const knowledgeOrganizationRepairId = (prior: string) =>
  knowledgeReviewHash(["knowledge-organization-format-repair/1", hash.parse(prior)]);
export const knowledgeTruncatedOutputRepairId = (prior: string) =>
  knowledgeReviewHash(["knowledge-known-output-truncation/1", hash.parse(prior)]);

/** A bounded operator ledger, separate from every family's authority and chat. */
export function createFirestoreKnowledgeWork(options: Options) {
  const { database, cipher, namespace, projectId } = options;
  const collection = database.collection(namespace + "_knowledge_work");
  const ref = (kind: string, operation: string, suffix = "") => collection.doc(knowledgeReviewHash([kind, operation, suffix]));
  const context = (reference: DocumentReference) => JSON.stringify(["knowledge-work/1", projectId, namespace, reference.path]);
  function seal(reference: DocumentReference, value: unknown) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) reject("knowledge_work_capacity");
    return { format: "knowledge-work", version: 1, ciphertext: cipher.encrypt(text, context(reference)) };
  }
  function open<T>(reference: DocumentReference, raw: unknown, schema: z.ZodType<T>): T {
    try {
      const envelope = z.strictObject({ format: z.literal("knowledge-work"), version: z.literal(1), ciphertext: z.string() }).parse(raw);
      const plaintext = cipher.decrypt(envelope.ciphertext, context(reference));
      if (Buffer.byteLength(plaintext) > MAX_PAYLOAD_BYTES) reject("knowledge_work_capacity");
      return schema.parse(JSON.parse(plaintext));
    } catch { reject("knowledge_work_storage_invalid"); }
  }
  return {
    async readHeldStage(request: BackgroundKnowledgeRunRequest, revision: RetainedDraftRevision | BoundReviewedWindow, attemptKey: string, requestHash: string) {
      const priorRequest = { ...request, operationFingerprint: revision.operationFingerprint };
      const root = ref('work', revision.operationFingerprint), stageRef = ref('model', revision.operationFingerprint, attemptKey);
      const registered = revision.action === 'commissioned_window';
      const transcription = revision.action === 'retain_pdf_transcription' || registered && revision.registration.action === 'retain_window_quotes';
      const windowed = transcription || registered;
      if (registered && !attemptKey.startsWith('knowledge-window-organize:') && !(transcription && attemptKey.startsWith('knowledge-window-review:')))
        reject('knowledge_retained_page_binding');
      const expectedHash = registered ? requestHash : revision.action === 'retain_pdf_transcription' && attemptKey.startsWith('knowledge-window-review:')
        ? revision.reviewerRequestHash : revision.organizerRequestHash;
      if (requestHash !== expectedHash) reject('knowledge_retained_page_binding');
      return database.runTransaction(async tx => {
        const [work, stage] = await tx.getAll(root, stageRef);
        const old = open(root, work!.data(), workSchema), saved = open(stageRef, stage!.data(), stageSchema);
        if (knowledgeReviewHash(old.request) !== knowledgeReviewHash(priorRequest) || old.lease || old.preparedHash || old.receipt
          || old.result?.status !== 'candidate_held' || Boolean(old.windowed) !== windowed
          || old.result.code !== (registered ? reviewedParentCode(revision.registration) : transcription ? 'knowledge_window_quote_mismatch' : 'knowledge_review_failed')
          || old.budget.modelCalls !== (transcription ? 2 : 1)
          || old.result.observationHash !== revision.observationHash || saved.requestHash !== expectedHash
          || saved.state !== 'ready' || saved.text === null) reject('knowledge_retained_page_binding');
        return saved.text;
      }, { readOnly: true });
    },
    /** Reuse a successful stage from a recorded MAX_TOKENS operation, including its complete organizer output. */
    async readTruncatedStage(request: BackgroundKnowledgeRunRequest, observation: string, input: { system: string; user: string; attemptKey: string }) {
      const workRef = ref("work", request.operationFingerprint), stageRef = ref("model", request.operationFingerprint, input.attemptKey);
      return database.runTransaction(async tx => {
        const [root, saved] = await tx.getAll(workRef, stageRef);
        const prior = open(workRef, root!.data(), workSchema);
        if (knowledgeReviewHash(prior.request) !== knowledgeReviewHash(request) || prior.receipt || prior.preparedHash
          || prior.result?.status !== "candidate_held" || prior.result.code !== "model_output_limit" || prior.result.observationHash !== observation)
          reject("knowledge_truncation_repair_binding");
        if (!saved!.exists) {
          // A non-windowed organizer always ran. A second paid stage means the reviewer also ran.
          if (!prior.windowed && (input.attemptKey.startsWith('knowledge-organize:') || prior.budget.modelCalls === 2))
            reject('knowledge_truncation_repair_stage');
          return null;
        }
        const stage = open(stageRef, saved!.data(), stageSchema);
        if (stage.requestHash !== knowledgeReviewHash(input) || !["ready","unknown"].includes(stage.state))
          reject("knowledge_truncation_repair_stage");
        return stage.text;
      }, { readOnly: true });
    },
    /** Preserve the first verified derivation: PDF writer metadata can vary across restarts. */
    async readPdfWindow(sourceId: string, parentHash: string, first: number, count: number,
      originals: ReturnType<typeof createFirestoreKnowledgeOriginals>, signal?: AbortSignal) {
      const method = "pdfjs-dist/6.4.299-extractPages/1";
      const schema = z.strictObject({ sourceId: z.literal(sourceId), parentHash: z.literal(hash.parse(parentHash)),
        first: z.literal(first), count: z.literal(count), method: z.literal(method), total: z.number().int().positive(), contentHash: hash });
      const identity = { sourceId, parentHash, first, count, method };
      const reference = ref("pdf-window", knowledgeReviewHash(identity));
      const prior = await reference.get();
      let descriptor;
      if (prior.exists) descriptor = open(reference, prior.data(), schema);
      else {
        const original = await originals.readPdf(sourceId, parentHash);
        const result = await (options.pdfReader ?? extractKnowledgePdf)(original, { expectedHash: parentHash, startPage: first, pageLimit: count, includePagePdf: true, signal });
        if (!result.pagePdf || result.pages.length !== count) reject("knowledge_window_range_invalid");
        const contentHash = await originals.save(sourceId, "application/pdf", Buffer.from(result.pagePdf));
        const proposed = schema.parse({ ...identity, total: result.totalPages, contentHash });
        descriptor = await database.runTransaction(async tx => {
          const existing = await tx.get(reference);
          if (existing.exists) return open(reference, existing.data(), schema);
          tx.create(reference, seal(reference, proposed));
          return proposed;
        });
      }
      const bytes = await originals.readPdf(sourceId, descriptor.contentHash);
      return { descriptor, bytes };
    },
    /** Read the bound work and candidate without acquiring a lease or restarting an external effect. */
    async inspect(raw: BackgroundKnowledgeRunRequest) {
      const request = backgroundKnowledgeRunRequestSchema.parse(raw);
      const workRef = ref("work", request.operationFingerprint), preparedRef = ref("prepared", request.operationFingerprint);
      return database.runTransaction(async tx => {
        const [snapshot, candidate] = await tx.getAll(workRef, preparedRef);
        if (!snapshot.exists) {
          if (candidate.exists) reject("knowledge_work_storage_invalid");
          return null;
        }
        const work = open(workRef, snapshot.data(), workSchema);
        if (knowledgeReviewHash(work.request) !== knowledgeReviewHash(request)) reject("knowledge_work_binding_changed");
        const saved = candidate.exists ? open(preparedRef, candidate.data(), preparedSchema) : null;
        if (work.preparedHash !== (saved ? knowledgeReviewHash(saved) : null)
          || saved && (saved.prepared.source.sourceId !== request.watchId
            || saved.prepared.versionHash !== sourceVersionHash(saved.prepared.source))) {
          reject("knowledge_work_candidate_changed");
        }
        return { ...work, prepared: saved?.prepared ?? null };
      }, { readOnly: true });
    },
    async bind(raw: BackgroundKnowledgeRunRequest, leaseToken: string, configHash: string,
      limits: { modelCalls: number; deadlineMs: number; maxUnits?: number; windowed?: true; windowRangeLimit?: 8; publicationConfigHash?:string }, reusedOrganizationFrom?: string,
      sameDayCapacity?: (tx: Transaction) => Promise<boolean>, retained?: RetainedDraftRevision) {
      const request = backgroundKnowledgeRunRequestSchema.parse(raw);
      if (reusedOrganizationFrom && knowledgeOrganizationRepairId(reusedOrganizationFrom) !== request.operationFingerprint)
        reject("knowledge_work_repair_binding");
      z.uuid().parse(leaseToken); hash.parse(configHash);
      z.object({ modelCalls: z.number().int().min(1).max(limits.windowed ? 64 : 2), windowed: z.literal(true).optional(),
        windowRangeLimit: limits.windowed ? workSchema.shape.windowRangeLimit : z.never().optional(), publicationConfigHash:hash.optional(),
        deadlineMs: z.number().int().min(1000).max(300_000), maxUnits: z.number().int().min(2).max(258).optional() }).strict().parse(limits);
      const workRef = ref("work", request.operationFingerprint), preparedRef = ref("prepared", request.operationFingerprint);
      function verify(row: Work) {
        if (knowledgeReviewHash(row.request) !== knowledgeReviewHash(request) || row.configHash !== configHash || row.reusedOrganizationFrom !== reusedOrganizationFrom || row.windowed !== limits.windowed
          || row.windowRangeLimit !== limits.windowRangeLimit || row.publicationConfigHash && row.publicationConfigHash !== limits.publicationConfigHash)
          reject("knowledge_work_binding_changed");
        return row;
      }
      async function load(tx: Transaction) {
        const row = await tx.get(workRef);
        if (!row.exists) reject("knowledge_work_missing");
        return verify(open(workRef, row.data(), workSchema));
      }
      async function current(tx: Transaction, requireLease = true) {
        const [row, control] = await Promise.all([load(tx), options.readControl(tx)]);
        if (!control.enabled || control.generation !== request.workerGeneration) reject("knowledge_work_disabled");
        if (row.deadlineAtMs <= Date.now()) reject("knowledge_work_expired");
        if (row.result) reject("knowledge_work_completed");
        if (requireLease && (row.lease?.token !== leaseToken || row.lease.untilMs <= Date.now())) reject("knowledge_work_lease_lost");
        return row;
      }
      const initial = await database.runTransaction(async tx => {
        const snapshot = await tx.get(workRef), control = await options.readControl(tx);
        if (!control.enabled || control.generation !== request.workerGeneration) reject("knowledge_work_disabled");
        if (snapshot.exists) {
          const row = verify(open(workRef, snapshot.data(), workSchema));
          if (row.result && canResumeRetainedPromptFailure(row, retained)) {
            const resumed = { ...row, retainedPromptFailure: row.result, result: null, deadlineAtMs: Date.now() + limits.deadlineMs };
            tx.set(workRef, seal(workRef, resumed));
            return resumed;
          }
          const day = new Date().toISOString().slice(0, 10);
          if (row.waitingForQuotaDay && row.waitingForQuotaDay <= day
            && (row.preparedHash || row.quotaPhase === 'model') && !row.receipt && !row.result && (!row.lease || row.lease.untilMs <= Date.now())) {
            if (row.waitingForQuotaDay === day && !await sameDayCapacity?.(tx)) {
              if (row.quotaPhase === 'model') throw new KnowledgeModelQuotaPending();
              throw new EmbeddingAdmissionDeferred();
            }
            const { waitingForQuotaDay: _, quotaPhase: _phase, ...rest } = row;
            const continued = { ...rest, deadlineAtMs: Date.now() + limits.deadlineMs, lease: null };
            tx.set(workRef, seal(workRef, continued));
            return continued;
          }
          if (row.windowed && !row.waitingForQuotaDay && row.deadlineAtMs <= Date.now() && !row.result && !row.receipt
            && (!row.lease || row.lease.untilMs <= Date.now())) {
            const resumed = { ...row, deadlineAtMs: Date.now()+limits.deadlineMs, lease: null };
            tx.set(workRef,seal(workRef,resumed));
            return resumed;
          }
          return row;
        }
        let priorBudget: BackgroundKnowledgeWorkBudget | undefined;
        if (reusedOrganizationFrom) {
          const oldRef = ref("work", reusedOrganizationFrom);
          const old = open(oldRef, (await tx.get(oldRef)).data(), workSchema);
          if (old.reusedOrganizationFrom || old.configHash !== configHash || old.receipt || old.preparedHash
            || old.result?.status !== "candidate_held" || old.result.code !== "knowledge_review_failed"
            || old.budget.modelCalls !== 1 || old.budget.maxModelCalls !== limits.modelCalls
            || old.budget.maxUnits !== (limits.maxUnits ?? 8) || old.request.operationFingerprint !== reusedOrganizationFrom
            || knowledgeReviewHash({...old.request,operationFingerprint:request.operationFingerprint}) !== knowledgeReviewHash(request))
            reject("knowledge_work_repair_binding");
          priorBudget = old.budget;
        }
        const row: Work = { request, configHash, ...(limits.publicationConfigHash ? {publicationConfigHash:limits.publicationConfigHash} : {}),
          ...(limits.windowed ? {windowed:true as const} : {}), ...(limits.windowRangeLimit ? {windowRangeLimit:limits.windowRangeLimit} : {}),
          ...(reusedOrganizationFrom ? {reusedOrganizationFrom} : {}), deadlineAtMs: Date.now() + limits.deadlineMs, lease: null,
          budget: priorBudget ?? { usedUnits: 0, maxUnits: limits.maxUnits ?? 8, modelCalls: 0, maxModelCalls: limits.modelCalls }, result: null, receipt: null, preparedHash: null };
        tx.create(workRef, seal(workRef, row)); return row;
      });
      const requireId = (fingerprint: string) => { if (fingerprint !== request.operationFingerprint) reject("knowledge_work_binding_changed"); };
      const write = (tx: Transaction, row: Work) => tx.set(workRef, seal(workRef, workSchema.parse(row)));
      const budgetMerge = (row: Work, budget: BackgroundKnowledgeWorkBudget) => {
        backgroundKnowledgeWorkBudgetSchema.parse(budget);
        if (budget.maxUnits !== row.budget.maxUnits || budget.maxModelCalls !== row.budget.maxModelCalls
          || budget.modelCalls > row.budget.modelCalls || budget.usedUnits > row.budget.maxUnits)
          reject("knowledge_work_budget_invalid");
        return { ...row.budget, usedUnits: Math.max(row.budget.usedUnits, budget.usedUnits) };
      };
      const ports: Omit<BackgroundKnowledgeDurableOperation, "review" | "publish"> = {
        async loadBudget(id) { requireId(id); return database.runTransaction(async tx => (await load(tx)).budget, { readOnly: true }); },
        async saveBudget(id, next) {
          requireId(id); await database.runTransaction(async tx => {
            const row = await current(tx); if (row.result) return;
            write(tx, { ...row, budget: budgetMerge(row, next) });
          });
        },
        async loadResult(id) { requireId(id); return database.runTransaction(async tx => (await load(tx)).result, { readOnly: true }); },
        async saveResult(id, result) {
          requireId(id); await database.runTransaction(async tx => {
            const row = await current(tx); if (row.result) return;
            // Only the publication transaction can claim a committed publication.
            if (result.published && !row.receipt) reject("knowledge_work_receipt_missing");
            write(tx, { ...row, result: backgroundKnowledgeRunResultSchema.parse({ ...result, budget: row.budget }) });
          });
        },
        async claimOperation(id, token, untilMs) {
          requireId(id); if (token !== leaseToken || !Number.isSafeInteger(untilMs)) reject("knowledge_work_binding_changed");
          return database.runTransaction(async tx => {
            const row = await load(tx), control = await options.readControl(tx);
            if (!control.enabled || control.generation !== request.workerGeneration) reject("knowledge_work_disabled");
            if (row.result) return { status: "completed", result: row.result };
            if (Date.now() >= row.deadlineAtMs) reject("knowledge_work_expired");
            if (row.lease?.token === token && row.lease.untilMs <= Date.now()) reject("knowledge_work_lease_lost");
            if (row.lease && row.lease.token !== token && row.lease.untilMs > Date.now()) return { status: "busy" };
            write(tx, { ...row, lease: { token, untilMs: Math.min(untilMs, row.deadlineAtMs) } });
            return { status: "claimed", leaseToken: token };
          });
        },
        async releaseOperation(id, token) {
          requireId(id); if (token !== leaseToken) reject("knowledge_work_binding_changed");
          await database.runTransaction(async tx => {
            const row = await load(tx);
            if (row.lease?.token === token) write(tx, { ...row, lease: null });
          });
        },
        async loadPublishReceipt(id) { requireId(id); return database.runTransaction(async tx => (await load(tx)).receipt, { readOnly: true }); },
        async savePublishReceipt(id, receipt) {
          requireId(id);
          const saved = await database.runTransaction(async tx => (await load(tx)).receipt, { readOnly: true });
          if (!saved || knowledgeReviewHash(saved) !== knowledgeReviewHash(receipt)) reject("knowledge_work_receipt_missing");
        },
      };
      return {
        ports, deadlineAtMs: initial.deadlineAtMs,
        async assertLease(tx: Transaction) { await current(tx); },
        async authorize() {
          try { return await database.runTransaction(async tx => { await current(tx); return true; }, { readOnly: true }); }
          catch (error) { if (error instanceof FirestoreKnowledgeWorkError) return false; throw error; }
        },
        async readWindow(index: number) {
          const reference = ref("reviewed-window", request.operationFingerprint, String(index));
          return database.runTransaction(async tx => {
            await current(tx);
            const row = await tx.get(reference);
            return row.exists ? open(reference, row.data(), windowReadingSchema) : null;
          }, { readOnly: true });
        },
        async saveWindow(index: number, reading: WindowReading, yieldAfter: boolean) {
          const reference = ref("reviewed-window", request.operationFingerprint, String(index));
          const value = windowReadingSchema.parse(reading);
          await database.runTransaction(async tx => {
            const row = await current(tx), prior = await tx.get(reference);
            if (!row.windowed || (prior.exists && knowledgeReviewHash(open(reference, prior.data(), windowReadingSchema)) !== knowledgeReviewHash(value)))
              reject("knowledge_window_binding_changed");
            if (!prior.exists) tx.create(reference, seal(reference, value));
            if (yieldAfter) write(tx, { ...row, lease: null });
          });
        },
        async verifyWindowedReview(tx: Transaction, versionHash: string) {
          const row = await current(tx), snapshot = await tx.get(preparedRef);
          if (!row.windowed || !snapshot.exists) return false;
          const value = open(preparedRef, snapshot.data(), preparedSchema);
          return row.preparedHash === knowledgeReviewHash(value) && value.prepared.versionHash === versionHash
            && value.prepared.review.modelReviewCompleted && value.prepared.review.decision === "approve_candidate"
            && Boolean(value.prepared.provenance.windows?.length);
        },
        async waitForQuota() {
          await database.runTransaction(async tx => {
            const row = await current(tx);
            if (!row.preparedHash || row.result || row.receipt) reject("knowledge_work_candidate_invalid");
            write(tx, { ...row, waitingForQuotaDay: new Date().toISOString().slice(0, 10), lease: null });
          });
        },
        async reserveWorkUnit(key: string) {
          const unitRef = ref("unit", request.operationFingerprint, key);
          await database.runTransaction(async tx => {
            const row = await current(tx), prior = await tx.get(unitRef);
            if (prior.exists) {
              write(tx, { ...row, lease: { token: leaseToken, untilMs: Math.min(Date.now() + 120_000, row.deadlineAtMs) } });
              return;
            }
            if (row.budget.usedUnits >= row.budget.maxUnits) reject("knowledge_work_unit_limit");
            tx.create(unitRef, seal(unitRef, { key }));
            write(tx, { ...row, lease: { token: leaseToken, untilMs: Math.min(Date.now() + 120_000, row.deadlineAtMs) },
              budget: { ...row.budget, usedUnits: row.budget.usedUnits + 1 } });
          });
        },
        async savePrepared(candidate: BackgroundKnowledgeCandidate, prepared: PreparedKnowledgeMaintenance) {
          if (!backgroundKnowledgeReviewMatchesCandidate(prepared.review, candidate)
            || prepared.versionHash !== sourceVersionHash(prepared.source)) reject("knowledge_work_candidate_invalid");
          const saved = preparedSchema.parse({ candidateHash: knowledgeReviewHash(candidate), prepared });
          await database.runTransaction(async tx => {
            const row = await current(tx), old = await tx.get(preparedRef);
            if (old.exists && knowledgeReviewHash(open(preparedRef, old.data(), preparedSchema)) !== knowledgeReviewHash(saved))
              reject("knowledge_work_candidate_changed");
            tx.set(preparedRef, seal(preparedRef, saved));
            write(tx, { ...row, preparedHash: knowledgeReviewHash(saved) });
          });
        },
        async verifyLease(tx: Transaction) { await current(tx); },
        async readPrepared(candidate: BackgroundKnowledgeCandidate) {
          return database.runTransaction(async tx => {
            const row = await current(tx), saved = await tx.get(preparedRef);
            if (!saved.exists) return null;
            const value = open(preparedRef, saved.data(), preparedSchema);
            if (value.candidateHash !== knowledgeReviewHash(candidate) || row.preparedHash !== knowledgeReviewHash(value))
              reject("knowledge_work_candidate_changed");
            return value.prepared;
          }, { readOnly: true });
        },
        /** Reserve before dispatch. An unanswered reservation is lookup-only forever. */
        async completeText(input: { system: string; user: string; attemptKey: string }, generate: (rootRunId: string) => Promise<string>, canStart?: (tx:Transaction)=>Promise<boolean>) {
          const stageRef = ref("model", request.operationFingerprint, input.attemptKey);
          const requestHash = knowledgeReviewHash(input);
          const cached = await database.runTransaction(async tx => {
            const row = await current(tx), snapshot = await tx.get(stageRef);
            const stage = snapshot.exists ? open(stageRef, snapshot.data(), stageSchema) : null;
            if (stage && stage.requestHash !== requestHash) reject("knowledge_work_model_binding_changed");
            if (stage?.state === "ready") return { text: stage.text! };
            if (stage && (stage.state !== "daily_refused" || !stage.refusedDay)) reject("knowledge_work_model_outcome_unknown");
            if (reusedOrganizationFrom && (input.attemptKey.startsWith("knowledge-organize:") || input.attemptKey.startsWith("knowledge-page-organize:"))) {
              const priorRef = ref("model", reusedOrganizationFrom, input.attemptKey);
              const prior = open(priorRef, (await tx.get(priorRef)).data(), stageSchema);
              if (prior.state !== "ready" || prior.requestHash !== requestHash || prior.text === null)
                reject("knowledge_work_repair_stage_missing");
              tx.create(stageRef, seal(stageRef,prior));
              return { text: prior.text };
            }
            if (canStart && !await canStart(tx)) {
              write(tx,{...row,lease:null,quotaPhase:"model",waitingForQuotaDay:new Date().toISOString().slice(0,10)});
              return false as const;
            }
            if (row.preparedHash) reject("knowledge_work_candidate_already_prepared");
            // A known pre-dispatch daily refusal retains this work's reserved stage. Its previous
            // root never admitted an attempt. A new bounded deadline is linked to the recorded refusal.
            if (!stage && row.budget.modelCalls >= row.budget.maxModelCalls) reject("knowledge_work_model_limit");
            const key = [request.operationFingerprint, input.attemptKey];
            if (stage?.refusedDay) key.push(stage.refusedDay);
            const rootRunId = canStart || row.windowed ? knowledgeReviewHash(key) : request.operationFingerprint;
            tx.set(stageRef, seal(stageRef, { requestHash, rootRunId, state: "pending", text: null }));
            write(tx, { ...row, lease: { token: leaseToken, untilMs: Math.min(Date.now() + 120_000, row.deadlineAtMs) },
              budget: { ...row.budget, modelCalls: row.budget.modelCalls + (stage ? 0 : 1) } });
            return { rootRunId };
          });
          if (cached === false) throw new KnowledgeModelQuotaPending();
          if ("text" in cached) return cached.text!;
          try {
            const text = await generate(cached.rootRunId);
            await database.runTransaction(async tx => {
              await current(tx);
              const snapshot = await tx.get(stageRef), stage = open(stageRef, snapshot.data(), stageSchema);
              if (stage.requestHash !== requestHash || stage.state !== "pending") reject("knowledge_work_model_binding_changed");
              tx.set(stageRef, seal(stageRef, stageSchema.parse({ ...stage, state: "ready", text })));
            });
            return text;
          } catch (error) {
            if (error instanceof KnowledgeDailyAdmissionRefused) {
              await database.runTransaction(async tx => {
                const row = await current(tx), snap = await tx.get(stageRef);
                const stage = open(stageRef, snap.data(), stageSchema);
                if (stage.state !== "pending" || stage.requestHash !== requestHash || stage.rootRunId !== cached.rootRunId)
                  reject("knowledge_work_model_binding_changed");
                const day = new Date().toISOString().slice(0, 10);
                tx.set(stageRef, seal(stageRef, { ...stage, state: "daily_refused", refusedDay: day }));
                write(tx, { ...row, lease: null, quotaPhase: "model", waitingForQuotaDay: day });
              });
              throw new KnowledgeModelQuotaPending();
            }
            // Keep pending if even recording unknown fails. Neither state permits redispatch.
            await database.runTransaction(async tx => {
              await current(tx);
              const snapshot = await tx.get(stageRef), stage = open(stageRef, snapshot.data(), stageSchema);
              if (stage.state === "pending" && stage.requestHash === requestHash)
                tx.set(stageRef, seal(stageRef, { ...stage, state: "unknown", text: null }));
            }).catch(() => {});
            throw error;
          }
        },
        publicationFence(candidate: BackgroundKnowledgeCandidate, prepared: PreparedKnowledgeMaintenance): FirestoreKnowledgePublicationFence {
          return {
            async prepare(tx, publication) {
              const row = await current(tx), snapshot = await tx.get(preparedRef);
              const saved = snapshot.exists ? open(preparedRef, snapshot.data(), preparedSchema) : null;
              if (request.publishMode !== "live" || !saved || row.preparedHash !== knowledgeReviewHash(saved)
                || saved.candidateHash !== knowledgeReviewHash(candidate)
                || knowledgeReviewHash(saved.prepared) !== knowledgeReviewHash(prepared)
                || publication.sourceId !== candidate.watchId || publication.versionHash !== prepared.versionHash
                || publication.previousVersionId !== prepared.assessment.comparedVersionId && publication.previousVersionId !== publication.versionId
                || publication.previousVersionId !== null && !publication.sourceEnabled
                || publication.observationHash !== candidate.observationHash
                || prepared.review.decision !== "approve_candidate" || !prepared.review.modelReviewCompleted)
                reject("knowledge_work_publication_mismatch");
              const receipt: BackgroundKnowledgePublishReceipt = { observationHash: candidate.observationHash, state: "committed" };
              const result: BackgroundKnowledgeRunResult = { status: "published", watchId: request.watchId, observationHash: candidate.observationHash,
                published: true, publishMode: "live", budget: row.budget, review: prepared.review };
              // Called by the knowledge store in this same transaction, after all reads.
              return () => write(tx, { ...row, result, receipt });
            },
          };
        },
      };
    },
  };
}
