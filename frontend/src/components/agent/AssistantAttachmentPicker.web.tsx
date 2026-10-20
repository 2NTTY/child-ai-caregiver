import { useEffect, useRef } from "react";
import { View } from "react-native";
import { localAttachmentId } from "../../assistant-draft";
import { AppButton } from "../ui";
import type { AssistantAttachmentPickerProps } from "./AssistantAttachmentPicker";
import { VOICE_LIMITS, normalizeVoiceMimeType } from "../../../../src/shared/voice";
import { voiceFromBlob } from "./voice-attachment";

// A local preview adapter only: no parser, transcription, upload or server wire format.
export function AssistantAttachmentPicker({ kind, disabled, onPick, onError }: AssistantAttachmentPickerProps) {
  const input = useRef<HTMLInputElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <View><input ref={input} type="file" accept={kind === "voice" ? "audio/*" : ".pdf,.txt,.doc,.docx,.csv"} hidden tabIndex={-1}
    aria-label={kind === "voice" ? "選取已錄音訊原檔" : "選擇本地文件原檔"} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (!file || disabled || !mounted.current) return;
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (file.size < 1 || file.size > (kind === "voice" ? VOICE_LIMITS.bytes : 20 * 1024 * 1024) || file.name.length > 200 ||
        (kind === "voice" ? !normalizeVoiceMimeType(file.type) : !["pdf", "txt", "doc", "docx", "csv"].includes(extension ?? ""))) {
        onError(kind === "voice" ? "請選擇受支援音訊，最多兩分鐘／5 MiB，檔名不超過 200 字。" : "請選擇所列種類、最多 20 MiB 及檔名不超過 200 字的本地附件；原有草稿保留。"); return;
      }
      if (kind === "voice") {
        try { onPick(voiceFromBlob(file, file.name, blob => URL.createObjectURL(blob), uri => URL.revokeObjectURL(uri))); }
        catch { onError("未能讀取所選音訊；原有草稿保留。"); }
        return;
      }
      const uri = URL.createObjectURL(file);
      onPick({ id: localAttachmentId(), kind, fileName: file.name, mimeType: file.type || "application/octet-stream", bytes: file.size,
        localUri: uri, dispose: () => URL.revokeObjectURL(uri) });
    }} />
    <AppButton label={kind === "voice" ? "選取已錄音訊" : "選擇本地文件"} disabled={disabled} onPress={() => input.current?.click()} />
  </View>;
}
