import { Platform } from "react-native";

// Local chat presentation adapted from official Codex desktop references, not vendor CSS.
export const chatFont = Platform.select({
  web: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif",
  default: undefined,
});
export const chatColors = {
  canvas: "#FFFFFF", ink: "#202123", secondary: "#6B6B6B", userBubble: "#F3F3F3",
  line: "#E5E5E5", hover: "#F4F4F4", send: "#212121", focus: "#8A8A8A",
} as const;
export const chatType = {
  body: { fontSize: 15, lineHeight: 24 },
  section: { fontSize: 15, lineHeight: 24, fontWeight: "600" as const },
  tool: { fontSize: 13, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 18 },
  input: { fontSize: 16, lineHeight: 24 },
} as const;
export const chatLayout = {
  maxWidth: 800, wideInset: 24, compactInset: 16, turnGap: 24, compactTurnGap: 20,
  paragraphGap: 12, composerRadius: 20, controlSize: 40, compactControlSize: 48,
  inputMinHeight: 48, inputMaxHeight: 168,
} as const;
