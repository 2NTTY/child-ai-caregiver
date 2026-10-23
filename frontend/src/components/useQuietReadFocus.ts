import { useLayoutEffect, useRef } from "react";
import { Platform, type View } from "react-native";

// Opt-in for a retained same-scope snapshot only. Like HistoryEntryCard, avoid a
// native disabled transition that blurs the current button; callers still guard activation.
export function useQuietReadFocus(disabled: boolean, preserveFocusWhenDisabled: boolean) {
  const host = useRef<View | null>(null);
  const preserved = useRef<{ node: HTMLElement; tabIndex: string | null } | null>(null);
  const preserveWebFocus = preserveFocusWhenDisabled && Platform.OS === "web";
  useLayoutEffect(() => {
    if (!preserveWebFocus && !preserved.current) return;
    const element = host.current as unknown as HTMLElement | null;
    const node = element?.matches?.('button,[role="button"]') ? element : element?.querySelector?.<HTMLElement>('button,[role="button"]');
    if (preserveWebFocus && disabled && node) {
      if (preserved.current?.node !== node) preserved.current = { node, tabIndex: node.getAttribute("tabindex") };
      // RN Web/Paper rebuild aria-disabled from their native disabled prop.
      node.setAttribute("aria-disabled", "true"); node.setAttribute("tabindex", "-1");
    } else if (preserved.current) {
      const previous = preserved.current; preserved.current = null;
      if (previous.node === node && !disabled) {
        node.removeAttribute("aria-disabled");
        if (previous.tabIndex === null) node.removeAttribute("tabindex");
        else node.setAttribute("tabindex", previous.tabIndex);
      }
    }
  });
  return { host, preserveWebFocus, nativeDisabled: disabled && !preserveWebFocus };
}
