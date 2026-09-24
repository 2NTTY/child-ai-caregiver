import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Child } from "../shared/records.ts";
import type { ChatController } from "./chat-controller.ts";

interface Props {
  controller: ChatController;
  auth: "checking" | "signedOut" | "signedIn" | "unavailable";
  userId: string | null;
  online: boolean;
  child: Child | null;
}

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("zh-HK", { hour12: false });
}

export function ChatPanel({ controller, auth, userId, online, child }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    if (auth === "signedIn") controller.syncContext(userId, online, child?.id ?? null);
    else if (auth === "signedOut") controller.syncContext(null, online, null);
  }, [controller, auth, userId, online, child?.id]);

  // A prop change can render before the effect runs. Keep the previous account and child hidden.
  if (auth !== "signedIn" || !userId || !child || state.userId !== userId || state.selectedChildId !== child.id) return null;

  const draft = state.drafts[child.id];
  const phase = draft?.phase ?? "draft";
  const unresolved = phase === "save_unknown" || phase === "checked";
  const busy = state.busy !== null;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>{child.displayName}的 AI 聊天</Text>
    <Text style={styles.hint}>聊天會獨立保存為訊息，不會寫入上方的照顧記錄。草稿只留在本頁；切換孩子會保留各自草稿。</Text>
    <Text style={styles.warning}>要求 AI 回覆時，這位孩子的稱呼及近期聊天會送到 Google 處理。試玩階段請只輸入合成資料，不要輸入真實家庭資料。</Text>
    <Text style={styles.hint}>AI 狀態：{state.available === null ? "尚未確認" : state.available ? "可用" : "目前未開放"}</Text>
    {state.usage && <Text style={styles.hint}>
      {state.usage.day}（UTC）調用 {state.usage.attempts} 次；已回報輸入 {state.usage.inputTokens} tokens、輸出 {state.usage.outputTokens} tokens、快取 {state.usage.cachedTokens} tokens；{state.usage.unknownUsageAttempts} 次用量未知。
    </Text>}
    <TextInput accessibilityLabel={`向${child.displayName}的 AI 聊天輸入訊息`}
      value={draft?.text ?? ""} onChangeText={text => controller.setText(text)}
      editable={!busy && phase === "draft"} multiline numberOfLines={4} style={[styles.input, styles.textArea]} />
    {draft?.notice && <Text accessibilityRole="alert" style={styles.warning}>{draft.notice}</Text>}
    {state.replyError && state.replyError !== draft?.notice && <Text accessibilityRole="alert" style={styles.warning}>{state.replyError}</Text>}
    <View style={styles.row}>
      <Action label={state.busy === "save" ? "正在保存聊天…" : state.busy === "reply" ? "正在等候 AI…" : "發送並要求 AI 回覆"}
        onPress={() => { void controller.send(); }} disabled={busy || state.loading || !state.loadedAt || !online || phase !== "draft" || !draft?.text.trim()} />
      {(phase === "reply_failed" || phase === "replying") && draft?.savedUserMessageId &&
        <Action label="再次取得這則訊息的 AI 回覆" onPress={() => { void controller.requestReply(draft.savedUserMessageId!); }} disabled={busy || !online} />}
      {phase === "reply_failed" && <Action label="開始新訊息" onPress={() => controller.startNewMessage()} disabled={busy} />}
    </View>
    {phase === "save_unknown" && <Text style={styles.warning}>保存結果仍未確認；先重新讀取聊天核對，不會自動重送這段原文。</Text>}
    {phase === "checked" && <Text style={styles.warning}>已核對原提交。尚無確認時，可保留原文重試；不會自動發送。</Text>}
    {phase === "checked" && draft?.candidateMessageId && <Action label="已核對，確認這則聊天已保存"
      onPress={() => controller.confirmFoundMessage()} disabled={busy} />}
    {phase === "checked" && <Action label="已核對，解鎖重新發送" onPress={() => controller.unlockCheckedSave()} disabled={busy || !online} />}
    <Text accessibilityRole="header" style={styles.heading}>最近 {state.limit} 則聊天</Text>
    <Action label={state.loading ? "正在讀取聊天…" : unresolved ? "重新讀取聊天並核對" : "重新讀取聊天"}
      onPress={() => { void controller.reloadMessages(); }} disabled={busy || state.loading || !online} />
    {state.error && <Text accessibilityRole="alert" style={styles.warning}>{state.error}</Text>}
    {state.loadedAt && <Text style={styles.hint}>最後讀取：{dateTime(state.loadedAt)}。以下只顯示 Server 已確認的訊息。</Text>}
    {!state.loading && state.loadedAt && state.messages.length === 0 && <Text style={styles.body}>尚未有已保存聊天。</Text>}
    {state.messages.map(message => {
      const pending = message.role === "user" && message.authorUserId === userId
        && !state.messages.some(item => item.role === "model" && item.inReplyTo === message.id);
      return <View key={message.id} style={styles.message}>
        <Text style={styles.label}>{message.role === "user" ? "你" : "AI"} · {dateTime(message.createdAt)}</Text>
        <Text selectable style={styles.body}>{message.text}</Text>
        {pending && <Action label={state.replyingMessageId === message.id ? "正在等候 AI…" : "要求這則訊息的 AI 回覆"}
          onPress={() => { void controller.requestReply(message.id); }} disabled={busy || !online} />}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d4dbd6", borderRadius: 8, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600", color: "#17291f" },
  body: { fontSize: 16, lineHeight: 25, color: "#233429" },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#233429" },
  hint: { fontSize: 14, lineHeight: 22, color: "#4f5e54" },
  warning: { fontSize: 15, lineHeight: 24, color: "#744300" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  input: { borderWidth: 1, borderColor: "#718078", borderRadius: 4, padding: 12, fontSize: 16, color: "#17291f", backgroundColor: "#ffffff" },
  textArea: { minHeight: 120, textAlignVertical: "top", lineHeight: 25 },
  button: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#244e38", borderRadius: 5 },
  buttonText: { color: "#ffffff", fontSize: 15, lineHeight: 22 },
  disabled: { opacity: 0.5 },
  message: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 14, gap: 8 },
});
