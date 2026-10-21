import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { BackgroundImagePickerProps } from "../../background-view-model";
import { backgroundImageMime } from "../../platform/background-image";
import { AppButton } from "../ui";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 4 * 1024 * 1024;

export function BackgroundImagePicker({ onSelected, onError, onReadingChange, disabled = false }: BackgroundImagePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [reading, setReading] = useState(false);
  useEffect(() => () => { generation.current += 1; }, []);
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const request = ++generation.current;
    if (!acceptedTypes.has(file.type) || !file.size || file.size > maxBytes) {
      setReading(false); onReadingChange(false);
      onError("請選擇 4 MiB 以內的 JPG、PNG 或 WebP 圖片。原有背景仍然保留。"); return;
    }
    setReading(true); onReadingChange(true);
    let uri: string | null = null;
    try {
      if (backgroundImageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer())) !== file.type) throw new Error("Invalid image type");
      uri = URL.createObjectURL(file);
      const originalUri = uri;
      await new Promise<void>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => { image.onload = null; image.onerror = null; image.naturalWidth && image.naturalHeight && image.naturalWidth * image.naturalHeight <= 16_000_000 ? resolve() : reject(new Error("Empty image")); };
        image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error("Invalid image")); };
        image.src = originalUri;
      });
      if (request !== generation.current) return;
      let disposed = false;
      await onSelected({ uri: originalUri, filename: "自選圖片", blob: file, dispose: () => { if (!disposed) { disposed = true; URL.revokeObjectURL(originalUri); } } });
      uri = null;
    } catch {
      if (request === generation.current) onError("未能讀取這張背景圖片，原有背景仍然保留。請選擇另一張圖片。");
    } finally {
      if (uri) URL.revokeObjectURL(uri);
      if (request === generation.current) { setReading(false); onReadingChange(false); }
    }
  }
  return <>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-hidden tabIndex={-1} style={{ display: "none" }} onChange={event => { void readFile(event); }} />
    <AppButton label="選擇背景圖片" variant="secondary" loading={reading} disabled={disabled || reading} onPress={() => input.current?.click()} />
  </>;
}
