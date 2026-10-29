import { bindPrivateQueries } from "../navigation/private-query-cache";
import { useNativePushNavigation } from "./useNativePushNavigation";
import { useProductionActivity } from "./useProductionActivity";
import { createProductionTransport } from "./production-transport";
import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { Linking, Platform } from "react-native";
import { Text } from "react-native-paper";
import type { AuthMode, Credentials } from "../../../src/client/records-api";
import type { PhotoMessageReference } from "../../../src/shared/photos";
import { emptyAssistantDraft, photoAttachment, type AssistantAttachment } from "../assistant-draft";
import { AppDialog } from "../components/AppDialog";
import { DeleteChildDialog } from "../components/DeleteChildDialog";
import { AppButton } from "../components/ui";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import type { PreviewScenario } from "../preview/fixture";
import type { HomeActions } from "../view-model";
import { ProductionOwner } from "./ProductionOwner";
import { AccountCallbackGate } from "../components/account/AccountCallbackGate";
import { projectProductionHome } from "./home-projection";
import { homeTargetHref } from "../home-target";
import { useOnlineUpdates } from "../../../src/client/use-online-updates";

function initialOnline() { return Platform.OS !== "web" || typeof navigator === "undefined" || navigator.onLine; }

function useProductionValue(owner: ProductionOwner) {
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const draft = useSyncExternalStore(owner.draftOwner.subscribe, owner.draftOwner.getSnapshot, owner.draftOwner.getSnapshot);
  const agent = useSyncExternalStore(owner.agentOwner.subscribe, owner.agentOwner.getSnapshot, owner.agentOwner.getSnapshot);
  const authorization = useSyncExternalStore(owner.authorizationOwner.subscribe, owner.authorizationOwner.getSnapshot, owner.authorizationOwner.getSnapshot);
  const voiceUpload = useSyncExternalStore(owner.voiceOwner.subscribe,owner.voiceOwner.getSnapshot,owner.voiceOwner.getSnapshot);
  const fileUpload = useSyncExternalStore(owner.fileOwner.subscribe,owner.fileOwner.getSnapshot,owner.fileOwner.getSnapshot);
  const photoUpload = useSyncExternalStore(owner.photoOwner.subscribe,owner.photoOwner.getSnapshot,owner.photoOwner.getSnapshot);
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
  useEffect(() => {
    const pending=owner.voiceOwner.getSnapshot();
    const message=pending.voice?snapshot.chat.messages.find(item=>item.voice?.id===pending.voice!.id):null;
    if(message&&snapshot.scopeKey&&pending.localId){owner.draftOwner.remove(snapshot.scopeKey,pending.localId);owner.voiceOwner.linked(message.id,message.voice!.id);}
  },[owner,snapshot.chat.messages,snapshot.scopeKey,voiceUpload.voice?.id]);
  useEffect(() => {
    const pending=owner.fileOwner.getSnapshot();
    const message=pending.file?snapshot.chat.messages.find(item=>item.file?.id===pending.file!.id):null;
    if(message&&snapshot.scopeKey&&pending.localId){owner.draftOwner.remove(snapshot.scopeKey,pending.localId);owner.fileOwner.linked(message.id,message.file!.id);}
  },[owner,snapshot.chat.messages,snapshot.scopeKey,fileUpload.file?.id]);
  useEffect(() => {
    const pending = owner.photoOwner.getSnapshot();
    const draft = snapshot.chat.selectedChildId ? snapshot.chat.drafts[snapshot.chat.selectedChildId] : undefined;
    const message = draft?.savedUserMessageId ? snapshot.chat.messages.find(item => item.id === draft.savedUserMessageId && item.photo?.id === pending.photo?.id) : null;
    if (message && snapshot.scopeKey && pending.localId) { owner.draftOwner.remove(snapshot.scopeKey,pending.localId); owner.photoOwner.linked(message.id,message.photo!.id); }
  }, [owner,snapshot.chat.messages,snapshot.chat.drafts,snapshot.scopeKey,photoUpload.photo?.id]);
  useNativePushNavigation(owner, snapshot.account.gate === "ready" ? snapshot.identityKey : null, snapshot.records.user?.id ?? null, target => {
    const identity = snapshot.identityKey;
    leave(() => { void (async () => {
      if (!identity || owner.getSnapshot().identityKey !== identity) return;
      if (target.childId) await owner.controller.selectChild(target.childId);
      if (owner.getSnapshot().identityKey === identity) router.push(target.kind === "test" ? "/settings" : { pathname: "/tasks", params: { taskId: target.taskId! } });
    })().catch(() => { if (owner.getSnapshot().identityKey === identity) setLocalNotice("通知事項未能開啟，請在待辦重新讀取。"); }); }, target.childId ? "child" : undefined);
  }, setLocalNotice);
  const visibleDraft = draft.scope === snapshot.scopeKey ? draft : emptyAssistantDraft;
  const model = useMemo(() => projectProductionHome(snapshot), [snapshot]);
  useLayoutEffect(() => bindPrivateQueries(owner), [owner]);
  const chatDraft = snapshot.chat.selectedChildId ? snapshot.chat.drafts[snapshot.chat.selectedChildId] : undefined;

  useLayoutEffect(() => {
    if ((!["/", "/chat"].includes(pathname) || previousPath.current === "/chat" && pathname !== "/chat")
      && !owner.voiceOwner.getSnapshot().localId && !owner.fileOwner.getSnapshot().localId && !owner.photoOwner.getSnapshot().localId && !owner.draftOwner.getSnapshot().attachments.some(item => item.kind === "file")) owner.draftOwner.clearAttachments(snapshot.scopeKey);
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
    if (pathname !== "/chat") leave(() => router.push("/chat"), "workspace");
  };
  const addAgentAttachment = (attachment: AssistantAttachment, replaceId?: string) => {
    if (!currentScope() || current.current.pathname !== pathname || !["/", "/chat"].includes(pathname) || !["photo","voice","file"].includes(attachment.kind)) {
      attachment.dispose?.(); setLocalNotice("目前無法加入附件；內容尚未送出。"); return false;
    }
    const currentAttachments=owner.draftOwner.getSnapshot().attachments;
    if(owner.voiceOwner.getSnapshot().localId || owner.fileOwner.getSnapshot().localId || owner.photoOwner.getSnapshot().localId || currentAttachments.some(v=>v.id!==replaceId)) {
      attachment.dispose?.();setLocalNotice('每則可傳送一張照片、一段錄音或一份檔案。請先送出或移除目前附件。');return false;
    }
    return owner.draftOwner.add(snapshot.scopeKey, attachment, replaceId);
  };
  const actions: HomeActions = {
    selectChild(id) {
      if (!snapshot.identityKey || current.current.identityKey !== snapshot.identityKey || id === model.selectedChildId) return;
      leave(() => { if (current.current.identityKey === snapshot.identityKey) void owner.controller.selectChild(id); }, "child");
    },
    refresh: () => { void refresh(); },
    reviewOperation: () => { leave(() => router.push("/guide"), "workspace"); },
    open(target) { leave(() => {
      const live = owner.getSnapshot();
      if (live.scopeKey === snapshot.scopeKey && live.identityKey === snapshot.identityKey
        && current.current.scopeKey === snapshot.scopeKey && current.current.identityKey === snapshot.identityKey && current.current.pathname === pathname) router.push(homeTargetHref(target));
    }, "workspace"); },
    openChildProfile(id) {
      leave(async () => {
        const before = owner.getSnapshot();
        if (!snapshot.identityKey || before.identityKey !== snapshot.identityKey || before.scopeKey !== snapshot.scopeKey
          || current.current.pathname !== pathname || !before.records.children.some(child => child.id === id)) return;
        try {
          if (before.records.selectedChildId !== id) await owner.controller.selectChild(id);
          const after = owner.getSnapshot();
          if (after.identityKey === snapshot.identityKey && after.scopeKey && after.records.selectedChildId === id
            && after.records.children.some(child => child.id === id) && current.current.pathname === pathname) router.push("/profile");
        } catch { if (owner.getSnapshot().identityKey === snapshot.identityKey) setLocalNotice("未能選擇這位孩子，請重新核對孩子列表。"); }
      }, "navigation");
    },
    openAgentPhoto(original) {
      if (!currentScope() || current.current.pathname !== "/") { original.dispose?.(); return; }
      if (addAgentAttachment(photoAttachment(original))) openAgentDraft();
    },
    composeCare() { leave(() => router.push("/care"), "workspace"); },
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
    account: snapshot.account,
    canPrepareAccountDeletion: owner.canStartDomainWrite() && !snapshot.records.busy && snapshot.records.childOutcome === "draft" && !snapshot.records.deletion
      && Object.values(snapshot.records.drafts).every(item => item.outcome === "draft") && !owner.chatController.hasUnsavedInput() && !visibleDraft.attachments.length,
    accountActions: {
      requestEmail: (kind: "verification" | "reset", email: string) => owner.accountOwner.requestEmail(kind, email),
      revokeOtherSessions: () => { if (current.current.identityKey === snapshot.identityKey) return owner.accountOwner.revokeOtherSessions(); },
      prepareDeletion: () => { const raw = owner.controller.getSnapshot();
        if (current.current.identityKey === snapshot.identityKey && owner.canStartDomainWrite() && !raw.busy && raw.childOutcome === "draft" && !raw.deletion
          && Object.values(raw.drafts).every(item => item.outcome === "draft") && !owner.chatController.hasUnsavedInput() && !owner.draftOwner.getSnapshot().attachments.length) return owner.accountOwner.prepareDeletion(); },
      verifyDeletionIdentity: (password: string) => { if (current.current.identityKey === snapshot.identityKey) return owner.accountOwner.verifyDeletionIdentity(password); },
      executeDeletion: (confirmation: string) => { if (current.current.identityKey === snapshot.identityKey) return owner.accountOwner.executeDeletion(confirmation); },
      cancelPreparedDeletion: () => { if (current.current.identityKey === snapshot.identityKey) return owner.accountOwner.cancelPreparedDeletion(); },
      checkDeletion: () => owner.accountOwner.checkDeletion(),
      downloadNextPart: (save: (text: string, filename: string, isCurrent: () => boolean) => void | Promise<void>) => { if (current.current.identityKey === snapshot.identityKey) return owner.accountOwner.downloadNextPart(save); },
      clearDownload: () => { if (current.current.identityKey === snapshot.identityKey) owner.accountOwner.clearDownload(); },
    },
    dismissNotice: () => { setLocalNotice(null); setDismissedNotice(snapshot.records.notice); },
    homeIntroductionPending: snapshot.homeIntroductionPending, markHomeIntroductionPresented: owner.markHomeIntroductionPresented,
    chatState: snapshot.chat, chatController: owner.chatController,
    chatDraft: chatDraft?.text ?? "", setChatDraft: (value: string) => { if (currentScope()) owner.chatController.setText(value); },
    sendChat: async () => {
      if(!currentScope()||!owner.chatWritesAllowed())return;
      const attachments=owner.draftOwner.getSnapshot().attachments;
      if(attachments.length&&(attachments.length!==1||!['voice','file','photo'].includes(attachments[0].kind)))return;
      const known=new Set(owner.chatController.getSnapshot().messages.map(item=>item.id));
      const attachment=attachments[0];
      const voice=attachment?.kind==='voice'?await owner.voiceOwner.prepare(attachment):null;
      const file=attachment?.kind==='file'?await owner.fileOwner.prepare(attachment):null;
      const photo=attachment?.kind==='photo'?(attachment.photoReference
        ?await owner.photoOwner.prepareReference(attachment.photoReference,attachment.id):attachment.photo?await owner.photoOwner.prepare({id:attachment.id,photo:attachment.photo}):null):null;
      if(!currentScope()||attachments.length&&!voice&&!file&&!photo||!owner.chatWritesAllowed())return;
      await owner.chatController.send(voice?{id:voice.id,version:voice.version}:undefined,file?{id:file.id,version:file.version}:undefined,photo?{id:photo.id,version:photo.version}:undefined);
      if(currentScope()&&photo){const saved=owner.chatController.getSnapshot().messages.find(item=>!known.has(item.id)&&item.photo?.id===photo.id);
        if(saved){owner.draftOwner.remove(snapshot.scopeKey,attachment.id);owner.photoOwner.linked(saved.id,photo.id);}}
      if(currentScope()&&owner.chatController.getSnapshot().messages.some(item=>!known.has(item.id)))owner.invalidatePrivateReads();
    },
    fileUpload, checkFileUpload: () => {if(currentScope())void owner.fileOwner.check();},
    photoUpload, checkPhotoUpload: () => {if(currentScope())void owner.photoOwner.check();},
    attachSavedPhoto: (photo: PhotoMessageReference) => {
      if(!currentScope())return;
      leave(() => {
        if(!currentScope()||!owner.chatWritesAllowed()||owner.draftOwner.getSnapshot().attachments.length){setLocalNotice('請先送出或移除目前聊天附件。');return;}
        const chat=owner.chatController.getSnapshot(), draft=chat.selectedChildId?chat.drafts[chat.selectedChildId]:undefined;
        if(chat.busy||draft&&draft.phase!=='draft'){setLocalNotice('請先處理目前訊息的保存結果。');return;}
        owner.draftOwner.add(snapshot.scopeKey,{id:`saved-photo-${photo.id}`,kind:'photo',fileName:photo.fileName,mimeType:photo.mimeType,bytes:photo.bytes,photoReference:photo});
        router.push('/chat');
      },'workspace');
    },
    voiceUpload, checkVoiceUpload: () => {if(currentScope())void owner.voiceOwner.check();},
    requestChatReply: async (id: string) => { if (!currentScope() || !owner.chatWritesAllowed()) return; const known = new Set(owner.chatController.getSnapshot().messages.map(item => item.id)); await owner.chatController.requestReply(id); if (currentScope() && owner.chatController.getSnapshot().messages.some(item => !known.has(item.id))) owner.invalidatePrivateReads(); },
    agentModel: agent.model, agentInbox: agent.inbox, agentRuns: agent.runs, agentPending: agent.pending,
    chatWritesAllowed: !owner.hasDomainPending() && !agent.model.busy && !agent.model.pendingDecision && !authorization.busy && !authorization.pending,
    readAgentActivity: (includePending = true) => { if (currentScope()) owner.agentOwner.readActivity(includePending); },
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
    removeAgentAttachment: (id: string) => { if (!currentScope())return;
      if(owner.voiceOwner.getSnapshot().localId===id){
        if(!owner.chatController.clearUnsentVoice())return;
        void owner.voiceOwner.discard().then(removed=>{if(removed&&currentScope())owner.draftOwner.remove(snapshot.scopeKey,id);});
      }else if(owner.fileOwner.getSnapshot().localId===id){
        if(!owner.chatController.clearUnsentFile())return;
        void owner.fileOwner.discard().then(removed=>{if(removed&&currentScope())owner.draftOwner.remove(snapshot.scopeKey,id);});
      }else if(owner.photoOwner.getSnapshot().localId===id){
        if(!owner.chatController.clearUnsentPhoto())return;
        void owner.photoOwner.discard().then(removed=>{if(removed&&currentScope())owner.draftOwner.remove(snapshot.scopeKey,id);});
      }else owner.draftOwner.remove(snapshot.scopeKey,id);
    },
    clearAgentDraft: () => { if (currentScope() && !owner.hasDomainPending()) {
      if (owner.voiceOwner.getSnapshot().localId) {
        if (!owner.chatController.clearUnsentVoice()) return;
        void owner.voiceOwner.discard().then(removed=>{if(removed&&currentScope()){owner.chatController.setText("");owner.draftOwner.clearAttachments(snapshot.scopeKey);}});
      } else if (owner.fileOwner.getSnapshot().localId) {
        if (!owner.chatController.clearUnsentFile()) return;
        void owner.fileOwner.discard().then(removed=>{if(removed&&currentScope()){owner.chatController.setText("");owner.draftOwner.clearAttachments(snapshot.scopeKey);}});
      } else if (owner.photoOwner.getSnapshot().localId) {
        if (!owner.chatController.clearUnsentPhoto()) return;
        void owner.photoOwner.discard().then(removed=>{if(removed&&currentScope()){owner.chatController.setText("");owner.draftOwner.clearAttachments(snapshot.scopeKey);}});
      } else {owner.chatController.setText("");owner.draftOwner.clearAttachments(snapshot.scopeKey);}
    } },
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
// Owner-only guards do not need route, draft or read-projection notifications.
// Identity and child consumers must continue using the reactive production value.
const ProductionOwnerContext = createContext<ProductionOwner | null>(null);

export function ProductionOwnerHost({ children, apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || (Platform.OS === "web" ? "/api" : "https://ex-machina.eu.org/api") }: { children?: ReactNode; apiBaseUrl?: string }) {
  const [owner] = useState(() => new ProductionOwner(apiBaseUrl.replace(/\/$/, ""), initialOnline(), undefined, undefined, undefined, { legacyTrial: process.env.EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL === "true" }, createProductionTransport(apiBaseUrl)));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const activity = useProductionActivity();
  useOnlineUpdates(owner.apiBaseUrl, snapshot.records.auth === "signedIn" && snapshot.account.gate === "ready" ? snapshot.records.user?.id ?? null : null, activity.online ?? snapshot.records.online, async reason => {
    await owner.refresh();
    owner.invalidatePrivateReads(false, reason !== "unavailable");
  }, owner.fetcher, activity.active, () => owner.chatController.refreshOriginalReply());
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
    const beforeUnload = (event: BeforeUnloadEvent) => { if (owner.hasDomainPending() || owner.chatController.hasUnsavedInput() || owner.draftOwner.getSnapshot().attachments.length || owner.agentOwner.getSnapshot().model.pendingDecision || owner.authorizationOwner.getSnapshot().pending || owner.adminOwner.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); window.addEventListener("online", connection); window.addEventListener("offline", connection); window.addEventListener("focus", focus);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("focus", focus); owner.dispose(); };
  }, [owner]);
  useEffect(() => {
    if (activity.active === undefined) return;
    if (activity.online !== undefined) owner.controller.setOnline(activity.online);
    const state = owner.controller.getSnapshot();
    if (!activity.active || activity.online === false || state.busy || state.auth === "checking") return;
    // Signed-in ready scopes refresh through the same changes-cursor observer, avoiding duplicate reads.
    if (state.auth !== "signedIn" || !owner.accountOwner.isReady()) void owner.refresh();
  }, [owner, activity.active, activity.online]);
  return <ProductionOwnerContext value={owner}>{children}</ProductionOwnerContext>;
}

/** Static rendering does not run the custom client entry; its isolated tree owns its own session. */
export function ProductionProvider({ children, apiBaseUrl }: { children: ReactNode; apiBaseUrl?: string }) {
  const owner = use(ProductionOwnerContext);
  return owner ? <ProductionProjection owner={owner}>{children}</ProductionProjection>
    : <ProductionOwnerHost apiBaseUrl={apiBaseUrl}><ProductionProvider>{children}</ProductionProvider></ProductionOwnerHost>;
}

function ProductionProjection({ children, owner }: { children: ReactNode; owner: ProductionOwner }) {
  const value = useProductionValue(owner);
  return <QueryClientProvider client={owner.queryClient}><ProductionContext value={value}><AccountCallbackGate>{children}</AccountCallbackGate>
    <DeleteChildDialog state={value.recordsState} confirmationKey={owner.childDeletionConfirmationKey()} getConfirmationKey={owner.childDeletionConfirmationKey} controller={owner.controller} />
    <AppDialog visible={value.logoutConfirmation} onDismiss={value.cancelLogout}>
      <AppDialog.Title>登出並清除未提交內容？</AppDialog.Title>
      <AppDialog.Content><Text>這次登出會清除本頁的文字及照片草稿。已提交但結果未知的操作仍須沿原操作查核。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="繼續編輯" variant="quiet" onPress={value.cancelLogout} /><AppButton label="確認登出" variant="danger" onPress={() => { void value.signOut(true); }} /></AppDialog.Actions>
    </AppDialog>
  </ProductionContext></QueryClientProvider>;
}

export function useProductionOwner() {
  const owner = use(ProductionOwnerContext);
  if (!owner) throw new Error("ProductionProvider is required for production owners");
  return owner;
}

export function useProduction() {
  const value = use(ProductionContext);
  if (!value) throw new Error("ProductionProvider is required for production pages");
  return value;
}
