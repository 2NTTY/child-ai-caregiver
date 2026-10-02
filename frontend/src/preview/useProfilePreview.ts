import { useEffect, useState } from "react";
import {
  emptyProfileForm, profileDataFromForm, profileFormFromData,
  type ProfileActions, type ProfileFormValues, type ProfileRevisionView, type ProfileViewModel,
} from "../profile-view-model";
import type { HomeChild } from "../view-model";
import { createProfileFixture } from "./profile-fixture";
import { usePreviewOperation } from "./usePreviewOperation";

export type ProfilePreviewCondition = "normal" | "read_only" | "access_lost" | "no_profile";

// Local synthetic state only. Child-key unmount also cancels the shared operation timer.
export function useProfilePreview(child: HomeChild | null, online: boolean, reading: boolean) {
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
  const access = condition === "access_lost" ? "lost" : condition === "read_only" ? "read_only" : "editable";
  const blocked = controller.locked || controller.operation.state === "conflict";
  const canReview = access === "editable" && !reading && !blocked && (!child || online && !needsRefresh);
  const canSubmit = !!child && canReview;

  useEffect(() => { if (!online) setNeedsRefresh(true); }, [online]);

  function changeCondition(next: ProfilePreviewCondition) {
    if (controller.locked && next !== "access_lost") return;
    controller.reset();
    const nextFixture = fixture();
    const nextCurrent = next === "access_lost" ? null : next === "no_profile" && child
      ? { version: 0, data: null, confirmedByLabel: null, confirmedAtLabel: null, reason: null } : nextFixture.current;
    setCondition(next); setCurrent(nextCurrent); setBasis(nextCurrent);
    setHistory(next === "access_lost" || next === "no_profile" ? [] : nextFixture.history);
    setHistoryLimit(0); setLatest(null); setReviewedValues(null); setIntent(null); setNotice(null);
    setInitialValues(profileFormFromData(nextCurrent?.data ?? null)); setFormKey(value => value + 1);
  }

  const actions: ProfileActions = {
    reviewDraft(values) {
      if (!canReview) return;
      setReviewedValues({ ...values }); setIntent("save"); setNotice(null); controller.review();
    },
    editDraft() {
      if (blocked) return;
      setReviewedValues(null); setIntent(null); controller.edit();
    },
    cancelReview() {
      if (blocked) return;
      setReviewedValues(null); setIntent(null); controller.edit();
    },
    submitReviewed() {
      if (!canSubmit || controller.operation.state !== "needs_confirmation" || !intent || intent === "save" && !reviewedValues) return;
      const submittedValues = reviewedValues ? { ...reviewedValues } : null;
      const submittedBasis = basis;
      const submittedIntent = intent;
      controller.submit(() => {
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
      if (!canSubmit || !current?.data) return;
      setIntent("delete"); setReviewedValues(null); setNotice(null); controller.review();
    },
    useLatestVersion() {
      if (!latest || !online || reading || access !== "editable" || controller.operation.state !== "conflict") return;
      setBasis(latest); setLatest(null); setReviewedValues(null); setIntent(null); controller.useLatest();
    },
    showHistory() { if (child && online && !reading && access !== "lost") setHistoryLimit(1); },
    loadOlderHistory() { if (online && !reading && access !== "lost") setHistoryLimit(value => value + 1); },
    refresh() {
      if (!online || reading || access === "lost" || controller.locked) return;
      setNeedsRefresh(false); setNotice("已模擬重新讀取及核對；草稿保留，沒有向 Server 發出請求。");
    },
  };

  const model: ProfileViewModel = {
    child: child ? { id: child.id, name: child.displayName } : null,
    access, online, reading, needsRefresh,
    current: reading || access === "lost" ? null : current,
    basis: access === "lost" ? null : basis,
    latest: access === "lost" ? null : latest,
    history: reading || access === "lost" ? [] : history.slice(0, historyLimit),
    historyOpen: historyLimit > 0, hasMoreHistory: historyLimit < history.length,
    initialValues, formKey, reviewedValues, intent, operation: controller.operation, notice,
  };
  return { model, actions, controller, condition, changeCondition };
}
