import { colors } from "../../theme";

export function CitationMarker({ number, label, onPress }: { number: number; label: string; onPress(): void }) {
  return <sup style={{ fontSize: "0.78em", lineHeight: 0, verticalAlign: "super" }}>
    <button type="button" aria-label={label} onClick={onPress} style={{ font: "inherit", color: colors.deepTeal,
      lineHeight: "normal", background: "transparent", border: 0, padding: 0, cursor: "pointer", borderRadius: 3 }}>【{number}】</button>
  </sup>;
}
