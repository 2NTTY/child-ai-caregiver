import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { Text } from "react-native-paper";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { AppButton } from "../ui";

export function LocalAudioPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri }), status = useAudioPlayerStatus(player);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if (state !== "active") player.pause(); });
    return () => { sub.remove(); };
  }, [player]);
  async function toggle() {
    try {
      setError(null);
      if (status.playing) player.pause();
      else { if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0); player.play(); }
    } catch { setError("暫時未能播放這段音訊，原檔保留。"); }
  }
  return <View><AppButton label={status.playing ? "暫停試聽" : "播放試聽"} disabled={!status.isLoaded} onPress={() => { void toggle(); }} />
    <Text>{Math.floor(status.currentTime)} / {Math.ceil(status.duration)} 秒</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>;
}
