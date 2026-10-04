import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import type { DrawerOverlayProps } from "./DrawerOverlay.types";

const focusableSelector = 'button,[href],input,select,textarea,[tabindex]';
function focusableWithin(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(node => node.tabIndex >= 0
    && !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true" && !node.closest('[inert],[aria-hidden="true"]')
    && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
}

/** Temporary focus ownership for one Web drawer, released before its visual exit. */
export function useDrawerFocus(props: DrawerOverlayProps, surface: RefObject<View | null>) {
  const latest = useRef(props); latest.current = props;
  const pendingReturn = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    const origin = pendingReturn.current; pendingReturn.current = null;
    if (latest.current.restoreFocusOnClose !== false && origin?.isConnected
      && !origin.hasAttribute("disabled") && origin.getAttribute("aria-disabled") !== "true"
      && !origin.closest('[inert],[aria-hidden="true"]')) origin.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    // Layout cleanup runs during React's mutation phase. Returning focus there
    // can be undone by React restoring the previously focused drawer control.
    // The next layout setup runs after that restoration, still before paint.
    if (!props.open) { restoreFocus(); return; }
    pendingReturn.current = null;
    const dialog = surface.current as unknown as HTMLElement | null;
    const background = props.backgroundRef?.current as unknown as HTMLElement | null;
    if (!dialog) return;
    const origin = (props.returnFocusRef?.current as unknown as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    const oldInert = background?.inert;
    const oldHidden = background?.getAttribute("aria-hidden");
    // RN Modal dialogs opened above this drawer retain their own focus owner.
    const anotherModal = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .some(node => node !== dialog && !dialog.contains(node) && !background?.contains(node) && node.getClientRects().length > 0);
    const focusFirst = () => (focusableWithin(dialog)[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();
    if (background) { background.inert = true; background.setAttribute("aria-hidden", "true"); }
    let redirecting = false;
    const onFocus = (event: FocusEvent) => {
      if (redirecting || anotherModal() || dialog.contains(event.target as Node)) return;
      redirecting = true; focusFirst(); redirecting = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (anotherModal()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); latest.current.onRequestClose(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusableWithin(dialog);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.focus({ preventScroll: true }); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus, true);
      dialog.inert = true;
      if (background) {
        background.inert = oldInert ?? false;
        if (oldHidden === null || oldHidden === undefined) background.removeAttribute("aria-hidden"); else background.setAttribute("aria-hidden", oldHidden);
      }
      pendingReturn.current = origin;
    };
  }, [props.open, props.scopeKey, props.backgroundRef, props.returnFocusRef, surface, restoreFocus]);
  // An actual unmount has no next layout setup; restore after its DOM removal.
  useEffect(() => () => restoreFocus(), [restoreFocus]);
}
