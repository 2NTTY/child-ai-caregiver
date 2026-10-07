import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter, type Href } from "expo-router";
import { Linking, Platform } from "react-native";
import { Text } from "react-native-paper";
import type { AuthMode, Credentials } from "../../../src/client/records-api";
import { emptyAssistantDraft, photoAttachment, type AssistantAttachment } from "../assistant-draft";
import { AppDialog } from "../components/AppDialog";
import { AppButton } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import type { PreviewScenario } from "../preview/fixture";
import type { HomeActions } from "../view-model";
import { ProductionOwner } from "./ProductionOwner";
import { projectProductionHome } from "./home-projection";
import { productionDestinations } from "./routes";
import { useOnlineUpdates } from "../../../src/client/use-online-updates";

function initialOnline() { return Platform.OS !== "web" || typeof navigator === "undefined" || navigator.onLine; }

function useProductionValue(owner: ProductionOwner) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const draft = useSyncExternalStore(owner.draftOwner.subscribe, owner.draftOwner.getSnapshot, owner.draftOwner.getSnapshot);
  const agent = useSyncExternalStore(owner.agentOwner.subscribe, owner.agentOwner.getSnapshot, owner.agentOwner.getSnapshot);
  const authorization = useSyncExternalStore(owner.authorizationOwner.subscribe, owner.authorizationOwner.getSnapshot, owner.authorizationOwner.getSnapshot);
  const pathname = usePathname();
  const router = useRouter();
  const leave = usePreviewNavigation();
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const current = useRef({ scopeKey: snapshot.scopeKey, identityKey: snapshot.identityKey, pathname });
  current.current = { scopeKey: snapshot.scopeKey, identityKey: snapshot.identityKey, pathname };
  const previousPath = useRef(pathname);
  const visibleDraft = draft.scope === snapshot.scopeKey ? draft : emptyAssistantDraft;
  const model = useMemo(() => projectProductionHome(snapshot), [snapshot]);
  const chatDraft = snapshot.chat.selectedChildId ? snapshot.chat.drafts[snapshot.chat.selectedChildId] : undefined;

  useLayoutEffect(() => {
    if (!["/", "/chat"].includes(pathname) || previousPath.current === "/chat" && pathname !== "/chat") owner.draftOwner.clearAttachments(snapshot.scopeKey);
    previousPath.current = pathname;
  }, [owner, pathname, snapshot.scopeKey]);
  useEffect(() => { setLocalNotice(null); setDismissedNotice(null); setLogoutConfirmation(false); }, [snapshot.identityKey]);

  const refresh = useCallback(() => owner.refresh(), [owner]);
  const authenticate = useCallback((mode: AuthMode, input: Credentials) => owner.authenticate(mode, input), [owner]);
  const signOut = useCallback(async (discardConfirmed = false) => {
    if (!snapshot.identityKey || current.current.identityKey !== snapshot.identityKey) return;
    if (owner.hasDomainPending()) { setLocalNotice("請先等候或查核原操作結果，再登出。"); return; }
    const state = owner.controller.getSnapshot();
    if (state.childOutcome === "unknown" || state.childOutcome === "checked" || state.deletion
      || Object.values(state.drafts).some(item => item.outcome === "unknown" || item.outcome === "checked" || item.outcome === "sending")) {
      setLocalNotice("請先查核原操作結果，再登出；原操作及輸入會保留。"); return;
    }
    const chat = owner.chatController.getSnapshot(), agentState = owner.agentOwner.getSnapshot().model;
    if (chat.busy || Object.values(chat.drafts).some(item => item.phase === "save_unknown" || item.phase === "checked") || agentState.busy || agentState.pendingDecision || owner.authorizationOwner.getSnapshot().busy || owner.authorizationOwner.getSnapshot().pending) {
      setLocalNotice("請先等候或查核原聊天及候選操作，再登出；原操作會保留。"); return;
    }
    const currentDraft = owner.draftOwner.getSnapshot();
    if (!discardConfirmed && (owner.chatController.hasUnsavedInput() || currentDraft.attachments.length)) { setLogoutConfirmation(true); return; }
    setLogoutConfirmation(false);
    await owner.controller.signOut(discardConfirmed);
  }, [owner, snapshot.identityKey]);
  const currentScope = () => !!snapshot.scopeKey && current.current.scopeKey === snapshot.scopeKey && owner.getSnapshot().scopeKey === snapshot.scopeKey;
  const openAgentDraft = (focusText = false) => {
    if (!currentScope()) return;
    if (focusText) setComposerFocusRequest(value => value + 1);
    if (pathname !== "/chat") leave(() => router.push("/chat"));
  };
  const addAgentAttachment = (attachment: AssistantAttachment, replaceId?: string) => {
    if (!currentScope() || current.current.pathname !== pathname || !["/", "/chat"].includes(pathname) || attachment.kind !== "photo") {
      attachment.dispose?.(); setLocalNotice("目前只支援文字及照片草稿；內容尚未送出。"); return false;
    }
    return owner.draftOwner.add(snapshot.scopeKey, attachment, replaceId);
  };
  const actions: HomeActions = {
    selectChild(id) {
      if (!snapshot.identityKey || current.current.identityKey !== snapshot.identityKey || id === model.selectedChildId) return;
      leave(() => { if (current.current.identityKey === snapshot.identityKey) void owner.controller.selectChild(id); }, "child");
    },
    refresh: () => { void refresh(); },
    reviewOperation: () => { leave(() => router.push("/guide")); },
    open(destination) { leave(() => router.push(productionDestinations[destination] as Href)); },
    openAgentPhoto(original) {
      if (!currentScope() || current.current.pathname !== "/") { original.dispose?.(); return; }
      if (owner.draftOwner.add(snapshot.scopeKey, photoAttachment(original))) router.push("/chat");
    },
    composeCare() { leave(() => router.push("/care")); },
    prepareQuestion(question) {
      if (!currentScope()) return;
      if (chatDraft?.text.trim()) setLocalNotice("保留你原本未送出的問題；可在草稿入口核對後修改。");
      else owner.chatController.setText(question);
      openAgentDraft(true);
    },
    createChildPreview(displayName) {
      if (!snapshot.identityKey || current.current.identityKey !== snapshot.identityKey) return;
      owner.controller.setChildName(displayName); void owner.controller.createChild();
    },
    deleteChildPreview() {
      if (!currentScope() || owner.hasDomainPending()) return;
      owner.controller.reviewDeleteChild();
    },
    completeGuidePreview() { setLocalNotice("引導完成狀態尚未接線；你可以繼續使用已接通的入口。"); },
  };
  const notice = localNotice ?? (snapshot.records.notice === dismissedNotice ? null : snapshot.records.notice);
  return {
    apiBaseUrl: owner.apiBaseUrl, owner, controller: owner.controller, recordsState: snapshot.records,
    queryClient: owner.queryClient, user: snapshot.records.user, userId: snapshot.records.user?.id ?? null,
    selectedChildId: model.selectedChildId, scopeKey: snapshot.scopeKey, identityKey: snapshot.identityKey,
    sessionGeneration: snapshot.sessionGeneration, auth: snapshot.records.auth, online: snapshot.records.online,
    authenticate, signOut, refresh, model, actions, notice,
    dismissNotice: () => { setLocalNotice(null); setDismissedNotice(snapshot.records.notice); },
    homeIntroductionPending: snapshot.homeIntroductionPending, markHomeIntroductionPresented: owner.markHomeIntroductionPresented,
    chatState: snapshot.chat, chatController: owner.chatController,
    chatDraft: chatDraft?.text ?? "", setChatDraft: (value: string) => { if (currentScope()) owner.chatController.setText(value); },
    sendChat: async () => { if (!currentScope() || !owner.chatWritesAllowed() || owner.draftOwner.getSnapshot().attachments.length) return; const known = new Set(owner.chatController.getSnapshot().messages.map(item => item.id)); await owner.chatController.send(); if (currentScope() && owner.chatController.getSnapshot().messages.some(item => !known.has(item.id))) owner.invalidatePrivateReads(); },
    requestChatReply: async (id: string) => { if (!currentScope() || !owner.chatWritesAllowed()) return; const known = new Set(owner.chatController.getSnapshot().messages.map(item => item.id)); await owner.chatController.requestReply(id); if (currentScope() && owner.chatController.getSnapshot().messages.some(item => !known.has(item.id))) owner.invalidatePrivateReads(); },
    agentModel: agent.model, agentInbox: agent.inbox, agentRuns: agent.runs, agentPending: agent.pending,
    chatWritesAllowed: !owner.hasDomainPending() && !agent.model.busy && !agent.model.pendingDecision && !authorization.busy && !authorization.pending,
    readAgentPending: (more = false) => { if (currentScope()) void owner.agentOwner.readPending(more); },
    authorization, authorizationActions: {
      readPolicy: () => { if (currentScope()) void owner.authorizationOwner.readPolicy(); },
      readContact: () => { if (currentScope()) void owner.authorizationOwner.readContact(); },
      readNotes: (more = false) => { if (currentScope()) void owner.authorizationOwner.readNotes(more); },
      setDraft: (patch: Parameters<typeof owner.authorizationOwner.setDraft>[0]) => { if (currentScope()) owner.authorizationOwner.setDraft(patch); },
      setSharedConfirmation: (checked: boolean) => { if (currentScope()) owner.authorizationOwner.setSharedConfirmation(checked); },
      setQuery: (value: string) => { if (currentScope()) owner.authorizationOwner.setQuery(value); },
      save: () => { if (currentScope()) owner.authorizationOwner.savePolicy(); },
      deleteNote: (id: string) => { if (currentScope()) owner.authorizationOwner.deleteNote(id); },
      retryOriginal: () => { if (currentScope()) owner.authorizationOwner.retryOriginal(); },
      readReceipts: (id: string, force = false) => { if (currentScope()) void owner.authorizationOwner.readReceipts(id, force); },
    },
    agentActions: { refresh: () => { if (currentScope()) void owner.agentOwner.refresh(); },
      setSharedConfirmation: (id: string, checked: boolean) => { if (currentScope()) owner.agentOwner.setSharedConfirmation(id, checked); },
      decide: (id: string, decision: "accept" | "dismiss") => { if (currentScope()) owner.agentOwner.decide(id, decision); },
      retryOriginal: () => { if (currentScope()) owner.agentOwner.retryOriginal(); },
      openSource: (id: string) => { if (!currentScope()) return; const url = owner.agentOwner.sourceUrl(id); if (url) void Linking.openURL(url).catch(() => { if (currentScope()) setLocalNotice("未能開啟來源連結。"); }); } },
    selectAgentRun: (id: string) => { if (currentScope()) owner.agentOwner.selectRun(id); },
    openAgentSource: (runId: string, id: string) => { if (!currentScope()) return; const url = owner.agentOwner.sourceUrl(id, runId); if (url) void Linking.openURL(url).catch(() => { if (currentScope()) setLocalNotice("未能開啟來源連結。"); }); },
    agentInboxActions: { refresh: () => { if (currentScope()) void owner.agentOwner.readInbox(); },
      select: (id: string) => { if (currentScope()) owner.agentOwner.selectRun(id, true); },
      collapse: () => { if (currentScope()) owner.agentOwner.collapseInbox(); } },
    agentAttachments: visibleDraft.attachments, addAgentAttachment,
    removeAgentAttachment: (id: string) => { if (currentScope()) owner.draftOwner.remove(snapshot.scopeKey, id); },
    clearAgentDraft: () => { if (currentScope()) { owner.chatController.setText(""); owner.draftOwner.clearAttachments(snapshot.scopeKey); } },
    agentDraftScope: snapshot.scopeKey, composerFocusRequest, openAgentDraft,
    logoutConfirmation: logoutConfirmation || snapshot.records.logoutConfirmation,
    cancelLogout: () => { setLogoutConfirmation(false); owner.controller.cancelLogout(); },
    // Legacy preview consumers are kept type-compatible while their routes are gated.
    scenario: "normal" as PreviewScenario,
    setScenario: (_scenario: PreviewScenario) => { setLocalNotice("正式介面不支援合成情境切換。"); },
  };
}

export type ProductionContextValue = ReturnType<typeof useProductionValue>;
const ProductionContext = createContext<ProductionContextValue | null>(null);

export function ProductionProvider({ children, apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || "/api" }: { children: ReactNode; apiBaseUrl?: string }) {
  const [owner] = useState(() => new ProductionOwner(apiBaseUrl.replace(/\/$/, ""), initialOnline()));
  const value = useProductionValue(owner);
  useOnlineUpdates(owner.apiBaseUrl, value.auth === "signedIn" ? value.userId : null, value.online, async reason => {
    await owner.refresh();
    owner.invalidatePrivateReads(false, reason !== "unavailable");
  });
  useEffect(() => {
    owner.connect();
    void owner.controller.restoreSession();
    if (Platform.OS !== "web" || typeof window === "undefined") return () => owner.dispose();
    const recheck = () => {
      const state = owner.controller.getSnapshot();
      if (!navigator.onLine || state.busy) return;
      if (state.auth === "signedIn") void owner.refresh();
      else void owner.controller.restoreSession();
    };
    const connection = () => {
      owner.controller.setOnline(navigator.onLine);
      recheck();
    };
    const focus = recheck;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (owner.chatController.hasUnsavedInput() || owner.draftOwner.getSnapshot().attachments.length || owner.agentOwner.getSnapshot().model.pendingDecision || owner.authorizationOwner.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); window.addEventListener("online", connection); window.addEventListener("offline", connection); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("focus", focus); owner.dispose(); };
  }, [owner]);
  return <QueryClientProvider client={owner.queryClient}><ProductionContext.Provider value={value}>{children}
    <AppDialog visible={value.recordsState.deletion !== null} onDismiss={() => owner.controller.cancelDeleteChild()}>
      <AppDialog.Title>永久刪除這位孩子及附屬資料？</AppDialog.Title>
      <AppDialog.Content><Text>這會刪除所選孩子、照護記錄、私人聊天、記憶、任務及附屬資料。此操作不能撤銷。</Text>
        {value.recordsState.deletion?.message ? <Text>{value.recordsState.deletion.message}</Text> : null}</AppDialog.Content>
      <AppDialog.Actions>
        <AppButton label="保留孩子" variant="quiet" disabled={!!value.recordsState.busy || value.recordsState.deletion?.phase === "unknown"} onPress={() => owner.controller.cancelDeleteChild()} />
        {value.recordsState.deletion?.phase === "confirm" ? <AppButton label="確認永久刪除" variant="danger" disabled={!!value.recordsState.busy || !value.online} onPress={() => { void owner.controller.confirmDeleteChild(); }} />
          : <AppButton label="查核原刪除結果" disabled={!!value.recordsState.busy || !value.online} onPress={() => { void owner.controller.reloadChildren(); }} />}
        {value.recordsState.deletion?.phase === "checked" ? <AppButton label="核對後重試原刪除" variant="danger" disabled={!!value.recordsState.busy || !value.online} onPress={() => owner.controller.reviewDeleteChild()} /> : null}
      </AppDialog.Actions>
    </AppDialog>
    <AppDialog visible={value.logoutConfirmation} onDismiss={value.cancelLogout}>
      <AppDialog.Title>登出並清除未提交內容？</AppDialog.Title>
      <AppDialog.Content><Text>這次登出會清除本頁的文字及照片草稿。已提交但結果未知的操作仍須沿原操作查核。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="繼續編輯" variant="quiet" onPress={value.cancelLogout} /><AppButton label="確認登出" variant="danger" onPress={() => { void value.signOut(true); }} /></AppDialog.Actions>
    </AppDialog>
  </ProductionContext.Provider></QueryClientProvider>;
}

export function useProduction() {
  const value = useContext(ProductionContext);
  if (!value) throw new Error("ProductionProvider is required for production pages");
  return value;
}
