import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openFirebasePersistence } from './firebase-persistence.ts';
import { FirestoreDeviceSessions } from './firestore-device-sessions.ts';
import { createFirebaseAuthPort } from './firebase-auth.ts';
import { createFirebaseRequestHandler } from './firebase-app.ts';

/** Real production clients; no seeded authority, SQL fallback or implicit database initialization. */
export async function openFirebaseRuntime(env: Record<string, string | undefined>) {
  const persistence = await openFirebasePersistence(env);
  let app: ReturnType<typeof initializeApp> | undefined;
  try {
    const { config, database, cipher, authority } = persistence;
    app = initializeApp({ projectId: config.projectId, credential: applicationDefault() }, 'yuban-' + randomUUID());
    const sessions = new FirestoreDeviceSessions({ database, cipher, projectId: config.projectId, namespace: config.sessionNamespace });
    const auth = createFirebaseAuthPort({ auth: getAuth(app), sessions, lifecycle: authority,
      publicOrigin: config.publicOrigin, production: config.production });
    // Email actions become available only after F02 provider configuration and real delivery verification.
    const handler = createFirebaseRequestHandler({ authority, auth, publicOrigin: config.publicOrigin, mailConfigured: false });
    const ownedApp = app;
    let closing: Promise<void> | undefined;
    return { ...persistence, sessions, auth, handler,
      close() { return closing ??= (async () => { try { await deleteApp(ownedApp); } finally { await persistence.close(); } })(); } };
  } catch (error) {
    try { if (app) await deleteApp(app); } finally { await persistence.close(); }
    throw error;
  }
}
