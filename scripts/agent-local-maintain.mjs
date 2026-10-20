import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { createFirestoreKnowledgeMaintenance } from '../server/firestore-knowledge-maintenance.ts';
import { backgroundKnowledgeRunRequestSchema, M03_INITIAL_WATCH_IDS } from '../src/shared/background-knowledge-maintenance.ts';
import { backgroundKnowledgeOperationFingerprint } from '../server/background-knowledge-maintenance.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { fetchKnowledgeSource } from '../server/knowledge-source-fetch.ts';
import { parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createGeminiKeyProviders } from '../server/gemini-key-provider.ts';

// Explicit operator command; no public HTTP bypass or second Agent implementation.
const config = assertLocalAgentEnvironment(process.env);
const state = JSON.parse(await readFile(process.env.LOCAL_AGENT_STATE_FILE, 'utf8'));
if (state.projectId !== config.projectId || state.storageKey !== process.env.YUBAN_FIREBASE_STORAGE_KEY) throw Error('Local state binding mismatch');
const watchId = process.env.LOCAL_KNOWLEDGE_WATCH, live = process.env.LOCAL_KNOWLEDGE_LIVE_SOURCE === 'true';
const provider = process.env.LOCAL_MODEL_PROVIDER;
if (!M03_INITIAL_WATCH_IDS.includes(watchId)) throw Error('Watch outside the current reviewed scope');
if (!['gemini', 'vertex-adc'].includes(provider) || process.env.AI_ENABLED !== 'true')
  throw Error('Knowledge maintenance needs a configured Gemini key or Vertex ADC including embedding; no platform fallback');
const base = readAiConfig({ ...process.env, GCP_PROJECT_ID: provider === 'vertex-adc' ? process.env.LOCAL_MODEL_PROJECT : config.projectId });
const directory = dirname(process.env.LOCAL_AGENT_STATE_FILE), workPath = join(directory, 'maintenance-work.json');
const resultPath = join(directory, 'maintenance-result.json');
let persistence;
try {
  let fixture;
  if (!live) {
    const manifest = JSON.parse(await readFile(new URL('../knowledge/local-development-seed.json', import.meta.url), 'utf8'));
    const sources = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'));
    const source = parseKnowledgeSource(sources.find(item => item.sourceId === manifest.sourceId));
    if (watchId !== manifest.sourceId || sourceVersionHash(source) !== manifest.versionHash) throw Error('No reviewed fixture for this watch');
    fixture = { url: source.url, title: source.title, text: source.chunks.map(chunk => chunk.originalText).join('\n\n'),
      sourcePublishedAt: source.sourcePublishedAt, sourceUpdatedAt: source.sourceUpdatedAt, sourceDateText: source.sourceDateText ?? null };
  }
  persistence = await openFirebasePersistence(process.env);
  const { database, cipher, authority } = persistence;
  const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
  try { await authority.readControl(); }
  catch (error) { if (error.code !== 'not_found') throw error; await authority.initializeControl({ generation: state.generation, enabled: true }); }
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
  let stored;
  try { stored = JSON.parse(await readFile(workPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (process.env.LOCAL_KNOWLEDGE_NEW_WORK === 'true') stored = undefined;
  if (stored && (stored.projectId !== config.projectId || stored.watchId !== watchId || stored.live !== live))
    throw Error('Existing work has different scope; inspect it before explicitly starting new work');
  if (!stored) {
    await refresh.register(watchId, 'local-developer');
    const job = (await refresh.jobs()).find(item => item.data.watchId === watchId);
    if (!job) throw Error('Local watch not available');
    const request = backgroundKnowledgeRunRequestSchema.parse({ watchId, workerGeneration: job.data.workerGeneration, publishMode: 'live',
      operationFingerprint: backgroundKnowledgeOperationFingerprint({ ...job.data, slot: randomUUID() }) });
    stored = { projectId: config.projectId, watchId, live, request };
    // Preserve every prior identity and result, even when a developer explicitly
    // creates another work item after editing code. Never overwrite old evidence.
    await writeFile(join(directory, `maintenance-${request.operationFingerprint}.json`), JSON.stringify(stored), { mode: 0o600, flag: 'wx' });
    await writeFile(workPath, JSON.stringify(stored), { mode: 0o600 });
  }
  const request = backgroundKnowledgeRunRequestSchema.parse(stored.request);
  const knowledge = createFirestoreKnowledgeStore({ ...domain, sourceIds: [watchId], observations: refresh.gate });
  const maintenance = createFirestoreKnowledgeMaintenance({ ...domain, knowledge, refresh,
    config: { ...base, backgroundKnowledgeMaintenanceEnabled: true, backgroundKnowledgeLiveFetch: live, backgroundKnowledgeLivePublish: true },
    // A credential change cannot silently continue a different payer's work.
    credentialBinding: createHash('sha256').update(JSON.stringify([provider, base.project,
      provider === 'gemini' ? process.env.LOCAL_MODEL_API_KEY : process.env.GOOGLE_APPLICATION_CREDENTIALS ?? 'local-adc'])).digest('hex'),
    ...(provider === 'gemini' ? { providers: selected => createGeminiKeyProviders(selected, process.env.LOCAL_MODEL_API_KEY,
      'gemini', { documentEmbeddings: true }) } : {}),
    readControl: tx => authority.readControl(tx), fetch: fetchKnowledgeSource,
    ...(fixture ? { fixtureFetch: async () => ({ status: 'ok', items: [fixture] }), isolatedFixturePublish: true } : {}),
  });
  const result = await maintenance.start(request);
  const report = { sourceMode: live ? 'allowlisted-website' : 'reviewed-local-fixture', operationFingerprint: request.operationFingerprint, ...result };
  await writeFile(resultPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(join(directory, `maintenance-${request.operationFingerprint}-result.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (!result.published && result.status !== 'unchanged' && !(result.status === 'already_recorded' && result.code === 'unchanged')) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ event: 'local_knowledge_maintenance_failed',
    code: typeof error?.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code : 'maintenance_failed',
    recovery: 'Original work and usage retained. Inspect the same work; do not reset or automatically retry.' }));
  process.exitCode = 1;
} finally { await persistence?.close(); }
