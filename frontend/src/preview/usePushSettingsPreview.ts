import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { ChannelDeliveryState, ChannelDeliveryView, ChannelPermission, ChannelReadState, ChannelReview, PushBindingView, PushSettingsActions, PushSettingsModel } from "../channel-view-model";
import { blocksAnotherTest } from "../channel-view-model";
import { usePreviewOperation } from "./usePreviewOperation";

export type PushScenario = "normal" | "denied" | "unsupported" | "unconfigured" | "paused" | "expired" | "unknown_delivery" | "read_failed" | "loading" | "session_changed";
export interface ChannelPreviewIdentity { id: string; name: string }
interface PushData {
  available: boolean; workerEnabled: boolean; permission: ChannelPermission; readState: ChannelReadState;
  currentBindingId: string | null; bindings: PushBindingView[]; deliveries: ChannelDeliveryView[];
  testsRemaining: number; nextTestAt: string | null;
}
function initial(): PushData {
  return { available: true, workerEnabled: true, permission: Platform.OS === "web" ? "default" : "unsupported", readState: "ready",
    currentBindingId: null, bindings: [], deliveries: [], testsRemaining: 3, nextTestAt: null };
}
const reasons: Partial<Record<ChannelDeliveryState, string>> = {
  rejected: "渠道拒絕本次一般測試。", unknown: "未能確認是否已被渠道接受，不能自動重送。", stopped: "這次投遞已停止。",
};

export function usePushSettingsPreview(online: boolean, identity: ChannelPreviewIdentity) {
  const op = usePreviewOperation();
  const [data, setData] = useState<PushData>(initial);
  const [review, setReview] = useState<ChannelReview | null>(null);
  const target = useRef<{ id: string | null; version: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenario, setScenario] = useState<PushScenario>("normal");
  const [deliveryOutcome, setDeliveryOutcome] = useState<ChannelDeliveryState>("accepted");
  const sequence = useRef(0);
  useEffect(() => { if (op.operation.state === "failed") { setReview(null); target.current = null; } }, [op.operation.state]);
  const locked = op.locked || op.operation.state === "conflict";
  const ready = online && data.readState === "ready" && !locked;
  const canStage = ready && review === null;
  function stage(next: ChannelReview, id: string | null = null) {
    if (!canStage) return;
    target.current = { id, version: next.expectedVersion };
    setReview(next); setNotice(null); op.review();
  }
  const actions: PushSettingsActions = {
    refresh() {
      if (!online || locked || data.readState === "session_changed") return;
      setData(current => ({ ...current, readState: "ready" })); setReview(null); target.current = null; op.edit();
      setNotice("已模擬重新讀取本人訂閱；沒有真服務回覆。");
    },
    stageEnable(label) {
      const value = label.trim();
      if (!data.available || Platform.OS !== "web" || data.permission === "denied" || data.permission === "unsupported" || !value || value.length > 80) return;
      const current = data.bindings.find(binding => binding.id === data.currentBindingId);
      stage({ kind: "enable", targetLabel: value, expectedVersion: current?.version ?? null, confirmed: false }, current?.id ?? null);
    },
    stageRevoke(id) {
      const binding = data.bindings.find(item => item.id === id);
      if (binding?.status === "active") stage({ kind: "revoke", targetLabel: binding.label, expectedVersion: binding.version, confirmed: false }, id);
    },
    stageTest(id) {
      const binding = data.bindings.find(item => item.id === id);
      if (!data.available || !data.workerEnabled || data.testsRemaining <= 0 || data.nextTestAt && Date.parse(data.nextTestAt) > Date.now()
        || !binding || binding.status !== "active" || blocksAnotherTest(data.deliveries, id)) return;
      stage({ kind: "test", targetLabel: binding.label, expectedVersion: binding.version, confirmed: false }, id);
    },
    confirmReview(confirmed) { if (!locked) setReview(current => current ? { ...current, confirmed } : null); },
    cancel() { if (!locked) { setReview(null); target.current = null; op.edit(); } },
    useLatest() {
      if (!online || op.operation.state !== "conflict") return;
      setReview(null); target.current = null; op.useLatest();
      setNotice("已讀到新的渠道版本；舊勾選已清除，請重新核對這次對象。");
    },
    submit() {
      if (!ready || !review?.confirmed || !target.current) return;
      const draft = review;
      const basis = { ...target.current };
      const outcome = deliveryOutcome;
      op.submit(() => {
        setData(current => {
          if (draft.kind === "enable") {
            const id = basis.id ?? `preview-push-${identity.id}`;
            const binding: PushBindingView = { id, version: (basis.version ?? 0) + 1, label: draft.targetLabel, status: "active", providerLabel: "Firefox（合成）", expiresAt: null };
            return { ...current, permission: "granted", currentBindingId: id, bindings: [binding, ...current.bindings.filter(item => item.id !== id)] };
          }
          if (draft.kind === "revoke") return { ...current, bindings: current.bindings.map(item => item.id === basis.id ? { ...item, status: "revoked", version: item.version + 1 } : item) };
          const delivery: ChannelDeliveryView = { id: `preview-push-delivery-${identity.id}-${++sequence.current}`, bindingId: basis.id!, label: draft.targetLabel,
            status: outcome, reasonLabel: reasons[outcome] ?? null, createdAt: new Date().toISOString(), acknowledgedAt: null };
          return { ...current, deliveries: [delivery, ...current.deliveries].slice(0, 20), testsRemaining: Math.max(0, current.testsRemaining - 1), nextTestAt: new Date(Date.now() + 60_000).toISOString() };
        });
        setReview(null); target.current = null;
      }, () => {
        setData(current => ({ ...current, bindings: current.bindings.map(item => item.id === basis.id ? { ...item, version: item.version + 1, label: "最新瀏覽器名稱（合成）" } : item) }));
        setReview(null); target.current = null;
      });
    },
  };
  const visible = data.readState === "ready";
  const model: PushSettingsModel = { ...data, online, locked, conflict: op.operation.state === "conflict", notice, review,
    browserSupported: Platform.OS === "web" && data.permission !== "unsupported",
    bindings: visible ? data.bindings : [], deliveries: visible ? data.deliveries : [], currentBindingId: visible ? data.currentBindingId : null };
  function resetForAccount() {
    op.reset(); setData(initial()); setReview(null); target.current = null; setNotice(null); setScenario("normal"); sequence.current = 0;
  }
  function chooseScenario(next: PushScenario) {
    if (locked || review) return;
    op.reset(); target.current = null; setNotice(null); setScenario(next);
    const sample = initial();
    if (!["normal", "loading", "session_changed"].includes(next)) {
      sample.currentBindingId = `preview-push-${identity.id}`;
      sample.bindings = [{ id: sample.currentBindingId, version: 2, label: "我的瀏覽器（合成）", status: next === "expired" ? "expired" : "active", providerLabel: "Firefox（合成）", expiresAt: null }];
    }
    if (next === "denied") sample.permission = "denied";
    if (next === "unsupported") sample.permission = "unsupported";
    if (next === "unconfigured") sample.available = false;
    if (next === "paused") sample.workerEnabled = false;
    if (next === "loading") sample.readState = "loading";
    if (next === "read_failed") sample.readState = "failed";
    if (next === "session_changed") sample.readState = "session_changed";
    if (next === "unknown_delivery") sample.deliveries = [{ id: "preview-unknown-push", bindingId: sample.currentBindingId!, label: "我的瀏覽器（合成）", status: "unknown", reasonLabel: reasons.unknown!, createdAt: new Date().toISOString(), acknowledgedAt: null }];
    setData(sample);
  }
  return { model, actions, operation: op, scenario, chooseScenario, deliveryOutcome, setDeliveryOutcome, resetForAccount };
}
