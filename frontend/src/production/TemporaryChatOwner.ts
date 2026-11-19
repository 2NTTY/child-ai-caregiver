import {
  TEMPORARY_CHAT_COPY,
  TEMPORARY_CHAT_LIMITS,
  type TemporaryChatCloseReason,
  type TemporaryChatCloseReceipt,
  type TemporaryChatMessage,
  type TemporaryChatSessionMeta,
} from "../../../src/shared/temporary-chat.ts";
import {
  TemporaryChatApiError,
  type TemporaryChatApi,
} from "../../../src/client/temporary-chat-api.ts";

export type TemporaryChatPhase =
  | "closed"
  | "opening"
  | "ready"
  | "sending"
  | "expired"
  | "error";

export type TemporaryChatCloseState =
  | "idle"
  | "local_cleared_remote_confirming"
  | "remote_confirmed"
  | "local_cleared_remote_pending";

export interface TemporaryChatSnapshot {
  available: boolean;
  open: boolean;
  phase: TemporaryChatPhase;
  session: TemporaryChatSessionMeta | null;
  messages: TemporaryChatMessage[];
  draft: string;
  error: string | null;
  closeState: TemporaryChatCloseState;
  closeReceipt: TemporaryChatCloseReceipt | null;
  closeNotice: string | null;
  pendingRemoteCloseCount: number;
}

interface PendingRemoteClose {
  userId: string;
  sessionId: string;
  generation: number;
  requestedAt: string;
}

/**
 * Isolated ephemeral client owner for top-left Temporary Chat.
 * Holds zero childId, scopeKey, main chat history, agent proposals, or browser storage.
 */
export class TemporaryChatOwner {
  private readonly api: TemporaryChatApi;
  private readonly onIdentityError?: () => void;
  private readonly listeners = new Set<() => void>();

  private userId: string | null = null;
  private online = true;
  private clientToken = 0;
  private closeEpoch = 0;

  private isOpen = false;
  private phase: TemporaryChatPhase = "closed";
  private session: TemporaryChatSessionMeta | null = null;
  private messages: TemporaryChatMessage[] = [];
  private draft = "";
  private error: string | null = null;
  private closeState: TemporaryChatCloseState = "idle";
  private closeReceipt: TemporaryChatCloseReceipt | null = null;
  private closeNotice: string | null = null;

  private pendingRemoteCloses: PendingRemoteClose[] = [];
  private openAbort: AbortController | null = null;
  private sendAbort: AbortController | null = null;
  private snapshot: TemporaryChatSnapshot;

  constructor(api: TemporaryChatApi, onIdentityError?: () => void) {
    this.api = api;
    this.onIdentityError = onIdentityError;
    this.snapshot = this.project();
  }

  private project(): TemporaryChatSnapshot {
    const pendingCount = this.userId
      ? this.pendingRemoteCloses.filter(entry => entry.userId === this.userId).length
      : 0;
    return {
      available: Boolean(this.userId),
      open: this.isOpen,
      phase: this.phase,
      session: this.session ? { ...this.session } : null,
      messages: this.messages.map(item => ({ ...item })),
      draft: this.draft,
      error: this.error,
      closeState: this.closeState,
      closeReceipt: this.closeReceipt ? { ...this.closeReceipt } : null,
      closeNotice: this.closeNotice,
      pendingRemoteCloseCount: pendingCount,
    };
  }

  private emit() {
    this.snapshot = this.project();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private wipeLocalSessionState() {
    this.clientToken += 1;
    this.openAbort?.abort();
    this.openAbort = null;
    this.sendAbort?.abort();
    this.sendAbort = null;
    this.isOpen = false;
    this.phase = "closed";
    this.session = null;
    this.messages = [];
    this.draft = "";
    this.error = null;
  }

  private enqueuePendingClose(entry: PendingRemoteClose) {
    if (!this.pendingRemoteCloses.some(item => item.sessionId === entry.sessionId && item.userId === entry.userId)) {
      this.pendingRemoteCloses.push(entry);
    }
  }

  private removePendingClose(sessionId: string, userId: string) {
    this.pendingRemoteCloses = this.pendingRemoteCloses.filter(
      item => !(item.sessionId === sessionId && item.userId === userId),
    );
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  syncContext = (userId: string | null, online: boolean) => {
    const previousUserId = this.userId;
    const wasOnline = this.online;
    const userChanged = userId !== previousUserId;

    this.userId = userId;
    this.online = online;

    if (userChanged) {
      const priorSession = this.session;
      this.wipeLocalSessionState();
      this.closeState = "idle";
      this.closeReceipt = null;
      this.closeNotice = null;
      this.pendingRemoteCloses = [];

      if (previousUserId && priorSession) {
        void this.api
          .closeSession(
            previousUserId,
            priorSession.sessionId,
            { generation: priorSession.generation, reason: "sign_out" },
            { keepalive: true },
          )
          .catch(() => {});
      }
      this.emit();
      return;
    }

    if (online && !wasOnline && userId && this.pendingRemoteCloses.some(item => item.userId === userId)) {
      this.emit();
      void this.retryPendingRemoteCloses();
      return;
    }

    if (this.snapshot.available !== Boolean(this.userId)) {
      this.emit();
    }
  };

  open = async () => {
    const activeUserId = this.userId;
    if (!activeUserId) return;
    if (this.isOpen && this.session && this.phase !== "expired" && this.phase !== "error") {
      return;
    }

    this.wipeLocalSessionState();
    const token = this.clientToken;
    this.isOpen = true;
    this.closeState = "idle";
    this.closeReceipt = null;
    this.closeNotice = null;

    if (!this.online) {
      this.phase = "error";
      this.error = "目前處於離線狀態，無法建立空白臨時聊天。";
      this.emit();
      return;
    }

    this.phase = "opening";
    this.emit();

    const controller = new AbortController();
    this.openAbort = controller;
    try {
      const created = await this.api.createSession(activeUserId, controller.signal);
      if (token !== this.clientToken || !this.isOpen || this.userId !== activeUserId) {
        void this.api
          .closeSession(
            activeUserId,
            created.session.sessionId,
            { generation: created.session.generation, reason: "client_reset" },
            { keepalive: true },
          )
          .catch(() => {});
        return;
      }
      this.session = created.session;
      this.messages = created.messages;
      this.phase = "ready";
      this.error = null;
      this.emit();
    } catch (error) {
      if (controller.signal.aborted || token !== this.clientToken || !this.isOpen || this.userId !== activeUserId) {
        return;
      }
      if (
        error instanceof TemporaryChatApiError &&
        (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized")
      ) {
        this.wipeLocalSessionState();
        this.emit();
        this.onIdentityError?.();
        return;
      }
      this.phase = "error";
      this.error =
        error instanceof TemporaryChatApiError
          ? error.message
          : "暫時無法建立空白臨時聊天，請稍後重試。";
      this.emit();
    } finally {
      if (this.openAbort === controller) {
        this.openAbort = null;
      }
    }
  };

  setDraft = (value: string) => {
    if (!this.isOpen || this.phase === "expired") return;
    if (value === this.draft) return;
    this.draft = value;
    this.emit();
  };

  send = async () => {
    const activeUserId = this.userId;
    const activeSession = this.session;
    if (!activeUserId || !this.isOpen || !activeSession || this.phase !== "ready") return;

    const text = this.draft.trim();
    if (!text) return;
    if (text.length > TEMPORARY_CHAT_LIMITS.maxMessageCharacters) {
      this.error = `訊息不可超過 ${TEMPORARY_CHAT_LIMITS.maxMessageCharacters} 字元。`;
      this.emit();
      return;
    }
    if (!this.online) {
      this.error = "目前離線，無法傳送臨時訊息。";
      this.emit();
      return;
    }

    const token = this.clientToken;
    const pendingMessageId = `pending-${token}-${Date.now()}`;
    const optimisticMessage: TemporaryChatMessage = {
      id: pendingMessageId,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };

    const controller = new AbortController();
    this.sendAbort = controller;
    this.draft = "";
    this.phase = "sending";
    this.error = null;
    this.messages = [...this.messages, optimisticMessage];
    this.emit();

    try {
      const result = await this.api.sendMessage(
        activeUserId,
        activeSession.sessionId,
        { text, generation: activeSession.generation },
        controller.signal,
      );
      if (
        token !== this.clientToken ||
        !this.isOpen ||
        this.userId !== activeUserId ||
        this.session?.sessionId !== activeSession.sessionId
      ) {
        return;
      }
      this.session = result.session;
      this.messages = [
        ...this.messages.filter(item => item.id !== pendingMessageId),
        result.userMessage,
        result.modelMessage,
      ];
      this.phase = "ready";
      this.error = null;
      this.emit();
    } catch (error) {
      if (
        controller.signal.aborted ||
        token !== this.clientToken ||
        !this.isOpen ||
        this.userId !== activeUserId ||
        this.session?.sessionId !== activeSession.sessionId
      ) {
        return;
      }
      if (error instanceof TemporaryChatApiError) {
        if (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized") {
          this.wipeLocalSessionState();
          this.emit();
          this.onIdentityError?.();
          return;
        }
        if (error.status === 410) {
          this.messages = this.messages.filter(item => item.id !== pendingMessageId);
          this.session = null;
          this.phase = "expired";
          this.error = TEMPORARY_CHAT_COPY.sessionExpiredNotice;
          this.emit();
          return;
        }
      }
      this.messages = this.messages.filter(item => item.id !== pendingMessageId);
      if (!this.draft) this.draft = text;
      this.phase = "ready";
      this.error =
        error instanceof TemporaryChatApiError
          ? error.message
          : "暫時未能取得臨時聊天回覆，請稍後重試。";
      this.emit();
    } finally {
      if (this.sendAbort === controller) {
        this.sendAbort = null;
      }
    }
  };

  exitAndClear = async (
    reason: TemporaryChatCloseReason = "user_exit",
    options?: { keepalive?: boolean },
  ) => {
    const closingUserId = this.userId;
    const closingSession = this.session;
    const wasActiveOrPending = this.isOpen || Boolean(closingSession);

    this.wipeLocalSessionState();
    if (!wasActiveOrPending || !closingUserId || !closingSession) {
      this.emit();
      return;
    }

    const entry: PendingRemoteClose = {
      userId: closingUserId,
      sessionId: closingSession.sessionId,
      generation: closingSession.generation,
      requestedAt: new Date().toISOString(),
    };
    this.enqueuePendingClose(entry);

    const epoch = ++this.closeEpoch;
    this.closeState = "local_cleared_remote_confirming";
    this.closeReceipt = null;
    this.closeNotice = TEMPORARY_CHAT_COPY.localClearedRemoteConfirmingNotice;
    this.emit();

    if (!this.online && !options?.keepalive) {
      this.closeState = "local_cleared_remote_pending";
      this.closeNotice = TEMPORARY_CHAT_COPY.localClearedRemotePendingNotice;
      this.emit();
      return;
    }

    try {
      const response = await this.api.closeSession(
        entry.userId,
        entry.sessionId,
        { generation: entry.generation, reason },
        options?.keepalive ? { keepalive: true } : undefined,
      );
      this.removePendingClose(entry.sessionId, entry.userId);
      if (this.userId === entry.userId && !this.isOpen && this.closeEpoch === epoch) {
        this.closeState = "remote_confirmed";
        this.closeReceipt = response.receipt;
        this.closeNotice = TEMPORARY_CHAT_COPY.localAndRemoteClearedNotice;
        this.emit();
      }
    } catch (error) {
      if (
        error instanceof TemporaryChatApiError &&
        (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized")
      ) {
        this.removePendingClose(entry.sessionId, entry.userId);
        if (this.userId === entry.userId) {
          this.closeState = "idle";
          this.closeReceipt = null;
          this.closeNotice = null;
          this.emit();
          this.onIdentityError?.();
        }
        return;
      }
      if (this.userId === entry.userId && !this.isOpen && this.closeEpoch === epoch) {
        this.closeState = "local_cleared_remote_pending";
        this.closeNotice = TEMPORARY_CHAT_COPY.localClearedRemotePendingNotice;
        this.emit();
      }
    }
  };

  retryPendingRemoteCloses = async () => {
    const activeUserId = this.userId;
    if (!activeUserId || !this.online) return;
    const targets = this.pendingRemoteCloses.filter(item => item.userId === activeUserId);
    if (!targets.length) return;

    let lastReceipt: TemporaryChatCloseReceipt | null = null;
    for (const entry of targets) {
      try {
        const res = await this.api.closeSession(entry.userId, entry.sessionId, {
          generation: entry.generation,
          reason: "client_reset",
        });
        this.removePendingClose(entry.sessionId, entry.userId);
        lastReceipt = res.receipt;
      } catch (error) {
        if (
          error instanceof TemporaryChatApiError &&
          (error.status === 401 || error.code === "session_changed" || error.code === "unauthorized")
        ) {
          this.removePendingClose(entry.sessionId, entry.userId);
          this.wipeLocalSessionState();
          this.pendingRemoteCloses = [];
          this.closeState = "idle";
          this.closeNotice = null;
          this.closeReceipt = null;
          this.emit();
          this.onIdentityError?.();
          return;
        }
      }
    }

    if (this.userId !== activeUserId || this.isOpen) {
      this.emit();
      return;
    }

    const stillPending = this.pendingRemoteCloses.some(item => item.userId === activeUserId);
    if (!stillPending && lastReceipt) {
      this.closeState = "remote_confirmed";
      this.closeReceipt = lastReceipt;
      this.closeNotice = TEMPORARY_CHAT_COPY.localAndRemoteClearedNotice;
    } else if (stillPending) {
      this.closeState = "local_cleared_remote_pending";
      this.closeNotice = TEMPORARY_CHAT_COPY.localClearedRemotePendingNotice;
    }
    this.emit();
  };

  dismissCloseNotice = () => {
    if (this.closeState === "local_cleared_remote_confirming") return;
    this.closeNotice = null;
    if (this.closeState === "remote_confirmed") {
      this.closeState = "idle";
      this.closeReceipt = null;
    }
    this.emit();
  };

  handlePageHide = () => {
    if (this.isOpen || this.session) {
      void this.exitAndClear("page_unload", { keepalive: true });
    }
  };

  dispose = () => {
    this.wipeLocalSessionState();
    this.pendingRemoteCloses = [];
    this.closeState = "idle";
    this.closeReceipt = null;
    this.closeNotice = null;
    this.listeners.clear();
  };
}
