import { extractKnowledgePdf } from "./knowledge-pdf.ts";
import type { createFirestoreKnowledgeOriginals } from "./firestore-knowledge-originals.ts";
import type { DocumentReference, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import {
  backgroundKnowledgeRunRequestSchema, backgroundKnowledgeRunResultSchema, backgroundKnowledgeWorkBudgetSchema,
  type BackgroundKnowledgeRunRequest, type BackgroundKnowledgeRunResult, type BackgroundKnowledgeWorkBudget,
} from "../src/shared/background-knowledge-maintenance.ts";
import type { BackgroundKnowledgeCandidate, BackgroundKnowledgeDurableOperation, BackgroundKnowledgePublishReceipt } from "./background-knowledge-maintenance.ts";
import { backgroundKnowledgeReviewMatchesCandidate } from "./background-knowledge-maintenance.ts";
import { nativePdfProvenanceSchema, type PreparedKnowledgeMaintenance } from "./background-knowledge-model.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgePublicationFence } from "./firestore-knowledge.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { backgroundKnowledgeReviewBindingSchema } from "../src/shared/background-knowledge-maintenance.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.number().int().positive();
const receiptSchema = z.strictObject({ observationHash: hash, state: z.literal("committed") });
const workSchema = z.strictObject({
  request: backgroundKnowledgeRunRequestSchema, configHash: hash, reusedOrganizationFrom: hash.optional(), deadlineAtMs: time,
  waitingForQuotaDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  lease: z.strictObject({ token: z.uuid(), untilMs: time }).nullable(),
  budget: backgroundKnowledgeWorkBudgetSchema, result: backgroundKnowledgeRunResultSchema.nullable(),
  receipt: receiptSchema.nullable(), preparedHash: hash.nullable(),
});
type Work = z.infer<typeof workSchema>;
const stageSchema = z.strictObject({
  requestHash: hash, state: z.enum(["pending", "ready", "unknown"]), text: z.string().max(128000).nullable(),
}).refine(row => (row.state === "ready") === (row.text !== null));
const preparedSchema = z.strictObject({
  candidateHash: hash,
  prepared: z.strictObject({
    source: z.unknown().transform(parseKnowledgeSource), versionHash: hash,
    assessment: knowledgeReviewAssessmentSchema, review: backgroundKnowledgeReviewBindingSchema,
    provenance: z.strictObject({ packVersion: z.string().min(1).max(30), organizeAttemptKey: z.string().max(150), reviewAttemptKey: z.string().max(150), nativePdf: nativePdfProvenanceSchema.optional() }),
  }),
});
export class FirestoreKnowledgeWorkError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "FirestoreKnowledgeWorkError"; this.code = code; }
}
function reject(code: string): never { throw new FirestoreKnowledgeWorkError(code); }
type Options = FirestoreDomainOptions & {
  readControl(tx: Transaction): Promise<{ enabled: boolean; generation: string }>;
};
const MAX_PAYLOAD_BYTES = 512 * 1024;

/** A single explicit continuation inherits the original allowance and cannot itself spawn a repair. */
export const knowledgeOrganizationRepairId = (prior: string) =>
  knowledgeReviewHash(["knowledge-organization-format-repair/1", hash.parse(prior)]);

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
        const result = await extractKnowledgePdf(original, { expectedHash: parentHash, startPage: first, pageLimit: count, includePagePdf: true, signal });
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
    /** Operator lookup only. Never acquire a lease or restart an external effect. */
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
      limits: { modelCalls: number; deadlineMs: number; maxUnits?: number }, reusedOrganizationFrom?: string) {
      const request = backgroundKnowledgeRunRequestSchema.parse(raw);
      if (reusedOrganizationFrom && knowledgeOrganizationRepairId(reusedOrganizationFrom) !== request.operationFingerprint)
        reject("knowledge_work_repair_binding");
      z.uuid().parse(leaseToken); hash.parse(configHash);
      z.object({ modelCalls: z.number().int().min(1).max(2), deadlineMs: z.number().int().min(1000).max(300_000), maxUnits: z.number().int().min(2).max(258).optional() }).strict().parse(limits);
      const workRef = ref("work", request.operationFingerprint), preparedRef = ref("prepared", request.operationFingerprint);
      function verify(row: Work) {
        if (knowledgeReviewHash(row.request) !== knowledgeReviewHash(request) || row.configHash !== configHash || row.reusedOrganizationFrom !== reusedOrganizationFrom)
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
          if (row.waitingForQuotaDay && row.waitingForQuotaDay < new Date().toISOString().slice(0, 10)
            && row.preparedHash && !row.receipt && !row.result && (!row.lease || row.lease.untilMs <= Date.now())) {
            const { waitingForQuotaDay: _, ...rest } = row;
            const continued = { ...rest, deadlineAtMs: Date.now() + limits.deadlineMs, lease: null };
            tx.set(workRef, seal(workRef, continued));
            return continued;
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
        const row: Work = { request, configHash, ...(reusedOrganizationFrom ? {reusedOrganizationFrom} : {}), deadlineAtMs: Date.now() + limits.deadlineMs, lease: null,
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
        async authorize() {
          try { return await database.runTransaction(async tx => { await current(tx); return true; }, { readOnly: true }); }
          catch (error) { if (error instanceof FirestoreKnowledgeWorkError) return false; throw error; }
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
        async completeText(input: { system: string; user: string; attemptKey: string }, generate: () => Promise<string>) {
          const stageRef = ref("model", request.operationFingerprint, input.attemptKey);
          const requestHash = knowledgeReviewHash(input);
          const cached = await database.runTransaction(async tx => {
            const row = await current(tx), snapshot = await tx.get(stageRef);
            if (snapshot.exists) {
              const stage = open(stageRef, snapshot.data(), stageSchema);
              if (stage.requestHash !== requestHash) reject("knowledge_work_model_binding_changed");
              if (stage.state !== "ready") reject("knowledge_work_model_outcome_unknown");
              return stage.text;
            }
            if (reusedOrganizationFrom && (input.attemptKey.startsWith("knowledge-organize:") || input.attemptKey.startsWith("knowledge-page-organize:"))) {
              const priorRef = ref("model", reusedOrganizationFrom, input.attemptKey);
              const prior = open(priorRef, (await tx.get(priorRef)).data(), stageSchema);
              if (prior.state !== "ready" || prior.requestHash !== requestHash || prior.text === null)
                reject("knowledge_work_repair_stage_missing");
              tx.create(stageRef, seal(stageRef,prior));
              return prior.text;
            }
            if (row.preparedHash) reject("knowledge_work_candidate_already_prepared");
            if (row.budget.modelCalls >= row.budget.maxModelCalls) reject("knowledge_work_model_limit");
            tx.create(stageRef, seal(stageRef, { requestHash, state: "pending", text: null }));
            write(tx, { ...row, lease: { token: leaseToken, untilMs: Math.min(Date.now() + 120_000, row.deadlineAtMs) },
              budget: { ...row.budget, modelCalls: row.budget.modelCalls + 1 } });
            return null;
          });
          if (cached !== null) return cached;
          try {
            const text = await generate();
            await database.runTransaction(async tx => {
              await current(tx);
              const snapshot = await tx.get(stageRef), stage = open(stageRef, snapshot.data(), stageSchema);
              if (stage.requestHash !== requestHash || stage.state !== "pending") reject("knowledge_work_model_binding_changed");
              tx.set(stageRef, seal(stageRef, stageSchema.parse({ requestHash, state: "ready", text })));
            });
            return text;
          } catch (error) {
            // Keep pending if even recording unknown fails. Neither state permits redispatch.
            await database.runTransaction(async tx => {
              await current(tx);
              const snapshot = await tx.get(stageRef), stage = open(stageRef, snapshot.data(), stageSchema);
              if (stage.state === "pending" && stage.requestHash === requestHash)
                tx.set(stageRef, seal(stageRef, { requestHash, state: "unknown", text: null }));
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
