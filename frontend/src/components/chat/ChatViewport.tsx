import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

export type ChatViewportLayout = "bounded" | "reflow";
export function chatViewportLayout(platform: string, height: number): ChatViewportLayout {
  return platform === "web" && height < 600 ? "reflow" : "bounded";
}

// Keep both containers and their children mounted across zoom/height changes.
// In a short viewport the workspace scrolls, rather than shrinking reading to
// nothing or hiding input, attachments, recovery messages or activity controls.
export function ChatViewport({ layout, children }: { layout: ChatViewportLayout; children: ReactNode }) {
  return <View testID="chat-page-layout" role="region" accessibilityLabel="對話工作區"
    tabIndex={layout === "reflow" ? 0 : undefined} style={layout === "reflow" ? styles.reflow : styles.bounded}>
    {children}
  </View>;
}
export function ChatTimelineFrame({ layout, children }: { layout: ChatViewportLayout; children: ReactNode }) {
  return <View testID="chat-timeline-frame" style={layout === "reflow" ? styles.readingWindow : styles.timeline}>{children}</View>;
}
const styles = StyleSheet.create({
  bounded: { flex: 1, minHeight: 0, minWidth: 0, position: "relative" },
  reflow: { flex: 1, minHeight: 0, minWidth: 0, position: "relative", overflow: "scroll" },
  timeline: { flex: 1, minHeight: 0, minWidth: 0 },
  readingWindow: { height: 260, flexShrink: 0, minWidth: 0 },
});
