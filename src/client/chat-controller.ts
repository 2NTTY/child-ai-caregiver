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
  loadedAt: string | null;
  error: string | null;
  available: boolean | null;
  usage: ChatUsage | null;
  drafts: Record<string, ChatDraft>;
  busy: "save" | "reply" | null;
  replyingMessageId: string | null;
  replyError: string | null;
}

interface RequestScope {
  epoch: number;
  view: number;
  userId: string;
  childId: string | null;
  controller: AbortController;
}

const OFFLINE = "目前離線，未能提交。草稿仍保留在本頁。";
const SESSION_CHANGED = "登入狀態已改變，聊天內容已隱藏。請重新確認登入。";
const UNKNOWN_SAVE = "這次聊天保存結果未能確認。請先重新讀取聊天核對，避免重複發送。";

function emptyDraft(): ChatDraft {
  return { text: "", phase: "draft", savedUserMessageId: null, candidateMessageId: null, notice: null, knownIds: [] };
}

function initialState(online: boolean): ChatState {
  return {
    userId: null, online, selectedChildId: null, messages: [], limit: 100, loading: false,
    loadedAt: null, error: null, available: null, usage: null, drafts: {},
    busy: null, replyingMessageId: null, replyError: null,
  };
}

function sessionError(error: unknown): boolean {
  return error instanceof ChatApiError && (error.status === 401 || error.status === 409
    || error.code === "unauthorized" || error.code === "session_changed");
}

function unknownSave(error: unknown): boolean {
  return !(error instanceof ChatApiError) || error.status === 0 || error.status >= 500;
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof ChatApiError && error.code === "invalid_input") return "訊息格式未獲接納，請檢查輸入。";
  if (error instanceof ChatApiError && error.code === "not_found") return "找不到這位孩子，請重新讀取孩子列表。";
  return "聊天未能保存，請稍後重試。";
}

function replyErrorMessage(error: unknown): string {
  if (error instanceof ChatApiError) {
    switch (error.code) {
      case "ai_disabled": return "AI 暫時未開放；聊天已保存，可稍後要求回覆。";
      case "ai_busy": return "AI 正忙碌；聊天已保存，可稍後再試。";
      case "ai_quota_exceeded": return "今日 AI 調用次數已達上限；聊天已保存。";
      case "ai_timeout": return "AI 回覆逾時；聊天已保存，可重試取得回覆。";
      case "ai_unavailable": return "AI 暫時無法回覆；聊天已保存，可稍後再試。";
      case "invalid_input": return "AI 未能處理這則訊息；聊天已保存。";
      case "not_found": return "未找到待回覆訊息，請重新讀取聊天。";
    }
  }
  return "AI 回覆結果未能確認；聊天已保存。可重試取得同一則訊息的回覆。";
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
    this.blockedChildIds.clear();
    this.forgottenChildIds.clear();
    this.update(initialState(this.state.online));
  }

  beginChildDeletion(childId: string): boolean {
    if (!this.state.userId || this.state.busy) return false;
    this.blockedChildIds.add(childId);
    if (this.state.selectedChildId === childId) {
      this.abortRequests();
      this.update({ selectedChildId: null, messages: [], loading: false, loadedAt: null, error: null,
        replyingMessageId: null, replyError: null });
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
      this.update({ drafts, selectedChildId: null, messages: [], loading: false, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null });
    } else this.update({ drafts });
  }

  reconcileChildren(childIds: string[], pendingDeletionId: string | null): void {
    const present = new Set(childIds);
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
      this.update({ selectedChildId: childId, messages: [], loading: false, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null });
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
    if (!this.state.userId || !childId || this.state.loading || this.state.busy) return;
    if (!this.state.online) {
      this.update({ error: OFFLINE });
      return;
    }
    const scope = this.scope();
    this.update({ loading: true, error: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      const page = await this.api.listMessages(childId, scope.controller.signal);
      if (!this.current(scope)) return;
      if (page.messages.some(item => item.role === "user" && item.authorUserId !== scope.userId)) {
        this.invalidateIdentity();
        return;
      }
      if (!await this.verifyIdentity(scope)) return;
      this.update({ messages: page.messages, limit: page.limit, loadedAt: new Date().toISOString() });
      const draft = this.state.drafts[childId];
      if (draft?.savedUserMessageId && page.messages.some(item => item.role === "model" && item.inReplyTo === draft.savedUserMessageId)) {
        this.updateDraft(childId, { text: "", phase: "draft", savedUserMessageId: null,
          notice: "已在聊天記錄找到 AI 回覆。", knownIds: [] });
      }
      if (draft?.phase === "save_unknown" || draft?.phase === "checked") {
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
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else this.update({ error: "未能讀取聊天記錄；請檢查連線後再試。" });
      }
    } finally {
      if (this.current(scope)) this.update({ loading: false });
      this.release(scope);
    }
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
      const reply = await this.api.requestReply(childId, messageId, scope.controller.signal, scope.userId);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      const messages = this.state.messages.some(item => item.id === reply.id)
        ? this.state.messages : [...this.state.messages, reply].slice(-this.state.limit);
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
      const notice = replyErrorMessage(error);
      this.update({ replyError: notice });
      if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
        this.updateDraft(childId, { phase: "reply_failed", notice });
      }
    } finally {
      if (this.current(scope)) {
        if (this.state.drafts[childId]?.phase === "replying") {
          this.updateDraft(childId, { phase: "reply_failed", notice: "暫未能確認回覆，原文已保存。請重新讀取聊天後再試。" });
        }
        this.update({ busy: null, replyingMessageId: null });
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
    if (!draft.text.trim() || draft.text.length > 10_000) {
      this.updateDraft(childId, { notice: "請輸入 1 至 10,000 個字元的訊息。" });
      return;
    }
    const scope = this.scope();
    this.update({ busy: "save", replyError: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(childId, { phase: "saving", notice: null, candidateMessageId: null,
        knownIds: this.state.messages.map(item => item.id) });
      const saved = await this.api.saveMessage(childId, draft.text, scope.controller.signal, scope.userId);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      this.update({ messages: [...this.state.messages.filter(item => item.id !== saved.id), saved].slice(-this.state.limit),
        busy: "reply", replyingMessageId: saved.id });
      this.updateDraft(childId, { phase: "replying", savedUserMessageId: saved.id, notice: "聊天已保存，正在等候 AI 回覆。" });
      await this.performReply(scope, saved.id);
    } catch (error) {
      if (!this.current(scope)) return;
      if (sessionError(error)) {
        this.invalidateIdentity();
        return;
      }
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
    this.update({ busy: "reply", replyingMessageId: messageId, replyError: null });
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
      notice: "已解鎖。再次發送可能建立重複訊息，請先核對聊天記錄。" });
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
