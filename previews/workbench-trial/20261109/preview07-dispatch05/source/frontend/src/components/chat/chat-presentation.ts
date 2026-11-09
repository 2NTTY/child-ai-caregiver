import { Platform } from "react-native";
import { colors } from "../../theme";

// Shared chat reading and control proportions; brand tokens stay owned by the theme.
export const chatFont = Platform.select({
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif",
  default: undefined,
});
export const chatColors = {
  canvas: colors.canvas, surface: colors.controlSurface, ink: colors.ink, secondary: colors.muted,
  userBubble: colors.quietSurface, line: colors.softLine, outline: colors.controlOutline, hover: colors.quietSurface,
  send: colors.accent, onSend: colors.onAccent, focus: colors.ink,
} as const;
export const chatType = {
  body: { fontSize: 16, lineHeight: 27 },
  section: { fontSize: 16, lineHeight: 26, fontWeight: "600" as const },
  tool: { fontSize: 13, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 18 },
  input: { fontSize: 16, lineHeight: 24 },
} as const;
export const chatLayout = {
  maxWidth: 820, wideInset: 24, compactInset: 16, turnGap: 32, compactTurnGap: 28,
  paragraphGap: 12, composerRadius: 18, composerOverlap: 32, controlSize: 40, compactControlSize: 48,
  inputMinHeight: 48, inputMaxHeight: 168,
} as const;
