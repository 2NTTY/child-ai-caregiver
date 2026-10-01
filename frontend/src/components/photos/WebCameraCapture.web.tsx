import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import { colors, mobileType, radius, spacing, chineseFont } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";

function stopTracks(stream: MediaStream | null) { stream?.getTracks().forEach(track => track.stop()); }

// Mounted only after an explicit capture press; no microphone or network transport.
export function WebCameraCapture({ onCapture, onChooseFile, onDismiss }: {
  onCapture: (file: File) => void; onChooseFile: () => void; onDismiss: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const active = useRef(true), request = useRef(0), capturing = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Modal/Portal may attach its DOM after effects have run.
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    if (!element && video.current) video.current.srcObject = null;
    video.current = element;
    if (element && stream && element.srcObject !== stream) element.srcObject = stream;
  }, [stream]);
  function releaseCamera() { stopTracks(currentStream.current); currentStream.current = null; if (video.current) video.current.srcObject = null; }
  function close(next = onDismiss) { active.current = false; request.current++; releaseCamera(); next(); }
  async function openCamera() {
    const started = ++request.current;
    releaseCamera(); setStream(null); setReady(false); setError(null);
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("這個瀏覽器未能開啟頁內相機，可改用系統拍照／選圖。"); return;
    }
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!active.current || request.current !== started) { stopTracks(next); return; }
      currentStream.current = next; setStream(next);
    } catch (cause) {
      if (!active.current || request.current !== started) return;
      const name = cause instanceof DOMException ? cause.name : "";
      setError(name === "NotAllowedError" ? "未獲相機權限。可在瀏覽器允許相機，或改用系統拍照／選圖。" :
        name === "NotFoundError" ? "這部裝置未找到相機，可改用系統拍照／選圖。" : "相機暫時無法使用，可重試或改用系統拍照／選圖。");
    }
  }
  useEffect(() => {
    active.current = true; void openCamera();
    return () => { active.current = false; request.current++; releaseCamera(); };
  }, []);
  useEffect(() => {
    if (!stream) return;
    const ended = () => {
      if (!active.current || currentStream.current !== stream) return;
      releaseCamera(); setStream(null); setReady(false); setError("相機已停止。可重新開啟，或改用系統拍照／選圖。");
    };
    const tracks = stream.getVideoTracks();
    tracks.forEach(track => track.addEventListener("ended", ended));
    return () => { tracks.forEach(track => track.removeEventListener("ended", ended)); };
  }, [stream]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) close(); };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [onDismiss]);
  async function capture() {
    const element = video.current;
    if (!active.current || !ready || capturing.current || !element?.videoWidth || !element.videoHeight) return;
    capturing.current = true; setBusy(true); setError(null);
    try {
      const canvas = document.createElement("canvas"); canvas.width = element.videoWidth; canvas.height = element.videoHeight;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image capture unavailable");
      context.drawImage(element, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Image capture failed")), "image/jpeg"));
      if (!active.current) return;
      const extension = blob.type === "image/jpeg" ? "jpg" : "png";
      const file = new File([blob], `拍照-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: blob.type });
      close(() => onCapture(file));
    } catch { if (active.current) setError("未能拍攝照片，請再試或改用系統拍照／選圖。"); }
    finally { capturing.current = false; if (active.current) setBusy(false); }
  }
  return <Portal><AppDialog visible onDismiss={() => close()} testID="web-camera-dialog">
    <AppDialog.Title>拍照</AppDialog.Title>
    <AppDialog.Content><ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {stream ? <video ref={attachVideo} autoPlay muted playsInline aria-label="相機即時預覽" style={videoStyle}
        onCanPlay={() => setReady(!!video.current?.videoWidth && stream.getVideoTracks().every(track => track.readyState === "live"))} /> :
        <View style={styles.placeholder}><AppIcon name="camera-outline" size={32} /><Text style={styles.meta}>{error ? "相機尚未開啟" : "正在等待相機權限…"}</Text></View>}
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <Text style={styles.meta}>拍攝後先在對話頁檢視；不會自動上傳或送出，也不會錄音。</Text>
    </ScrollView></AppDialog.Content>
    <AppDialog.Actions>
      {error && !stream ? <AppButton label="重新開啟相機" variant="secondary" onPress={() => { void openCamera(); }} /> :
        <AppButton label="拍下照片" disabled={!ready} loading={busy} onPress={() => { void capture(); }} />}
      <AppButton label="系統拍照／選圖" variant="secondary" disabled={busy} onPress={() => close(onChooseFile)} />
      <AppButton label="取消拍照" variant="quiet" onPress={() => close()} />
    </AppDialog.Actions>
  </AppDialog></Portal>;
}

const videoStyle: CSSProperties = { display: "block", width: "100%", aspectRatio: "4 / 3", maxHeight: 260, objectFit: "contain", backgroundColor: colors.canvas, borderRadius: radius.small };
const styles = StyleSheet.create({
  scroll: { flexGrow: 0 }, content: { gap: spacing.md },
  placeholder: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: colors.canvas, borderRadius: radius.small },
  meta: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body }, error: { fontFamily: chineseFont, color: colors.warningInk, ...mobileType.body },
});
