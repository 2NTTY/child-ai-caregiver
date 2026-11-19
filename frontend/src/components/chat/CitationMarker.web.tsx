import { colors } from "../../theme";
import { useState, type Ref } from "react";
import type { View } from "react-native";

export function CitationMarker({ number, label, onPress, ref, markerText, live }: { number: number; label: string; onPress(): void; ref?: Ref<View>; markerText?: string; live?: boolean }) {
  const [focused, setFocused] = useState(false);
  const displayText = markerText ?? (live ? `【${number}·即時】` : `【${number}】`);
  return <sup style={{ fontSize: "0.78em", lineHeight: 0, verticalAlign: "super" }}>
    <button ref={node => { const target = node as unknown as View | null; if (typeof ref === "function") ref(target); else if (ref) ref.current = target; }}
      type="button" aria-label={label} onClick={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{ font: "inherit", color: live ? colors.warningInk : colors.deepTeal, outline: focused ? `1px solid ${live ? colors.statusWarmLine : colors.deepTeal}` : undefined, outlineOffset: 2,
      lineHeight: "normal", textDecoration: "underline", background: live ? colors.paleAmber : "transparent", border: live ? `1px solid ${colors.statusWarmLine}` : 0, padding: live ? "0 3px" : 0, cursor: "pointer", borderRadius: 3 }}>{displayText}</button>
  </sup>;
}
