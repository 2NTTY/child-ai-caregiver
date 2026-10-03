import { colors } from "../../theme";
import type { Ref } from "react";
import type { View } from "react-native";

export function CitationMarker({ number, label, onPress, ref }: { number: number; label: string; onPress(): void; ref?: Ref<View> }) {
  return <sup style={{ fontSize: "0.78em", lineHeight: 0, verticalAlign: "super" }}>
    <button ref={node => { const target = node as unknown as View | null; if (typeof ref === "function") ref(target); else if (ref) ref.current = target; }}
      type="button" aria-label={label} onClick={onPress} style={{ font: "inherit", color: colors.deepTeal,
      lineHeight: "normal", background: "transparent", border: 0, padding: 0, cursor: "pointer", borderRadius: 3 }}>【{number}】</button>
  </sup>;
}
