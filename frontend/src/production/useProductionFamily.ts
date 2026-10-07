import { useEffect, useMemo, useRef, useState } from "react";
import { createFamilyApi, FamilyApiError } from "../../../src/client/family-api.ts";
import type { FamilyDraft, FamilyActions, FamilyViewModel } from "../family-view-model";
import type { FamilySpace } from "../../../src/shared/family.ts";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { settingsAccessError, settingsFailure, settingsRead, useSettingsRefresh, useSettingsRequests, type SettingsEnvironment } from "./SettingsDomainSupport";
type OriginalFamily = { draft: FamilyDraft; token: string; confirmed: boolean; reviewed: boolean; consent: boolean };
export function useProductionFamily(env: SettingsEnvironment) {
  const api = useMemo(() => createFamilyApi(env.apiBaseUrl), [env.apiBaseUrl]), requests = useSettingsRequests(env, true);
  const [families, setFamilies] = useState<FamilySpace[]>([]), [familyId, setFamilyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FamilyDraft | null>(null), [latestFamily, setLatestFamily] = useState<FamilySpace | null>(null);
  const [incoming, setIncoming] = useState<FamilyViewModel["incoming"]>(null), [incomingError, setIncomingError] = useState<string | null>(null);
  const [oneTimeCode, setOneTimeCode] = useState<string | null>(null), [formKey, setFormKey] = useState(0);
  const [operation, setOperation] = useState<FamilyViewModel["operation"]>({ state: "none", message: "", reference: null });
  const [notice, setNotice] = useState<string | null>(null), [loaded, setLoaded] = useState(false), [lost, setLost] = useState(false), [original, setOriginal] = useState<OriginalFamily | null>(null);
  const incomingToken = useRef(""), pending = useRef<OriginalFamily | null>(null), data = useRef(families), selected = useRef(familyId), draftRef = useRef(draft);
  data.current = families; selected.current = familyId; draftRef.current = draft;
  const family = families.find(item => item.id === familyId) ?? null;
  const retain = (entry: OriginalFamily | null) => { pending.current = entry; setOriginal(entry ? { ...entry } : null); };
  const clearDraft = () => { setDraft(null); setLatestFamily(null); setIncoming(null); incomingToken.current = ""; setIncomingError(null); setFormKey(value => value + 1); };
  const verify = async (signal: AbortSignal) => { if (await api.getSession(signal) !== env.userId) throw new FamilyApiError(401); };
  const read = async (signal: AbortSignal) => {
    await verify(signal);
    const values = await settingsRead(env, "families", true, () => api.listFamilies(signal));
    await verify(signal); return values;
  };
  const apply = (values: FamilySpace[]) => {
    setFamilies(values); setLoaded(true); setLost(false);
    const selectedChild = env.owner.getSnapshot().records.children.find(child => child.id === env.childId);
    const nextId = values.some(item => item.id === selected.current) ? selected.current : values.find(item => item.id === selectedChild?.workspaceId)?.id ?? values[0]?.id ?? null;
    setFamilyId(nextId);
    const basis = draftRef.current;
    if (basis && basis.kind !== "accept") {
      const current = values.find(item => item.id === basis.basis.id);
      if (!current || current.role !== "owner") { clearDraft(); retain(null); api.resetOnline?.(); setOneTimeCode(null); }
      else if (current.version !== basis.basis.version) setLatestFamily(current);
    }
  };
  const fail = (error: unknown, entry?: OriginalFamily) => {
    const failure = settingsFailure(error);
    if (failure.status === 403 || failure.code === "access_denied") {
      api.resetOnline?.(); retain(null); clearDraft(); setOneTimeCode(null);
      const affectedId = entry ? entry.draft.kind === "accept" ? entry.draft.invitation.workspaceId : entry.draft.basis.id : null;
      const remaining = affectedId ? data.current.filter(item => item.id !== affectedId) : [];
      setFamilies(remaining); setFamilyId(remaining.some(item => item.id === selected.current) ? selected.current : remaining[0]?.id ?? null);
      setLoaded(false); setLost(false);
      setOperation({ state: "failed", message: "目前已無權進行這個家庭操作。", reference: null });
      setNotice("家庭存取權限已改變，對應資料及草稿已清除；請重新讀取家庭清單，再核對可用角色。"); return;
    }
    if (settingsAccessError(env, error, true)) {
      api.resetOnline?.(); retain(null); clearDraft(); setFamilies([]); setOneTimeCode(null); setLoaded(false); setLost(true); return;
    }
    if (entry && failure.confirmed) entry.confirmed = true;
    if (entry && (entry.confirmed || api.hasPendingOnline?.() || failure.status === 0 || failure.status >= 500)) {
      entry.reviewed = false; entry.consent = false; retain(entry);
      setOperation({ state: "unknown", reference: null, message: entry.confirmed ? "原操作已確認；目前家庭資料待重新讀取。" : "原操作結果待查核；不會自動建立另一邀請或更改。" });
    } else if (entry) {
      retain(null); setOperation({ state: failure.status === 409 ? "conflict" : "failed", reference: null, message: "操作未獲接納，請重讀家庭並重新核對草稿。" });
    }
    setLoaded(false); setNotice("未能讀取或確認家庭資料；目前清單不能當作最新或空清單。");
  };
  const refresh = async (reconcile = true) => {
    const request = requests.start(); if (!request || !env.userId) return;
    setOneTimeCode(null);
    if (draftRef.current?.kind !== "accept" && pending.current?.draft.kind !== "accept") { setIncoming(null); incomingToken.current = ""; }
    const entry = pending.current;
    if (entry) { entry.consent = false; entry.reviewed = false; retain(entry); }
    try {
      const receipt = reconcile && entry ? await api.reconcilePending?.(request.signal, env.userId) : null;
      if (entry && receipt?.state === "confirmed") entry.confirmed = true;
      const values = await read(request.signal); if (!request.current()) return;
      apply(values);
      if (!entry) {
        const basis = draftRef.current;
        if (basis?.kind === "accept") { setDraft({ ...basis, scopeConfirmed: false }); setOperation({ state: "needs_confirmation", reference: null, message: "請重新核對目前本人及原邀請的期限與共享範圍。" }); }
        else if (basis) {
          const current = values.find(item => item.id === basis.basis.id);
          if (current?.role === "owner") {
            setDraft({ ...basis, scopeConfirmed: false });
            setOperation({ state: current.version === basis.basis.version ? "needs_confirmation" : "conflict", reference: null, message: "目前家庭已讀取；請重新核對目標、版本及共享範圍。" });
          }
        }
        setNotice("目前家庭已重新讀取；未提交草稿保留。");
      }
      if (entry && !entry.confirmed && api.hasPendingOnline?.()) {
        entry.reviewed = receipt?.state === "unconfirmed"; retain(entry);
        setNotice("原操作尚無確認收據；已重讀目前家庭。請核對原目標及版本，再明確重試原內容。");
      } else if (entry) { retain(null); clearDraft(); setOperation({ state: entry.confirmed ? "saved" : "none", message: entry.confirmed ? "原操作已確認；目前家庭已重新讀取。邀請碼不能再次顯示，請查閱邀請清單。" : "已無待查原操作，請重新明確核對。", reference: null }); }
    } catch (error) { if (request.current()) fail(error, entry ?? undefined); }
    finally { request.finish(!!pending.current); }
  };
  const submit = async (retry = false) => {
    const value = retry ? pending.current?.draft : draftRef.current;
    if (!value || !env.userId || !loaded || !value.scopeConfirmed && !retry) return;
    const entry: OriginalFamily = retry ? pending.current! : { draft: structuredClone(value), token: incomingToken.current, confirmed: false, reviewed: false, consent: false };
    if (retry && (!entry.reviewed || !entry.consent || entry.confirmed || !api.hasPendingOnline?.())) return;
    if (!retry && (pending.current || api.hasPendingOnline?.())) return;
    if (value.kind !== "accept" && data.current.find(item => item.id === value.basis.id)?.role !== "owner") return;
    if (value.kind === "accept" && Date.parse(value.invitation.expiresAt) <= Date.now()) return;
    const request = requests.start(true, retry); if (!request) return;
    entry.reviewed = false; entry.consent = false; retain(entry); setOneTimeCode(null);
    setOperation({ state: "saving", message: "正在保存家庭操作。", reference: null });
    try {
      let code: string | null = null;
      if (value.kind === "invite") code = (await api.createInvitation(value.basis.id, value.values.email, value.values.role, value.basis.version, request.signal, env.userId)).token;
      else if (value.kind === "member") await api.changeMember(value.basis.id, value.userId, value.role, value.basis.version, request.signal, env.userId);
      else if (value.kind === "revoke") await api.revokeInvitation(value.basis.id, value.invitationId, value.basis.version, request.signal, env.userId);
      else await api.acceptInvitation(entry.token, value.invitation.workspaceId, request.signal, env.userId);
      entry.confirmed = true;
      if (request.current()) { env.invalidate(); void env.owner.controller.reloadChildren(); }
      await verify(request.signal); if (!request.current()) return;
      const values = await read(request.signal); if (!request.current()) return;
      apply(values); clearDraft(); retain(null); setOneTimeCode(code);
      setOperation({ state: "saved", message: "家庭操作已確認；邀請不會自動寄送電郵。", reference: null });
    } catch (error) { if (request.current()) fail(error, entry); }
    finally { request.finish(!!pending.current); }
  };
  const stage = (value: FamilyDraft) => {
    if (!loaded || requests.busy || pending.current || !env.online || !env.canStartWrite()) return;
    setDraft(value); setLatestFamily(null); setOneTimeCode(null); setOperation({ state: "needs_confirmation", message: "請核對目標及家庭共享範圍。", reference: null });
  };
  const actions: FamilyActions = {
    refresh: () => { void refresh(); },
    selectFamily(id) { if (!pending.current && !requests.busy && families.some(item => item.id === id)) { setFamilyId(id); clearDraft(); setOneTimeCode(null); } },
    editInvite() { if (!pending.current) { setDraft(null); setOneTimeCode(null); setOperation({ state: "none", message: "", reference: null }); } },
    reviewInvite(values) { if (family?.role === "owner") stage({ kind: "invite", basis: family, values: { ...values }, scopeConfirmed: false }); },
    stageMember(userId, role) { const member = family?.members.find(item => item.userId === userId); if (family?.role === "owner" && member && member.role !== "owner" && member.userId !== env.userId)
      stage({ kind: "member", basis: family, userId, name: member.name, previousRole: member.role, role, scopeConfirmed: false }); },
    stageRevokeInvitation(id) { const invitation = family?.invitations.find(item => item.id === id); if (family?.role === "owner" && invitation?.status === "pending") stage({ kind: "revoke", basis: family, invitationId: id, email: invitation.email, scopeConfirmed: false }); },
    editIncoming() { if (!pending.current) { setIncoming(null); incomingToken.current = ""; setIncomingError(null); setDraft(null); } },
    previewIncoming(code) {
      if (!env.userId || pending.current) return;
      const request = requests.start(); if (!request) return;
      setIncoming(null); incomingToken.current = ""; setIncomingError(null);
      void api.previewInvitation(code.trim(), request.signal, env.userId).then(async invitation => {
        await verify(request.signal); if (!request.current()) return;
        incomingToken.current = code.trim(); setIncoming({ ...invitation, status: Date.parse(invitation.expiresAt) > Date.now() ? "pending" : "expired" });
      }).catch(error => { if (request.current()) { if (!settingsAccessError(env, error, true)) setIncomingError("邀請未能核對；請確認本人帳號、邀請碼及期限。"); else fail(error); } }).finally(() => request.finish());
    },
    stageAccept() { if (incoming?.status === "pending" && incomingToken.current) stage({ kind: "accept", invitation: incoming, scopeConfirmed: false }); },
    confirmScope(value) { if (!pending.current) setDraft(current => current ? { ...current, scopeConfirmed: value } : null); },
    reviewCurrent() { void refresh(); }, submit: () => { void submit(); },
    cancel() { if (!pending.current && !requests.busy) { clearDraft(); setOperation({ state: "none", message: "", reference: null }); } },
    useLatest() { if (!pending.current && latestFamily?.role === "owner" && draft && draft.kind !== "accept") {
      setDraft({ ...draft, basis: latestFamily, scopeConfirmed: false }); setLatestFamily(null); setOperation({ state: "needs_confirmation", message: "已明確採用最新基準，請再次核對範圍。", reference: null }); } },
    dismissCode() { setOneTimeCode(null); }, openProfile() {} };
  useEffect(() => () => { api.resetOnline?.(); incomingToken.current = ""; pending.current = null; }, [api]);
  useEffect(() => { if (!env.online) { setOneTimeCode(null); setIncoming(null); if (pending.current) { pending.current.reviewed = false; pending.current.consent = false; retain(pending.current); } setDraft(current => current ? { ...current, scopeConfirmed: false } : null); } }, [env.online]);
  useSettingsRefresh(env, () => { void refresh(false); }, !requests.busy && !original && !draft && !incoming && !oneTimeCode, true);
  useDomainWriteGuard(!!draft || !!incoming || !!oneTimeCode, !!original || requests.busy, "account");
  const recordChildren = env.owner.getSnapshot().records.children;
  const model: Omit<FamilyViewModel, "families"> & { families: FamilySpace[] } = { families, family, selfUserId: env.userId ?? "", children: recordChildren.filter(child => child.workspaceId === familyId).map(child => ({ id: child.id, displayName: child.displayName, ageLabel: "年齡資料未載入" })),
    online: env.online, loadState: lost || !env.currentIdentity() ? "lost" : requests.busy && !loaded ? "loading" : "ready", canManage: family?.role === "owner" && loaded,
    canStartAction: loaded && env.online && !requests.busy && !original, locked: requests.busy || !!original || !loaded || !env.currentIdentity(), draft, latest: latestFamily, incoming, incomingError, oneTimeCode,
    inviteFormKey: formKey, operation, notice };
  return { readState: (lost || !loaded && notice && !requests.busy ? "error" : loaded ? "ready" : "loading") as "loading" | "ready" | "error", model, actions, original, busy: requests.busy, confirmOriginal(value: boolean) { if (pending.current && pending.current.reviewed) { pending.current.consent = value; retain(pending.current); } }, retryOriginal: () => { void submit(true); } };
}
