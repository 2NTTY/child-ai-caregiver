import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { createFirestoreKnowledgeWork } from '../server/firestore-knowledge-work.ts';
import { backgroundKnowledgeRunRequestSchema } from '../src/shared/background-knowledge-maintenance.ts';
import { GROWTH_RULES } from '../server/growth-rules.ts';

// Explicit loopback operator inspection; no model, worker, account or publication.
const config = assertLocalAgentEnvironment(process.env);
if (process.env.AI_ENABLED !== 'false') throw Error('Knowledge inspection must disable model calls');
const state = JSON.parse(await readFile(process.env.LOCAL_AGENT_STATE_FILE, 'utf8'));
if (state.projectId !== config.projectId || state.storageKey !== process.env.YUBAN_FIREBASE_STORAGE_KEY)
  throw Error('Local state binding mismatch');
const directory = dirname(process.env.LOCAL_AGENT_STATE_FILE);
const operation = process.env.LOCAL_KNOWLEDGE_INSPECT_OPERATION ?? '';
if (operation && !/^[a-f0-9]{64}$/u.test(operation)) throw Error('Invalid knowledge operation fingerprint');
const recorded = JSON.parse(await readFile(join(directory, operation ? `maintenance-${operation}.json` : 'maintenance-work.json'), 'utf8'));
const request = backgroundKnowledgeRunRequestSchema.parse(recorded.request);
if (recorded.projectId !== config.projectId || recorded.watchId !== request.watchId
  || operation && operation !== request.operationFingerprint) throw Error('Local knowledge work binding mismatch');
const runtime = await openFirebasePersistence(process.env);
try {
  const work = createFirestoreKnowledgeWork({ database: runtime.database, cipher: runtime.cipher,
    namespace: config.namespace, projectId: config.projectId, readControl: tx => runtime.authority.readControl(tx) });
  const saved = await work.inspect(request);
  if (!saved) throw Error('Knowledge work not found; inspection does not initialize it');
  const growthRuleBindings = GROWTH_RULES.filter(rule => rule.sourceId === request.watchId).map(rule => ({
    id: rule.id, revision: rule.revision, sourceKey: rule.key, expectedContentHash: rule.hash,
    candidateContainsSourceKey: saved.prepared ? saved.prepared.source.chunks.some(chunk => chunk.key === rule.key) : null,
  }));
  const report = { mode: 'local-read-only', inspectedAt: new Date().toISOString(), request: saved.request,
    deadlineAtMs: saved.deadlineAtMs, leaseUntilMs: saved.lease?.untilMs ?? null, budget: saved.budget,
    result: saved.result, receipt: saved.receipt, prepared: saved.prepared, growthRuleBindings };
  const path = join(directory, `maintenance-${request.operationFingerprint}-inspection.json`);
  // Only reviewed/public source evidence is included, never raw model context,
  // family content, account credentials or the local storage key.
  await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: saved.result?.status ?? 'unfinished', code: saved.result?.code ?? null,
    operationFingerprint: request.operationFingerprint, modelCalls: saved.budget.modelCalls,
    reviewDecision: saved.prepared?.review.decision ?? null, published: saved.receipt?.state === 'committed',
    candidateUnits: saved.prepared?.source.chunks.length ?? 0, growthRuleBindings, inspectionFile: path }));
} finally { await runtime.close(); }
