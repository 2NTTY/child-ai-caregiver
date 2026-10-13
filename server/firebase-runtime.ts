import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openFirebasePersistence } from './firebase-persistence.ts';
import { FirestoreDeviceSessions } from './firestore-device-sessions.ts';
import { createFirebaseAuthPort } from './firebase-auth.ts';
import { createFirebaseRequestHandler } from './firebase-app.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { createCloudStoragePhotoObjects } from './firebase-photo-objects.ts';
import { createCloudStorageErasureJournal } from './firebase-erasure-journal.ts';
import { createFirestorePhotoStore } from './firestore-photos.ts';
import { createFirestoreTaskWorker } from './firestore-task-worker.ts';
import { createFirestoreKnowledgeStore } from './firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from './firestore-knowledge-refresh.ts';
import { SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { createFirestorePersonalLibrary } from './firestore-personal-library.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';
import { createFirestoreCareSummary } from './firestore-care-summary.ts';
import { createFirestoreCareStore } from './firestore-care.ts';
import { createFirestoreMemoryStore } from './firestore-memory.ts';
import { createFirestoreProductAgent } from './firestore-product-agent.ts';
import { readAiConfig } from './ai-config.ts';
import { createPhotoAgent } from './photo-agent.ts';
import { createFirestoreErasureStore } from './firestore-erasure.ts';
import { createFirestoreErasureCleanup } from './firestore-erasure-cleanup.ts';
import { FirestoreSessionService } from './firestore-session-service.ts';
import { createFirestoreAccountExport } from './firestore-account-export.ts';
import { createFirestoreSharedInputStore } from './firestore-shared-inputs.ts';
import { createSharedInputService } from './shared-input-service.ts';

import { createFirestoreGrowthStore } from "./firestore-growth.ts";
import { createFirestoreConcernStore } from "./firestore-concerns.ts";
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { readFirestoreBackgroundClaim } from './firestore-background-work.ts';
import { createFirestoreWebPush } from './firestore-web-push.ts';
import { createWebPushGateway, readWebPushConfig } from './web-push-gateway.ts';
import { createFirestoreTelegram } from './firestore-telegram.ts';
import { readTelegramConfig } from './telegram-config.ts';
import { createTelegramGateway } from './telegram-gateway.ts';
import { createFirestoreContact } from './firestore-contact.ts';
import { createFirestoreTaskAgentEvents } from './firestore-task-agent.ts';

/** Real production clients; no seeded authority, SQL fallback or implicit database initialization. */
export async function openFirebaseRuntime(env: Record<string, string | undefined>, composition: { worker?: boolean } = {}) {
  const persistence = await openFirebasePersistence(env);
  let app: ReturnType<typeof initializeApp> | undefined;
  try {
    const { config, database, cipher, authority } = persistence;
    app = initializeApp({ projectId: config.projectId, credential: applicationDefault() }, 'yuban-' + randomUUID());
    const sessions = new FirestoreDeviceSessions({ database, cipher, projectId: config.projectId, namespace: config.sessionNamespace });
    const nativeAuth = getAuth(app);
    const auth = createFirebaseAuthPort({ auth: nativeAuth, sessions, lifecycle: authority,
      publicOrigin: config.publicOrigin, production: config.production });
    const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
    const objects = createCloudStoragePhotoObjects({ config: { projectId: config.projectId, namespace: config.namespace, bucketName: config.photoBucket }, cipher });
    const journal = createCloudStorageErasureJournal({ config: { projectId: config.projectId, namespace: config.namespace, bucketName: config.erasureBucket }, cipher });
    const photos = createFirestorePhotoStore({ ...domain, objects, journal });
    const erasures = createFirestoreErasureStore({ ...domain, journal });
    const exporter = createFirestoreAccountExport({ ...domain, photos });
    const nativeSessions = new FirestoreSessionService({ ...domain, namespace: config.namespace + '_adk' });
    const erasureCleanup = createFirestoreErasureCleanup({ ...domain, journal, erasures, photos,
      deleteAgentSession: (userId, sessionId) => nativeSessions.deleteSession({ appName: 'yuban_hk', userId, sessionId }),
      eraseAgentUserPage: userId => nativeSessions.eraseUserPage('yuban_hk', userId),
      eraseDeviceSessions: (userId, cursor) => sessions.eraseUserPage(userId, cursor),
      async eraseAuthUser(userId) {
        try { await nativeAuth.deleteUser(userId); } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') throw error;
        }
      },
    });
    const currentAuth = async (userId: string) => {
      try {
        const user = await nativeAuth.getUser(userId);
        return { userId: user.uid, disabled: user.disabled, emailVerified: user.emailVerified, email: user.email ?? null };
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'auth/user-not-found' || code === 'auth/user-disabled') return { userId, disabled: true, emailVerified: false, email: null };
        throw new Error('Firebase worker identity unavailable');
      }
    };
    const reminders = createFirestoreTaskWorker({ ...domain, enabled: config.taskWorkerEnabled, currentAuth });
    const pushConfig = await readWebPushConfig(env), pushGateway = createWebPushGateway(pushConfig);
    const telegramConfig = await readTelegramConfig(env), telegramGateway = createTelegramGateway(telegramConfig);
    const push = createFirestoreWebPush({ ...domain, gateway: pushGateway, enabled: !!pushConfig, currentAuth });
    const telegram = createFirestoreTelegram({ ...domain, config: telegramConfig, gateway: telegramGateway, currentAuth });
    const chat = createFirestoreChatStore(domain), care = createFirestoreCareStore(domain);
    const sources = createFirestoreSharedInputStore(domain), concerns = createFirestoreConcernStore(domain);
    const memory = createFirestoreMemoryStore({ ...domain, chat, care });
    const summary = createFirestoreCareSummary(domain, care);
    const mutations = [summary.mutation, chat.mutation, care.mutation, memory.mutation, sources.mutation, push.mutation, telegram.mutation];
    const online = createFirestoreOnlineStore({ ...domain, photos, erasures, reminders, mutations });
    const documents = createFirestoreFamilyDocumentStore({ database, cipher, projectId: config.projectId, namespace: config.namespace });
    const knowledgeRefresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
    const knowledge = config.knowledgeSourceIds === null ? undefined : createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, observations: knowledgeRefresh.gate });
    const growth = createFirestoreGrowthStore({ ...domain, memory, care, online, knowledge });
    const taskEvents = createFirestoreTaskAgentEvents(domain);
    let product: Awaited<ReturnType<typeof createFirestoreProductAgent>>;
    const contact = createFirestoreContact({ ...domain, push, telegram, pushGateway, telegramGateway, telegramBotId: telegramConfig?.botId ?? null, growth,
      runs: () => product.runs, currentAuth });
    mutations.push(contact.mutation);
    const library = knowledge ? createFirestorePersonalLibrary({ authority, knowledge, cipher, projectId: config.projectId, namespace: config.namespace }) : undefined;
    product = await createFirestoreProductAgent({ ...domain, config: readAiConfig(env), chat, care, summary, memory, online, documents, knowledge, sources, concerns, growth, contact,
      authorizeWorker: composition.worker ? async (b, reference, recipeId) => {
        if (!config.taskWorkerEnabled || !(await authority.readControl(b.transaction)).enabled) return false;
        const job = await readFirestoreBackgroundClaim(new FirestoreDomainData(domain), b, reference); if (!job) return false;
        if (job.kind === 'work-continuation') return recipeId === 'product-work-followup' && !!await product.continuation.input(b, job);
        if (recipeId !== 'product-background') return false;
        return job.kind === 'concern' ? concerns.authorizeBackground(b, job) : job.kind === 'growth' ? growth.authorizeBackground(b, job)
          : job.kind === 'task-agent' ? !!await taskEvents.input(b, job) && await growth.taskAllowedIn(b, job.resourceId) : false;
      } : undefined });
    const sourceService = createSharedInputService(sources, product.runtime);
    // Enable only after provider/origin configuration readback; this is not proof of mail delivery.
    const photoAgent = createPhotoAgent(photos, product.runtime);
    const handler = createFirebaseRequestHandler({ authority, auth, online, documents, photos, photoAgent, library, chat, care, summary, memory, product, sources, sourceService, concerns, growth, push, contact, telegram: { store: telegram, config: telegramConfig, gateway: telegramGateway }, accountData: { erasures, exporter },
      publicOrigin: config.publicOrigin, mailConfigured: config.authEmailEnabled });
    const ownedApp = app;
    let closing: Promise<void> | undefined;
    return { ...persistence, sessions, auth, currentAuth, reminders, online, documents, photos, objects, journal, erasures, erasureCleanup, exporter, knowledge, knowledgeRefresh, library, chat, care, summary, memory, sources, sourceService, concerns, growth, push, telegram, telegramConfig, telegramGateway, pushGateway, contact, taskEvents, product, handler,
      close() { return closing ??= (async () => { try { await deleteApp(ownedApp); } finally { await persistence.close(); } })(); } };
  } catch (error) {
    try { if (app) await deleteApp(app); } finally { await persistence.close(); }
    throw error;
  }
}
