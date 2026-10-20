import type { DocumentReference, Transaction } from "@google-cloud/firestore";
import { z } from "zod";
import {
  backgroundKnowledgeRunRequestSchema, backgroundKnowledgeRunResultSchema, backgroundKnowledgeWorkBudgetSchema,
  type BackgroundKnowledgeRunRequest, type BackgroundKnowledgeRunResult, type BackgroundKnowledgeWorkBudget,
} from "../src/shared/background-knowledge-maintenance.ts";
import type { BackgroundKnowledgeCandidate, BackgroundKnowledgeDurableOperation, BackgroundKnowledgePublishReceipt } from "./background-knowledge-maintenance.ts";
import { backgroundKnowledgeReviewMatchesCandidate } from "./background-knowledge-maintenance.ts";
import type { PreparedKnowledgeMaintenance } from "./background-knowledge-model.ts";
import type { FirestoreDomainOptions } from "./firestore-domain-data.ts";
import type { FirestoreKnowledgePublicationFence } from "./firestore-knowledge.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import { parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { backgroundKnowledgeReviewBindingSchema } from "../src/shared/background-knowledge-maintenance.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u), time = z.number().int().positive();
const receiptSchema = z.strictObject({ observationHash: hash, state: z.literal("committed") });
const workSchema = z.strictObject({
  request: backgroundKnowledgeRunRequestSchema, configHash: hash, deadlineAtMs: time,
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
    provenance: z.strictObject({ packVersion: z.string().min(1).max(30), organizeAttemptKey: z.string().max(150), reviewAttemptKey: z.string().max(150) }),
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
    async bind(raw: BackgroundKnowledgeRunRequest, leaseToken: string, configHash: string,
      limits: { modelCalls: number; deadlineMs: number }) {
      const request = backgroundKnowledgeRunRequestSchema.parse(raw);
      z.uuid().parse(leaseToken); hash.parse(configHash);
      z.object({ modelCalls: z.number().int().min(1).max(2), deadlineMs: z.number().int().min(1000).max(300_000) }).strict().parse(limits);
      const workRef = ref("work", request.operationFingerprint), preparedRef = ref("prepared", request.operationFingerprint);
      function verify(row: Work) {
        if (knowledgeReviewHash(row.request) !== knowledgeReviewHash(request) || row.configHash !== configHash)
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
        if (snapshot.exists) return verify(open(workRef, snapshot.data(), workSchema));
        const row: Work = { request, configHash, deadlineAtMs: Date.now() + limits.deadlineMs, lease: null,
          budget: { usedUnits: 0, maxUnits: 8, modelCalls: 0, maxModelCalls: limits.modelCalls }, result: null, receipt: null, preparedHash: null };
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
