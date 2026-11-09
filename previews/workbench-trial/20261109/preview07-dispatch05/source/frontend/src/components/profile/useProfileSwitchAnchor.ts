import { useCallback, useLayoutEffect, useRef } from "react";
import { Platform, type ScrollView, type View } from "react-native";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";

type WebScrollView = ScrollView & { getScrollableNode(): HTMLElement };
type SwitchAnchor = { fromId: string; targetId: string; screenY: number; restoreFocus: boolean };

/** Keep the shared switch control in view, never the previous child's data or draft. */
export function useProfileSwitchAnchor(selectedChildId: string, onSelect: (id: string) => void) {
  const leave = usePreviewNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const pickerRef = useRef<View>(null);
  const options = useRef(new Map<string, View>());
  const selected = useRef(selectedChildId);
  selected.current = selectedChildId;
  const pending = useRef<SwitchAnchor | null>(null);
  const focusRequest = useRef<{ targetId: string; observer: MutationObserver | null } | null>(null);
  const clearFocusRequest = useCallback(() => {
    focusRequest.current?.observer?.disconnect();
    focusRequest.current = null;
  }, []);
  const setOptionRef = useCallback((id: string, node: View | null) => {
    if (node) options.current.set(id, node);
    else options.current.delete(id);
  }, []);

  function selectChild(targetId: string) {
    const fromId = selected.current;
    if (targetId === fromId) return;
    const source = Platform.OS === "web" ? options.current.get(targetId) as unknown as HTMLElement | undefined : undefined;
    const restoreFocus = !!source && source.ownerDocument.activeElement === source;
    // Capture only after the existing draft/operation guard permits this switch.
    leave(() => {
      if (selected.current !== fromId) return;
      clearFocusRequest();
      pending.current = null;
      if (Platform.OS === "web") {
        const viewport = (scrollRef.current as WebScrollView | null)?.getScrollableNode();
        const picker = pickerRef.current as unknown as HTMLElement | null;
        if (viewport && picker) pending.current = {
          fromId, targetId, restoreFocus,
          screenY: picker.getBoundingClientRect().top,
        };
      }
      onSelect(targetId);
    }, "child");
  }

  const restorePosition = useCallback(() => {
    const anchor = pending.current;
    if (!anchor || anchor.targetId !== selected.current || Platform.OS !== "web") return;
    const viewport = (scrollRef.current as WebScrollView | null)?.getScrollableNode();
    const picker = pickerRef.current as unknown as HTMLElement | null;
    if (!viewport || !picker) return;
    pending.current = null;
    // Include shell notice/facts height changes so the card keeps its visible position.
    const shiftY = picker.getBoundingClientRect().top - anchor.screenY;
    scrollRef.current?.scrollTo({ y: Math.max(0, viewport.scrollTop + shiftY), animated: false });

    const target = options.current.get(anchor.targetId) as unknown as HTMLElement | undefined;
    if (!anchor.restoreFocus || !target) return;
    const scope = target.closest('[data-testid="motion-child-scope"]');
    const request = { targetId: anchor.targetId, observer: null as MutationObserver | null };
    focusRequest.current = request;
    const restoreFocus = () => {
      if (focusRequest.current !== request) return;
      if (selected.current !== request.targetId || !target.isConnected) { clearFocusRequest(); return; }
      if (target.closest('[inert], [aria-hidden="true"]')) return;
      const active = target.ownerDocument.activeElement;
      // A newer user focus choice outside the concealed scope wins.
      if (active && active !== target.ownerDocument.body && active !== target) { clearFocusRequest(); return; }
      clearFocusRequest();
      target.focus({ preventScroll: true });
    };
    const Observer = target.ownerDocument.defaultView?.MutationObserver;
    if (scope && Observer) {
      request.observer = new Observer(restoreFocus);
      request.observer.observe(scope, { attributes: true, subtree: true, attributeFilter: ["inert", "aria-hidden"] });
    }
    restoreFocus();
    if (focusRequest.current === request && !request.observer) clearFocusRequest();
  }, [clearFocusRequest]);

  useLayoutEffect(() => {
    if (focusRequest.current && focusRequest.current.targetId !== selectedChildId) clearFocusRequest();
    if (pending.current && pending.current.fromId !== selectedChildId && pending.current.targetId !== selectedChildId) pending.current = null;
  }, [selectedChildId, clearFocusRequest]);
  useLayoutEffect(() => () => { pending.current = null; clearFocusRequest(); }, [clearFocusRequest]);

  return { scrollRef, pickerRef, setOptionRef, selectChild, restorePosition };
}
