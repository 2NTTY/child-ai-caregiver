import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { AgentProposalView } from "../agent-view-model";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { useProductionCareProfile } from "../production/CareProfileDomains";
import { useProduction } from "../production/ProductionProvider";
import { chineseFont, colors, radius, spacing } from "../theme";
import { useCareWorkspace } from "../workspaces/CareWorkspace";
import { AppDialog as Dialog } from "./AppDialog";
import { AppScrollView } from "./AppScrollView";
import { ToolbarIconButton } from "./ToolbarIconButton";
import { AgentRunView, type ActivityProposalTarget } from "./agent/AgentRunView";
import { PendingReviewList } from "../screens/PendingReviewList";
import { summarizePendingShortcut } from "./agent/pending-review-model";
import { AppButton } from "./ui";

/**
 * Top-right shortcut that reads and acts on the exact same ProductAgentOwner pending queue
 * used by /care ("記錄與核對"), without maintaining a second pending inbox or store.
 */
export function PendingReviewShortcut() {
  const {
    scopeKey,
    selectedChildId,
    online,
    sharedChild,
    agentPending,
    agentModel,
    agentActions,
    readAgentPending,
    selectAgentRun,
  } = useProduction();
  const workspace = useCareWorkspace();
  const recovery = useProductionCareProfile();
  const router = useRouter();
  const navigate = usePreviewNavigation();

  const [open, setOpen] = useState(false);
  const [openedCard, setOpenedCard] = useState<{
    scope: string;
    runId: string;
    target?: ActivityProposalTarget;
  } | null>(null);

  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;

  useEffect(() => {
    setOpen(false);
    setOpenedCard(null);
  }, [scopeKey]);

  const careLocked = !!recovery?.pending || !!workspace?.model.draft || !!workspace?.model.deletion;
  const locked = careLocked || !!agentModel.writesBlocked;
  const summary = summarizePendingShortcut({
    scopeKey,
    online,
    pending: agentPending,
    pendingDecision: agentModel.pendingDecision,
    readState: agentModel.readState,
    sharedChildActive: Boolean(sharedChild?.target),
  });

  usePreviewLeaveGuard(false, open && agentModel.busy === "write", "child", undefined, true);

  if (!summary.visible) return null;

  const activeSelection = open && openedCard && openedCard.scope === scopeKey ? openedCard : null;
  const validSelection = !!activeSelection
    && agentModel.run?.id === activeSelection.runId
    && agentModel.run.childId === selectedChildId;
  const original = agentModel.pendingDecision;

  function openShortcut() {
    if (online && !summary.denied && !agentModel.busy && !agentModel.pendingDecision && !agentModel.writesBlocked) {
      readAgentPending(false, Boolean(agentPending.hasSnapshot));
    }
    setOpenedCard(null);
    setOpen(true);
  }

  function closeDialog() {
    if (agentModel.busy === "write") return;
    setOpen(false);
    setOpenedCard(null);
  }

  function openCard(runId: string, proposalId: string, _cardKey: string, proposal?: AgentProposalView) {
    if (!scopeKey || !online || summary.denied || agentModel.busy || careLocked) return;
    if (original ? original.runId !== runId || original.proposalId !== proposalId : locked) return;
    const resolved = proposal ?? (agentModel.run?.id === runId ? agentModel.run.proposals.find(item => item.id === proposalId) : undefined);
    setOpenedCard({
      scope: scopeKey,
      runId,
      target: resolved
        ? { runId, id: resolved.id, version: resolved.version, kind: resolved.kind, scope: resolved.scope }
        : undefined,
    });
    if (original) agentActions.refresh();
    else selectAgentRun(runId);
  }

  function openCarePage() {
    if (!scopeKey || currentScope.current !== scopeKey || agentModel.busy === "write") return;
    setOpen(false);
    setOpenedCard(null);
    navigate(() => router.push("/care"), "workspace");
  }

  const quietRefresh = online && !!agentPending.hasSnapshot && agentModel.busy === "read" && !summary.denied && !locked && !original;
  const dialogTitle = activeSelection
    ? "核對事項詳情"
    : summary.loadedCountLabel
      ? `待確認事項（${summary.loadedCountLabel}）`
      : "待確認事項";

  return (
    <>
      <View testID="header-pending-shortcut" style={styles.anchor}>
        <ToolbarIconButton
          quiet
          icon="clipboard-check-outline"
          label={summary.accessibilityLabel}
          expanded={open}
          onPress={openShortcut}
        />
        {summary.badgeText ? (
          <View
            testID="header-pending-badge"
            pointerEvents="none"
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.badge, original ? styles.badgeAlert : styles.badgePending]}
          >
            <Text style={[styles.badgeText, original ? styles.badgeAlertText : styles.badgePendingText]}>
              {summary.badgeText}
            </Text>
          </View>
        ) : null}
      </View>
      <Portal>
        <Dialog visible={open} onDismiss={closeDialog} accessibilityLabel="待確認草稿快捷入口" style={styles.dialog}>
          <Dialog.Title style={styles.title}>{dialogTitle}</Dialog.Title>
          <Dialog.Content style={styles.content}>
            {open ? (
              <AppScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                {activeSelection ? (
                  <View style={styles.detailPane}>
                    <AppButton
                      label="返回待確認清單"
                      variant="quiet"
                      density="compact"
                      disabled={agentModel.busy === "write" || locked}
                      onPress={() => setOpenedCard(null)}
                      style={styles.backButton}
                    />
                    {validSelection || original?.runId === activeSelection.runId ? (
                      <AgentRunView
                        model={{ ...agentModel, writesBlocked: agentModel.writesBlocked || locked }}
                        actions={agentActions}
                        proposalTarget={activeSelection.target}
                        proposalOnly
                        preserveDecisionFocusOnRead={quietRefresh && agentPending.state === "loading"}
                      />
                    ) : (
                      <Text style={styles.fallbackCopy}>
                        {agentModel.readState === "failed"
                          ? "原提案未能讀回，不能沿用清單文字提交。"
                          : agentModel.readState === "denied"
                            ? "目前沒有權限查看所選結果。"
                            : agentModel.busy === "read" || agentModel.readState === "loading"
                              ? "正在核對所選原提案。"
                              : "所選結果尚未讀取，不能沿用清單文字提交。"}
                      </Text>
                    )}
                    {!validSelection && agentModel.readState === "failed" && !original ? (
                      <AppButton
                        label="重新讀取所選結果"
                        disabled={!online || !!agentModel.busy}
                        onPress={() => selectAgentRun(activeSelection.runId)}
                      />
                    ) : null}
                  </View>
                ) : (
                  <PendingReviewList
                    testIDPrefix="shortcut"
                    scopeKey={scopeKey}
                    online={online}
                    agentPending={agentPending}
                    agentModel={agentModel}
                    careLocked={careLocked}
                    onOpen={openCard}
                    onRefresh={more => readAgentPending(Boolean(more))}
                  />
                )}
              </AppScrollView>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions style={styles.actions}>
            <AppButton
              label="前往核對頁"
              variant="secondary"
              disabled={!scopeKey || agentModel.busy === "write"}
              onPress={openCarePage}
            />
            <AppButton
              label="關閉"
              variant="quiet"
              disabled={agentModel.busy === "write"}
              onPress={closeDialog}
            />
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { alignItems: "center", justifyContent: "center", position: "relative" },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgePending: { backgroundColor: colors.accent },
  badgeAlert: { backgroundColor: colors.coral },
  badgeText: { fontFamily: chineseFont, fontSize: 11, lineHeight: 14, fontWeight: "800" },
  badgePendingText: { color: colors.onAccent },
  badgeAlertText: { color: colors.white },
  dialog: { width: "92%", maxWidth: 640, alignSelf: "center", borderRadius: radius.large },
  title: { flexShrink: 0 },
  content: { flexShrink: 1, minHeight: 0, paddingBottom: 0 },
  scroll: { maxHeight: 460, flexShrink: 1, minHeight: 0 },
  scrollContent: { paddingBottom: spacing.sm },
  detailPane: { gap: spacing.sm, minWidth: 0 },
  backButton: { alignSelf: "flex-start" },
  fallbackCopy: { fontFamily: chineseFont, color: colors.muted },
  actions: { flexGrow: 0, flexShrink: 0, justifyContent: "space-between" },
});
