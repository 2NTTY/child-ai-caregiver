import { useEffect, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Text } from "react-native-paper";
import { z } from "zod";
import { AppDialog } from "../components/AppDialog";
import { AppButton } from "../components/ui";
import { ChatMessage } from "../components/chat/ChatMessage";
import { useProduction } from "./ProductionProvider";
import { useChatForeground } from "./useChatExposure";

const targetMessage = z.object({ message: z.object({ id: z.uuid(), childId: z.uuid(), role: z.literal("model"), text: z.string(), proactive: z.literal(true).optional() }) });
/** A bounded original-message read also reaches messages older than the first history page. */
export function NotificationChatTarget() {
  const { messageId, childId } = useLocalSearchParams<{ messageId?: string; childId?: string }>();
  const { owner, identityKey, scopeKey, selectedChildId, userId, sharedChild, online } = useProduction();
  const pathname = usePathname(), router = useRouter(), foreground = useChatForeground();
  const [result, setResult] = useState<{ id: string; text: string; proactive?: true } | null>(null), [failed, setFailed] = useState(false), [exposed, setExposed] = useState(false);
  const requested = pathname === "/chat" && !!messageId;
  useEffect(() => {
    setResult(null); setFailed(false); setExposed(false);
    if (!requested || !identityKey || !scopeKey || !userId || !online || sharedChild.target || childId !== selectedChildId) return;
    const abort = new AbortController(), generation = owner.getSnapshot().sessionGeneration;
    const current = () => !abort.signal.aborted && owner.getSnapshot().identityKey === identityKey && owner.getSnapshot().sessionGeneration === generation && owner.getSnapshot().scopeKey === scopeKey;
    const base = owner.apiBaseUrl.replace(/\/$/u, ""), api = base.endsWith("/api") ? base : base + "/api";
    void owner.fetcher(api + "/children/" + encodeURIComponent(childId) + "/chat/messages/" + encodeURIComponent(messageId!), {
      method: "GET", cache: "no-store", signal: abort.signal, headers: { Accept: "application/json", "x-expected-user-id": userId },
    }).then(async response => {
      if (!response.ok) throw new Error("notification_message_unavailable");
      const value = targetMessage.parse(await response.json()).message;
      if (value.id !== messageId || value.childId !== childId) throw new Error("notification_message_mismatch");
      if (current()) setResult(value);
    }).catch(() => { if (current()) setFailed(true); });
    return () => abort.abort();
  }, [owner, identityKey, scopeKey, userId, selectedChildId, sharedChild.target, online, requested, messageId, childId]);
  useEffect(() => {
    if (!requested || !foreground || !exposed || !result?.proactive || !identityKey || !scopeKey || !userId || !online || childId !== selectedChildId || sharedChild.target) return;
    const abort = new AbortController(), generation = owner.getSnapshot().sessionGeneration, base = owner.apiBaseUrl.replace(/\/$/u, ""), api = base.endsWith("/api") ? base : base + "/api";
    const timer = setTimeout(() => {
      const snapshot = owner.getSnapshot();
      if (snapshot.identityKey !== identityKey || snapshot.sessionGeneration !== generation || snapshot.scopeKey !== scopeKey) return;
      void owner.fetcher(api + "/children/" + encodeURIComponent(childId) + "/chat/messages/" + encodeURIComponent(result.id) + "/seen", {
      method: "POST", cache: "no-store", signal: abort.signal, headers: { Accept: "application/json", "Content-Type": "application/json", "x-expected-user-id": userId }, body: "{}",
    }).catch(() => {}); }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [owner, requested, foreground, exposed, result, identityKey, scopeKey, userId, online, childId, selectedChildId, sharedChild.target]);
  const unavailable = failed || !online || !!sharedChild.target || childId !== selectedChildId;
  const close = () => router.setParams({ messageId: undefined, childId: undefined });
  return <AppDialog visible={requested} onDismiss={close} accessibilityLabel="通知的原聊天訊息">
    <AppDialog.Title>通知的原聊天訊息</AppDialog.Title>
    <AppDialog.ScrollArea><ScrollView><AppDialog.Content>{unavailable ? <Text accessibilityRole="alert">原聊天訊息目前不可用，或你已沒有查看權限。請重新讀取聊天。</Text>
      : result ? <View onLayout={() => setExposed(true)}><ChatMessage message={{ id: result.id, role: "assistant", text: result.text }} /></View>
        : <Text accessibilityLiveRegion="polite">正在核對原聊天訊息…</Text>}</AppDialog.Content></ScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="繼續對話" onPress={close} /></AppDialog.Actions>
  </AppDialog>;
}
