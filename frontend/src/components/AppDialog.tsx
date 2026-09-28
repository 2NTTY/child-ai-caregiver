import type { ComponentProps } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { Dialog as PaperDialog } from "react-native-paper";

// Paper supplies the appearance; RN Modal owns the modal focus and platform close behavior.
export const AppDialog = Object.assign(function AppDialog(props: ComponentProps<typeof PaperDialog>) {
  return <Modal visible={props.visible} transparent animationType="none" onRequestClose={props.onDismiss}>
    <View style={styles.root}><PaperDialog {...props} style={[styles.dialog, props.style]} /></View>
  </Modal>;
}, { Title: PaperDialog.Title, Content: PaperDialog.Content, Actions: PaperDialog.Actions, ScrollArea: PaperDialog.ScrollArea, Icon: PaperDialog.Icon });

const styles = StyleSheet.create({ root: { flex: 1 }, dialog: { width: "92%", maxWidth: 520, maxHeight: "92%", alignSelf: "center", marginHorizontal: 0 } });
