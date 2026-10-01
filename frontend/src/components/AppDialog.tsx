import type { ComponentProps } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { Dialog as PaperDialog } from "react-native-paper";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

function Title({ danger = false, style, ...props }: ComponentProps<typeof PaperDialog.Title> & { danger?: boolean }) {
  return <PaperDialog.Title {...props} style={[styles.title, danger && styles.dangerTitle, style]} />;
}

function Actions({ style, ...props }: ComponentProps<typeof PaperDialog.Actions>) {
  return <PaperDialog.Actions {...props} style={[styles.actions, style]} />;
}

// Paper supplies the appearance; RN Modal owns the modal focus and platform close behavior.
export const AppDialog = Object.assign(function AppDialog({ danger = false, onClosed, ...props }: ComponentProps<typeof PaperDialog> & { danger?: boolean; onClosed?: () => void }) {
  return <Modal visible={props.visible} transparent animationType="none" onRequestClose={props.onDismiss} onDismiss={onClosed}>
    <View style={styles.root}><PaperDialog {...props} testID={props.testID ?? "app-dialog"} style={[styles.dialog, danger && styles.dangerDialog, props.style]} /></View>
  </Modal>;
}, { Title, Content: PaperDialog.Content, Actions, ScrollArea: PaperDialog.ScrollArea, Icon: PaperDialog.Icon });

const styles = StyleSheet.create({
  root: { flex: 1 },
  dialog: { width: "92%", maxWidth: 480, maxHeight: "92%", alignSelf: "center", marginHorizontal: 0, borderRadius: radius.large, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  title: { fontFamily: chineseFont, fontSize: typeScale.title, lineHeight: 28, fontWeight: "700", color: colors.ink },
  dangerDialog: { borderColor: colors.errorInk },
  dangerTitle: { color: colors.errorInk },
  actions: { flexWrap: "wrap", gap: spacing.sm, padding: spacing.lg },
});
