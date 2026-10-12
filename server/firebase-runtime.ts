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
import { createFirestorePersonalLibrary } from './firestore-personal-library.ts';

/** Real production clients; no seeded authority, SQL fallback or implicit database initialization. */
export async function openFirebaseRuntime(env: Record<string, string | undefined>) {
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
    const reminders = createFirestoreTaskWorker({ ...domain, enabled: config.taskWorkerEnabled, async currentAuth(userId) {
      try {
        const user = await nativeAuth.getUser(userId);
        return { userId: user.uid, disabled: user.disabled, emailVerified: user.emailVerified, email: user.email ?? null };
      } catch (error) {
        const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'auth/user-not-found' || code === 'auth/user-disabled') return { userId, disabled: true, emailVerified: false, email: null };
        throw new Error('Firebase worker identity unavailable');
      }
    } });
    const online = createFirestoreOnlineStore({ ...domain, photos, reminders });
    const documents = createFirestoreFamilyDocumentStore({ database, cipher, projectId: config.projectId, namespace: config.namespace });
    const knowledge = config.knowledgeSourceIds === null ? undefined : createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds });
    const library = knowledge ? createFirestorePersonalLibrary({ authority, knowledge, cipher, projectId: config.projectId, namespace: config.namespace }) : undefined;
    // Enable only after provider/origin configuration readback; this is not proof of mail delivery.
    const handler = createFirebaseRequestHandler({ authority, auth, online, documents, photos, library, publicOrigin: config.publicOrigin, mailConfigured: config.authEmailEnabled });
    const ownedApp = app;
    let closing: Promise<void> | undefined;
    return { ...persistence, sessions, auth, online, documents, photos, objects, journal, knowledge, library, handler,
      close() { return closing ??= (async () => { try { await deleteApp(ownedApp); } finally { await persistence.close(); } })(); } };
  } catch (error) {
    try { if (app) await deleteApp(app); } finally { await persistence.close(); }
    throw error;
  }
}
