import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import type { RecordsController, RecordsState } from "../../../src/client/records-controller";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppDialog } from "./AppDialog";
import { AppScrollView } from "./AppScrollView";
import { AppButton, AppTextField } from "./ui";

type Controller = Pick<RecordsController, "getSnapshot" | "cancelDeleteChild" | "confirmDeleteChild" | "reloadChildren" | "reviewDeleteChild">;

/** Name confirmation prevents UI mistakes; the existing owner and Server still authorize deletion. */
export function DeleteChildDialog({ state, confirmationKey, getConfirmationKey, controller }: {
  state: RecordsState; confirmationKey: string | null; getConfirmationKey: () => string | null; controller: Controller;
}) {
  const deletion = state.deletion;
  const child = state.children.find(item => item.id === deletion?.childId);
  const basis = useMemo(() => ({ deletion, confirmationKey, userId: state.user?.id, childId: deletion?.childId, name: child?.displayName, role: child?.accessRole }),
    [deletion, confirmationKey, state.user?.id, child?.id, child?.displayName, child?.accessRole]);
  const [input, setInput] = useState<{ basis: typeof basis; value: string } | null>(null);
  const latest = useRef(basis); latest.current = basis;
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const value = input?.basis === basis ? input.value : "";
  const current = () => {
    const next = controller.getSnapshot();
    return mounted.current && latest.current === basis && next.deletion === basis.deletion && next.user?.id === basis.userId;
  };
  const editable = state.auth === "signedIn" && state.online && !state.busy && !state.childrenLoading
    && !!child && child.accessRole === "owner" && child.id === state.selectedChildId && !!confirmationKey;
  const currentConfirmation = () => current() && !!basis.confirmationKey && getConfirmationKey() === basis.confirmationKey;
  const confirmed = !!basis.name && value === basis.name;
  const canSubmit = editable && deletion?.phase === "confirm" && confirmed;
  const cancel = () => { if (current()) { controller.cancelDeleteChild(); if (!controller.getSnapshot().deletion) setInput(null); } };
  const submit = () => {
    const next = controller.getSnapshot(), target = next.children.find(item => item.id === basis.childId);
    if (!canSubmit || !currentConfirmation() || next.auth !== "signedIn" || !next.online || next.busy || next.childrenLoading
      || next.deletion?.phase !== "confirm" || next.selectedChildId !== basis.childId
      || target?.displayName !== basis.name || target?.accessRole !== "owner" || basis.role !== "owner") return;
    setInput(null); void controller.confirmDeleteChild();
  };
  return <AppDialog danger visible={deletion !== null} accessibilityLabel="永久刪除孩子及全部附屬資料" onDismiss={cancel}>
    <AppDialog.Title danger>永久刪除整位孩子？</AppDialog.Title>
    <AppDialog.ScrollArea><AppScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.name}>{child ? `刪除對象：${child.displayName}` : "刪除對象暫時未能核對"}</Text>
      <Text style={styles.body}>這會永久刪除這位孩子、照護記錄、私人聊天、記憶、任務及全部附屬資料，不能撤銷，也無法從歷史復原。</Text>
      {deletion?.phase === "confirm" ? <>
        <Text nativeID="delete-child-name-help" style={styles.body}>請完整輸入孩子名字「{child?.displayName ?? ""}」，確認你要刪除的是這位孩子。</Text>
        <AppTextField label="輸入孩子名字以確認" accessibilityLabel="輸入要刪除的孩子完整名字" accessibilityHint="必須與上方孩子名字完全相同" aria-describedby="delete-child-name-help" aria-invalid={!!value && !confirmed} error={!!value && !confirmed} value={value}
          onChangeText={text => { if (currentConfirmation() && editable) setInput({ basis, value: text }); }} disabled={!editable}
          autoCapitalize="none" autoCorrect={false} autoComplete="off" returnKeyType="done" />
        {value && !confirmed ? <Text accessibilityLiveRegion="polite" style={styles.error}>名字未一致；請按上方完整名字重新輸入。</Text> : null}
      </> : null}
      {deletion?.message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{deletion.message}</Text> : null}
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions>
      <AppButton label="保留孩子" variant="quiet" disabled={!!state.busy || deletion?.phase === "unknown"} onPress={cancel} />
      {deletion?.phase === "confirm" ? <AppButton label="確認永久刪除" variant="danger" disabled={!canSubmit} onPress={submit} />
        : <AppButton label="查核原刪除結果" disabled={!!state.busy || !state.online} onPress={() => { if (current()) void controller.reloadChildren(); }} />}
      {deletion?.phase === "checked" ? <AppButton label="重新核對原刪除" variant="danger-secondary" disabled={!editable} onPress={() => { if (currentConfirmation() && editable) { setInput(null); controller.reviewDeleteChild(); } }} /> : null}
    </AppDialog.Actions>
  </AppDialog>;
}
const styles = StyleSheet.create({ content: { gap: spacing.md, padding: spacing.lg }, name: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool } });
