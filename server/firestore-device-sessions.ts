import { createHash } from "node:crypto";
import type { Firestore, DocumentSnapshot } from "@google-cloud/firestore";
import type { StorageCipher } from "./storage-crypto.ts";

const FORMAT = "yuban-firebase-device-session";
const VERSION = 1;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validUserId = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 128 && value.isWellFormed();
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export interface DeviceSessionKey { userId: string; sessionHash: string; }
export interface DeviceSessionIssue extends DeviceSessionKey {
  expiresAtMs: number;
  authTimeSeconds: number;
  /** Only an already verified current cookie/ledger/admission may supply this proof. */
  existingSessionHash?: string;
}
export interface DeviceSessionsPort {
  issue(input: DeviceSessionIssue): Promise<void>;
  assertActive(input: DeviceSessionKey): Promise<void>;
  revokeThis(input: DeviceSessionKey): Promise<void>;
  revokeOthers(input: DeviceSessionKey): Promise<void>;
}
export interface FirestoreDeviceSessionsOptions {
  /** Trusted server-configured pairing. This service never creates or closes a client. */
  database: Firestore;
  cipher: StorageCipher;
  projectId: string;
  namespace: string;
  serverClock?: () => number;
}
export class DeviceSessionError extends Error {
  readonly status: 400 | 401 | 409 | 503;
  readonly code: string;
  constructor(status: DeviceSessionError["status"], code: string) {
    super("Device session request rejected"); this.name = "DeviceSessionError"; this.status = status; this.code = code;
  }
}
interface SessionControl {
  userId: string;
  generation: number;
  revokedBefore: number | null;
  retainedSessionHash: string | null;
}
interface SessionRecord extends DeviceSessionIssue { generation: number; revoked: boolean; }
type Kind = "sessionControl" | "deviceSession";

/** Point-read, encrypted, server-only ledger independent of ADK session storage. */
export class FirestoreDeviceSessions implements DeviceSessionsPort {
  #database: Firestore;
  #cipher: StorageCipher;
  #projectId: string;
  #namespace: string;
  #clock: () => number;
  constructor(options: FirestoreDeviceSessionsOptions) {
    const { database, cipher, projectId, namespace, serverClock } = options;
    if (typeof database?.collection !== "function" || typeof database.runTransaction !== "function"
      || typeof cipher?.encrypt !== "function" || typeof cipher.decrypt !== "function"
      || typeof projectId !== "string" || !projectId || projectId !== projectId.trim() || !projectId.isWellFormed()
      || !/^[a-z][a-z0-9_]{0,60}$/.test(namespace) || serverClock !== undefined && typeof serverClock !== "function") {
      throw new DeviceSessionError(400, "invalid_configuration");
    }
    this.#database = database; this.#cipher = cipher; this.#projectId = projectId; this.#namespace = namespace;
    this.#clock = serverClock ?? Date.now;
  }
  #now() {
    const now = this.#clock();
    if (!integer(now)) throw new DeviceSessionError(503, "device_sessions_unavailable");
    return now;
  }
  #key(input: DeviceSessionKey) {
    if (!validUserId(input?.userId) || !validHash(input?.sessionHash)) throw new DeviceSessionError(400, "invalid_session_identity");
    return { userId: input.userId, sessionHash: input.sessionHash };
  }
  #paths(key: DeviceSessionKey) {
    const collection = this.#database.collection(this.#namespace);
    return { control: collection.doc("auth-control-" + digest(key.userId)), session: collection.doc("auth-session-" + key.sessionHash) };
  }
  #aad(kind: Kind, key: DeviceSessionKey) {
    return JSON.stringify([FORMAT, VERSION, this.#projectId, this.#namespace, kind, key.userId,
      kind === "deviceSession" ? key.sessionHash : null]);
  }
  #seal(kind: Kind, key: DeviceSessionKey, value: SessionControl | SessionRecord) {
    return { format: FORMAT, version: VERSION, kind, ciphertext: this.#cipher.encrypt(JSON.stringify(value), this.#aad(kind, key)) };
  }
  #open(snapshot: DocumentSnapshot, kind: Kind, key: DeviceSessionKey): Record<string, unknown> {
    try {
      const envelope: unknown = snapshot.data();
      if (!record(envelope) || Object.keys(envelope).sort().join(",") !== "ciphertext,format,kind,version"
        || envelope.format !== FORMAT || envelope.version !== VERSION || envelope.kind !== kind || typeof envelope.ciphertext !== "string") throw new Error();
      const value: unknown = JSON.parse(this.#cipher.decrypt(envelope.ciphertext, this.#aad(kind, key)));
      if (!record(value) || value.userId !== key.userId) throw new Error();
      return value;
    } catch { throw new DeviceSessionError(503, "device_sessions_unavailable"); }
  }
  #control(snapshot: DocumentSnapshot, key: DeviceSessionKey): SessionControl {
    const value = this.#open(snapshot, "sessionControl", key);
    if (Object.keys(value).sort().join(",") !== "generation,retainedSessionHash,revokedBefore,userId"
      || !integer(value.generation) || value.revokedBefore !== null && !integer(value.revokedBefore)
      || value.retainedSessionHash !== null && !validHash(value.retainedSessionHash)) throw new DeviceSessionError(503, "device_sessions_unavailable");
    return value as unknown as SessionControl;
  }
  #session(snapshot: DocumentSnapshot, key: DeviceSessionKey): SessionRecord {
    const value = this.#open(snapshot, "deviceSession", key);
    if (Object.keys(value).sort().join(",") !== "authTimeSeconds,expiresAtMs,generation,revoked,sessionHash,userId"
      || value.sessionHash !== key.sessionHash || !integer(value.generation) || !integer(value.authTimeSeconds)
      || !integer(value.expiresAtMs) || typeof value.revoked !== "boolean") throw new DeviceSessionError(503, "device_sessions_unavailable");
    return value as unknown as SessionRecord;
  }
  #active(control: SessionControl, session: SessionRecord, now: number) {
    if (session.revoked || session.expiresAtMs <= now || session.generation !== control.generation) {
      throw new DeviceSessionError(401, "session_invalid");
    }
  }
  async #transaction<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof DeviceSessionError) throw error;
      throw new DeviceSessionError(503, "device_sessions_unavailable");
    }
  }

  async issue(input: DeviceSessionIssue): Promise<void> {
    const key = this.#key(input), now = this.#now();
    if (input.existingSessionHash !== undefined && !validHash(input.existingSessionHash)) throw new DeviceSessionError(400, "invalid_session_identity");
    if (!integer(input.expiresAtMs) || input.expiresAtMs <= now || !integer(input.authTimeSeconds)
      || input.authTimeSeconds > Math.floor(now / 1000)) throw new DeviceSessionError(400, "invalid_session_lifetime");
    const paths = this.#paths(key);
    await this.#transaction(() => this.#database.runTransaction(async transaction => {
      const [controlSnapshot, sessionSnapshot] = await transaction.getAll(paths.control, paths.session);
      if (!controlSnapshot.exists && sessionSnapshot.exists) throw new DeviceSessionError(503, "device_sessions_unavailable");
      const control: SessionControl = controlSnapshot.exists ? this.#control(controlSnapshot, key)
        : { userId: key.userId, generation: 0, revokedBefore: null, retainedSessionHash: null };
      if (sessionSnapshot.exists) {
        const session = this.#session(sessionSnapshot, key);
        this.#active(control, session, now);
        if (session.expiresAtMs !== input.expiresAtMs || session.authTimeSeconds !== input.authTimeSeconds) {
          throw new DeviceSessionError(409, "session_binding_conflict");
        }
        // Lost commit acknowledgement may safely retry only this identical, still-active cookie.
        if (control.revokedBefore !== null && input.authTimeSeconds <= control.revokedBefore
          && (control.retainedSessionHash !== key.sessionHash || input.existingSessionHash !== key.sessionHash)) {
          throw new DeviceSessionError(409, "recent_reauthentication_required");
        }
        return;
      }
      if (control.revokedBefore !== null && input.authTimeSeconds <= control.revokedBefore) {
        throw new DeviceSessionError(409, "recent_reauthentication_required");
      }
      if (!controlSnapshot.exists) transaction.create(paths.control, this.#seal("sessionControl", key, control));
      transaction.create(paths.session, this.#seal("deviceSession", key, {
        ...key, expiresAtMs: input.expiresAtMs, authTimeSeconds: input.authTimeSeconds, generation: control.generation, revoked: false,
      }));
    }));
  }

  async assertActive(input: DeviceSessionKey): Promise<void> {
    const key = this.#key(input), paths = this.#paths(key), now = this.#now();
    await this.#transaction(() => this.#database.runTransaction(async transaction => {
      const [controlSnapshot, sessionSnapshot] = await transaction.getAll(paths.control, paths.session);
      if (!controlSnapshot.exists || !sessionSnapshot.exists) throw new DeviceSessionError(401, "session_invalid");
      this.#active(this.#control(controlSnapshot, key), this.#session(sessionSnapshot, key), now);
    }, { readOnly: true }));
  }
  async revokeThis(input: DeviceSessionKey): Promise<void> {
    const key = this.#key(input), paths = this.#paths(key);
    await this.#transaction(() => this.#database.runTransaction(async transaction => {
      const [controlSnapshot, sessionSnapshot] = await transaction.getAll(paths.control, paths.session);
      if (!sessionSnapshot.exists) return;
      if (!controlSnapshot.exists) throw new DeviceSessionError(503, "device_sessions_unavailable");
      const control = this.#control(controlSnapshot, key), session = this.#session(sessionSnapshot, key);
      if (session.revoked) return;
      transaction.set(paths.session, this.#seal("deviceSession", key, { ...session, revoked: true }));
      if (control.retainedSessionHash === key.sessionHash) {
        transaction.set(paths.control, this.#seal("sessionControl", key, { ...control, retainedSessionHash: null }));
      }
    }));
  }
  async revokeOthers(input: DeviceSessionKey): Promise<void> {
    const key = this.#key(input), paths = this.#paths(key), now = this.#now();
    await this.#transaction(() => this.#database.runTransaction(async transaction => {
      const [controlSnapshot, sessionSnapshot] = await transaction.getAll(paths.control, paths.session);
      if (!controlSnapshot.exists || !sessionSnapshot.exists) throw new DeviceSessionError(401, "session_invalid");
      const control = this.#control(controlSnapshot, key), session = this.#session(sessionSnapshot, key);
      this.#active(control, session, now);
      if (control.generation === Number.MAX_SAFE_INTEGER) throw new DeviceSessionError(503, "device_sessions_unavailable");
      const next: SessionControl = { ...control, generation: control.generation + 1, retainedSessionHash: key.sessionHash,
        revokedBefore: Math.max(control.revokedBefore ?? 0, Math.floor(now / 1000)) };
      transaction.set(paths.control, this.#seal("sessionControl", key, next));
      transaction.set(paths.session, this.#seal("deviceSession", key, { ...session, generation: next.generation }));
    }));
  }
}
