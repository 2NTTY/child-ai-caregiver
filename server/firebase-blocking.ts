import { beforeUserCreated, HttpsError } from "firebase-functions/v2/identity";
import { defineSecret, defineString } from "firebase-functions/params";
import { Firestore } from "@google-cloud/firestore";
import { createStorageCipher } from "./storage-crypto.ts";
import { createFirestoreAuthority } from "./firestore-authority.ts";
import { createFirebaseRegistrationHandler, decodeFirebaseRegistrationStorageKey, type FirebaseRegistrationHandler } from "./firebase-registration.ts";

const projectId = defineString("GCP_PROJECT_ID", { input: { text: { nonEmpty: true, validationRegex: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/ } } });
const databaseId = defineString("FIREBASE_DATABASE_ID", { input: { text: { nonEmpty: true, validationRegex: /^[a-z][a-z0-9-]{2,61}[a-z0-9]$/ } } });
const namespace = defineString("FIREBASE_NAMESPACE", { input: { text: { nonEmpty: true, validationRegex: /^[a-z][a-z0-9_]{0,47}$/ } } });
const serviceAccount = defineString("FIREBASE_BLOCKING_SERVICE_ACCOUNT", { input: { text: {
  nonEmpty: true, validationRegex: /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/,
} } });
const storageKey = defineSecret("YUBAN_FIREBASE_STORAGE_KEY");
const forbiddenDebugAtImport = process.env.FIREBASE_DEBUG_MODE === "true";
let runtimeHandler: FirebaseRegistrationHandler | undefined;

function getRuntimeHandler(): FirebaseRegistrationHandler {
  if (runtimeHandler) return runtimeHandler;
  try {
    const project = projectId.value(), database = databaseId.value(), scope = namespace.value(), account = serviceAccount.value();
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(database)
      || !/^[a-z][a-z0-9_]{0,47}$/.test(scope)
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(account)
      || !account.endsWith("@" + project + ".iam.gserviceaccount.com")
      || process.env.GCLOUD_PROJECT !== undefined && process.env.GCLOUD_PROJECT !== project
      || process.env.FIRESTORE_EMULATOR_HOST !== undefined || process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined
      || forbiddenDebugAtImport || process.env.FIREBASE_DEBUG_MODE === "true") throw new Error("Invalid blocking runtime configuration");
    const key = decodeFirebaseRegistrationStorageKey(storageKey.value());
    let cipher: ReturnType<typeof createStorageCipher>;
    try { cipher = createStorageCipher(key); } finally { key.fill(0); }
    const client = new Firestore({ projectId: project, databaseId: database, maxIdleChannels: 0 });
    const authority = createFirestoreAuthority({ database: client, cipher, projectId: project, namespace: scope });
    runtimeHandler = createFirebaseRegistrationHandler({ authority, projectId: project, tenantId: null });
    return runtimeHandler;
  } catch { throw new HttpsError("unavailable", "Registration is temporarily unavailable"); }
}

/** Native blocking wrapper validates Identity Platform JWTs before reaching the read-only guard. */
export const beforeYubanUserCreated = beforeUserCreated({
  region: "asia-east2",
  cpu: 1,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  timeoutSeconds: 7,
  serviceAccount,
  secrets: [storageKey],
  idToken: false,
  accessToken: false,
  refreshToken: false,
}, event => getRuntimeHandler()(event));

