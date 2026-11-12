import { AVATAR_LIFECYCLE_RELEASE_READY } from './avatar-release.ts';
import { readAvatarConfig } from './avatar-config.ts';
import { createAvatarCodec, type AvatarCodec } from './avatar-codec.ts';
import { createAvatarObjects, createCloudStorageAvatarObjects } from './firebase-avatar-objects.ts';
import { createFirestoreAvatarStore } from './firestore-avatars.ts';
import { createFirestoreAvatarCleanup } from './firestore-avatar-cleanup.ts';
import { createCloudStorageChatFileObjects, createChatFileObjects } from './firebase-chat-file-objects.ts';
import { createFirestoreChatFilesStore } from './firestore-chat-files.ts';
import { createCloudStorageVoiceObjects, createVoiceObjects } from './firebase-voice-objects.ts';
import { createFirestoreVoiceStore } from './firestore-voice.ts';
import { readContextBasis } from './firestore-context-basis.ts';
import { parseSummaryBackgroundBasis } from './private-summary-work.ts';
import { createFirestoreAdmin } from './firestore-admin.ts';
import { readAdminUid } from './admin-api.ts';
import { createKnowledgeIndexBatches } from './firestore-knowledge-index-batches.ts';
import { createKnowledgeTransfers } from './firestore-knowledge-transfers.ts';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createHash, randomUUID } from 'node:crypto';
import { openFirebasePersistence } from './firebase-persistence.ts';
import { FirestoreDeviceSessions } from './firestore-device-sessions.ts';
import { createFirebaseAuthPort } from './firebase-auth.ts';
import { createFirestoreNativePush } from './firestore-native-push.ts';
import { createNativePushGateway, readNativePushConfig } from './native-push-gateway.ts';
import { createApnsPushGateway, readApnsPushConfig } from './apns-push-gateway.ts';
import { createFirebaseRequestHandler } from './firebase-app.ts';
import { createProactiveDemo } from './proactive-demo.ts';
import { createProactiveWakes, readProactivePolicy } from './firestore-proactive-wakes.ts';
import { profileIsApplicable, topicMayAsk } from './memory-policy.ts';
import { createProactiveEventSources, parseProactivePublicSelections } from './proactive-event-sources.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { createCloudStoragePhotoObjects, createFirebasePhotoObjects, type FirebasePhotoBucketPort } from './firebase-photo-objects.ts';
import { createCloudStorageErasureJournal, createFirebaseErasureJournal } from './firebase-erasure-journal.ts';
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
import { createFirestoreBackgroundDispatcher, readFirestoreBackgroundClaim } from './firestore-background-work.ts';
import { createFirebaseBackgroundDelivery } from './firebase-task-delivery.ts';
import { readFirebaseWorkerConfig } from './firebase-worker-config.ts';
import { combineChatNotificationChannels } from './firestore-chat-notification-queue.ts';
import { createFirestoreWebPush } from './firestore-web-push.ts';
import { createWebPushGateway, readWebPushConfig } from './web-push-gateway.ts';
import { createFirestoreTelegram } from './firestore-telegram.ts';
import { readTelegramConfig } from './telegram-config.ts';
import { createTelegramGateway } from './telegram-gateway.ts';
import { createFirestoreContact } from './firestore-contact.ts';
import { createFirestoreTaskAgentEvents } from './firestore-task-agent.ts';
import { assertLocalAgentEnvironment } from './local-agent-config.ts';
import type { AiConfig } from './ai-config.ts';
import type { PlatformProviderFactory } from './firestore-model-routing.ts';
import { createHandoverService } from './handover-service.ts';
import { createHandoverUploadService } from './handover-upload-service.ts';
import { createHandoverImportService } from './handover-import-service.ts';
import { readHandoverKeys } from './handover-keys.ts';
import { createCloudStorageHandoverObjects, createFirebaseHandoverObjects, type HandoverBucketPort } from './firebase-handover-objects.ts';

export interface LocalRuntimePorts {
  bucket(name: string): FirebasePhotoBucketPort;
  handoverBucket(name: string): HandoverBucketPort;
  modelConfig: AiConfig;
  providers?: PlatformProviderFactory;
  diagnostics?: (event: import('./agent-observer.ts').AgentDiagnostic) => void | Promise<void>;
  bootstrapAccount?: (auth: import('firebase-admin/auth').Auth) => Promise<string>;
  deliveries?: (domain: import('./firestore-domain-data.ts').FirestoreDomainOptions) => import('./local-agent-delivery.ts').LocalDeliveryAdapters;
}

/** Production assembly; only the explicit guarded local entry may inject emulator ports. */
export async function openFirebaseRuntime(env: Record<string, string | undefined>, composition: { worker?: boolean; local?: LocalRuntimePorts } = {}) {
  if (composition.local) {
    assertLocalAgentEnvironment(env);
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      if (env[key] !== process.env[key]) throw new Error('Local SDK emulator environment mismatch');
    }
  }
  else if (env.YUYF_LOCAL_DEVELOPMENT !== undefined) throw new Error('Use the explicit local Agent entry');
  const avatarConfig = readAvatarConfig(env);
  if (avatarConfig.writesEnabled && !AVATAR_LIFECYCLE_RELEASE_READY) throw new Error('Avatar lifecycle release gate is not satisfied');
  const persistence = await openFirebasePersistence(env);
  let app: ReturnType<typeof initializeApp> | undefined, avatarCodec: AvatarCodec | undefined;
  let nativeChatDelivery: ReturnType<typeof createFirebaseBackgroundDelivery> | undefined;
  try {
    const { config, database, cipher, authority } = persistence;
    app = initializeApp({ projectId: config.projectId, ...(composition.local ? {} : { credential: applicationDefault() }) }, 'yuban-' + randomUUID());
    const sessions = new FirestoreDeviceSessions({ database, cipher, projectId: config.projectId, namespace: config.sessionNamespace });
    const nativeAuth = getAuth(app);
    const localAdminUid = await composition.local?.bootstrapAccount?.(nativeAuth);
    const auth = createFirebaseAuthPort({ auth: nativeAuth, sessions, lifecycle: authority,
      publicOrigin: config.publicOrigin, production: config.production,
      ...(composition.local ? { localCookieName: '__local_session_' + createHash('sha256').update(config.projectId).digest('hex').slice(0, 8) } : {}) });
    const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace, messageHistoryEnabled: config.messageHistoryEnabled };
    const objectOptions = { config: { projectId: config.projectId, namespace: config.namespace, bucketName: config.photoBucket }, cipher };
    const journalOptions = { config: { ...objectOptions.config, bucketName: config.erasureBucket }, cipher };
    const objects = composition.local ? createFirebasePhotoObjects({ ...objectOptions, bucket: composition.local.bucket(config.photoBucket) }) : createCloudStoragePhotoObjects(objectOptions);
    const journal = composition.local ? createFirebaseErasureJournal({ ...journalOptions, bucket: composition.local.bucket(config.erasureBucket) }) : createCloudStorageErasureJournal(journalOptions);
    const avatarObjects = composition.local ? createAvatarObjects({ ...objectOptions, bucket: composition.local.bucket(config.photoBucket) })
      : createCloudStorageAvatarObjects(objectOptions);
    avatarCodec = createAvatarCodec(avatarConfig.admission);
    const avatarStore = createFirestoreAvatarStore({ ...domain, config: avatarConfig, codec: avatarCodec, objects: avatarObjects, journal });
    const avatarCleanup = createFirestoreAvatarCleanup({ ...domain, objects: avatarObjects, journal });
    // Cleanup/export remain connected independently of new-write admission. Unsupported public API is explicit 503.
    const avatars = AVATAR_LIFECYCLE_RELEASE_READY ? avatarStore : undefined;
    const photos = createFirestorePhotoStore({ ...domain, objects, journal });
    const erasures = createFirestoreErasureStore({ ...domain, journal });
    const nativeSessions = new FirestoreSessionService({ ...domain, namespace: config.namespace + '_adk' });
    const voiceObjects = composition.local ? createVoiceObjects({ ...objectOptions, bucket: composition.local.bucket(config.photoBucket) }) : createCloudStorageVoiceObjects(objectOptions);
    const voices = createFirestoreVoiceStore({ ...domain, attachmentListPolicy: config.attachmentListPolicy, objects: voiceObjects, journal,
      eraseTranscriptionRun: (userId, sessionId) => nativeSessions.deleteSession({ appName: 'yuban_hk', userId, sessionId }) });
    const fileObjects = composition.local ? createChatFileObjects({ ...objectOptions, bucket: composition.local.bucket(config.photoBucket) }) : createCloudStorageChatFileObjects(objectOptions);
    const files = createFirestoreChatFilesStore({ ...domain, attachmentListPolicy: config.attachmentListPolicy, objects: fileObjects, journal });
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
    const localDelivery = composition.local?.deliveries?.(domain);
    const apnsConfig = localDelivery ? null : await readApnsPushConfig(env);
    const nativePushGateway = localDelivery?.nativePushGateway ?? { ...createNativePushGateway(readNativePushConfig(env)),
      ...(apnsConfig ? { apns: createApnsPushGateway(apnsConfig) } : {}) };
    // Use the same deterministic Tasks identity and dispatch lease as the minute scanner.
    // Local composition retains its loopback transport and never initializes a cloud Tasks client.
    if (!composition.local && config.taskWorkerEnabled && env.FIREBASE_TASKS_QUEUE && env.FIREBASE_TASKS_REGION
      && env.FIREBASE_TASK_WORKER_ORIGIN && env.FIREBASE_TASK_OIDC_AUDIENCE && env.FIREBASE_TASK_DISPATCH_SERVICE_ACCOUNT_EMAIL) {
      const worker = readFirebaseWorkerConfig(env);
      nativeChatDelivery = createFirebaseBackgroundDelivery({ ...worker, workerUrl: worker.workerOrigin + '/internal/product-work' });
    }
    const chatDispatcher = nativeChatDelivery && createFirestoreBackgroundDispatcher({ ...domain, enabled: config.taskWorkerEnabled,
      readControl: tx => authority.readControl(tx), transport: nativeChatDelivery });
    const nativePush = createFirestoreNativePush({ ...domain, gateway: nativePushGateway, sessions, currentAuth,
      dispatchChatWork: chatDispatcher?.dispatchOne });
    const pushConfig = await readWebPushConfig(env), pushGateway = localDelivery?.pushGateway ?? createWebPushGateway(pushConfig);
    const telegramConfig = localDelivery?.telegramConfig ?? await readTelegramConfig(env);
    const telegramGateway = localDelivery?.telegramGateway ?? createTelegramGateway(telegramConfig);
    const push = createFirestoreWebPush({ ...domain, gateway: pushGateway, enabled: !!localDelivery || !!pushConfig, currentAuth,
      sessions, dispatchChatWork:chatDispatcher?.dispatchOne });
    const chatNotifications = combineChatNotificationChannels(nativePush,push);
    const telegram = createFirestoreTelegram({ ...domain, config: telegramConfig, gateway: telegramGateway, currentAuth,
      ...(localDelivery ? { startUrl: localDelivery.telegramStartUrl } : {}) });
    const chat = createFirestoreChatStore({ ...domain, voice: voices, files, photos, notifications: chatNotifications }), care = createFirestoreCareStore(domain);
    const sources = createFirestoreSharedInputStore(domain), concerns = createFirestoreConcernStore(domain);
    const memory = createFirestoreMemoryStore({ ...domain, chat, care });
    const proactiveData = new FirestoreDomainData(domain);
    const reminders = createFirestoreTaskWorker({ ...domain, enabled: config.taskWorkerEnabled, currentAuth,
      async prepareParentContact(b,{opId,text}) {
        if (!(await readProactivePolicy(proactiveData,b)).enabled) return null;
        return chat.prepareParentContact(b,{opId,text,origin:'task'});
      } });
    const summary = createFirestoreCareSummary(domain, care);
    const mutations = [summary.mutation, chat.mutation, care.mutation, memory.mutation, sources.mutation, push.mutation, telegram.mutation, nativePush.mutation];
    const online = createFirestoreOnlineStore({ ...domain, photos, erasures, avatars, reminders, mutations });
    const documents = createFirestoreFamilyDocumentStore({ database, cipher, projectId: config.projectId, namespace: config.namespace });
    const knowledgeRefresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
    const knowledge = config.knowledgeSourceIds === null ? undefined : createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, observations: knowledgeRefresh.gate });
    const proactiveEvents = createProactiveEventSources({...domain,care,knowledge,sourceIds:config.knowledgeSourceIds ?? [],
      managedSelections:parseProactivePublicSelections(env.PROACTIVE_PUBLIC_EVENTS_JSON)});
    const growth = createFirestoreGrowthStore({ ...domain, memory, care, online, knowledge });
    const taskEvents = createFirestoreTaskAgentEvents(domain);
    let product: Awaited<ReturnType<typeof createFirestoreProductAgent>>;
    const proactive = createProactiveWakes(domain, chat, proactiveEvents.readCandidates, chatNotifications, {
      coverage: (binding, candidates) => product.continuation.coverage(binding, candidates),
      async readHouseholdChange(binding, change) {
        if (change.domain === 'profile') {
          return change.id === binding.scope.childId && profileIsApplicable((await care.readProfile(binding)).data);
        }
        if (change.domain === 'memory_topic') {
          const topic = await memory.readTopic(binding, change.id);
          return !!topic && topicMayAsk(topic);
        }
        if (change.domain === 'concern') {
          const concern = await concerns.head(binding, change.id);
          return !!concern && concern.status !== 'closed'
            && !(concern.followUp && ['pending', 'queued', 'unknown'].includes(concern.followUp.state));
        }
        const resource = await product.resourceBasis(binding, { kind: change.domain, id: change.id });
        return resource.available && !resource.terminal;
      },
    });
    const contact = createFirestoreContact({ ...domain, push, telegram, pushGateway, telegramGateway, nativePush, nativePushGateway, telegramBotId: telegramConfig?.botId ?? null, growth,
      runs: () => product.runs, currentAuth });
    mutations.push(contact.mutation);
    const library = knowledge ? createFirestorePersonalLibrary({ authority, knowledge, cipher, projectId: config.projectId, namespace: config.namespace }) : undefined;
    const aiConfig = composition.local?.modelConfig ?? readAiConfig(env);
    product = await createFirestoreProductAgent({ ...domain, config: aiConfig, platformProviders: composition.local?.providers, diagnostics: composition.local?.diagnostics, voices, files, photos, chat, care, summary, memory, online, documents, knowledge, sources, concerns, growth, contact,
      authorizeWorker: composition.worker ? async (b, reference, recipeId) => {
        if (!config.taskWorkerEnabled || !(await authority.readControl(b.transaction)).enabled) return false;
        const job = await readFirestoreBackgroundClaim(new FirestoreDomainData(domain), b, reference); if (!job) return false;
        if (job.kind === 'memory-refresh') {
          const basis = parseSummaryBackgroundBasis(job.basis);
          if (recipeId !== 'memory-refresh' || !basis || basis.kind === 'completion') return false;
          const gate = await product.summaryWork.readEntryGate(b);
          if (gate.kind === 'blocked') return false;
          if (basis.kind === 'part') return gate.kind === 'durable' && product.summaryWork.authorizeBackgroundPart(b, reference);
          const current = await readContextBasis(new FirestoreDomainData(domain), b);
          return job.resourceId === b.scope.childId && current.value.summaryPending === true
            && !current.value.summaryBlocked && current.value.summaryRequest === basis.request;
        }
        if (job.kind === 'work-continuation') return recipeId === 'product-work-followup' && !!await product.continuation.input(b, job);
        if (job.kind === 'proactive-assessment') return recipeId === 'product-work-followup' && !!await proactive.input(b,job);
        if (recipeId !== 'product-background') return false;
        return job.kind === 'concern' ? concerns.authorizeBackground(b, job) : job.kind === 'growth' ? growth.authorizeBackground(b, job)
          : job.kind === 'task-agent' ? !!await taskEvents.input(b, job) && await growth.taskAllowedIn(b, job.resourceId) : false;
      } : undefined });
    const exporter = createFirestoreAccountExport({ ...domain, photos, voices, files, growth, avatars: avatarStore, transcripts: product.voiceTranscripts,
      mixedTranscriptPage:product.runs.mixedTranscriptPage });
    const handoverObjectOptions = { config: objectOptions.config, files: cipher.files };
    const handoverObjects = composition.local ? createFirebaseHandoverObjects({ ...handoverObjectOptions,
      bucket: composition.local.handoverBucket(config.photoBucket) }) : createCloudStorageHandoverObjects(handoverObjectOptions);
    const packageKeys = await readHandoverKeys(env, config.publicOrigin, composition.worker === true);
    const handover = createHandoverService({ ...domain, exporter, objects: handoverObjects, serverId: config.publicOrigin, signingKey: packageKeys.signingKey });
    const handoverUploads = createHandoverUploadService({ ...domain, objects: handoverObjects, trustedKeys: packageKeys.trustedKeys });
    const handoverImports = createHandoverImportService({ ...domain, uploads: handoverUploads, knowledge,
      originalBackup: { serverId: config.publicOrigin, matchesIssuedBackup: handover.matchesIssuedBackup },
      attachments: { files, voices, photos, transcripts: product.voiceTranscripts,
        ...(avatars ? { avatars: { store: avatars, policy: avatarConfig.policy } } : {}) } });
    const erasureCleanup = createFirestoreErasureCleanup({ ...domain, journal, erasures, photos, voices, files, avatars: avatarCleanup, handover, handoverUploads,
      deleteAgentSession: (userId, sessionId) => nativeSessions.deleteSession({ appName: 'yuban_hk', userId, sessionId }),
      eraseAgentUserPage: userId => nativeSessions.eraseUserPage('yuban_hk', userId),
      eraseDeviceSessions: (userId, cursor) => sessions.eraseUserPage(userId, cursor),
      async eraseAuthUser(userId) {
        try { await nativeAuth.deleteUser(userId); } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') throw error;
        }
      },
    });
    const sourceService = createSharedInputService(sources, product.runtime);
    // Enable only after provider/origin configuration readback; this is not proof of mail delivery.
    const photoAgent = createPhotoAgent(photos, product.runtime);
    const configuredAdminUid = localAdminUid ?? readAdminUid(env);
    const knowledgeIndexes = knowledge ? createKnowledgeIndexBatches(domain, knowledge, tx => authority.readControl(tx), configuredAdminUid) : undefined;
    const knowledgeTransfers = knowledge ? createKnowledgeTransfers(domain, tx => authority.readControl(tx)) : undefined;
    const admin = createFirestoreAdmin(domain, aiConfig, knowledgeRefresh, knowledgeIndexes, knowledgeTransfers);
    const handler = createFirebaseRequestHandler({ sharing:createFirestoreSharingStore({...domain,classErasure:erasures}), admin, adminUid: composition.worker && !composition.local ? null : configuredAdminUid, authority, auth, online, documents, photos, avatars, files, voice: { ...voices, transcripts: product.voiceTranscripts }, photoAgent, library, chat, care, summary, memory, product, sources, sourceService, concerns, growth, push, nativePush, contact, telegram: { store: telegram, config: telegramConfig, gateway: telegramGateway }, accountData: { erasures, exporter, packages: handover, packageUploads: handoverUploads, packageImports: handoverImports },
      proactiveDemo: createProactiveDemo(env,authority,chat,chatNotifications), proactiveSettings:(uid,child,command) => authority.runTransaction(uid,child,
        async b => command === undefined ? proactive.view(await proactive.read(b)) : proactive.configure(b,command)),
      publicOrigin: config.publicOrigin, mailConfigured: config.authEmailEnabled });
    const ownedApp = app;
    let closing: Promise<void> | undefined;
    return { proactive,proactiveEvents,...persistence, admin, knowledgeIndexes, configuredAdminUid, sessions, auth, nativeAuth, currentAuth, reminders, online, documents, photos, avatars, avatarObjects, avatarCleanup, voices, voiceObjects, files, fileObjects, objects, journal, erasures, erasureCleanup, exporter, handover, handoverUploads, handoverImports, knowledge, knowledgeRefresh, library, chat, care, summary, memory, sources, sourceService, concerns, growth, push, nativePush, telegram, telegramConfig, telegramGateway, pushGateway, contact, taskEvents, product, handler,
      close() { return closing ??= (async () => {
        try { await nativeChatDelivery?.close(); }
        finally { try { await avatarCodec?.close(); await deleteApp(ownedApp); } finally { await persistence.close(); } }
      })(); } };
  } catch (error) {
    try { await nativeChatDelivery?.close(); }
    finally { try { await avatarCodec?.close(); if (app) await deleteApp(app); } finally { await persistence.close(); } }
    throw error;
  }
}
