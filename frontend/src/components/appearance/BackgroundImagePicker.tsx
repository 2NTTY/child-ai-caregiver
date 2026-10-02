import { useEffect, useRef, useState } from "react";
import { Text } from "react-native-paper";
import type { BackgroundImagePickerProps, PickedBackgroundImage } from "../../background-view-model";
import { AppButton } from "../ui";

export function BackgroundImagePicker({ onSelected, onError, onReadingChange, pickImage }: BackgroundImagePickerProps) {
  const [reading, setReading] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function choose() {
    if (!pickImage || reading) return;
    setReading(true); onReadingChange(true);
    let image: PickedBackgroundImage | null = null;
    try {
      image = await pickImage();
      if (!alive.current) { image?.dispose(); return; }
      if (image) { onSelected(image); image = null; }
    } catch {
      image?.dispose();
      if (alive.current) onError("暫時未能選取背景圖片，原有背景仍然保留。");
    } finally {
      if (alive.current) { setReading(false); onReadingChange(false); }
    }
  }
  return <>
    <AppButton label="選擇背景圖片" variant="secondary" disabled={!pickImage || reading} loading={reading} onPress={() => { void choose(); }} />
    {!pickImage ? <Text>此手機預覽尚未接通系統選圖；背景設定入口已預留。</Text> : null}
  </>;
}
