import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";

// Announce transitions, never a historical snapshot merely mounted on screen.
export function StatusAnnouncement({ eventKey, message, urgent = false }: { eventKey: string; message: string; urgent?: boolean }) {
  const previous = useRef(eventKey);
  const [announcement, setAnnouncement] = useState({ message: "", urgent: false });
  useEffect(() => {
    if (previous.current === eventKey) return;
    previous.current = eventKey; setAnnouncement({ message, urgent });
  }, [eventKey, message, urgent]);
  return <Text testID="status-announcement" accessibilityRole={announcement.urgent ? "alert" : "text"} accessibilityLiveRegion={announcement.urgent ? "assertive" : "polite"}
    style={styles.hidden}>{announcement.message ? `狀態：${announcement.message}` : ""}</Text>;
}
const styles = StyleSheet.create({ hidden: { position: "absolute", width: 1, height: 1, overflow: "hidden" } });
