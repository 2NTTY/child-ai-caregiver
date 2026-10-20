import { fileFromBlob } from "./file-attachment";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { AppButton } from "../ui";
import type { AssistantAttachmentPickerProps } from "./AssistantAttachmentPicker";
import { VOICE_LIMITS, normalizeVoiceMimeType } from "../../../../src/shared/voice";
import { voiceFromBlob } from "./voice-attachment";

// Selection stays local; the shared owner handles explicit submission.
export function AssistantAttachmentPicker({ kind, disabled, onPick, onError }: AssistantAttachmentPickerProps) {
  const input = useRef<HTMLInputElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <View><input ref={input} type="file" accept={kind === "voice" ? "audio/*" : undefined} hidden tabIndex={-1}
    aria-label={kind === "voice" ? "選取已錄音訊原檔" : "選擇本地文件原檔"} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (!file || disabled || !mounted.current) return;
      if (file.size < 1 || file.size > (kind === "voice" ? VOICE_LIMITS.bytes : 20 * 1024 * 1024) || file.name.length > 200 ||
        (kind === "voice" && !normalizeVoiceMimeType(file.type))) {
        onError(kind === "voice" ? "請選擇受支援音訊，最多兩分鐘／5 MiB，檔名不超過 200 字。" : "附件最多 20 MiB，檔名不超過 200 字；原有草稿保留。"); return;
      }
      if (kind === "voice") {
        try { onPick(voiceFromBlob(file, file.name, blob => URL.createObjectURL(blob), uri => URL.revokeObjectURL(uri))); }
        catch { onError("未能讀取所選音訊；原有草稿保留。"); }
        return;
      }
      try { onPick(fileFromBlob(file, file.name, blob => URL.createObjectURL(blob), uri => URL.revokeObjectURL(uri))); }
      catch { onError("未能讀取所選檔案；原有草稿保留。"); }
    }} />
    <AppButton label={kind === "voice" ? "選取已錄音訊" : "選擇本地文件"} disabled={disabled} onPress={() => input.current?.click()} />
  </View>;
}
