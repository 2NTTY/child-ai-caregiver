import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  emptyProfileForm, profileDataFromForm, profileFormFromData,
  type ProfileActions, type ProfileFormValues, type ProfileRevisionView, type ProfileViewModel,
} from "../profile-view-model";
import type { HomeChild } from "../view-model";
import { createProfileFixture } from "./profile-fixture";
import { usePreviewOperation } from "./usePreviewOperation";

export type ProfilePreviewCondition = "normal" | "read_only" | "access_lost" | "no_profile";

// One synthetic owner serves profile editing and the current-child read projection.
export function useProfilePreview(child: HomeChild | null, online: boolean, reading: boolean, scopeKey = child?.id ?? "no-child", workspaceEntry = "profile") {
  const [controllerScope, setControllerScope] = useState(scopeKey);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const activeEntry = useRef(workspaceEntry);
  const generation = useRef(0);
  const fixture = () => child ? createProfileFixture(child.id) : { current: null, history: [] };
  const [condition, setCondition] = useState<ProfilePreviewCondition>("normal");
  const [current, setCurrent] = useState<ProfileRevisionView | null>(() => fixture().current);
  const [basis, setBasis] = useState<ProfileRevisionView | null>(() => fixture().current);
  const [history, setHistory] = useState<ProfileRevisionView[]>(() => fixture().history);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [latest, setLatest] = useState<ProfileRevisionView | null>(null);
  const [initialValues, setInitialValues] = useState(() => profileFormFromData(fixture().current?.data ?? null));
  const [formKey, setFormKey] = useState(0);
  const [reviewedValues, setReviewedValues] = useState<ProfileFormValues | null>(null);
  const [intent, setIntent] = useState<"save" | "delete" | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(!online);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = usePreviewOperation();
  const access = condition === "access_lost" ? "lost" : condition === "read_only" || child?.accessRole === "viewer" ? "read_only" : "editable";
  const blocked = controller.locked || controller.operation.state === "conflict";
  const canReview = access === "editable" && !reading && !blocked && (!child || online && !needsRefresh);
  const canSubmit = !!child && canReview;
  const live = useRef({ access, online, reading, canReview, canSubmit, blocked, locked: controller.locked });
  live.current = { access, online, reading, canReview, canSubmit, blocked, locked: controller.locked };
  const sameScope = () => controllerScope === scopeKey && currentScope.current === scopeKey;
  const currentRead = () => sameScope() && live.current.access !== "lost" && !live.current.reading;
  const currentReview = () => currentRead() && live.current.canReview;

  useEffect(() => { if (!online) setNeedsRefresh(true); }, [online]);

  function changeCondition(next: ProfilePreviewCondition, scopeReset = false) {
    if (!scopeReset && (!sameScope() || live.current.locked && next !== "access_lost")) return;
    generation.current++;
    controller.reset();
    const nextFixture = fixture();
    const nextCurrent = next === "access_lost" ? null : next === "no_profile" && child
      ? { version: 0, data: null, confirmedByLabel: null, confirmedAtLabel: null, reason: null } : nextFixture.current;
    setCondition(next); setCurrent(nextCurrent); setBasis(nextCurrent);
    setHistory(next === "access_lost" || next === "no_profile" ? [] : nextFixture.history);
    setHistoryLimit(0); setLatest(null); setReviewedValues(null); setIntent(null); setNotice(null);
    setInitialValues(profileFormFromData(nextCurrent?.data ?? null)); setFormKey(value => value + 1);
    if (scopeReset) setNeedsRefresh(!online);
  }

  useLayoutEffect(() => {
    if (controllerScope === scopeKey) return;
    changeCondition("normal", true); setControllerScope(scopeKey);
  }, [scopeKey, controllerScope]);
  useEffect(() => {
    const previous = activeEntry.current;
    activeEntry.current = workspaceEntry;
    if (!sameScope() || previous !== "profile" || workspaceEntry === "profile" || controller.locked) return;
    // The existing navigation guard approves draft departure; confirmed data stays shared.
    controller.reset(); setBasis(current); setLatest(null); setReviewedValues(null); setIntent(null);
    setHistoryLimit(0); setNotice(null);
    setInitialValues(profileFormFromData(current?.data ?? null)); setFormKey(value => value + 1);
  }, [workspaceEntry]);
  useEffect(() => () => { generation.current++; }, []);

  const actions: ProfileActions = {
    reviewDraft(values) {
      if (!currentReview()) return;
      setReviewedValues({ ...values }); setIntent("save"); setNotice(null); controller.review();
    },
    editDraft() {
      if (!currentRead() || live.current.blocked) return;
      setReviewedValues(null); setIntent(null); controller.edit();
    },
    cancelReview() {
      if (!currentRead() || live.current.blocked) return;
      setReviewedValues(null); setIntent(null); controller.edit();
    },
    discardDraft() {
      if (!sameScope() || live.current.locked) return;
      controller.reset(); setBasis(current); setLatest(null); setReviewedValues(null); setIntent(null);
      setInitialValues(profileFormFromData(current?.data ?? null)); setFormKey(value => value + 1);
    },
    submitReviewed() {
      if (!currentReview() || !live.current.canSubmit || controller.operation.state !== "needs_confirmation" || !intent || intent === "save" && !reviewedValues) return;
      const submittedValues = reviewedValues ? { ...reviewedValues } : null;
      const submittedBasis = basis;
      const submittedIntent = intent;
      const started = generation.current, startedScope = scopeKey;
      const stillCurrent = () => generation.current === started && currentScope.current === startedScope && live.current.access !== "lost";
      controller.submit(() => {
        if (!stillCurrent()) return;
        const saved: ProfileRevisionView = {
          version: (submittedBasis?.version ?? 0) + 1,
          data: submittedIntent === "save" && submittedValues ? profileDataFromForm(submittedValues) : null,
          confirmedByLabel: "媽媽（合成）", confirmedAtLabel: "2026-09-29 10:00（合成）",
          reason: submittedIntent === "save" ? submittedValues!.reason : "永久刪除檔案及全部歷史（合成）",
        };
        setHistory(previous => submittedIntent === "delete" ? [] : submittedBasis?.data ? [submittedBasis, ...previous] : previous);
        setCurrent(saved); setBasis(saved); setLatest(null); setHistoryLimit(0);
        setReviewedValues(null); setIntent(null); setInitialValues(profileFormFromData(saved.data)); setFormKey(value => value + 1);
        setNotice(submittedIntent === "delete" ? "只在本次預覽清除檔案及歷史；孩子和照顧記錄仍保留。" : null);
      }, () => {
        if (!stillCurrent()) return;
        const next: ProfileRevisionView = {
          version: (submittedBasis?.version ?? 0) + 1,
          data: submittedBasis?.data ? { ...submittedBasis.data, preferences: "另一位照顧者更新的合成偏好" } : {
            ...profileDataFromForm(emptyProfileForm()), source: "另一位照顧者的合成示例", preferences: "先聽孩子描述一天的事情",
          },
          confirmedByLabel: "爸爸（合成）", confirmedAtLabel: "2026-09-29 09:58（合成）", reason: "另一位照顧者更新合成檔案",
        };
        setLatest(next); setCurrent(next);
        setHistory(previous => submittedBasis?.data ? [submittedBasis, ...previous] : previous);
      });
    },
    reviewDeletion() {
      if (!currentReview() || !live.current.canSubmit || !current?.data) return;
      setIntent("delete"); setReviewedValues(null); setNotice(null); controller.review();
    },
    useLatestVersion() {
      if (!currentRead() || !latest || !live.current.online || live.current.access !== "editable" || controller.operation.state !== "conflict") return;
      setBasis(latest); setLatest(null); setReviewedValues(null); setIntent(null); controller.useLatest();
    },
    showHistory() { if (currentRead() && child && live.current.online) setHistoryLimit(1); },
    loadOlderHistory() { if (currentRead() && live.current.online) setHistoryLimit(value => value + 1); },
    refresh() {
      if (!currentRead() || !live.current.online || live.current.locked) return;
      setNeedsRefresh(false); setNotice("已模擬重新讀取及核對；草稿保留，沒有向 Server 發出請求。");
    },
  };

  const scopeReady = controllerScope === scopeKey;
  const readable = scopeReady && !reading && access !== "lost";
  const model: ProfileViewModel = {
    child: child ? { id: child.id, name: child.displayName } : null,
    access, online, reading, needsRefresh,
    current: readable ? current : null,
    basis: scopeReady && access !== "lost" ? basis : null,
    latest: scopeReady && access !== "lost" ? latest : null,
    history: readable ? history.slice(0, historyLimit) : [],
    historyOpen: historyLimit > 0, hasMoreHistory: historyLimit < history.length,
    initialValues, formKey, reviewedValues, intent, operation: controller.operation, notice,
  };
  return { model, actions, controller, condition, changeCondition, scopeReady };
}
