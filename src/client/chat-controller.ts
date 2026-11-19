import type { ChatFileMessageReference } from '../shared/chat-files.ts';
import type { VoiceMessageReference } from '../shared/voice.ts';
import type { PhotoMessageReference } from '../shared/photos.ts';
import { normalizeChatInput } from "./chat-input.ts";
import {
  isIncompleteModelReplyText,
  reconcileAgentProgress,
  type AgentProgress,
  type AgentProgressSource,
  type OfficialHelpId,
} from '../shared/agent-feedback.ts';
import { agentStopMessage } from "../shared/agent-stop-message.ts";
import { isChatMode, resolveChatMode, type ChatMode, type ChatReplyState, type ChatMessage } from "../shared/chat.ts";
import { ChatApiError, type ChatApi, type ChatUsage } from "./chat-api.ts";

type DraftPhase = "draft" | "saving" | "save_unknown" | "checked" | "replying" | "reply_failed";

export interface ChatDraft {
  text: string;
  nextText?: string;
  file?: Pick<ChatFileMessageReference,"id"|"version">;
  voice?: Pick<VoiceMessageReference,"id"|"version">;
  photo?: Pick<PhotoMessageReference,"id"|"version">;
  phase: DraftPhase;
  savedUserMessageId: string | null;
  /** A fresh draft must not restore this abandoned turn's automatic help. */
  dismissedHelpMessageId?: string;
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
  cancelAcceptedFor?: string;
  queuedTextAfter?: string;
  cancelNotice: string | null;
  loadedAt: string | null;
  error: string | null;
  available: boolean | null;
  usage: ChatUsage | null;
  drafts: Record<string, ChatDraft>;
  chatModes?: Record<string, ChatMode>;
  modeSwitchedDuringReply?: { messageId: string; from: ChatMode; to: ChatMode } | null;
  busy: "save" | "reply" | null;
  remoteReply?: ChatReplyState | null;
  replyingMessageId: string | null;
  replyError: string | null;
  feedback?: (AgentProgress & { cards: OfficialHelpId[]; sources: AgentProgressSource[] }) | null;
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
  return { text: "", voice: undefined, file: undefined, photo: undefined, phase: "draft", savedUserMessageId: null, candidateMessageId: null, notice: null, knownIds: [] };
}

function initialState(online: boolean): ChatState {
  return {
    userId: null, online, selectedChildId: null, messages: [], limit: 100, loading: false,
    nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null,
    loadedAt: null, error: null, available: null, usage: null, drafts: {}, chatModes: {}, modeSwitchedDuringReply: null,
    busy: null, replyingMessageId: null, replyError: null, feedback: null, remoteReply: null,
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
  private checkingOriginal = false;
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

  hasUnsavedInput = (): boolean => Object.values(this.state.drafts).some(draft => (draft.savedUserMessageId ? draft.nextText : draft.text)?.length);

  private update(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private updateDraft(childId: string, patch: Partial<ChatDraft>): void {
    const previous = this.state.drafts[childId] ?? emptyDraft();
    const draft = { ...previous, ...patch };
    if (patch.phase === "draft" && previous.savedUserMessageId && previous.nextText !== undefined) {
      draft.text = previous.nextText;
      draft.nextText = undefined;
      draft.voice = undefined;
      draft.file = undefined;
      draft.photo = undefined;
    }
    this.update({ drafts: { ...this.state.drafts, [childId]: draft } });
  }

  private abortRequests(): void {
    if (this.state.queuedTextAfter || this.state.cancelAcceptedFor) this.update({ queuedTextAfter: undefined, cancelAcceptedFor: undefined });
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
        replyingMessageId: null, replyError: null, feedback: null, remoteReply: null, modeSwitchedDuringReply: null });
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
    const chatModes = { ...(this.state.chatModes ?? {}) };
    delete chatModes[childId];
    if (this.state.selectedChildId === childId) {
      this.abortRequests();
      this.update({ drafts, chatModes, selectedChildId: null, messages: [], loading: false, nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null, feedback: null, remoteReply: null, modeSwitchedDuringReply: null });
    } else this.update({ drafts, chatModes });
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
        if (draft?.phase === "replying") this.updateDraft(previousId, { phase: "reply_failed", notice: "聊天已保存。切換孩子後會查核原運行，不會重新執行。" });
      }
      this.abortRequests();
      this.update({ selectedChildId: childId, messages: [], loading: false, nextCursor: null, loadingOlder: false, cancelling: false, cancelNotice: null, loadedAt: null,
        error: null, busy: null, replyingMessageId: null, replyError: null, feedback: null, remoteReply: null, modeSwitchedDuringReply: null });
      if (childId && online) {
        void this.reloadMessages();
        void this.refreshMetadata();
      }
    } else if (online && childId && !this.state.loadedAt && !this.state.loading) {
      void this.reloadMessages();
      void this.refreshMetadata();
    }
  }

  getChatMode(childId: string | null = this.state.selectedChildId): ChatMode {
    return resolveChatMode(childId ? this.state.chatModes?.[childId] : undefined);
  }

  setChatMode(mode: ChatMode): void {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || !isChatMode(mode)) return;
    const previous = this.getChatMode(childId);
    if (previous === mode) return;
    const activeReplyMessageId = this.state.busy === "reply"
      ? this.state.replyingMessageId
      : this.state.remoteReply?.status === "running"
        ? this.state.remoteReply.messageId
        : null;
    this.update({
      chatModes: { ...(this.state.chatModes ?? {}), [childId]: mode },
      modeSwitchedDuringReply: activeReplyMessageId
        ? { messageId: activeReplyMessageId, from: previous, to: mode }
        : null,
    });
  }

  setText(text: string): void {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.busy === "save") return;
    const draft = this.state.drafts[childId] ?? emptyDraft();
    if (this.state.queuedTextAfter) this.update({ queuedTextAfter: undefined });
    if (draft.phase === "reply_failed" && this.state.busy === null && this.state.remoteReply?.status !== "running") {
      this.startNewMessage();
      this.updateDraft(childId, { text, notice: null });
    } else if (draft.savedUserMessageId && (draft.phase === "replying" || draft.phase === "reply_failed")) {
      this.updateDraft(childId, { nextText: text });
    } else if (draft.phase === "draft") {
      this.updateDraft(childId, { text, notice: null });
    }
  }

  /** A newer saved row can supersede an SSE stream for the same question. Publish both changes together. */
  private bindSavedRows(messages: ChatMessage[]): Partial<ChatState> & { messages: ChatMessage[] } {
    const latest = new Map<string, ChatMessage>();
    for (const row of messages) if (row.role === "model" && row.inReplyTo) latest.set(row.inReplyTo, row);
    const mismatched = (target: { messageId: string; runId: string } | null | undefined) => {
      if (!target) return false;
      const savedRun = latest.get(target.messageId)?.agentRunId;
      return !!savedRun && savedRun !== target.runId;
    };
    return {
      messages: messages.map(row => {
        const savedRun = row.role === "user" && latest.get(row.id)?.agentRunId;
        return savedRun && savedRun !== row.agentRunId ? { ...row, agentRunId: savedRun } : row;
      }),
      ...(mismatched(this.state.feedback) ? { feedback: null } : {}),
      ...(mismatched(this.state.remoteReply) ? { remoteReply: null, replyError: null } : {}),
    };
  }

  async reloadMessages(): Promise<void> {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.loading || this.state.loadingOlder || this.state.busy) return;
    if (!this.state.online) {
      this.update({ error: OFFLINE });
      return;
    }
    const scope = this.scope();
    const previousLatestUserId = [...this.state.messages].reverse().find(item => item.role === "user")?.id;
    const previousFeedbackId = this.state.feedback?.messageId;
    const previousDraft = this.state.drafts[childId];
    const previousFailedId = previousDraft?.phase === "reply_failed" ? previousDraft.savedUserMessageId : null;
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
            } else this.updateDraft(target, { text: "", voice: undefined, file: undefined, photo: undefined, phase: "draft", savedUserMessageId: null, candidateMessageId: null,
              notice: "Server 已確認原操作；原結果已不可用，請以最新聊天為準。", knownIds: [] });
          }
        }
      }
      const page = await this.api.listMessages(childId, scope.controller.signal);
      let authoritativePage = page;
      let checkedOriginal: ChatReplyState | null = null;
      if (!this.current(scope)) return;
      if (page.messages.some(item => item.role === "user" && item.authorUserId !== scope.userId)) {
        this.invalidateIdentity();
        return;
      }
      if (!await this.verifyIdentity(scope)) return;
      const newestIds = new Set(page.messages.map(item => item.id));
      const retainOlder = this.state.messages.length > page.limit && this.state.messages.some(item => newestIds.has(item.id));
      this.update({ ...this.bindSavedRows(retainOlder ? [...this.state.messages.filter(item => !newestIds.has(item.id)), ...page.messages] : page.messages),
        nextCursor: retainOlder ? this.state.nextCursor : page.nextCursor ?? null, limit: page.limit, loadedAt: new Date().toISOString() });
      const latestUser = [...page.messages].reverse().find(item => item.role === "user");
      if (latestUser && !page.messages.some(item => item.inReplyTo === latestUser.id)) {
        try {
          checkedOriginal = await this.readOriginal(scope, latestUser.id);
          if (!this.current(scope)) return;
          if (checkedOriginal?.status === "completed") {
            const refreshed = await this.api.listMessages(childId, scope.controller.signal);
            if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
            if (refreshed.messages.some(item => item.role === "user" && item.authorUserId !== scope.userId)) {
              this.invalidateIdentity();
              return;
            }
            if (refreshed.messages.some(item => item.role === "model" && item.inReplyTo === latestUser.id)) {
              authoritativePage = refreshed;
              const refreshedIds = new Set(refreshed.messages.map(item => item.id));
              const keepOlder = this.state.messages.length > refreshed.limit && this.state.messages.some(item => refreshedIds.has(item.id));
              this.update({
                ...this.bindSavedRows(keepOlder ? [...this.state.messages.filter(item => !refreshedIds.has(item.id)), ...refreshed.messages] : refreshed.messages),
                nextCursor: keepOlder ? this.state.nextCursor : refreshed.nextCursor ?? null,
                limit: refreshed.limit,
                loadedAt: new Date().toISOString(),
                remoteReply: null,
                replyError: null,
                modeSwitchedDuringReply: null,
              });
            }
          }
        }
        catch (error) {
          if (sessionError(error) || childAccessDenied(error)) throw error;
          if (this.current(scope) && this.state.drafts[childId]?.dismissedHelpMessageId !== latestUser.id) {
            this.update({ replyError: "原訊息已保存，暫時未能查核處理狀態；請稍後重新讀取。" });
          }
        }
        if (!this.current(scope)) return;
      } else if (!this.state.remoteReply || !page.messages.some(row => row.role === "model"
        && row.inReplyTo === this.state.remoteReply!.messageId && row.agentRunId === this.state.remoteReply!.runId)) {
        this.update({ remoteReply: null, replyError: null, modeSwitchedDuringReply: null });
      }
      const draft = this.state.drafts[childId];
      const latestTurn = [...authoritativePage.messages].reverse().find(item => item.role === "user");
      const previousRemote = this.state.remoteReply;
      if (latestTurn && latestTurn.id !== previousLatestUserId && previousRemote
        && previousRemote.messageId !== latestTurn.id && previousRemote.status !== "running") {
        this.update({ remoteReply: null, replyError: null });
      }
      const latestAnswer = latestTurn && [...authoritativePage.messages].reverse().find(row => row.role === "model" && row.inReplyTo === latestTurn.id);
      const persistedHelpId = latestAnswer?.agentRunId && latestAnswer.officialHelp?.length
        && draft?.dismissedHelpMessageId !== latestTurn?.id ? latestTurn?.id : null;
      // The recovery controls and retained feedback must settle from the same evidence.
      // A model row can be the persisted record of a stopped run, not an approved answer.
      for (const messageId of new Set([draft?.savedUserMessageId, previousFeedbackId, this.state.remoteReply?.messageId, persistedHelpId])) {
        if (!messageId) continue;
        if (latestTurn && latestTurn.id !== messageId && latestTurn.id !== previousLatestUserId) {
          const owned = this.state.drafts[childId];
          if (previousFailedId === messageId && owned?.phase === "reply_failed" && owned.savedUserMessageId === messageId) {
            this.updateDraft(childId, { ...emptyDraft(), dismissedHelpMessageId: messageId });
          }
          if (this.state.feedback?.messageId === messageId) this.update({ feedback: null });
          continue;
        }
        const matchingReply = [...authoritativePage.messages].reverse().find(item => item.role === "model" && item.inReplyTo === messageId);
        if (!matchingReply) continue;
        const outcome = await this.verifyResolvedReplyCompleted(scope, childId, messageId, matchingReply, null, undefined, true, checkedOriginal);
        if (outcome.aborted || !this.current(scope)) return;
        if (this.state.drafts[childId]?.dismissedHelpMessageId === messageId) continue;
        this.settleSavedDraft(childId, messageId, outcome.completed, "已在聊天記錄找到 AI 回覆。");
        if (this.state.feedback?.messageId === messageId && outcome.completed) this.update({ feedback: null });
        if (!this.state.remoteReply || this.state.remoteReply.messageId === messageId) {
          this.update({ remoteReply: outcome.remoteReply });
        }
      }
      if (draft?.phase === "save_unknown" || draft?.phase === "checked") {
        if (this.api.reconcilePending) {
          this.updateDraft(childId, { phase: "checked", candidateMessageId: null,
            notice: "原操作尚無確認。可以保留相同原文重試，系統會沿用原識別；不會按文字相同猜測已保存。" });
        } else {
        const matches = authoritativePage.messages.filter(item => item.role === "user" && item.authorUserId === scope.userId
          && item.text === draft.text && item.voice?.id === draft.voice?.id && item.file?.id === draft.file?.id && item.photo?.id === draft.photo?.id && item.photo?.version === draft.photo?.version && !draft.knownIds.includes(item.id));
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

  private async readOriginal(scope: RequestScope, messageId: string, preserveOtherRunning = false): Promise<ChatReplyState | null> {
    if (!scope.childId || !this.api.getOriginalReply) return null;
    const result = await this.api.getOriginalReply(scope.childId, messageId, scope.controller.signal, scope.userId);
    if (!this.current(scope)) return null;
    const active = this.state.remoteReply;
    if (preserveOtherRunning && active?.status === "running" && active.messageId !== messageId) {
      // Looking up an older turn must not retarget the active poll or cancel control.
      if (result) this.update({ messages: this.state.messages.map(item => item.id === messageId ? { ...item, agentRunId: result.runId } : item) });
      return result;
    }
    const alreadyReplied = this.state.messages.some(item => item.role === "model" && item.inReplyTo === messageId);
    const dismissedTerminal = this.state.drafts[scope.childId]?.dismissedHelpMessageId === messageId && result?.status !== "running";
    if (alreadyReplied || dismissedTerminal) {
      this.update({
        remoteReply: null,
        replyError: null,
        ...(this.state.modeSwitchedDuringReply?.messageId === messageId ? { modeSwitchedDuringReply: null } : {}),
        messages: result ? this.state.messages.map(item => item.id === messageId ? { ...item, agentRunId: result.runId } : item) : this.state.messages,
      });
      return result;
    }
    this.update({ remoteReply: result, replyError: result?.status === "running" ? null
      : result ? result.status === "completed" ? "原運行已完成，正在核對已保存的回覆。"
        : result.status === "stopped" && result.stopReason === "busy" ? CHAT_REPLY_ERROR_COPY.ai_capacity_busy
        : agentStopMessage(result.stopReason) ?? "原運行未完成，請查看原結果；沒有重新執行。" : null,
      messages: result ? this.state.messages.map(item => item.id === messageId ? { ...item, agentRunId: result.runId } : item) : this.state.messages });
    return result;
  }

  /** Foreground read only. The device may have lost all local run state. */
  async refreshOriginalReply(): Promise<void> {
    const original = this.state.remoteReply;
    if (!original || original.status !== "running" || this.checkingOriginal || this.state.busy || this.state.loading
      || !this.state.online || !this.state.userId || !this.state.selectedChildId) return;
    const scope = this.scope(); this.checkingOriginal = true;
    try {
      // An already-persisted reply owns its run; the per-question pointer can still name an older one.
      if (this.state.messages.some(row => row.role === "model" && row.inReplyTo === original.messageId && row.agentRunId)) {
        await this.reloadMessages();
        return;
      }
      const result = await this.readOriginal(scope, original.messageId);
      if (this.current(scope) && result?.status !== "running") await this.reloadMessages();
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else if (childAccessDenied(error)) this.forgetChild(scope.childId!);
        else this.update({ replyError: "暫時未能查核原運行，沒有重新執行；連線恢復後再讀取。" });
      }
    } finally { this.checkingOriginal = false; this.release(scope); }
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

  queueNextText(): void {
    const { selectedChildId, replyingMessageId, busy, online } = this.state;
    const draft = selectedChildId ? this.state.drafts[selectedChildId] : null;
    if (!online || busy !== "reply" || !replyingMessageId || draft?.phase !== "replying"
        || draft.savedUserMessageId !== replyingMessageId || !draft.nextText?.trim() || draft.nextText.length > 10_000) return;
    this.update({ queuedTextAfter: replyingMessageId });
  }

  unqueueNextText(): void {
    this.update({ queuedTextAfter: undefined });
  }

  private finishTextQueue(scope: RequestScope, messageId: string | null): void {
    if (!messageId || !this.current(scope) || this.state.queuedTextAfter !== messageId) return;
    this.unqueueNextText();
    const draft = scope.childId ? this.state.drafts[scope.childId] : null;
    if (this.state.online && !this.state.busy && draft?.phase === "draft" && draft.text.trim()
        && !this.state.replyError && !this.state.remoteReply && this.state.cancelAcceptedFor !== messageId
        && this.state.messages.some(row => row.role === "model" && row.inReplyTo === messageId && !isIncompleteModelReplyText(row.text))) {
      void this.send();
    }
  }

  async cancelReply(): Promise<void> {
    const childId = this.state.selectedChildId;
    const replyingMessageId = this.state.replyingMessageId ?? (this.state.remoteReply?.status === "running" ? this.state.remoteReply.messageId : null);
    if (!childId || !replyingMessageId || this.state.busy !== "reply" && this.state.remoteReply?.status !== "running" || this.state.cancelling || this.state.cancelAcceptedFor === replyingMessageId || !this.state.online || !this.api.cancelReply) return;
    const scope = this.scope();
    this.update({ cancelling: true, cancelNotice: null, queuedTextAfter: undefined });
    try {
      if (!await this.verifyIdentity(scope)) return;
      const accepted = await this.api.cancelReply(childId, replyingMessageId, scope.controller.signal, scope.userId);
      if (this.current(scope) && (this.state.replyingMessageId === replyingMessageId || this.state.remoteReply?.messageId === replyingMessageId && this.state.remoteReply.status === "running")) this.update({ cancelAcceptedFor: accepted ? replyingMessageId : undefined, cancelNotice: accepted
        ? null
        : "未找到進行中的回覆，可重新讀取對話。" });
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else this.update({ cancelNotice: "未能確認停止要求，請再試一次。" });
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

  private dropReplacedFeedback(messageId: string, savedRunId?: string): void {
    const feedback = this.state.feedback;
    if (savedRunId && feedback?.messageId === messageId && feedback.runId !== savedRunId) this.update({ feedback: null });
  }

  private incompleteReplyNotice(messageId: string, runId?: string | null): string {
    const feedback = this.state.feedback?.messageId === messageId && (!runId || this.state.feedback.runId === runId) ? this.state.feedback : null;
    if (feedback?.cards.length) return "這次回覆未完成，請先查看官方求助提示或查核原結果。";
    if (feedback?.sources.length) return "這次回覆未完成，已保留檢索到的官方來源預覽；未核草稿不作正式回覆，請查核原結果。";
    return "這次回覆未完成，請查核原結果。";
  }

  private settleSavedDraft(childId: string, messageId: string, completed: boolean, completedNotice: string): void {
    if (this.state.drafts[childId]?.savedUserMessageId !== messageId) return;
    this.updateDraft(childId, completed
      ? { ...emptyDraft(), notice: completedNotice }
      : { phase: "reply_failed", notice: this.incompleteReplyNotice(messageId) });
  }

  private async verifyResolvedReplyCompleted(
    scope: RequestScope,
    childId: string,
    messageId: string,
    reply: ChatMessage,
    activeRunId: string | null,
    verifiedRun?: Pick<ChatReplyState, "runId" | "status">,
    historyRead = false,
    checkedOriginal?: ChatReplyState | null,
  ): Promise<{ aborted: boolean; completed: boolean; runId: string | null; remoteReply: ChatReplyState | null }> {
    const runId = reply.agentRunId ?? activeRunId;
    const statusResult = (status: ChatReplyState["status"], id = runId, stopReason: string | null = null) => ({
      aborted: false, completed: status === "completed", runId: id,
      remoteReply: status !== "completed" && id ? { messageId, runId: id, status, stopReason } : null,
    });
    const aborted = { aborted: true, completed: false, runId, remoteReply: null };
    if (isIncompleteModelReplyText(reply.text)) {
      return statusResult(/中斷|未知/u.test(reply.text) ? "unknown" : "stopped");
    }
    if (verifiedRun && verifiedRun.runId === runId) return statusResult(verifiedRun.status);
    if (!runId && !historyRead && this.state.feedback?.messageId !== messageId) return statusResult("completed");
    try {
      // A question can have a replacement result. Only the selected row's run can settle it.
      if (runId && this.api.getReplyState) {
        const status = await this.api.getReplyState(childId, runId, scope.controller.signal, scope.userId);
        if (!this.current(scope) || !await this.verifyIdentity(scope)) return aborted;
        return statusResult(status);
      }
      const original = checkedOriginal?.messageId === messageId ? checkedOriginal
        : await this.api.getOriginalReply?.(childId, messageId, scope.controller.signal, scope.userId);
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return aborted;
      if (original && (!runId || original.runId === runId)) return statusResult(original.status, original.runId, original.stopReason);
      // Legacy untagged history is not evidence about an earlier SSE run.
      return statusResult(runId ? "unknown" : "completed");
    } catch (error) {
      if (!this.current(scope)) return aborted;
      if (sessionError(error)) { this.invalidateIdentity(); return aborted; }
      if (childAccessDenied(error)) { this.forgetChild(childId); return aborted; }
      return statusResult("unknown");
    }
  }

  private async performReply(scope: RequestScope, messageId: string): Promise<void> {
    const childId = scope.childId!;
    let settledRemoteReply: ChatReplyState | null = null;
    let replyCompleted = false;
    let activeRunId: string | null = null;
    try {
      if (!await this.verifyIdentity(scope)) return;
      const reply = await this.api.requestReply(childId, messageId, scope.controller.signal, scope.userId, event => {
        if (!this.current(scope) || event.messageId !== messageId || this.state.replyingMessageId !== messageId) return;
        if (activeRunId !== null && activeRunId !== event.runId) return;
        activeRunId = event.runId;
        // Only a frame from an actual replacement run supersedes the retained original.
        const previous = this.state.feedback?.messageId === messageId && this.state.feedback.runId === event.runId
          ? this.state.feedback : null;
        const next = reconcileAgentProgress(previous, event);
        if (next !== previous) this.update({ feedback: next });
      });
      if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
      this.dropReplacedFeedback(messageId, reply.agentRunId);
      const outcome = await this.verifyResolvedReplyCompleted(scope, childId, messageId, reply, activeRunId);
      if (outcome.aborted || !this.current(scope)) return;
      replyCompleted = outcome.completed;
      settledRemoteReply = outcome.remoteReply;
      const normalizedReply = outcome.runId && !reply.agentRunId ? { ...reply, agentRunId: outcome.runId } : reply;
      const messages = this.state.messages.some(item => item.id === normalizedReply.id)
        ? this.state.messages.map(item => item.id === normalizedReply.id ? normalizedReply : item)
        : [...this.state.messages, normalizedReply];
      const bound = this.bindSavedRows(messages);
      this.update({ ...bound, remoteReply: settledRemoteReply,
        replyError: outcome.completed ? null : this.incompleteReplyNotice(messageId, outcome.runId) });
      this.settleSavedDraft(childId, messageId, outcome.completed, "聊天已保存，AI 已回覆。");
    } catch (error) {
      if (!this.current(scope)) return;
      if (sessionError(error)) {
        this.invalidateIdentity();
        return;
      }
      if (childAccessDenied(error)) { this.forgetChild(childId); return; }
      let notice = replyErrorMessage(error);
      let runId = this.state.feedback?.messageId === messageId ? this.state.feedback.runId : null;
      if (!runId && this.api.getOriginalReply && error instanceof ChatApiError && (error.status === 0 || error.status >= 500)) {
        try {
          const discovered = await this.api.getOriginalReply(childId, messageId, scope.controller.signal, scope.userId);
          if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
          if (discovered) runId = discovered.runId;
        } catch (discoveryError) {
          if (!this.current(scope)) return;
          if (sessionError(discoveryError)) { this.invalidateIdentity(); return; }
          if (childAccessDenied(discoveryError)) { this.forgetChild(childId); return; }
        }
      }
      if (runId && this.api.getReplyState && error instanceof ChatApiError && (error.status === 0 || error.status >= 500)) {
        try {
          const original = await this.api.getReplyState(childId, runId, scope.controller.signal, scope.userId);
          if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
          const page = await this.api.listMessages(childId, scope.controller.signal);
          if (!this.current(scope) || !await this.verifyIdentity(scope)) return;
          const saved = [...page.messages].reverse().find(item => item.role === 'model' && item.inReplyTo === messageId);
          if (saved) {
            const savedRunId = saved.agentRunId ?? runId;
            this.dropReplacedFeedback(messageId, saved.agentRunId);
            const outcome = await this.verifyResolvedReplyCompleted(scope, childId, messageId, saved, savedRunId, { runId, status: original });
            if (outcome.aborted || !this.current(scope)) return;
            replyCompleted = outcome.completed;
            settledRemoteReply = outcome.remoteReply;
            this.update({
              messages: [...this.state.messages.filter(item => item.id !== saved.id).map(item => item.id === messageId ? { ...item, agentRunId: savedRunId } : item), saved],
              replyError: outcome.completed ? null : this.incompleteReplyNotice(messageId),
              remoteReply: settledRemoteReply,
            });
            this.settleSavedDraft(childId, messageId, outcome.completed, "已查回原回覆，沒有重新執行。");
            return;
          }
          if (original === 'running') {
            settledRemoteReply = { messageId, runId, status: 'running', stopReason: null };
          }
          this.update({
            messages: this.state.messages.map(item => item.id === messageId ? { ...item, agentRunId: runId } : item),
          });
          notice = original === 'running' ? '連線中斷；原運行仍在處理。請稍後重新讀取，沒有重新執行。' : '已核對原運行，聊天回覆尚未讀到。請重新讀取原結果，沒有重新執行。';
        } catch (recoveryError) {
          if (!this.current(scope)) return;
          if (sessionError(recoveryError)) { this.invalidateIdentity(); return; }
          if (childAccessDenied(recoveryError)) { this.forgetChild(childId); return; }
        }
      }
      const capacityBusy = error instanceof ChatApiError && error.code === "ai_capacity_busy";
      const busyRunId = capacityBusy && this.state.feedback?.messageId === messageId ? this.state.feedback.runId : "";
      if (capacityBusy) settledRemoteReply = { messageId, runId: busyRunId, status: "stopped", stopReason: "busy" };
      this.update({ replyError: notice,
        ...(busyRunId ? { messages: this.state.messages.map(item => item.id === messageId ? { ...item, agentRunId: busyRunId } : item) } : {}) });
      if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
        // Preserve the current text; a late history response must never replace a newer draft.
        this.updateDraft(childId, capacityBusy
          ? { phase: "draft", savedUserMessageId: null, candidateMessageId: null, knownIds: [], notice }
          : { phase: "reply_failed", notice });
      }
    } finally {
      if (this.current(scope)) {
        if (this.state.drafts[childId]?.phase === "replying") {
          this.updateDraft(childId, { phase: "reply_failed", notice: "暫未能確認回覆，原文已保存。請重新讀取聊天後再試。" });
        }
        const retainFeedback = !replyCompleted
          && this.state.feedback?.messageId === messageId
          && (this.state.feedback.cards.length > 0 || this.state.feedback.sources.length > 0)
          ? this.state.feedback
          : null;
        const keepModeNotice = settledRemoteReply?.status === "running"
          && this.state.modeSwitchedDuringReply?.messageId === messageId
          ? this.state.modeSwitchedDuringReply
          : null;
        this.update({ busy: null, replyingMessageId: null, feedback: retainFeedback, remoteReply: settledRemoteReply, modeSwitchedDuringReply: keepModeNotice });
        void this.refreshMetadata();
      }
    }
  }

  clearUnsentVoice():boolean {
    const childId=this.state.selectedChildId,draft=childId?this.state.drafts[childId]:null;
    if(!childId||this.state.busy||draft&&draft.phase!=='draft'||this.api.hasPendingOnline?.())return false;
    this.updateDraft(childId,{voice:undefined});return true;
  }

  clearUnsentFile():boolean {
    const childId=this.state.selectedChildId,draft=childId?this.state.drafts[childId]:null;
    if(!childId||this.state.busy||draft&&draft.phase!=='draft'||this.api.hasPendingOnline?.())return false;
    this.updateDraft(childId,{file:undefined});return true;
  }

  clearUnsentPhoto():boolean {
    const childId=this.state.selectedChildId,draft=childId?this.state.drafts[childId]:null;
    if(!childId||this.state.busy||draft&&draft.phase!=='draft'||this.api.hasPendingOnline?.())return false;
    this.updateDraft(childId,{photo:undefined});return true;
  }

  async send(voice?: Pick<VoiceMessageReference,"id"|"version">, file?: Pick<ChatFileMessageReference,"id"|"version">, photo?: Pick<PhotoMessageReference,"id"|"version">): Promise<void> {
    const childId = this.state.selectedChildId;
    if (!this.state.userId || !childId || this.state.busy || this.state.loading || !this.state.loadedAt || this.state.remoteReply?.status === "running" && !this.state.messages.some(item => item.role === "model" && item.inReplyTo === this.state.remoteReply?.messageId)) return;
    const draft = this.state.drafts[childId] ?? emptyDraft();
    if (draft.phase !== "draft") return;
    if (!this.state.online) {
      this.updateDraft(childId, { notice: OFFLINE });
      return;
    }
    const text = normalizeChatInput(draft.text);
    const attachments = [draft.voice ?? voice, draft.file ?? file, draft.photo ?? photo].filter(Boolean);
    if (attachments.length > 1 || !text.trim() && attachments.length === 0 || draft.text.length > 10_000) {
      this.updateDraft(childId, { notice: "請輸入 1 至 10,000 個字元的訊息。" });
      return;
    }
    const scope = this.scope();
    let savedId: string | null = null;
    const currentMode = this.getChatMode(childId);
    this.update({ busy: "save", replyError: null });
    try {
      if (!await this.verifyIdentity(scope)) return;
      this.updateDraft(childId, { text, voice: draft.voice ?? voice, file: draft.file ?? file, photo: draft.photo ?? photo, phase: "saving", notice: null, candidateMessageId: null,
        knownIds: this.state.messages.map(item => item.id) });
      const saved = currentMode === "chat_only"
        ? await this.api.saveMessage(childId, text, scope.controller.signal, scope.userId, draft.voice ?? voice, draft.file ?? file, draft.photo ?? photo, "chat_only")
        : await this.api.saveMessage(childId, text, scope.controller.signal, scope.userId, draft.voice ?? voice, draft.file ?? file, draft.photo ?? photo);
      if (!this.current(scope)) return;
      this.updateDraft(childId, { phase: "reply_failed", savedUserMessageId: saved.id, candidateMessageId: null,
        notice: "聊天已獲 Server 保存確認；尚未要求 AI 回覆。" });
      if (!await this.verifyIdentity(scope)) return;
      this.update({ messages: [...this.state.messages.filter(item => item.id !== saved.id), saved],
        feedback: null, remoteReply: null, busy: "reply", replyingMessageId: saved.id, cancelAcceptedFor: undefined, cancelNotice: null });
      savedId = saved.id;
      this.updateDraft(childId, { phase: "replying", savedUserMessageId: saved.id, dismissedHelpMessageId: undefined, notice: "聊天已保存，正在等候 AI 回覆。" });
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
      this.finishTextQueue(scope, savedId);
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
    if (!original && !savedDraft) return;
    if (this.state.messages.some(item => item.role === "model" && item.inReplyTo === messageId)) {
      if (savedDraft) await this.reloadMessages();
      return;
    }
    const scope = this.scope();
    this.update({ feedback: this.state.feedback?.messageId === messageId ? this.state.feedback : null,
      busy: "reply", replyingMessageId: messageId, replyError: null, cancelNotice: null });
    if (this.state.drafts[childId]?.dismissedHelpMessageId === messageId) {
      this.updateDraft(childId, { dismissedHelpMessageId: undefined });
    }
    try {
      const existing = await this.readOriginal(scope, messageId, true);
      if (!this.current(scope)) return;
      if (existing) {
        this.update({ busy: null, replyingMessageId: null });
        await this.reloadMessages(); return;
      }
      this.update({ remoteReply: null });
      if (this.state.drafts[childId]?.savedUserMessageId === messageId) {
        this.updateDraft(childId, { phase: "replying", notice: "聊天已保存，正在等候 AI 回覆。" });
      }
      await this.performReply(scope, messageId);
    } catch (error) {
      if (this.current(scope)) {
        if (sessionError(error)) this.invalidateIdentity();
        else if (childAccessDenied(error)) this.forgetChild(childId);
        else this.update({ replyError: "未能確認原運行，沒有重新執行；請重新讀取。" });
      }
    } finally {
      if (this.current(scope)) this.update({ busy: null, replyingMessageId: null });
      this.finishTextQueue(scope, messageId);
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
      && item.authorUserId === this.state.userId && item.text === draft.text
      && item.photo?.id === draft.photo?.id && item.photo?.version === draft.photo?.version);
    if (!candidate) return;
    const replied = this.state.messages.some(item => item.role === "model" && item.inReplyTo === messageId);
    this.updateDraft(childId, replied
      ? { text: "", voice: undefined, file: undefined, photo: undefined, phase: "draft", savedUserMessageId: null, candidateMessageId: null,
        notice: "已確認聊天訊息及 AI 回覆。", knownIds: [] }
      : { phase: "reply_failed", savedUserMessageId: messageId, candidateMessageId: null,
        notice: "已確認聊天訊息已保存，可要求 AI 回覆。" });
  }

  dismissRetainedFeedback(messageId: string): void {
    const childId = this.state.selectedChildId;
    const feedback = this.state.feedback;
    if (!childId || this.state.busy || feedback?.messageId !== messageId) return;
    const remote = this.state.remoteReply;
    if (remote?.messageId === messageId && remote.status === "running") return;
    const draft = this.state.drafts[childId] ?? emptyDraft();
    const latest = [...this.state.messages].reverse().find(item => item.role === "user");
    this.update({
      feedback: null,
      ...(latest?.id === messageId
        ? { drafts: { ...this.state.drafts, [childId]: { ...draft, dismissedHelpMessageId: messageId } } }
        : {}),
      ...(remote?.messageId === messageId ? { remoteReply: null } : {}),
      ...((!remote || remote.messageId === messageId) && (!draft.savedUserMessageId || draft.savedUserMessageId === messageId)
        ? { replyError: null, cancelNotice: null }
        : {}),
    });
  }

  startNewMessage(): void {
    const childId = this.state.selectedChildId;
    if (!childId || this.state.busy) return;
    const draft = this.state.drafts[childId];
    if (draft?.phase !== "reply_failed" || !draft.savedUserMessageId) return;
    const id = draft.savedUserMessageId;
    const remote = this.state.remoteReply;
    const noticeOwner = remote?.messageId ?? this.state.feedback?.messageId ?? id;
    this.update({
      drafts: { ...this.state.drafts, [childId]: { ...emptyDraft(), text: draft.nextText ?? "", dismissedHelpMessageId: id,
        notice: "舊訊息已保存；可在聊天記錄中再次要求 AI 回覆。" } },
      ...(this.state.feedback?.messageId === id ? { feedback: null } : {}),
      ...(remote?.messageId === id && remote.status !== "running" ? { remoteReply: null } : {}),
      ...(noticeOwner === id ? { replyError: null, cancelNotice: null } : {}),
    });
  }

  dispose(): void {
    this.clearIdentity();
    this.listeners.clear();
  }
}


