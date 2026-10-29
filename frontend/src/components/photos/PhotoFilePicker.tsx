import { selectNativePhoto, captureNativePhoto } from "./native-photo-picker";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { PhotoOriginal } from "../../photo-view-model";
import { AppButton } from "../ui";
import { photoStyles } from "./photo-styles";

export type PhotoPickerTrigger = { onPress: () => void; disabled: boolean; reading: boolean; unavailableReason?: string };
export type PhotoFilePickerProps = {
  disabled: boolean; onPick: (original: PhotoOriginal) => void; onError: (message: string) => void;
  selectOriginal?: () => Promise<PhotoOriginal | null>; capturePreferred?: boolean; captureOriginal?: () => Promise<PhotoOriginal | null>;
  renderTrigger?: (trigger: PhotoPickerTrigger) => ReactNode;
};
export function PhotoFilePicker({ disabled, onPick, onError, selectOriginal = selectNativePhoto, capturePreferred = false, captureOriginal = captureNativePhoto, renderTrigger }: PhotoFilePickerProps) {
  const [reading, setReading] = useState(false);
  const generation = useRef(0), disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => () => { generation.current++; }, []);
  async function choose(pick: PhotoFilePickerProps["selectOriginal"]) {
    if (!pick || disabled || reading) return;
    const started = ++generation.current; setReading(true);
    try {
      const original = await pick();
      if (generation.current !== started || disabledRef.current) { original?.dispose?.(); return; }
      if (original) onPick(original);
    } catch { if (generation.current === started) onError("未能取得照片。請核對相機權限，並選擇 4 MiB 以內的 JPEG／PNG；現有草稿保留。"); }
    finally { if (generation.current === started) setReading(false); }
  }
  if (renderTrigger) {
    const pick = capturePreferred ? captureOriginal : selectOriginal;
    return <>{renderTrigger({ onPress: () => { void choose(pick); }, disabled: disabled || reading || !pick, reading,
      unavailableReason: !pick ? (capturePreferred ? "原生相機尚未接線，沒有開啟裝置權限。" : "原生相簿尚未接線，沒有開啟裝置權限。") : undefined })}</>;
  }
  return <View style={photoStyles.stack}>{capturePreferred ? <><AppButton label="拍照" variant="secondary" disabled={disabled || reading || !captureOriginal} loading={reading} onPress={() => { void choose(captureOriginal); }} />
    {!captureOriginal ? <Text style={photoStyles.body}>原生相機尚未接線；沒有開啟相機或裝置權限。</Text> : null}</> : null}
    <AppButton label="選擇原照片" variant="secondary" disabled={disabled || reading || !selectOriginal} loading={reading} onPress={() => { void choose(selectOriginal); }} />
    {!selectOriginal ? <Text style={photoStyles.body}>原生相簿／相機選圖待 P3 接線。可用下方情境工具的品牌示例比較介面，沒有開啟裝置權限。</Text> : null}</View>;
}
