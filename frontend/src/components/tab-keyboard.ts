/** Shared eligibility for the two manual-activation tab lists, not a global shortcut owner. */
interface KeyFields {
  key?: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}
export interface TabKeyboardEvent extends KeyFields {
  nativeEvent?: unknown;
  preventDefault(): void;
}

export function unmodifiedTabKey(event: TabKeyboardEvent) {
  const native = event.nativeEvent as KeyFields | undefined;
  if (event.defaultPrevented || native?.defaultPrevented || event.altKey || native?.altKey
    || event.ctrlKey || native?.ctrlKey || event.metaKey || native?.metaKey
    || event.shiftKey || native?.shiftKey || event.isComposing || native?.isComposing) return null;
  return { key: native?.key ?? event.key, repeat: native?.repeat ?? event.repeat ?? false };
}

/** RNW PressResponder also invokes onPress on Enter keyup; keydown owns tab activation. */
export function isKeyboardTabPress(event?: { key?: string; nativeEvent?: unknown }) {
  const key = (event?.nativeEvent as KeyFields | undefined)?.key ?? event?.key;
  return key === "Enter" || key === " " || key === "Spacebar";
}
