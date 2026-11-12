import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { readLocalAgentModel } from '../server/local-agent-model.ts';
import { createEmbeddingGateway } from '../server/embedding-gateway.ts';
import { createFirestoreOperatorEmbeddingUsage } from '../server/firestore-embedding-usage.ts';
import { createVertexEmbeddingProvider } from '../server/vertex-embedding.ts';
import { AgentStopped } from '../server/agent-budget.ts';
import { buildLocalOfficialSeedAssessment } from './local-knowledge-assessments.ts';

// Explicit operator action only. Normal startup never fetches or embeds a corpus.
const config = assertLocalAgentEnvironment(process.env);
const prepareAll = process.env.LOCAL_KNOWLEDGE_PREPARE_ALL === 'true';
const manifest = JSON.parse(await readFile(new URL('../knowledge/local-development-seed.json', import.meta.url), 'utf8'));
const rawSources = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'));
const parsedSources = rawSources.map(value => parseKnowledgeSource(value));
const singleSource = parsedSources.find(value => value.sourceId === manifest.sourceId);
if (!singleSource || sourceVersionHash(singleSource) !== manifest.versionHash || singleSource.chunks.length !== 1) {
  throw Error('Local source changed; a new meaning review is required');
}
const targets = prepareAll ? parsedSources : [singleSource];
const maxEmbeddings = prepareAll ? 8 : 1;
const localModel = readLocalAgentModel(process.env, { documentEmbeddings: true });
if (!localModel.embeddingConfigured) throw Error('Knowledge preparation needs an explicit compatible embedding credential; no platform fallback');
const ai = localModel.modelConfig;

async function prepareSource({ source, store, gateway, remainingEmbeddings }) {
  const expectedHash = sourceVersionHash(source);
  const existing = await store.publishedEdition(source.sourceId);
  let versionId;
  if (existing?.enabled && existing.versionHash === expectedHash) {
    versionId = existing.versionId;
  } else {
    const imported = await store.importSource(source);
    // Preserve the reviewed source/terms assessment for this curated seed version.
    await store.review(imported.versionId, imported.hash, 'local-reviewed-seed', buildLocalOfficialSeedAssessment(source, manifest));
    versionId = imported.versionId;
  }
  let search;
  for (let page = 0; page < 64; page++) {
    search = await store.prepareSearch(versionId, expectedHash);
    if (search.complete) break;
  }
  if (!search?.complete) throw Error('Local search preparation is incomplete; no embedding was started');
  const pending = await store.missingDocuments(versionId);
  if (pending.length > remainingEmbeddings) throw Error('Local seed exceeds its embedding limit');
  let generated = 0;
  for (const document of pending) {
    const result = await store.embedDocument(document, () => gateway.embed({ text: document.text, title: document.title, task: 'RETRIEVAL_DOCUMENT' },
      { kind: 'corpus_maintenance', actorId: 'operator:local-developer', operationId: randomUUID() }, AbortSignal.timeout(120_000), async () => true));
    if (!result.reused) generated++;
  }
  const result = await store.publish(versionId, expectedHash);
  return { sourceId: source.sourceId, title: source.title, versionId, chunks: source.chunks.length, result, embeddingCalls: generated };
}

let persistence;
try {
  persistence = await openFirebasePersistence(process.env);
  const { database, cipher, authority } = persistence, domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
  const state = JSON.parse(await readFile(process.env.LOCAL_AGENT_STATE_FILE, 'utf8'));
  if (state.projectId !== config.projectId || state.storageKey !== process.env.YUBAN_FIREBASE_STORAGE_KEY) throw Error('Local state mismatch');
  try { await authority.readControl(); }
  catch (error) { if (error.code !== 'not_found') throw error; await authority.initializeControl({ generation: state.generation, enabled: true }); }
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
  const store = createFirestoreKnowledgeStore({ ...domain, sourceIds: targets.map(item => item.sourceId), observations: refresh.gate });
  const deadline = Date.now() + 120_000;
  const embedding = localModel.providers ? localModel.providers(ai).embedding : createVertexEmbeddingProvider(ai);
  const gateway = createEmbeddingGateway({ config: ai, provider: embedding, usage: createFirestoreOperatorEmbeddingUsage(domain, deadline) });
  const prepared = [];
  let generated = 0;
  for (const source of targets) {
    const item = await prepareSource({ source, store, gateway, remainingEmbeddings: maxEmbeddings - generated });
    generated += item.embeddingCalls;
    prepared.push(item);
  }
  console.log(JSON.stringify(prepareAll
    ? { event: 'local_knowledge_prepared', sources: prepared, embeddingCalls: generated, coverage: 'all-curated-official-sources' }
    : { event: 'local_knowledge_prepared', sourceId: manifest.sourceId, versionId: prepared[0].versionId,
      result: prepared[0].result, embeddingCalls: generated, reviewedOn: manifest.reviewedOn, coverage: 'one-curated-official-section' }));
} catch (error) {
  // Provider errors may contain request details. Emit only known bounded codes.
  console.error(JSON.stringify({ event: 'local_knowledge_preparation_failed', code: error instanceof AgentStopped ? error.reason : typeof error?.code === 'string' && /^[a-z_]{1,80}$/.test(error.code)
    ? error.code : 'preparation_failed', recovery: 'Inspect local version and original embedding receipt; do not reset and blindly retry.' }));
  process.exitCode = 1;
} finally { await persistence?.close(); }
