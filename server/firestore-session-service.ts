import { BaseSessionService, State, createSession } from '@google/adk';
import type { AppendEventRequest, CreateSessionRequest, DeleteSessionRequest, Event, GetSessionRequest, ListSessionsRequest, ListSessionsResponse, Session } from '@google/adk';
import type { Firestore, DocumentSnapshot, Query } from '@google-cloud/firestore';
import type { StorageCipher } from './storage-crypto.ts';
import type { EncryptedJson, SessionKey, StateMap } from './firestore-session-codec.ts';
import { randomUUID } from 'node:crypto';
import { canonical, createCodec, encodeId, identity, isRecord, limitDocument, MAX_EVENTS, MAX_LIST_SESSIONS, persistentEvent, reject } from './firestore-session-codec.ts';

function split(state: StateMap) {
  const app: StateMap = Object.create(null), user: StateMap = Object.create(null), session: StateMap = Object.create(null);
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith(State.TEMP_PREFIX)) continue;
    if (key.startsWith(State.APP_PREFIX)) app[key.slice(State.APP_PREFIX.length)] = value;
    else if (key.startsWith(State.USER_PREFIX)) user[key.slice(State.USER_PREFIX.length)] = value;
    else session[key] = value;
  }
  return { app, user, session };
}
function merge(app: StateMap, user: StateMap, session: StateMap): StateMap {
  const result = { ...session };
  for (const [key, value] of Object.entries(app)) Object.defineProperty(result, State.APP_PREFIX + key, { value, enumerable: true, writable: true, configurable: true });
  for (const [key, value] of Object.entries(user)) Object.defineProperty(result, State.USER_PREFIX + key, { value, enumerable: true, writable: true, configurable: true });
  return result;
}

export interface FirestoreSessionServiceOptions {
  /** A server-owned, already configured client. The caller owns its lifecycle. */
  database: Firestore;
  cipher: StorageCipher;
  /** Trusted server pairing with database; the SDK exposes no public project getter. */
  projectId: string;
  namespace: string;
}
interface SessionHeader {
  version: 1;
  /** Per-create nonce; absent only on sessions written before owned cleanup. */
  incarnation?: string;
  status: 'active' | 'deleting';
  revision: number;
  lastUpdateTime: number;
  state: EncryptedJson;
}
interface SessionMarker { key: SessionKey; revision: number; busy: boolean; poisoned: boolean; }

/**
 * Server-only native ADK session storage. Never construct from HTTP/model input.
 * The caller supplies and closes the Firestore client; this class does not read
 * environment/auth configuration, create resources, or register product routes.
 * Project/client pairing belongs to the server composer; this constructor cannot
 * synchronously verify the remote project through the public SDK API.
 * Append failures poison the original Session: stop the invocation and fresh-get.
 * JSON history is bounded to 64 events, documents to 900 KiB, and lists to 100.
 */
export class FirestoreSessionService extends BaseSessionService {
  #database: Firestore;
  #codec: ReturnType<typeof createCodec>;
  #namespace: string;
  #markers = new WeakMap<Session, SessionMarker>();
  #created = new WeakMap<Session, { key: SessionKey; incarnation: string }>();
  constructor({ database, cipher, projectId, namespace }: FirestoreSessionServiceOptions) {
    super();
    if (typeof projectId !== 'string' || !projectId || projectId !== projectId.trim() || !projectId.isWellFormed()
      || typeof namespace !== 'string' || !/^[a-z][a-z0-9_]{0,60}$/.test(namespace)
      || typeof database?.collection !== 'function' || typeof database.runTransaction !== 'function' || typeof database.batch !== 'function'
      || typeof cipher?.encrypt !== 'function' || typeof cipher.decrypt !== 'function') reject('invalid_configuration');
    this.#database = database;
    this.#namespace = namespace;
    this.#codec = createCodec(cipher, projectId, namespace);
  }
  #paths(key: SessionKey) {
    const app = this.#database.collection(this.#namespace).doc(encodeId(key.appName));
    const user = app.collection('users').doc(encodeId(key.userId));
    const session = user.collection('sessions').doc(encodeId(key.sessionId));
    return { app, user, session, events: session.collection('events') };
  }
  #readHeader(snapshot: DocumentSnapshot): SessionHeader {
    if (!snapshot.exists) reject('session_not_found');
    const header = snapshot.data() as SessionHeader;
    if (header.version !== 1 || !Number.isSafeInteger(header.revision) || header.revision < 0
      || !['active', 'deleting'].includes(header.status) || !Number.isFinite(header.lastUpdateTime)
      || header.incarnation !== undefined && (typeof header.incarnation !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(header.incarnation))) reject('invalid_session_header');
    return header;
  }
  #active(snapshot: DocumentSnapshot): SessionHeader {
    const header = this.#readHeader(snapshot);
    if (header.status !== 'active') reject('session_deleting');
    return header;
  }
  #state(snapshot: DocumentSnapshot, kind: 'app' | 'user', key: SessionKey): StateMap { return snapshot.exists ? this.#codec.open(kind, key, snapshot.get('state')) : {}; }
  #make(key: SessionKey, header: SessionHeader, app: StateMap, user: StateMap, events: Event[]): Session {
    const session = createSession({ id: key.sessionId, appName: key.appName, userId: key.userId,
      state: merge(app, user, this.#codec.open('session', key, header.state)), events, lastUpdateTime: header.lastUpdateTime });
    this.#markers.set(session, { key, revision: header.revision, busy: false, poisoned: false });
    return session;
  }

  async createSession({ appName, userId, sessionId = randomUUID(), state = {} }: CreateSessionRequest): Promise<Session> {
    const key = identity({ appName, userId, sessionId });
    if (!isRecord(state)) reject('invalid_state');
    const initial = split(JSON.parse(canonical(state))), paths = this.#paths(key), now = Date.now(), incarnation = randomUUID();
    const saved = await this.#database.runTransaction(async transaction => {
      const [session, app, user] = await transaction.getAll(paths.session, paths.app, paths.user);
      if (session.exists) reject('session_exists');
      const appState = { ...this.#state(app, 'app', key), ...initial.app };
      const userState = { ...this.#state(user, 'user', key), ...initial.user };
      const header = limitDocument<SessionHeader>({ version: 1, incarnation, status: 'active', revision: 0, lastUpdateTime: now,
        state: this.#codec.seal('session', key, initial.session) });
      transaction.set(paths.app, limitDocument({ version: 1, state: this.#codec.seal('app', key, appState) }));
      transaction.set(paths.user, limitDocument({ version: 1, state: this.#codec.seal('user', key, userState) }));
      transaction.create(paths.session, header);
      return { header, appState, userState };
    });
    const session = this.#make(key, saved.header, saved.appState, saved.userState, []);
    this.#created.set(session, { key, incarnation });
    return session;
  }

  async getSession({ appName, userId, sessionId, config }: GetSessionRequest): Promise<Session | undefined> {
    const key = identity({ appName, userId, sessionId }), paths = this.#paths(key);
    const recent = config?.numRecentEvents;
    if (recent !== undefined && (!Number.isSafeInteger(recent) || recent < 0 || recent > MAX_EVENTS)) reject('invalid_event_limit');
    if (config?.afterTimestamp !== undefined && !Number.isFinite(config.afterTimestamp)) reject('invalid_timestamp');
    const saved = await this.#database.runTransaction(async transaction => {
      const [snapshot, app, user] = await transaction.getAll(paths.session, paths.app, paths.user);
      if (!snapshot.exists) return undefined;
      const header = this.#active(snapshot);
      let events: Event[] = [];
      if (recent !== 0) {
        let query: Query = paths.events;
        if (config?.afterTimestamp !== undefined) query = query.where('timestamp', '>=', config.afterTimestamp);
        query = query.orderBy('timestamp', recent === undefined ? 'asc' : 'desc').orderBy('id', recent === undefined ? 'asc' : 'desc').limit(recent ?? MAX_EVENTS + 1);
        const rows = await transaction.get(query);
        if (rows.size > MAX_EVENTS) reject('event_capacity');
        events = rows.docs.map(row => {
          const id = row.get('id'); encodeId(id);
          if (row.id !== encodeId(id)) reject('event_identity_mismatch');
          const event = this.#codec.open<Event>('event', key, row.get('event'), id);
          if (event.id !== id || event.timestamp !== row.get('timestamp')) reject('event_identity_mismatch');
          return event;
        });
        if (recent !== undefined) events.reverse();
      }
      return { header, app: this.#state(app, 'app', key), user: this.#state(user, 'user', key), events };
    }, { readOnly: true });
    return saved ? this.#make(key, saved.header, saved.app, saved.user, saved.events) : undefined;
  }

  async listSessions({ appName, userId, limit, offset, page, order }: ListSessionsRequest): Promise<ListSessionsResponse> {
    // Owner-only bounded listing; overflow fails rather than claiming a partial total.
    if (!userId) reject('owner_required');
    const key = identity({ appName, userId, sessionId: 'list-sentinel' }), paths = this.#paths(key);
    for (const value of [limit, offset]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) reject('invalid_pagination');
    if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) reject('invalid_pagination');
    if (order !== undefined && !['asc', 'desc'].includes(order)) reject('invalid_pagination');
    const saved = await this.#database.runTransaction(async transaction => {
      const [app, user] = await transaction.getAll(paths.app, paths.user);
      const rows = await transaction.get(paths.user.collection('sessions').where('status', '==', 'active').limit(MAX_LIST_SESSIONS + 1));
      if (rows.size > MAX_LIST_SESSIONS) reject('session_list_capacity');
      const states = { app: this.#state(app, 'app', key), user: this.#state(user, 'user', key) };
      return rows.docs.map(snapshot => {
        const encoded = snapshot.id;
        if (!encoded.startsWith('i-')) reject('invalid_identity');
        const sessionId = Buffer.from(encoded.slice(2), 'base64url').toString('utf8');
        if (encodeId(sessionId) !== encoded) reject('invalid_identity');
        return { key: identity({ appName, userId, sessionId }), header: this.#active(snapshot), ...states };
      });
    }, { readOnly: true });
    saved.sort((a, b) => (a.header.lastUpdateTime - b.header.lastUpdateTime || a.key.sessionId.localeCompare(b.key.sessionId)) * (order === 'desc' ? -1 : 1));
    const totalItems = saved.length, size = limit ?? totalItems;
    const start = page !== undefined ? (page - 1) * size : offset ?? 0;
    const selected = saved.slice(start, start + size);
    // List snapshots are read-only projections; only get/create issue append markers.
    const sessions = selected.map(item => createSession({ id: item.key.sessionId, appName, userId,
      state: merge(item.app, item.user, this.#codec.open('session', item.key, item.header.state)), events: [], lastUpdateTime: item.header.lastUpdateTime }));
    return { sessions, totalItems, page: page ?? (size ? Math.floor(start / size) + 1 : 1), limit: size, totalPages: size ? Math.ceil(totalItems / size) : 0 };
  }

  async appendEvent({ session, event }: AppendEventRequest): Promise<Event> {
    const marker = this.#markers.get(session);
    if (!marker || marker.poisoned) reject('session_requires_reload');
    if (marker.busy) reject('session_busy');
    marker.busy = true;
    try {
      const { key, revision } = marker;
      if (session.id !== key.sessionId || session.appName !== key.appName || session.userId !== key.userId) reject('session_identity_changed');
      if (event.partial) return await super.appendEvent({ session, event });
      const captured = persistentEvent(event, State.TEMP_PREFIX), payload = canonical(captured);
      encodeId(captured.id);
      if (!Number.isFinite(captured.timestamp)) reject('invalid_timestamp');
      const paths = this.#paths(key), eventRef = paths.events.doc(encodeId(captured.id));
      const duplicate = await this.#database.runTransaction(async transaction => {
        const [snapshot, existing] = await transaction.getAll(paths.session, eventRef);
        const header = this.#active(snapshot);
        if (header.revision !== revision) reject('revision_conflict');
        return existing.exists && canonical(this.#codec.open('event', key, existing.get('event'), captured.id)) === payload;
      }, { readOnly: true });
      if (canonical(persistentEvent(event, State.TEMP_PREFIX)) !== payload) reject('event_changed_during_preflight');
      if (duplicate) return event;

      // Keep the original objects and ADK's private in-process write ordering.
      // This executes once, outside retryable Firestore transaction callbacks.
      const accepted = await super.appendEvent({ session, event });
      if (canonical(accepted) !== payload) reject('native_payload_changed');
      const postState = JSON.parse(canonical(session.state)) as StateMap, sessionState = split(postState).session;
      const eventRecord = limitDocument({ version: 1, id: captured.id, timestamp: captured.timestamp,
        event: this.#codec.seal('event', key, captured, captured.id) });
      const sessionEnvelope = this.#codec.seal('session', key, sessionState);
      await this.#database.runTransaction(async transaction => {
        const [snapshot, existing, app, user] = await transaction.getAll(paths.session, eventRef, paths.app, paths.user);
        const header = this.#active(snapshot);
        if (header.revision !== revision) reject('revision_conflict');
        const all = await transaction.get(paths.events.limit(MAX_EVENTS + 1));
        if (all.size > MAX_EVENTS || !existing.exists && all.size >= MAX_EVENTS) reject('event_capacity');
        const appState = this.#state(app, 'app', key), userState = this.#state(user, 'user', key);
        for (const name of Object.keys(captured.actions.stateDelta)) {
          if (name.startsWith(State.APP_PREFIX)) Object.defineProperty(appState, name.slice(State.APP_PREFIX.length), { value: postState[name], enumerable: true, writable: true, configurable: true });
          else if (name.startsWith(State.USER_PREFIX)) Object.defineProperty(userState, name.slice(State.USER_PREFIX.length), { value: postState[name], enumerable: true, writable: true, configurable: true });
        }
        const next = limitDocument({ ...header, revision: revision + 1, lastUpdateTime: captured.timestamp, state: sessionEnvelope });
        const appRecord = limitDocument({ version: 1, state: this.#codec.seal('app', key, appState) });
        const userRecord = limitDocument({ version: 1, state: this.#codec.seal('user', key, userState) });
        transaction.set(eventRef, eventRecord);
        transaction.set(paths.session, next);
        transaction.set(paths.app, appRecord);
        transaction.set(paths.user, userRecord);
      });
      // Native super retains the original Event/history object. External mutation
      // while commit was pending invalidates this local Session even if DB committed.
      if (canonical(accepted) !== payload) reject('event_changed_during_commit');
      marker.revision = revision + 1;
      session.lastUpdateTime = captured.timestamp;
      return accepted;
    } catch (error) {
      marker.poisoned = true;
      throw error;
    } finally { marker.busy = false; }
  }

  async deleteSession(request: DeleteSessionRequest): Promise<void> {
    return this.#delete(identity(request));
  }

  /**
   * Teardown only for the exact object returned by this instance's confirmed
   * create. Read/list/forged objects grant no ownership. A stale cleanup cannot
   * remove a newer incarnation, even if it runs after the caller's timeout.
   * This never touches shared state, budget/usage ledgers or business receipts.
   */
  async cleanupCreatedSession(session: Session): Promise<void> {
    const owned = this.#created.get(session);
    if (!owned) reject('session_cleanup_not_owned');
    await this.#delete(owned.key, owned.incarnation);
  }

  async #delete(key: SessionKey, incarnation?: string): Promise<void> {
    const paths = this.#paths(key);
    const exists = await this.#database.runTransaction(async transaction => {
      const snapshot = await transaction.get(paths.session);
      if (!snapshot.exists) return false;
      const header = this.#readHeader(snapshot);
      if (incarnation !== undefined && header.incarnation !== incarnation) return false;
      if (header.status === 'active') transaction.update(paths.session, { status: 'deleting', revision: header.revision + 1 });
      return true;
    });
    if (!exists) return;
    const deleting = await this.#database.runTransaction(async transaction => {
      const snapshot = await transaction.get(paths.session);
      if (!snapshot.exists) return undefined;
      const header = this.#readHeader(snapshot);
      if (incarnation !== undefined && header.incarnation !== incarnation) return undefined;
      if (header.status !== 'deleting') reject('delete_conflict');
      const events = await transaction.get(paths.events.limit(MAX_EVENTS + 1));
      if (events.size > MAX_EVENTS) reject('event_capacity');
      return { updateTime: snapshot.updateTime, events: events.docs.map(event => event.ref) };
    }, { readOnly: true });
    if (!deleting) return;
    const batch = this.#database.batch();
    for (const event of deleting.events) batch.delete(event);
    batch.delete(paths.session, { lastUpdateTime: deleting.updateTime });
    await batch.commit();
  }
}
