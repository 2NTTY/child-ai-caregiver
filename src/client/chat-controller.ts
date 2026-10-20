import { normalizeChatInput } from "./chat-input.ts";
import type { AgentProgress, OfficialHelpId } from '../shared/agent-feedback.ts';
import type { ChatMessage } from "../shared/chat.ts";
import { ChatApiError, type ChatApi, type ChatUsage } from "./chat-api.ts";

type DraftPhase = "draft" | "saving" | "save_unknown" | "checked" | "replying" | "reply_failed";

export interface ChatDraft {
  text: string;
  phase: DraftPhase;
  savedUserMessageId: string | null;
  candidateMessageId: string | null;
  notice: string | null;
  knownIds: string[];
}

export interface ChatState {
  userId: string | null;
  online: boolean;
  selectedChildId: string | null;
  messages: ChatMessage[];
  limit: number;
  loading: boolean;
  nextCursor: string | null;
  loadingOlder: boolean;
  cancelling: boolean;
  cancelNotice: string | null;
  loadedAt: string | null;
  error: string | null;
  available: boolean | null;
  usage: ChatUsage | null;
  drafts: Record<string, ChatDraft>;
  busy: "save" | "reply" | null;
  replyingMessageId: string | null;
  replyError: string | null;
  feedback?: (AgentProgress & { cards: OfficialHelpId[] }) | null;
}

interface RequestScope {
  epoch: number;
  view: number;
  userId: string;
  childId: string | null;
  controller: AbortController;
}

export const CHAT_CLIENT_COPY = {
  offline: "目前離線，未能提交。草稿仍保留在本頁。",
  sessionChanged: "登入狀態已改變，聊天內容已隱藏。請重新確認登入。",
  unknownSave: "這次聊天保存結果未能確認。請先重新讀取聊天核對，避免重複發送。",
  saveInvalidInput: "訊息格式未獲接納，請檢查輸入。",
  saveNotFound: "找不到這位孩子，請重新讀取孩子列表。",
  saveFailed: "聊天未能保存，請稍後重試。",
} as const;

export const CHAT_REPLY_ERROR_COPY = {
  ai_disabled: "AI 暫時未開放；聊天已保存，可稍後要求回覆。",
  ai_busy: "AI 正忙碌；聊天已保存，可稍後再試。",
  ai_capacity_busy: "AI 正忙碌；原訊息已保存，但未開始處理，也沒有排隊。稍後請以新訊息重新提出要求。",
  ai_quota_exceeded: "今日 AI 調用次數已達上限；聊天已保存。",
  ai_timeout: "AI 回覆逾時；聊天已保存，可重試取得回覆。",
  ai_unavailable: "AI 暫時無法回覆；聊天已保存，可稍後再試。",
  invalid_input: "AI 未能處理這則訊息；聊天已保存。",
  not_found: "未找到待回覆訊息，請重新讀取聊天。",
  unknown: "AI 回覆結果未能確認；聊天已保存。可重試取得同一則訊息的回覆。",
} as const;

const OFFLINE = CHAT_CLIENT_COPY.offline;
const SESSION_CHANGED = CHAT_CLIENT_COPY.sessionChanged;
const UNKNOWN_SAVE = CHAT_CLIENT_COPY.unknownSave;

function emptyDraft(): ChatDraft {
  return { text: "", phase: "draft", savedUserMessageId: null, candidateMessageId: null, notice: null, knownIds: [] };
}

function initialState(online: boolean): ChatState {
  return {
    userId: null, online, selectedChildId: null, messages: [], limit: 100, loading: false,
    nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null,
    loadedAt: null, error: null, available: null, usage: null, drafts: {},
    busy: null, replyingMessageId: null, replyError: null, feedback: null,
  };
}

function sessionError(error: unknown): boolean {
  return error instanceof ChatApiError && (error.status === 401 || error.status === 409 && (!error.onlineCode || error.onlineCode === "session_changed")
    || error.code === "unauthorized" || error.code === "session_changed");
}

function unknownSave(error: unknown): boolean {
  return !(error instanceof ChatApiError) || error.status === 0 || error.status >= 500
    || ["operation_pending", "operation_busy", "operation_mismatch", "storage_epoch_changed"].includes(error.onlineCode ?? "");
}

function childAccessDenied(error: unknown): boolean {
  return error instanceof ChatApiError && (error.status === 403 || error.status === 404);
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof ChatApiError && error.code === "invalid_input") return CHAT_CLIENT_COPY.saveInvalidInput;
  if (error instanceof ChatApiError && error.code === "not_found") return CHAT_CLIENT_COPY.saveNotFound;
  return CHAT_CLIENT_COPY.saveFailed;
}

export function chatReplyErrorMessage(error: unknown): string {
  if (error instanceof ChatApiError) {
    switch (error.code) {
      case "ai_disabled": return CHAT_REPLY_ERROR_COPY.ai_disabled;
      case "ai_busy": return CHAT_REPLY_ERROR_COPY.ai_busy;
      case "ai_capacity_busy": return CHAT_REPLY_ERROR_COPY.ai_capacity_busy;
      case "ai_quota_exceeded": return CHAT_REPLY_ERROR_COPY.ai_quota_exceeded;
      case "ai_timeout": return CHAT_REPLY_ERROR_COPY.ai_timeout;
      case "ai_unavailable": return CHAT_REPLY_ERROR_COPY.ai_unavailable;
      case "invalid_input": return CHAT_REPLY_ERROR_COPY.invalid_input;
      case "not_found": return CHAT_REPLY_ERROR_COPY.not_found;
    }
  }
  return CHAT_REPLY_ERROR_COPY.unknown;
}

function replyErrorMessage(error: unknown): string {
  return chatReplyErrorMessage(error);
}

/** Page-memory chat state, isolated by account and child. */
export class ChatController {
  private state: ChatState;
  private readonly api: ChatApi;
  private listeners = new Set<() => void>();
  private requests = new Set<AbortController>();
  private epoch = 0;
  private view = 0;
  private blockedChildIds = new Set<string>();
  private forgottenChildIds = new Set<string>();

  constructor(api: ChatApi, online = true) {
    this.api = api;
    this.state = initialState(online);
  }

  getSnapshot = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hasUnsavedInput = (): boolean => Object.values(this.state.drafts).some(draft => draft.text.length > 0);

  private update(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateDraft(childId: string, patch: Partial<ChatDraft>): void {
    this.update({ drafts: { ...this.state.drafts, [childId]: { ...(this.state.drafts[childId] ?? emptyDraft()), ...patch } } });
  }

  private abortRequests(): void {
    this.view += 1;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
  }

  private clearIdentity(): void {
    this.epoch += 1;
    this.abortRequests();
    this.api.resetOnline?.();
    this.blockedChildIds.clear();
    this.forgottenChildIds.clear();
    this.update(initialState(this.state.online));
  }

  beginChildDeletion(childId: string): boolean {
    if (!this.state.userId || this.state.busy) return false;
    this.blockedChildIds.add(childId);
    if (this.state.selectedChildId === childId) {
      this.abortRequests();
      this.update({ selectedChildId: null, messages: [], loading: false, nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null, loadedAt: null, error: null,
        replyingMessageId: null, replyError: null, feedback: null });
    }
    return true;
  }

  releaseChildDeletion(childId: string): void {
    this.blockedChildIds.delete(childId);
    if (this.state.selectedChildId === childId && this.state.online) void this.reloadMessages();
  }

  forgetChild(childId: string): void {
    this.blockedChildIds.delete(childId);
    this.forgottenChildIds.add(childId);
    const drafts = { ...this.state.drafts };
    delete drafts[childId];
    if (this.state.selectedChildId === childId) {
      this.abortRequests();
      this.update({ drafts, selectedChildId: null, messages: [], loading: false, nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null, feedback: null });
    } else this.update({ drafts });
  }

  reconcileChildren(childIds: string[], pendingDeletionId: string | null): void {
    const present = new Set(childIds);
    // A fresh authorized list can include a child after a new invitation restores access.
    // Old drafts/messages remain cleared; selecting it performs a new authorized read.
    for (const childId of present) {
      if (childId !== pendingDeletionId) this.forgottenChildIds.delete(childId);
    }
    const known = new Set([...Object.keys(this.state.drafts),
      ...(this.state.selectedChildId ? [this.state.selectedChildId] : []), ...this.blockedChildIds]);
    for (const childId of known) {
      if (!present.has(childId)) this.forgetChild(childId);
      else if (childId !== pendingDeletionId) this.blockedChildIds.delete(childId);
    }
  }

  private invalidateIdentity(): void {
    this.clearIdentity();
    this.update({ error: SESSION_CHANGED });
  }

  private scope(childId: string | null = this.state.selectedChildId): RequestScope {
    const controller = new AbortController();
    this.requests.add(controller);
    return { epoch: this.epoch, view: this.view, userId: this.state.userId!, childId, controller };
  }

  private current(scope: RequestScope): boolean {
    return scope.epoch === this.epoch && scope.view === this.view
      && scope.userId === this.state.userId && scope.childId === this.state.selectedChildId;
  }

  private release(scope: RequestScope): void {
    this.requests.delete(scope.controller);
  }

  private async verifyIdentity(scope: RequestScope): Promise<boolean> {
    try {
      const user = await this.api.getSession(scope.controller.signal);
      if (!this.current(scope)) return false;
      if (user?.id !== scope.userId) {
        this.invalidateIdentity();
        return false;
      }
      return true;
    } catch (error) {
      if (this.current(scope) && sessionError(error)) this.invalidateIdentity();
      else if (this.current(scope)) this.update({ error: "暫時未能確認登入狀態，請稍後再試。" });
      return false;
    }
  }

  /** Call from a React effect so changing props never mutates state during render. */
  syncContext(userId: string | null, online: boolean, childId: string | null): void {
    if (userId !== this.state.userId) {
      this.clearIdentity();
      if (!userId) {
        this.update({ online });
        return;
      }
      this.update({ userId, online });
    } else if (online !== this.state.online) {
      this.update({ online });
    }
    if (!userId) return;
    if (childId && (this.blockedChildIds.has(childId) || this.forgottenChildIds.has(childId))) childId = null;
    if (childId !== this.state.selectedChildId) {
      const previousId = this.state.selectedChildId;
      if (previousId) {
        const draft = this.state.drafts[previousId];
        if (draft?.phase === "saving") this.updateDraft(previousId, { phase: "save_unknown", notice: UNKNOWN_SAVE });
        if (draft?.phase === "replying") this.updateDraft(previousId, { phase: "reply_failed", notice: "聊天已保存。切換孩子後可重新要求同一則訊息的回覆。" });
      }
      this.abortRequests();
      this.update({ selectedChildId: childId, messages: [], loading: false, nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null, feedback: null });
      if (childId && online) {
        void this.reloadMessages();
        void this.refreshMetadata();
      }
    } else if (online && childId && !this.state.loadedAt && !this.state.loading) {
      void this.reloadMessages();
      void this.refreshMetadata();
    }
  }

  setText(text: string): void {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.busy) return;
    const draft = this.state.drafts[childId] ?? emptyDraft();
    if (draft.phase !== "draft") return;
    this.updateDraft(childId, { text, notice: null });
  }

  async reloadMessages(): Promise<void> {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.loading || this.state.loadingOlder || this.state.busy) return;
    if (!this.state.online) {
      this.update({ error: OFFLINE });
      return;
    }
    const scope = this.scope();
    this.update({ loading: true, error: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      if (this.api.reconcilePending && this.api.hasPendingOnline?.()) {
        const receipt = await this.api.reconcilePending(scope.controller.signal, scope.userId);
        if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
        if (receipt?.state === "confirmed") {
          const target = /^\/api\/children\/([^/]+)\/messages$/u.exec(receipt.path ?? "")?.[1];
          if (target) {
            const value = receipt.result as { message?: ChatMessage } | null;
            const message = value?.message;
            if (message?.childId === target && message.authorUserId === scope.userId && message.role === "user") {
              this.updateDraft(target, { phase: "reply_failed", savedUserMessageId: message.id, candidateMessageId: null,
                notice: "Server 已確認原訊息保存；尚未要求 AI 回覆，可按需要繼續。", knownIds: [] });
            } else this.updateDraft(target, { text: "", phase: "draft", savedUserMessageId: null, candidateMessageId: null,
              notice: "Server 已確認原操作；原結果已不可用，請以最新聊天為準。", knownIds: [] });
          }
        }
      }
      const page = await this.api.listMessages(childId, scope.controller.signal);
      if (!this.current(scope)) return;
      if (page.messages.some(item => item.role === "user" && item.authorUserId !== scope.userId)) {
        this.invalidateIdentity();
        return;
      }
      if (!await this.verifyIdentity(scope)) return;
      const newestIds = new Set(page.messages.map(item => item.id));
      const retainOlder = this.state.messages.length > page.limit && this.state.messages.some(item => newestIds.has(item.id));
      this.update({ messages: retainOlder ? [...this.state.messages.filter(item => !newestIds.has(item.id)), ...page.messages] : page.messages,
        nextCursor: retainOlder ? this.state.nextCursor : page.nextCursor ?? null, limit: page.limit, loadedAt: new Date().toISOString() });
      const draft = this.state.drafts[childId];
      if (draft?.savedUserMessageId && page.messages.some(item => item.role === "model" && item.inReplyTo === draft.savedUserMessageId)) {
        this.updateDraft(childId, { text: "", phase: "draft", savedUserMessageId: null,
          notice: "已在聊天記錄找到 AI 回覆。", knownIds: [] });
      }
      if (draft?.phase === "save_unknown" || draft?.phase === "checked") {
        if (this.api.reconcilePending) {
          this.updateDraft(childId, { phase: "checked", candidateMessageId: null,
            notice: "原操作尚無確認。可以保留相同原文重試，系統會沿用原識別；不會按文字相同猜測已保存。" });
        } else {
        const matches = page.messages.filter(item => item.role === "user" && item.authorUserId === scope.userId
          && item.text === draft.text && !draft.knownIds.includes(item.id));
        if (matches.length === 1) {
          this.updateDraft(childId, { phase: "checked", candidateMessageId: matches[0].id,
            notice: "找到一則相同原文的新訊息。請核對下方聊天記錄，確認是否屬於這次提交。" });
        } else {
          this.updateDraft(childId, { phase: "checked", candidateMessageId: null, notice: matches.length > 1
            ? "找到多則相同訊息，無法確認哪則屬於這次提交；請檢視聊天記錄。"
            : "最近聊天未找到這次訊息，仍無法確定 Server 是否保存。請檢視後才決定是否重新發送。" });
        }
        }
      }
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else if (childAccessDenied(error)) {
          this.forgetChild(childId);
          this.update({ error: "孩子存取權已失效或資料已刪除，本頁聊天與草稿已清除。" });
        }
        else this.update({ error: "未能讀取聊天記錄；請檢查連線後再試。" });
      }
    } finally {
      if (this.current(scope)) this.update({ loading: false });
      this.release(scope);
    }
  }

  async loadOlderMessages(): Promise<void> {
    const { selectedChildId: childId, nextCursor } = this.state;
    if (!this.state.userId || !childId || !nextCursor || !this.state.online || this.state.loading || this.state.loadingOlder || this.state.busy) return;
    const scope = this.scope();
    this.update({ loadingOlder: true, error: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      const page = await this.api.listMessages(childId, scope.controller.signal, nextCursor);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      const known = new Set(this.state.messages.map(item => item.id));
      this.update({ messages: [...page.messages.filter(item => !known.has(item.id)), ...this.state.messages], nextCursor: page.nextCursor ?? null });
    } catch (error) {
      if (!this.current(scope)) return;
      if (sessionError(error)) this.invalidateIdentity();
      else if (childAccessDenied(error)) this.forgetChild(childId);
      else this.update({ error: "未能讀取更早對話；目前已讀取的內容保留。" });
    } finally { if (this.current(scope)) this.update({ loadingOlder: false }); this.release(scope); }
  }

  async cancelReply(): Promise<void> {
    const { selectedChildId: childId, replyingMessageId } = this.state;
    if (!childId || !replyingMessageId || this.state.busy !== "reply" || this.state.cancelling || !this.state.online || !this.api.cancelReply) return;
    const scope = this.scope();
    this.update({ cancelling: true, cancelNotice: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      const accepted = await this.api.cancelReply(childId, replyingMessageId, scope.controller.signal, scope.userId);
      if (this.current(scope)) this.update({ cancelNotice: accepted
        ? "Server 已接受停止要求；已保存的操作不會撤銷，請核對最後結果。"
        : "目前沒有可停止的運行；請等候或重新讀取原結果。" });
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else this.update({ cancelNotice: "未能確認停止要求；不能當作已停止，請查核原結果。" });
      }
    } finally { if (this.current(scope)) this.update({ cancelling: false }); this.release(scope); }
  }

  async refreshMetadata(): Promise<void> {
    if (!this.state.userId || !this.state.online) return;
    const scope = this.scope();
    try {
      if (!await this.verifyIdentity(scope)) return;
      const [status, usage] = await Promise.allSettled([
        this.api.getStatus(scope.controller.signal), this.api.getUsage(scope.controller.signal),
      ]);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      this.update({ available: status.status === "fulfilled" ? status.value : null,
        usage: usage.status === "fulfilled" ? usage.value : null });
    } finally {
      this.release(scope);
    }
  }

  private async performReply(scope: RequestScope, messageId: string): Promise<void> {
    const childId = scope.childId!;
    try {
      if (!await this.verifyIdentity(scope)) return;
      const reply = await this.api.requestReply(childId, messageId, scope.controller.signal, scope.userId, event => {
        if (!this.current(scope) || event.messageId !== messageId || this.state.replyingMessageId !== messageId) return;
        const previous = this.state.feedback?.messageId === messageId ? this.state.feedback.cards : [];
        this.update({ feedback: { ...event, cards: [...new Set([...previous, ...(event.card ? [event.card] : [])])] } });
      });
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      const messages = this.state.messages.some(item => item.id === reply.id)
        ? this.state.messages : [...this.state.messages, reply];
      this.update({ messages, replyError: null });
      if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
        this.updateDraft(childId, { text: "", phase: "draft", savedUserMessageId: null,
          notice: "聊天已保存，AI 已回覆。", knownIds: [] });
      }
    } catch (error) {
      if (!this.current(scope)) return;
      if (sessionError(error)) {
        this.invalidateIdentity();
        return;
      }
      if (childAccessDenied(error)) { this.forgetChild(childId); return; }
      let notice = replyErrorMessage(error);
      const runId = this.state.feedback?.messageId === messageId ? this.state.feedback.runId : null;
      if (runId && this.api.getReplyState && error instanceof ChatApiError && (error.status === 0 || error.status >= 500)) {
        try {
          const original = await this.api.getReplyState(childId, runId, scope.controller.signal, scope.userId);
          if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
          const page = await this.api.listMessages(childId, scope.controller.signal);
          if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
          const saved = page.messages.find(item => item.role === 'model' && item.inReplyTo === messageId);
          if (saved) {
            this.update({ messages: [...this.state.messages.filter(item => item.id !== saved.id), saved], replyError: null });
            if (this.state.drafts[childId]?.savedUserMessageId === messageId) this.updateDraft(childId, { text: '', phase: 'draft', savedUserMessageId: null, notice: '已查回原回覆，沒有重新執行。', knownIds: [] });
            return;
          }
          notice = original === 'running' ? '連線中斷；原運行仍在處理。請稍後重新讀取，沒有重新執行。' : '已核對原運行，聊天回覆尚未讀到。請重新讀取原結果，沒有重新執行。';
        } catch (recoveryError) {
          if (!this.current(scope)) return;
          if (sessionError(recoveryError)) { this.invalidateIdentity(); return; }
          if (childAccessDenied(recoveryError)) { this.forgetChild(childId); return; }
        }
      }
      this.update({ replyError: notice });
      if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
        // Preserve the current text; a late history response must never replace a newer draft.
        this.updateDraft(childId, error instanceof ChatApiError && error.code === "ai_capacity_busy"
          ? { phase: "draft", savedUserMessageId: null, candidateMessageId: null, knownIds: [], notice }
          : { phase: "reply_failed", notice });
      }
    } finally {
      if (this.current(scope)) {
        if (this.state.drafts[childId]?.phase === "replying") {
          this.updateDraft(childId, { phase: "reply_failed", notice: "暫未能確認回覆，原文已保存。請重新讀取聊天後再試。" });
        }
        this.update({ busy: null, replyingMessageId: null, feedback: null });
        void this.refreshMetadata();
      }
    }
  }

  async send(): Promise<void> {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.busy || this.state.loading || !this.state.loadedAt) return;
    const draft = this.state.drafts[childId] ?? emptyDraft();
    if (draft.phase !== "draft") return;
    if (!this.state.online) {
      this.updateDraft(childId, { notice: OFFLINE });
      return;
    }
    const text = normalizeChatInput(draft.text);
    if (!text.trim() || draft.text.length > 10_000) {
      this.updateDraft(childId, { notice: "請輸入 1 至 10,000 個字元的訊息。" });
      return;
    }
    const scope = this.scope();
    this.update({ busy: "save", replyError: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(childId, { text, phase: "saving", notice: null, candidateMessageId: null,
        knownIds: this.state.messages.map(item => item.id) });
      const saved = await this.api.saveMessage(childId, text, scope.controller.signal, scope.userId);
      if (!this.current(scope)) return;
      this.updateDraft(childId, { phase: "reply_failed", savedUserMessageId: saved.id, candidateMessageId: null,
        notice: "聊天已獲 Server 保存確認；尚未要求 AI 回覆。" });
      if (!await this.verifyIdentity(scope)) return;
      this.update({ messages: [...this.state.messages.filter(item => item.id !== saved.id), saved],
        feedback: null, busy: "reply", replyingMessageId: saved.id, cancelNotice: null });
      this.updateDraft(childId, { phase: "replying", savedUserMessageId: saved.id, notice: "聊天已保存，正在等候 AI 回覆。" });
      await this.performReply(scope, saved.id);
    } catch (error) {
      if (!this.current(scope)) return;
      if (sessionError(error)) {
        this.invalidateIdentity();
        return;
      }
      if (childAccessDenied(error)) { this.forgetChild(childId); return; }
      const uncertain = unknownSave(error);
      this.updateDraft(childId, { phase: uncertain ? "save_unknown" : "draft",
        notice: uncertain ? UNKNOWN_SAVE : saveErrorMessage(error) });
    } finally {
      if (this.current(scope)) {
        if (this.state.drafts[childId]?.phase === "saving") {
          this.updateDraft(childId, { phase: "save_unknown", notice: UNKNOWN_SAVE });
        }
        this.update({ busy: null });
      }
      this.release(scope);
    }
  }

  async requestReply(messageId: string): Promise<void> {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.busy || this.state.loading) return;
    if (!this.state.online) {
      this.update({ replyError: OFFLINE });
      return;
    }
    const original = this.state.messages.find(item => item.id === messageId && item.role === "user"
      && item.authorUserId === this.state.userId);
    const savedDraft = this.state.drafts[childId]?.savedUserMessageId === messageId;
    if ((!original && !savedDraft) || this.state.messages.some(item => item.role === "model" && item.inReplyTo === messageId)) return;
    const scope = this.scope();
    this.update({ feedback: null, busy: "reply", replyingMessageId: messageId, replyError: null, cancelNotice: null });
    if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
      this.updateDraft(childId, { phase: "replying", notice: "聊天已保存，正在等候 AI 回覆。" });
    }
    try {
      await this.performReply(scope, messageId);
    } finally {
      this.release(scope);
    }
  }

  unlockCheckedSave(): void {
    const childId = this.state.selectedChildId;
    if (!childId || this.state.busy || this.state.drafts[childId]?.phase !== "checked") return;
    this.updateDraft(childId, { phase: "draft", savedUserMessageId: null, candidateMessageId: null, knownIds: [],
      notice: "可重試原訊息；請保留原文，系統會先核對原操作，毋須另建重複訊息。" });
  }

  confirmFoundMessage(): void {
    const childId = this.state.selectedChildId;
    if (!childId || this.state.busy) return;
    const draft = this.state.drafts[childId];
    const messageId = draft?.candidateMessageId;
    if (draft?.phase !== "checked" || !messageId) return;
    const candidate = this.state.messages.find(item => item.id === messageId && item.role === "user"
      && item.authorUserId === this.state.userId && item.text === draft.text);
    if (!candidate) return;
    const replied = this.state.messages.some(item => item.role === "model" && item.inReplyTo === messageId);
    this.updateDraft(childId, replied
      ? { text: "", phase: "draft", savedUserMessageId: null, candidateMessageId: null,
        notice: "已確認聊天訊息及 AI 回覆。", knownIds: [] }
      : { phase: "reply_failed", savedUserMessageId: messageId, candidateMessageId: null,
        notice: "已確認聊天訊息已保存，可要求 AI 回覆。" });
  }

  startNewMessage(): void {
    const childId = this.state.selectedChildId;
    if (!childId || this.state.busy || this.state.drafts[childId]?.phase !== "reply_failed") return;
    this.updateDraft(childId, { ...emptyDraft(), notice: "舊訊息已保存；可在聊天記錄中再次要求 AI 回覆。" });
  }

  dispose(): void {
    this.clearIdentity();
    this.listeners.clear();
  }
}
