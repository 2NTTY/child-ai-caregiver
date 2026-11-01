import type { OperationOpenRequest } from "../operation-reveal";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { spacing } from "../theme";
import { AppDialog } from "./AppDialog";
import { AppScrollView } from "./AppScrollView";
import { AppButton } from "./ui";

/** Presentation only: the existing form and owner still own drafts, writes and recovery. */
export function FormDialog({ visible, scopeKey, title, children, recovery, onClose, returnFocusRef, fallbackFocusRef, formKey, closeOutcome, dismissMode = "guarded" }: {
  visible: boolean; scopeKey: string; title: string; children: ReactNode; recovery?: ReactNode;
  onClose(): void; returnFocusRef?: RefObject<View | null>; fallbackFocusRef?: RefObject<View | null>; formKey?: string | number;
  /** Optional owner projection acknowledgement; ordinary local-state dialogs need no port. */
  closeOutcome?: { revision: unknown; ready: boolean };
  /** Local dismissal is only for disposable presentation state, never an owner-backed draft or write. */
  dismissMode?: "guarded" | "local";
}) {
  const leave = usePreviewNavigation();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const generation = useRef({ visible, scopeKey, formKey, value: 0 });
  if (generation.current.scopeKey !== scopeKey || generation.current.formKey !== formKey || !generation.current.visible && visible) generation.current.value++;
  generation.current = { visible, scopeKey, formKey, value: generation.current.value };
  const openedGeneration = generation.current.value;
  const current = useRef({ visible, scopeKey, onClose, closeOutcome }); current.current = { visible, scopeKey, onClose, closeOutcome };
  const closeRequest = useRef<{ scopeKey: string; generation: number; closedGeneration: number | null; revision: unknown; outcomeObserved: boolean } | null>(null);
  const request = closeRequest.current;
  if (request) {
    if (request.scopeKey !== scopeKey || visible && request.generation !== openedGeneration) closeRequest.current = null;
    else {
      // Only a new owner projection can acknowledge or reject an owner-backed close.
      if (closeOutcome && !request.outcomeObserved && request.revision !== closeOutcome.revision) {
        request.outcomeObserved = true;
        if (visible || !closeOutcome.ready) closeRequest.current = null;
      }
      if (closeRequest.current && !visible) {
        if (closeOutcome && !closeOutcome.ready || request.closedGeneration !== null && request.closedGeneration !== openedGeneration) closeRequest.current = null;
        else request.closedGeneration = openedGeneration;
      }
    }
  }
  const dismiss = () => {
    if (!mounted.current || generation.current.value !== openedGeneration || !current.current.visible || current.current.scopeKey !== scopeKey) return;
    closeRequest.current = { scopeKey, generation: openedGeneration, closedGeneration: null, revision: current.current.closeOutcome?.revision, outcomeObserved: false };
    current.current.onClose();
  };
  const close = () => { if (dismissMode === "local") dismiss(); else leave(dismiss); };
  const closed = () => {
    const request = closeRequest.current, outcome = current.current.closeOutcome;
    if (request?.scopeKey === current.current.scopeKey && request.closedGeneration === generation.current.value && !current.current.visible && (!outcome || request.outcomeObserved && outcome.ready) && Platform.OS === "web") {
      for (const ref of [returnFocusRef, fallbackFocusRef]) {
        const host = ref?.current as unknown as HTMLElement | null;
        const target = host?.matches?.('button,[role="button"],[tabindex]') ? host : host?.querySelector<HTMLElement>('button,[role="button"],[tabindex]');
        if (!mounted.current || !target?.isConnected || target.hasAttribute?.("disabled") || target.getAttribute?.("aria-disabled") === "true"
          || target.closest?.('[aria-hidden="true"]') || target.getClientRects && !target.getClientRects().length) continue;
        if (typeof document !== "undefined" && document.activeElement === target) break;
        target.focus({ preventScroll: true });
        if (typeof document !== "undefined" && document.activeElement === target) break;
      }
    }
    closeRequest.current = null;
  };
  // RN Modal already portals natively; a Paper Portal here would lose page/owner contexts.
  return <AppDialog visible={visible} onDismiss={close} onClosed={closed} accessibilityLabel={title} style={styles.dialog} testID="manual-form-dialog">
    <AppDialog.Title>{title}</AppDialog.Title>
    <AppDialog.ScrollArea style={styles.scrollArea}><AppScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {visible ? <>{recovery}{children}</> : null}
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="關閉" accessibilityLabel={`關閉${title}`} variant="quiet" onPress={close} /></AppDialog.Actions>
  </AppDialog>;
}

/** A stable secondary trigger; closing only unmounts the form after guard approval. */
export function ManualFormDialog({ label, title = label, scopeKey, disabled = false, recovery, children, onClose, formKey, openRequest }: {
  label: string; title?: string; scopeKey: string; disabled?: boolean; recovery?: ReactNode; children: ReactNode; onClose?(): void; formKey?: string | number; openRequest?: OperationOpenRequest;
}) {
  const [state, setState] = useState<{ scopeKey: string; open: boolean } | null>(null);
  const trigger = useRef<View>(null);
  const visible = state?.scopeKey === scopeKey && state.open;
  const consumed = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.scopeKey !== scopeKey || consumed.current === openRequest.key) return;
    consumed.current = openRequest.key; openRequest.consume();
    if (!disabled) setState({ scopeKey, open: true });
  }, [openRequest?.key, openRequest?.scopeKey, scopeKey, disabled]);
  return <>
    <AppButton ref={trigger} label={label} accessibilityLabel={label === title ? label : `${label}：${title}`} variant="quiet" disabled={disabled} onPress={() => setState({ scopeKey, open: true })} />
    {state ? <FormDialog visible={!!visible} scopeKey={scopeKey} formKey={formKey} title={title} recovery={recovery} returnFocusRef={trigger}
      onClose={() => { onClose?.(); setState({ scopeKey, open: false }); }}>{children}</FormDialog> : null}
  </>;
}
const styles = StyleSheet.create({
  dialog: { maxWidth: 760 },
  scrollArea: { paddingHorizontal: 0, flexShrink: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
});
