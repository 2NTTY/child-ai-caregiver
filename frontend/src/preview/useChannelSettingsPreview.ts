import { useState } from "react";
import { usePushSettingsPreview, type ChannelPreviewIdentity } from "./usePushSettingsPreview";
import { useTelegramSettingsPreview } from "./useTelegramSettingsPreview";

export function useChannelSettingsPreview(online: boolean) {
  const [identity, setIdentity] = useState<ChannelPreviewIdentity>({ id: "preview-mum", name: "媽媽" });
  const push = usePushSettingsPreview(online, identity);
  const telegram = useTelegramSettingsPreview(online, identity);
  return { identity, push, telegram, switchAccount() {
    // Switching this synthetic account cancels pending timers and clears both channel scopes.
    push.resetForAccount(); telegram.resetForAccount();
    setIdentity(current => current.id === "preview-mum" ? { id: "preview-dad", name: "爸爸" } : { id: "preview-mum", name: "媽媽" });
  } };
}
export type ChannelSettingsPreviewController = ReturnType<typeof useChannelSettingsPreview>;
