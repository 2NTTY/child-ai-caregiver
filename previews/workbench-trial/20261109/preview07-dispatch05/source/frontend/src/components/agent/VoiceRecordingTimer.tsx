import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors } from "../../theme";

export type VoiceCaptureHandle = { start(): void };

export function VoiceRecordingTimer() {
  const started = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setSeconds(Math.floor((Date.now() - started.current) / 1000)); timer = setTimeout(tick, 1000); };
    timer = setTimeout(tick, 1000);
    return () => clearTimeout(timer);
  }, []);
  const label = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return <Text testID="voice-recording-time" accessibilityLabel={`錄音時間 ${label}`} style={styles.timer}>{label}</Text>;
}
const styles = StyleSheet.create({ timer: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontVariant: ["tabular-nums"] } });
