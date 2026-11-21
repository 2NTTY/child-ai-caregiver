import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import Play from "lucide-react-native/icons/play";
import Pause from "lucide-react-native/icons/pause";
import { colors } from "../../theme";
import { Text } from "react-native-paper";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { AppButton } from "../ui";

export function LocalAudioPreview({ uri, saved=false, seek, compact=false }: { uri: string; saved?:boolean; compact?:boolean; seek?:{seconds:number;request:number} }) {
  const player = useAudioPlayer({ uri }), status = useAudioPlayerStatus(player);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener("change", state => { if (state !== "active") player.pause(); });
    return () => { mounted.current = false; sub.remove(); };
  }, [player]);
  async function preparePlayback() {
    // Configure explicitly: Android silent/vibrate mode must not swallow an explicit media play action.
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, allowsBackgroundRecording: false, interruptionMode: "doNotMix" });
    return mounted.current && AppState.currentState === "active";
  }
  useEffect(()=>{
    if(!seek||!status.isLoaded)return;
    let active=true;
    void preparePlayback().then(async ready => { if (!ready || !active) return; await player.seekTo(seek.seconds); if (active && mounted.current && AppState.currentState === "active") player.play(); }).catch(()=>{if(active)setError('暫未能定位播放，可使用播放按鈕。');});
    return()=>{active=false;};
  },[player,seek,status.isLoaded]);
  async function toggle() {
    try {
      setError(null);
      if (status.playing) player.pause();
      else { if (!await preparePlayback()) return; if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0); if (mounted.current && AppState.currentState === "active") player.play(); }
    } catch { setError("暫時未能播放這段音訊，原檔保留。"); }
  }
  if (compact) return <View><Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "暫停播放" : "播放試聽"}
    disabled={!status.isLoaded} onPress={() => void toggle()} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
    {status.playing ? <Pause size={17} color={colors.ink} /> : <Play size={17} color={colors.ink} />}
    <Text>{Math.floor(status.currentTime)} / {Math.ceil(status.duration)} 秒</Text></Pressable>
    {error && <Text accessibilityRole="alert">{error}</Text>}</View>;
  return <View><AppButton label={status.playing ? "暫停播放" : saved ? "播放原錄音" : "播放試聽"} disabled={!status.isLoaded} onPress={() => { void toggle(); }} />
    <Text>{Math.floor(status.currentTime)} / {Math.ceil(status.duration)} 秒</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}</View>;
}
