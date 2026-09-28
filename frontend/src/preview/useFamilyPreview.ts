import { useRef, useState } from "react";
import type { FamilyActions, FamilyDraft, FamilyInviteValues, FamilyPerspective, FamilySpace, FamilyViewModel, IncomingInvitationCondition } from "../family-view-model";
import type { HomeChild } from "../view-model";
import { applyFamilyManagement, createFamilyFixtures, createIncomingInvitation, createJoinedFamily, createLatestFamily, previewSelfIds, syntheticIncomingCode } from "./family-fixture";
import { usePreviewOperation } from "./usePreviewOperation";

// Synthetic state only; no tokens, email delivery, API calls, or authorization authority.
export function useFamilyPreview({ perspective, incomingCondition, ownerName, children, online, reading }: {
  perspective: FamilyPerspective; incomingCondition: IncomingInvitationCondition; ownerName: string;
  children: HomeChild[]; online: boolean; reading: boolean;
}) {
  const controller = usePreviewOperation();
  const [families, setFamilies] = useState(() => createFamilyFixtures(perspective, ownerName));
  const [selectedId, setSelectedId] = useState("preview-family-home");
  const [draft, setDraft] = useState<FamilyDraft | null>(null);
  const [latest, setLatest] = useState<FamilySpace | null>(null);
  const [incoming, setIncoming] = useState<FamilyViewModel["incoming"]>(null);
  const [incomingError, setIncomingError] = useState<string | null>(null);
  const [incomingConsumed, setIncomingConsumed] = useState(false);
  const [oneTimeCode, setOneTimeCode] = useState<string | null>(null);
  const [inviteFormKey, setInviteFormKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const serial = useRef(0);
  const family = families.find(item => item.id === selectedId) ?? null;
  const lost = perspective === "access_lost";
  const ready = online && !reading && !lost;
  const blocked = controller.locked || controller.operation.state === "conflict";
  const canManage = ready && family?.role === "owner";
  const canStartAction = ready && !blocked && !draft;
  const selfUserId = previewSelfIds[perspective];

  function begin(next: FamilyDraft) {
    setDraft(next); setLatest(null); setNotice(null); setOneTimeCode(null);
    controller.review();
  }

  function clearWorkspace() {
    controller.reset(); setDraft(null); setLatest(null); setIncoming(null); setIncomingError(null);
    setOneTimeCode(null); setNotice(null); setInviteFormKey(value => value + 1);
  }

  const actions: Omit<FamilyActions, "openProfile"> = {
    selectFamily(id) {
      if (!ready || controller.locked || !families.some(item => item.id === id) || id === selectedId) return;
      clearWorkspace(); setSelectedId(id);
    },
    refresh() {
      if (!canStartAction) return;
      setOneTimeCode(null); setIncoming(null); setIncomingError(null); controller.edit();
      setNotice("已重新讀取合成清單；一次性示例碼不會再次顯示。沒有呼叫 Server。");
    },
    editInvite() {
      if (blocked || draft && draft.kind !== "invite") return;
      setDraft(null); setLatest(null); setNotice(null); controller.edit();
    },
    reviewInvite(values: FamilyInviteValues) {
      if (!canManage || blocked || draft && draft.kind !== "invite" || !family) return;
      const email = values.email.trim();
      const pending = family.invitations.filter(item => item.status === "pending");
      if (pending.some(item => item.email.toLowerCase() === email.toLowerCase())) {
        setNotice("這個電郵已有待接受的合成邀請；請先核對清單。"); return;
      }
      if (pending.length >= 20) { setNotice("此家庭已有 20 個待接受邀請；請先處理現有邀請。"); return; }
      begin({ kind: "invite", basis: family, values: { ...values, email }, scopeConfirmed: false });
    },
    stageMember(userId, role) {
      if (!canManage || !canStartAction || !family) return;
      const member = family.members.find(item => item.userId === userId);
      if (!member || member.role === "owner" || member.userId === selfUserId || member.role === role) return;
      begin({ kind: "member", basis: family, userId, name: member.name, previousRole: member.role, role, scopeConfirmed: false });
    },
    stageRevokeInvitation(id) {
      if (!canManage || !canStartAction || !family) return;
      const invitation = family.invitations.find(item => item.id === id && item.status === "pending");
      if (invitation) begin({ kind: "revoke", basis: family, invitationId: id, email: invitation.email, scopeConfirmed: false });
    },
    editIncoming() {
      if (!canStartAction) return;
      setIncoming(null); setIncomingError(null); controller.edit();
    },
    previewIncoming(code) {
      if (!canStartAction) return;
      setIncoming(null); setIncomingError(null); controller.edit(); setNotice(null);
      if (code.trim() !== syntheticIncomingCode || incomingCondition !== "pending" || incomingConsumed) {
        setIncomingError("邀請未能讀取或已失效；過期、撤銷或已使用的合成邀請不能接受。"); return;
      }
      setIncoming(createIncomingInvitation(incomingCondition));
    },
    stageAccept() {
      if (!canStartAction || !incoming || incoming.status !== "pending" || incomingConsumed) return;
      if (controller.outcome === "conflict") controller.setOutcome("success");
      begin({ kind: "accept", invitation: incoming, scopeConfirmed: false });
    },
    confirmScope(checked) {
      if (blocked || !draft) return;
      setDraft({ ...draft, scopeConfirmed: checked });
    },
    reviewCurrent() {
      if (!ready || blocked || !draft) return;
      setDraft({ ...draft, scopeConfirmed: false }); controller.review();
    },
    submit() {
      if (!ready || blocked || !draft || !draft.scopeConfirmed || controller.operation.state !== "needs_confirmation") return;
      const attempt = draft;
      const nextSerial = serial.current + 1;
      const updated = attempt.kind === "accept" ? createJoinedFamily(attempt, selfUserId)
        : family && canManage ? applyFamilyManagement(family, attempt, nextSerial) : null;
      if (!updated || attempt.kind === "accept" && incomingConsumed) {
        setNotice("目標權限、邀請狀態或版本已改變；請取消並重新核對。這次沒有保存。"); return;
      }
      controller.submit(() => {
        serial.current = nextSerial;
        if (attempt.kind === "accept") {
          setFamilies(previous => previous.some(item => item.id === updated.id) ? previous : [...previous, updated]);
          setIncomingConsumed(true); setIncoming(null);
          setNotice("已模擬加入家庭；請在家庭選擇中查看。沒有加入真實家庭。");
        } else {
          setFamilies(previous => previous.map(item => item.id === updated.id ? updated : item));
          if (attempt.kind === "invite") {
            setOneTimeCode(`INVALID / PREVIEW ONLY / CODE ${nextSerial}`);
            setInviteFormKey(value => value + 1);
            setNotice("已建立合成邀請示例；沒有寄出電郵，示例碼完全無效。");
          } else setNotice(attempt.kind === "member" ? "合成成員權限已更新；正式權限仍由 Server 決定。" : "合成邀請已撤銷；沒有發出電郵。");
        }
        setDraft(null); setLatest(null);
      }, attempt.kind === "accept" ? undefined : () => {
        if (!family) return;
        const changed = createLatestFamily(family, attempt);
        setFamilies(previous => previous.map(item => item.id === changed.id ? changed : item));
        setLatest(changed); setDraft({ ...attempt, scopeConfirmed: false }); setOneTimeCode(null);
      });
    },
    cancel() {
      if (controller.locked) return;
      controller.reset(); setDraft(null); setLatest(null); setNotice(null);
    },
    useLatest() {
      if (controller.operation.state !== "conflict" || !latest || !draft || draft.kind === "accept") return;
      setDraft({ ...draft, basis: latest, scopeConfirmed: false }); setLatest(null); controller.useLatest();
    },
    dismissCode() { setOneTimeCode(null); },
  };

  const model: FamilyViewModel = {
    families: reading || lost ? [] : families.map(item => ({ id: item.id, ownerName: item.ownerName, role: item.role })),
    family: reading || lost ? null : family, selfUserId,
    children: reading || lost || family?.id !== "preview-family-home" ? [] : children,
    online, loadState: lost ? "lost" : reading ? "loading" : "ready", canManage, canStartAction,
    locked: blocked, draft: reading || lost ? null : draft, latest: reading || lost ? null : latest,
    incoming: reading || lost ? null : incoming, incomingError, oneTimeCode: reading || lost ? null : oneTimeCode,
    inviteFormKey, operation: controller.operation, notice,
  };
  return { model, actions, controller };
}
