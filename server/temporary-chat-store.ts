import { randomUUID } from "node:crypto";
import {
  TEMPORARY_CHAT_LIMITS,
  type TemporaryChatCloseReason,
  type TemporaryChatCloseReceipt,
  type TemporaryChatMessage,
  type TemporaryChatSessionMeta,
} from "../src/shared/temporary-chat.ts";

export class TemporaryChatError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

interface InFlightTurn {
  requestId: string;
  generation: number;
  abortController: AbortController;
  startedAtMs: number;
}

interface SessionRecord {
  sessionId: string;
  userId: string;
  generation: number;
  createdAtMs: number;
  lastActivityAtMs: number;
  idleExpiresAtMs: number;
  hardExpiresAtMs: number;
  messages: TemporaryChatMessage[];
  inFlight: InFlightTurn | null;
}

interface RevokedTombstone {
  sessionId: string;
  userId: string;
  generation: number;
  closedAtMs: number;
  reason: TemporaryChatCloseReason | "expired" | "evicted";
}

export interface TemporaryChatTurnHandle {
  requestId: string;
  abortController: AbortController;
  priorMessages: TemporaryChatMessage[];
  isStillValid: () => boolean;
}

export type TemporaryChatCommitResult =
  | {
      committed: true;
      session: TemporaryChatSessionMeta;
      userMessage: TemporaryChatMessage;
      modelMessage: TemporaryChatMessage;
    }
  | {
      committed: false;
      reason: "closed" | "expired";
    };

export interface TemporaryChatStoreOptions {
  clock?: () => number;
  idleTtlMs?: number;
  maxLifetimeMs?: number;
  maxMessages?: number;
  maxActiveSessionsPerUser?: number;
  maxTotalSessions?: number;
  revokedTombstoneTtlMs?: number;
  sweepIntervalMs?: number;
}

const MAX_TOMBSTONES = 5000;

/**
 * Pure in-memory isolated container for ephemeral temporary chats.
 * Never persists content to Firestore/PostgreSQL, durable agent runs, memory stores, or logs.
 */
export function createTemporaryChatStore(options: TemporaryChatStoreOptions = {}) {
  const clock = options.clock ?? Date.now;
  const idleTtlMs = options.idleTtlMs ?? TEMPORARY_CHAT_LIMITS.idleTtlMs;
  const maxLifetimeMs = options.maxLifetimeMs ?? TEMPORARY_CHAT_LIMITS.maxLifetimeMs;
  const maxMessages = options.maxMessages ?? TEMPORARY_CHAT_LIMITS.maxMessages;
  const maxActiveSessionsPerUser =
    options.maxActiveSessionsPerUser ?? TEMPORARY_CHAT_LIMITS.maxActiveSessionsPerUser;
  const maxTotalSessions = options.maxTotalSessions ?? TEMPORARY_CHAT_LIMITS.maxTotalSessions;
  const revokedTombstoneTtlMs =
    options.revokedTombstoneTtlMs ?? TEMPORARY_CHAT_LIMITS.revokedTombstoneTtlMs;
  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;

  const sessions = new Map<string, SessionRecord>();
  const revoked = new Map<string, RevokedTombstone>();

  function recordTombstone(entry: RevokedTombstone) {
    if (revoked.has(entry.sessionId)) revoked.delete(entry.sessionId);
    revoked.set(entry.sessionId, entry);
    while (revoked.size > MAX_TOMBSTONES) {
      const oldestKey = revoked.keys().next().value;
      if (oldestKey === undefined) break;
      revoked.delete(oldestKey);
    }
  }

  function wipeRecord(
    record: SessionRecord,
    reason: RevokedTombstone["reason"],
    nowMs: number,
  ): number {
    const abortReason =
      reason === "expired"
        ? "temporary_session_expired"
        : reason === "evicted"
          ? "temporary_session_evicted"
          : "temporary_session_closed";
    if (record.inFlight) {
      record.inFlight.abortController.abort(new Error(abortReason));
      record.inFlight = null;
    }
    record.messages.length = 0;
    sessions.delete(record.sessionId);
    const nextGeneration = record.generation + 1;
    recordTombstone({
      sessionId: record.sessionId,
      userId: record.userId,
      generation: nextGeneration,
      closedAtMs: nowMs,
      reason,
    });
    return nextGeneration;
  }

  function toMeta(record: SessionRecord): TemporaryChatSessionMeta {
    return {
      sessionId: record.sessionId,
      generation: record.generation,
      createdAt: new Date(record.createdAtMs).toISOString(),
      lastActivityAt: new Date(record.lastActivityAtMs).toISOString(),
      idleExpiresAt: new Date(record.idleExpiresAtMs).toISOString(),
      hardExpiresAt: new Date(record.hardExpiresAtMs).toISOString(),
      idleTtlMs,
      maxLifetimeMs,
    };
  }

  function sweepExpired(nowMs = clock()): number {
    let swept = 0;
    for (const record of [...sessions.values()]) {
      if (nowMs >= record.idleExpiresAtMs || nowMs >= record.hardExpiresAtMs) {
        wipeRecord(record, "expired", nowMs);
        swept++;
      }
    }
    for (const [id, tombstone] of revoked) {
      if (nowMs - tombstone.closedAtMs >= revokedTombstoneTtlMs) {
        revoked.delete(id);
      }
    }
    return swept;
  }

  const timer =
    sweepIntervalMs > 0
      ? setInterval(() => {
          sweepExpired();
        }, sweepIntervalMs)
      : null;
  timer?.unref();

  return {
    sweepExpired,

    create(userId: string): { session: TemporaryChatSessionMeta; messages: TemporaryChatMessage[] } {
      if (!userId.trim()) throw new TemporaryChatError(401, "unauthorized");
      const now = clock();
      sweepExpired(now);

      const userSessions = [...sessions.values()].filter(item => item.userId === userId);
      while (userSessions.length >= maxActiveSessionsPerUser) {
        const idleCandidates = userSessions
          .filter(item => item.inFlight === null)
          .sort(
            (left, right) =>
              left.lastActivityAtMs - right.lastActivityAtMs ||
              left.createdAtMs - right.createdAtMs,
          );
        const oldest = idleCandidates[0];
        if (!oldest) throw new TemporaryChatError(429, "temporary_chat_busy");
        wipeRecord(oldest, "evicted", now);
        const idx = userSessions.indexOf(oldest);
        if (idx >= 0) userSessions.splice(idx, 1);
      }

      if (sessions.size >= maxTotalSessions) {
        throw new TemporaryChatError(503, "temporary_chat_busy");
      }

      const record: SessionRecord = {
        sessionId: randomUUID(),
        userId,
        generation: 1,
        createdAtMs: now,
        lastActivityAtMs: now,
        idleExpiresAtMs: now + idleTtlMs,
        hardExpiresAtMs: now + maxLifetimeMs,
        messages: [],
        inFlight: null,
      };
      sessions.set(record.sessionId, record);
      return { session: toMeta(record), messages: [] };
    },

    beginTurn(
      userId: string,
      sessionId: string,
      expectedGeneration: number,
      userText: string,
    ): TemporaryChatTurnHandle {
      const now = clock();
      sweepExpired(now);

      const tombstone = revoked.get(sessionId);
      if (tombstone) {
        if (tombstone.userId !== userId) {
          throw new TemporaryChatError(404, "temporary_session_not_found");
        }
        throw new TemporaryChatError(
          410,
          tombstone.reason === "expired"
            ? "temporary_session_expired"
            : "temporary_session_closed",
        );
      }

      const record = sessions.get(sessionId);
      if (!record || record.userId !== userId) {
        throw new TemporaryChatError(404, "temporary_session_not_found");
      }
      if (now >= record.idleExpiresAtMs || now >= record.hardExpiresAtMs) {
        wipeRecord(record, "expired", now);
        throw new TemporaryChatError(410, "temporary_session_expired");
      }
      if (record.generation !== expectedGeneration) {
        throw new TemporaryChatError(409, "temporary_session_generation_mismatch");
      }
      if (record.inFlight !== null) {
        throw new TemporaryChatError(409, "temporary_chat_turn_in_progress");
      }
      if (record.messages.length + 2 > maxMessages) {
        throw new TemporaryChatError(400, "temporary_chat_message_limit");
      }
      if (
        !userText.trim() ||
        userText.length > TEMPORARY_CHAT_LIMITS.maxMessageCharacters ||
        /[\u0000\uD800-\uDFFF]/u.test(userText)
      ) {
        throw new TemporaryChatError(400, "invalid_input");
      }

      const requestId = randomUUID();
      const abortController = new AbortController();
      record.lastActivityAtMs = now;
      record.idleExpiresAtMs = Math.min(now + idleTtlMs, record.hardExpiresAtMs);
      record.inFlight = {
        requestId,
        generation: expectedGeneration,
        abortController,
        startedAtMs: now,
      };

      const priorMessages = record.messages.map(message => structuredClone(message));

      return {
        requestId,
        abortController,
        priorMessages,
        isStillValid: () => {
          sweepExpired();
          const current = sessions.get(sessionId);
          return Boolean(
            current &&
              current.userId === userId &&
              current.generation === expectedGeneration &&
              current.inFlight?.requestId === requestId &&
              !current.inFlight.abortController.signal.aborted,
          );
        },
      };
    },

    commitTurn(
      userId: string,
      sessionId: string,
      requestId: string,
      expectedGeneration: number,
      userMessage: TemporaryChatMessage,
      modelMessage: TemporaryChatMessage,
    ): TemporaryChatCommitResult {
      const now = clock();
      sweepExpired(now);

      const record = sessions.get(sessionId);
      if (
        !record ||
        record.userId !== userId ||
        record.generation !== expectedGeneration ||
        record.inFlight?.requestId !== requestId ||
        record.inFlight.abortController.signal.aborted
      ) {
        const tombstone = revoked.get(sessionId);
        return {
          committed: false,
          reason:
            tombstone?.userId === userId && tombstone.reason === "expired"
              ? "expired"
              : "closed",
        };
      }

      record.inFlight = null;
      const storedUser = structuredClone(userMessage);
      const storedModel = structuredClone(modelMessage);
      record.messages.push(storedUser, storedModel);
      record.generation += 1;
      record.lastActivityAtMs = now;
      record.idleExpiresAtMs = Math.min(now + idleTtlMs, record.hardExpiresAtMs);

      return {
        committed: true,
        session: toMeta(record),
        userMessage: structuredClone(storedUser),
        modelMessage: structuredClone(storedModel),
      };
    },

    abortTurn(userId: string, sessionId: string, requestId: string): void {
      const record = sessions.get(sessionId);
      if (record && record.userId === userId && record.inFlight?.requestId === requestId) {
        record.inFlight = null;
      }
    },

    close(
      userId: string,
      sessionId: string,
      reason: TemporaryChatCloseReason = "user_exit",
    ): TemporaryChatCloseReceipt {
      const now = clock();
      sweepExpired(now);

      const active = sessions.get(sessionId);
      if (active) {
        if (active.userId !== userId) {
          throw new TemporaryChatError(404, "temporary_session_not_found");
        }
        const cancelledInFlight = active.inFlight !== null;
        const generation = wipeRecord(active, reason, now);
        return {
          sessionId,
          status: "cleared",
          clearedAt: new Date(now).toISOString(),
          scope: "application_controlled_only",
          cancelledInFlight,
          generation,
        };
      }

      const tombstone = revoked.get(sessionId);
      if (tombstone) {
        if (tombstone.userId !== userId) {
          throw new TemporaryChatError(404, "temporary_session_not_found");
        }
        return {
          sessionId,
          status: "already_cleared",
          clearedAt: new Date(tombstone.closedAtMs).toISOString(),
          scope: "application_controlled_only",
          cancelledInFlight: false,
          generation: tombstone.generation,
        };
      }

      recordTombstone({
        sessionId,
        userId,
        generation: 1,
        closedAtMs: now,
        reason,
      });
      return {
        sessionId,
        status: "already_cleared",
        clearedAt: new Date(now).toISOString(),
        scope: "application_controlled_only",
        cancelledInFlight: false,
        generation: 1,
      };
    },

    closeAllForUser(
      userId: string,
      reason: TemporaryChatCloseReason = "sign_out",
    ): number {
      const now = clock();
      sweepExpired(now);
      let closedCount = 0;
      for (const record of [...sessions.values()]) {
        if (record.userId === userId) {
          wipeRecord(record, reason, now);
          closedCount++;
        }
      }
      return closedCount;
    },

    hasSessionContent(sessionId: string): boolean {
      return sessions.has(sessionId);
    },

    stats(): { activeSessions: number; revokedTombstones: number } {
      return {
        activeSessions: sessions.size,
        revokedTombstones: revoked.size,
      };
    },

    dispose(): void {
      if (timer) clearInterval(timer);
      const now = clock();
      for (const record of [...sessions.values()]) {
        wipeRecord(record, "user_exit", now);
      }
      revoked.clear();
    },
  };
}

export type TemporaryChatStore = ReturnType<typeof createTemporaryChatStore>;
