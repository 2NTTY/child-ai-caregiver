import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createEmbeddingGateway } from '../server/embedding-gateway.ts';
import { createFirestoreOperatorEmbeddingUsage } from '../server/firestore-embedding-usage.ts';
import { createVertexEmbeddingProvider } from '../server/vertex-embedding.ts';
import { createGeminiKeyProviders } from '../server/gemini-key-provider.ts';

// Explicit operator action only. Normal startup never fetches or embeds a corpus.
const config = assertLocalAgentEnvironment(process.env);
const manifest = JSON.parse(await readFile(new URL('../knowledge/local-development-seed.json', import.meta.url), 'utf8'));
const sources = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'));
const source = parseKnowledgeSource(sources.find(value => value.sourceId === manifest.sourceId));
if (sourceVersionHash(source) !== manifest.versionHash || source.chunks.length !== 1) throw Error('Local source changed; a new meaning review is required');
const provider = process.env.LOCAL_MODEL_PROVIDER;
if (!['gemini', 'vertex', 'vertex-adc'].includes(provider) || process.env.AI_ENABLED !== 'true') throw Error('Explicit local model configuration required');
if (provider === 'vertex') throw Error('Vertex API key embedding is not connected; use your own supported Gemini key or Vertex ADC explicitly. No platform fallback.');
const ai = readAiConfig({ ...process.env, GCP_PROJECT_ID: provider === 'vertex-adc' ? process.env.LOCAL_MODEL_PROJECT : config.projectId });
let persistence;
try {
  persistence = await openFirebasePersistence(process.env);
  const { database, cipher, authority } = persistence, domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
  const state = JSON.parse(await readFile(process.env.LOCAL_AGENT_STATE_FILE, 'utf8'));
  if (state.projectId !== config.projectId || state.storageKey !== process.env.YUBAN_FIREBASE_STORAGE_KEY) throw Error('Local state mismatch');
  try { await authority.readControl(); }
  catch (error) { if (error.code !== 'not_found') throw error; await authority.initializeControl({ generation: state.generation, enabled: true }); }
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
  const store = createFirestoreKnowledgeStore({ ...domain, sourceIds: [manifest.sourceId], observations: refresh.gate });
  const imported = await store.importSource(source);
  // Preserve the original recorded source/terms assessment, not a new claim that
  // the current website was fetched or that other handbook pages were reviewed.
  await store.review(imported.versionId, imported.hash, 'local-reviewed-seed', manifest.assessment);
  let search;
  for (let page = 0; page < 64; page++) {
    search = await store.prepareSearch(imported.versionId, imported.hash);
    if (search.complete) break;
  }
  if (!search?.complete) throw Error('Local search preparation is incomplete; no embedding was started');
  const pending = await store.missingDocuments(imported.versionId);
  if (pending.length > 1) throw Error('Local seed exceeds its one-embedding limit');
  const deadline = Date.now() + 120_000;
  const embedding = provider === 'gemini' ? createGeminiKeyProviders(ai, process.env.LOCAL_MODEL_API_KEY).embedding : createVertexEmbeddingProvider(ai);
  const gateway = createEmbeddingGateway({ config: ai, provider: embedding, usage: createFirestoreOperatorEmbeddingUsage(domain, deadline) });
  let generated = 0;
  for (const document of pending) {
    const result = await store.embedDocument(document, () => gateway.embed({ text: document.text, title: document.title, task: 'RETRIEVAL_DOCUMENT' },
      { kind: 'corpus_maintenance', actorId: 'operator:local-developer', operationId: randomUUID() }, AbortSignal.timeout(120_000), async () => true));
    if (!result.reused) generated++;
  }
  const result = await store.publish(imported.versionId, imported.hash);
  console.log(JSON.stringify({ event: 'local_knowledge_prepared', sourceId: manifest.sourceId, versionId: imported.versionId,
    result, embeddingCalls: generated, reviewedOn: manifest.reviewedOn, coverage: 'one-curated-official-section' }));
} catch (error) {
  // Provider errors may contain request details. Emit only known bounded codes.
  console.error(JSON.stringify({ event: 'local_knowledge_preparation_failed', code: typeof error?.code === 'string' && /^[a-z_]{1,80}$/.test(error.code)
    ? error.code : 'preparation_failed', recovery: 'Inspect local version and original embedding receipt; do not reset and blindly retry.' }));
  process.exitCode = 1;
} finally { await persistence?.close(); }
