import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { AppButton } from "../ui";
import type { PhotoFilePickerProps } from "./PhotoFilePicker";
import { photoStyles } from "./photo-styles";
import { WebCameraCapture } from "./WebCameraCapture.web";
import { readWebPhotoOriginal } from "./web-photo-file";

export function PhotoFilePicker({ disabled, onPick, onError, capturePreferred = false, renderTrigger }: PhotoFilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [reading, setReading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (disabled) setCameraOpen(false); }, [disabled]);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (file) await readOriginal(file);
  }
  async function readOriginal(file: File) {
    if (disabledRef.current || reading) return;
    const started = ++generation.current; setReading(true);
    try {
      const original = await readWebPhotoOriginal(file);
      if (generation.current !== started || disabledRef.current) { original.dispose?.(); return; }
      onPick(original);
    } catch (cause) { if (generation.current === started && !disabledRef.current) onError(cause instanceof Error && /HEIC|4 MiB|JPEG/u.test(cause.message) ? cause.message : "未能讀取原照片或核對完整性。請使用安全連線並明確重選；現有輸入保留。"); }
    finally { if (generation.current === started) setReading(false); }
  }
  const ordinaryInput = <input ref={input} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" aria-label="選擇照片原檔" tabIndex={-1} hidden disabled={disabled || reading} onChange={choose} />;
  const captureInput = <input ref={cameraInput} type="file" accept="image/*" capture="environment" aria-label="拍照原檔" tabIndex={-1} hidden disabled={disabled || reading} onChange={choose} />;
  if (renderTrigger) return <>{capturePreferred ? captureInput : ordinaryInput}
    {renderTrigger({ onPress: () => capturePreferred ? setCameraOpen(true) : input.current?.click(), disabled: disabled || reading, reading })}
    {cameraOpen && !disabled ? <WebCameraCapture onDismiss={() => setCameraOpen(false)} onChooseFile={() => { setCameraOpen(false); cameraInput.current?.click(); }}
      onCapture={file => { setCameraOpen(false); void readOriginal(file); }} /> : null}</>;
  return <View style={photoStyles.stack}>{ordinaryInput}
    {capturePreferred ? <>{captureInput}
      <AppButton label={reading ? "正在讀取原照片" : "拍照或選圖"} variant="secondary" disabled={disabled || reading} loading={reading} onPress={() => cameraInput.current?.click()} />
      <Text style={photoStyles.meta}>手機瀏覽器可由系統提供拍照；是否可用由瀏覽器決定。電腦通常會開啟選檔，也可改用下方選擇原照片。</Text></> : null}
    <AppButton label={reading ? "正在讀取原照片" : "選擇原照片"} variant="secondary" disabled={disabled || reading} loading={reading} onPress={() => input.current?.click()} />
    <Text style={photoStyles.meta}>HEIC 會先嘗試在本機轉為 JPEG。照片尚未上傳；關閉或重新載入會清除本次輸入。</Text>
  </View>;
}
