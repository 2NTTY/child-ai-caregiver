import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { photoLimits } from "../../photo-view-model";
import { AppButton } from "../ui";
import type { PhotoFilePickerProps } from "./PhotoFilePicker";
import { photoStyles } from "./photo-styles";
import { WebCameraCapture } from "./WebCameraCapture.web";

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
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > photoLimits.bytes || file.name.length > 200) {
      onError("只接受 JPEG／PNG 原照片，每張最多 4 MiB，檔名最多 200 字。現有照片與草稿保留。"); return;
    }
    const started = ++generation.current; setReading(true);
    try {
      if (!globalThis.crypto?.subtle) throw new Error("File integrity unavailable");
      const buffer = await file.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      if (generation.current !== started || disabledRef.current) return;
      const uri = URL.createObjectURL(file);
      onPick({ fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png", bytes: file.size,
        sha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join(""), imageSource: { uri },
        dispose: () => URL.revokeObjectURL(uri),
        readBase64: () => new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error("File reading failed"));
          reader.onload = () => { const value = reader.result; const comma = typeof value === "string" ? value.indexOf(",") : -1;
            if (typeof value !== "string" || comma < 0) reject(new Error("File reading failed")); else resolve(value.slice(comma + 1)); };
          reader.readAsDataURL(file);
        }),
      });
    } catch { if (generation.current === started) onError("未能讀取原照片或核對完整性。請使用安全連線並明確重選；現有輸入保留。"); }
    finally { if (generation.current === started) setReading(false); }
  }
  const ordinaryInput = <input ref={input} type="file" accept="image/jpeg,image/png" aria-label="選擇照片原檔" tabIndex={-1} hidden disabled={disabled || reading} onChange={choose} />;
  const captureInput = <input ref={cameraInput} type="file" accept="image/jpeg,image/png" capture="environment" aria-label="拍照原檔" tabIndex={-1} hidden disabled={disabled || reading} onChange={choose} />;
  if (renderTrigger) return <>{capturePreferred ? captureInput : ordinaryInput}
    {renderTrigger({ onPress: () => capturePreferred ? setCameraOpen(true) : input.current?.click(), disabled: disabled || reading, reading })}
    {cameraOpen && !disabled ? <WebCameraCapture onDismiss={() => setCameraOpen(false)} onChooseFile={() => { setCameraOpen(false); cameraInput.current?.click(); }}
      onCapture={file => { setCameraOpen(false); void readOriginal(file); }} /> : null}</>;
  return <View style={photoStyles.stack}>{ordinaryInput}
    {capturePreferred ? <>{captureInput}
      <AppButton label={reading ? "正在讀取原照片" : "拍照或選圖"} variant="secondary" disabled={disabled || reading} loading={reading} onPress={() => cameraInput.current?.click()} />
      <Text style={photoStyles.meta}>手機瀏覽器可由系統提供拍照；是否可用由瀏覽器決定。電腦通常會開啟選檔，也可改用下方選擇原照片。</Text></> : null}
    <AppButton label={reading ? "正在讀取原照片" : "選擇原照片"} variant="secondary" disabled={disabled || reading} loading={reading} onPress={() => input.current?.click()} />
    <Text style={photoStyles.meta}>原檔尚未上傳；關閉或重新載入會清除本次輸入。</Text>
  </View>;
}
