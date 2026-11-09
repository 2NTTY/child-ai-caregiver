import { useEffect, useRef, useState } from "react";
import { pickBackgroundImage } from "../../platform/background-picker";
import type { BackgroundImagePickerProps, PickedBackgroundImage } from "../../background-view-model";
import { AppButton } from "../ui";

export function BackgroundImagePicker({ onSelected, onError, onReadingChange, pickImage = pickBackgroundImage, disabled = false }: BackgroundImagePickerProps) {
  const [reading, setReading] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function choose() {
    if (!pickImage || disabled || reading) return;
    setReading(true); onReadingChange(true);
    let image: PickedBackgroundImage | null = null;
    try {
      image = await pickImage();
      if (!alive.current) { image?.dispose(); return; }
      if (image) { await onSelected(image); image = null; }
    } catch {
      image?.dispose();
      if (alive.current) onError("暫時未能選取背景圖片，原有背景仍然保留。");
    } finally {
      if (alive.current) { setReading(false); onReadingChange(false); }
    }
  }
  return <>
    <AppButton label="選擇背景圖片" variant="secondary" disabled={disabled || !pickImage || reading} loading={reading} onPress={() => { void choose(); }} />
  </>;
}
