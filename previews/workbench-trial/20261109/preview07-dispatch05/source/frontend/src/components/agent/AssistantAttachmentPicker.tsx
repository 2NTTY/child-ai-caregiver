import { pickNativeFile } from "./native-chat-file";
import { pickNativeVoice } from "./native-voice-file";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { AppButton } from "../ui";

export type AssistantAttachmentPickerProps = {
  kind: "file" | "voice"; disabled: boolean; onPick(attachment: AssistantAttachment): void; onError(message: string): void;
  selectAttachment?: (kind: "file" | "voice") => Promise<AssistantAttachment | null>;
};
export function AssistantAttachmentPicker({ kind, disabled, onPick, onError, selectAttachment = kind === "voice" ? pickNativeVoice : pickNativeFile }: AssistantAttachmentPickerProps) {
  const generation = useRef(0), disabledRef = useRef(disabled); disabledRef.current = disabled;
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { generation.current++; }, []);
  async function pick() {
    if (!selectAttachment || disabled || busy) return;
    const started = ++generation.current; setBusy(true);
    try {
      const attachment = await selectAttachment(kind);
      if (generation.current !== started || disabledRef.current) { attachment?.dispose?.(); return; }
      if (attachment) onPick(attachment);
    } catch { if (generation.current === started) onError("未能選取本地附件，原有草稿已保留。"); }
    finally { if (generation.current === started) setBusy(false); }
  }
  return <View><AppButton label={kind === "voice" ? "選取已錄音訊" : "選擇本地文件"} disabled={disabled || busy || !selectAttachment} loading={busy} onPress={() => { void pick(); }} />
    {!selectAttachment ? <Text>原生選檔 adapter 尚未接通；沒有開啟裝置權限。</Text> : null}</View>;
}
