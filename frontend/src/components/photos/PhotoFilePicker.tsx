import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { PhotoOriginal } from "../../photo-view-model";
import { AppButton } from "../ui";
import { photoStyles } from "./photo-styles";

export type PhotoFilePickerProps = { disabled: boolean; onPick: (original: PhotoOriginal) => void; onError: (message: string) => void; selectOriginal?: () => Promise<PhotoOriginal | null>; capturePreferred?: boolean; captureOriginal?: () => Promise<PhotoOriginal | null> };
export function PhotoFilePicker({ disabled, onPick, onError, selectOriginal, capturePreferred = false, captureOriginal }: PhotoFilePickerProps) {
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
    } catch { if (generation.current === started) onError("未能選擇原照片，原檔及草稿保留。請核對相簿權限後再試。"); }
    finally { if (generation.current === started) setReading(false); }
  }
  return <View style={photoStyles.stack}>{capturePreferred ? <><AppButton label="拍照" variant="secondary" disabled={disabled || reading || !captureOriginal} loading={reading} onPress={() => { void choose(captureOriginal); }} />
    {!captureOriginal ? <Text style={photoStyles.meta}>原生相機尚未接線；沒有開啟相機或裝置權限。</Text> : null}</> : null}
    <AppButton label="選擇原照片" variant="secondary" disabled={disabled || reading || !selectOriginal} loading={reading} onPress={() => { void choose(selectOriginal); }} />
    {!selectOriginal ? <Text style={photoStyles.meta}>原生相簿／相機選圖待 P3 接線。可用下方情境工具的品牌示例比較介面，沒有開啟裝置權限。</Text> : null}</View>;
}
