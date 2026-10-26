import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Animated, Easing, Modal, StyleSheet, View } from "react-native";
import { MotionBackdrop, motionTokens, useMotionPreferences } from "../motion";
import { MotionPaperScope } from "../motion/MotionPaperScope";
import { useModalBackdrop } from "../motion/useModalBackdrop";
import { Dialog as PaperDialog } from "react-native-paper";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

function Title({ danger = false, style, ...props }: ComponentProps<typeof PaperDialog.Title> & { danger?: boolean }) {
  return <PaperDialog.Title aria-level={2} {...props} style={[styles.title, danger && styles.dangerTitle, style]} />;
}

function Actions({ style, ...props }: ComponentProps<typeof PaperDialog.Actions>) {
  return <PaperDialog.Actions {...props} style={[styles.actions, style]} />;
}

// Paper supplies the appearance; RN Modal owns the modal focus and platform close behavior.
export const AppDialog = Object.assign(function AppDialog({ danger = false, onClosed, accessibilityLabel, ...props }: ComponentProps<typeof PaperDialog> & { danger?: boolean; onClosed?: () => void; accessibilityLabel?: string }) {
  const preferences = useMotionPreferences();
  const backdrop = useModalBackdrop(props.visible ?? false);
  const progress = useRef(new Animated.Value(1)).current;
  const previous = useRef(false);
  useLayoutEffect(() => {
    const opening = props.visible && !previous.current;
    previous.current = props.visible;
    progress.stopAnimation();
    if (!opening || !preferences.enabled) { progress.setValue(1); return; }
    progress.setValue(0);
    // The shared backdrop animates independently of RN Modal's focus owner.
    const animation = Animated.timing(progress, { toValue: 1, duration: motionTokens.dialog.duration, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [props.visible, preferences.enabled, preferences.epoch, progress]);
  return <Modal visible={props.visible} transparent animationType="none" accessibilityLabel={accessibilityLabel} onRequestClose={props.onDismiss} onDismiss={onClosed}>
    <MotionPaperScope><View style={styles.root}>
      <MotionBackdrop open={props.visible ?? false} {...backdrop} />
      <PaperDialog {...props} theme={{ ...props.theme, colors: { ...props.theme?.colors, backdrop: "transparent" }, animation: { scale: 0 } }} testID={props.testID ?? "app-dialog"} style={[styles.dialog, danger && styles.dangerDialog, props.style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [motionTokens.dialog.distance, 0] }) }] }]} />
    </View></MotionPaperScope>
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
