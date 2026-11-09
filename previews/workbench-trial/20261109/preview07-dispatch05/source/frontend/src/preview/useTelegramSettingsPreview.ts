import { useEffect, useRef, useState } from "react";
import type { ChannelDeliveryState, TelegramDeliveryView, ChannelReadState, ChannelReview, TelegramBindingView, TelegramChallengeView, TelegramSettingsActions, TelegramSettingsModel } from "../channel-view-model";
import { blocksAnotherTelegramTest, telegramBeginAllowed } from "../channel-view-model";
import type { ChannelPreviewIdentity } from "./usePushSettingsPreview";
import { usePreviewOperation } from "./usePreviewOperation";

export type TelegramScenario = "normal" | "unconfigured" | "paused" | "blocked" | "expired" | "unknown_delivery" | "read_failed" | "loading" | "session_changed";
interface TelegramData {
  configured: boolean; workerEnabled: boolean; readState: ChannelReadState;
  binding: TelegramBindingView | null; challenge: TelegramChallengeView | null; deliveries: TelegramDeliveryView[];
}
const initial = (): TelegramData => ({ configured: true, workerEnabled: true, readState: "ready", binding: null, challenge: null, deliveries: [] });

export function useTelegramSettingsPreview(online: boolean, identity: ChannelPreviewIdentity) {
  const op = usePreviewOperation("account");
  const [data, setData] = useState<TelegramData>(initial);
  const [review, setReview] = useState<ChannelReview | null>(null);
  const target = useRef<{ id: string | null; version: number | null } | null>(null);
  const simulatedRemoteChallenge = useRef<TelegramChallengeView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenario, setScenario] = useState<TelegramScenario>("normal");
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
  const actions: TelegramSettingsActions = {
    refresh() {
      if (!online || locked || data.readState === "session_changed") return;
      const nextChallenge = simulatedRemoteChallenge.current;
      simulatedRemoteChallenge.current = null;
      setData(current => ({ ...current, readState: "ready", challenge: nextChallenge && nextChallenge.id === current.challenge?.id ? nextChallenge : current.challenge }));
      setReview(null); target.current = null; op.edit();
      setNotice("已模擬重新讀取本人的 Telegram 狀態；沒有自動輪詢或真服務回覆。");
    },
    stageBegin() {
      if (!telegramBeginAllowed(data)) return;
      stage({ kind: "begin", targetLabel: `${identity.name}的私人 Telegram 渠道`, expectedVersion: null, confirmed: false });
    },
    stageConfirm() {
      const challenge = data.challenge;
      if (!data.configured || data.binding && data.binding.status !== "revoked" || !challenge?.candidate || challenge.state !== "seen" || Date.parse(challenge.expiresAt) <= Date.now()) return;
      stage({ kind: "confirm", targetLabel: `${challenge.candidate.label} · ${challenge.candidate.chatIdHint}`, expectedVersion: challenge.version, confirmed: false }, challenge.id);
    },
    stageRevoke() {
      const binding = data.binding;
      if (binding && binding.status !== "revoked") stage({ kind: "revoke", targetLabel: `${binding.label} · ${binding.chatIdHint}`, expectedVersion: binding.version, confirmed: false }, binding.id);
    },
    stageTest() {
      const binding = data.binding;
      if (!data.configured || !data.workerEnabled || !binding || binding.status !== "active" || blocksAnotherTelegramTest(data.deliveries, binding.id)) return;
      stage({ kind: "test", targetLabel: `${binding.label} · ${binding.chatIdHint}`, expectedVersion: binding.version, confirmed: false }, binding.id);
    },
    openStartLink() {
      if (!ready || !data.challenge || Date.parse(data.challenge.expiresAt) <= Date.now()) return;
      setNotice("正式版會開啟服務提供的 10 分鐘 bot 連結。本頁不開啟真 bot；可用下方合成情境模擬啟動，再手動重讀及核對帳號。");
    },
    confirmReview(confirmed) { if (!locked) setReview(current => current ? { ...current, confirmed } : null); },
    cancel() { if (!locked) { setReview(null); target.current = null; op.edit(); } },
    useLatest() {
      if (!online || op.operation.state !== "conflict") return;
      setReview(null); target.current = null; op.useLatest();
      setNotice("已讀到新的候選／綁定版本；舊帳號勾選已清除，請重新核對。");
    },
    submit() {
      if (!ready || !review?.confirmed || !target.current) return;
      if (review.kind === "confirm" && (!data.challenge || Date.parse(data.challenge.expiresAt) <= Date.now())) {
        setReview(null); target.current = null; op.edit(); setNotice("綁定連結已過期；請重新開始私人綁定。"); return;
      }
      const draft = review;
      const basis = { ...target.current };
      const candidate = data.challenge?.candidate;
      const outcome = deliveryOutcome;
      op.submit(() => {
        simulatedRemoteChallenge.current = null;
        setData(current => {
          if (draft.kind === "begin") return { ...current, challenge: { id: `preview-challenge-${identity.id}-${++sequence.current}`, version: 1, state: "waiting", candidate: null, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
          if (draft.kind === "confirm") return { ...current, challenge: null, binding: { id: `preview-telegram-${identity.id}`, version: (current.binding?.version ?? 0) + 1, status: "active", label: candidate!.label, chatIdHint: candidate!.chatIdHint } };
          if (draft.kind === "revoke") return { ...current, binding: current.binding ? { ...current.binding, status: "revoked", version: current.binding.version + 1 } : null };
          const delivery: TelegramDeliveryView = { id: `preview-telegram-delivery-${identity.id}-${++sequence.current}`, bindingId: basis.id!, label: draft.targetLabel, status: outcome,
            reasonLabel: outcome === "unknown" ? "未能確認是否已接受，請先核對原投遞。" : outcome === "rejected" ? "渠道拒絕本次一般測試。" : outcome === "stopped" ? "這次投遞已停止。" : null,
            createdAt: new Date().toISOString(), acknowledgedAt: null };
          return { ...current, deliveries: [delivery, ...current.deliveries].slice(0, 20) };
        });
        setReview(null); target.current = null;
      }, () => {
        setData(current => draft.kind === "confirm" && current.challenge ? { ...current, challenge: { ...current.challenge, version: current.challenge.version + 1, candidate: { label: "另一個候選帳號（合成）", chatIdHint: "•••4321" } } }
          : { ...current, binding: current.binding ? { ...current.binding, version: current.binding.version + 1, label: "最新候選帳號（合成）" } : null });
        setReview(null); target.current = null;
      });
    },
  };
  const visible = data.readState === "ready";
  const model: TelegramSettingsModel = { ...data, online, locked, conflict: op.operation.state === "conflict", notice, review,
    binding: visible ? data.binding : null, challenge: visible ? data.challenge : null, deliveries: visible ? data.deliveries : [] };
  function resetForAccount() {
    simulatedRemoteChallenge.current = null;
    op.reset(); setData(initial()); setReview(null); target.current = null; setNotice(null); setScenario("normal"); sequence.current = 0;
  }
  function chooseScenario(next: TelegramScenario) {
    if (locked || review) return;
    simulatedRemoteChallenge.current = null;
    op.reset(); target.current = null; setNotice(null); setScenario(next);
    const sample = initial();
    if (!["normal", "expired", "loading", "session_changed"].includes(next)) sample.binding = { id: `preview-telegram-${identity.id}`, version: 2, status: next === "blocked" ? "blocked" : "active", label: `${identity.name}（合成）`, chatIdHint: "•••1234" };
    if (next === "unconfigured") sample.configured = false;
    if (next === "paused") sample.workerEnabled = false;
    if (next === "read_failed") sample.readState = "failed";
    if (next === "loading") sample.readState = "loading";
    if (next === "session_changed") sample.readState = "session_changed";
    if (next === "expired") sample.challenge = { id: "preview-expired-challenge", version: 2, state: "seen", candidate: { label: `${identity.name}（合成）`, chatIdHint: "•••1234" }, expiresAt: new Date(Date.now() - 60_000).toISOString() };
    if (next === "unknown_delivery") sample.deliveries = [{ id: "preview-unknown-telegram", bindingId: sample.binding!.id, label: sample.binding!.label, status: "unknown", reasonLabel: "未能確認是否已接受，請先核對原投遞。", createdAt: new Date().toISOString(), acknowledgedAt: null }];
    setData(sample);
  }
  function simulateBotStart() {
    if (!ready || review || !data.challenge || data.challenge.state !== "waiting" || Date.parse(data.challenge.expiresAt) <= Date.now()) return;
    simulatedRemoteChallenge.current = { ...data.challenge, state: "seen", version: data.challenge.version + 1, candidate: { label: `${identity.name}（合成）`, chatIdHint: "•••1234" } };
    setNotice("已模擬 Telegram 啟動；請手動重新讀取，再核對候選帳號並明確確認。");
  }
  function simulateAcknowledgement() {
    if (!ready || review || data.deliveries.length === 0) return;
    setData(current => ({ ...current, deliveries: current.deliveries.map((item, index) => index === 0 ? { ...item, acknowledgedAt: new Date().toISOString() } : item) }));
  }
  return { model, actions, operation: op, scenario, chooseScenario, deliveryOutcome, setDeliveryOutcome, resetForAccount, simulateBotStart, simulateAcknowledgement };
}
