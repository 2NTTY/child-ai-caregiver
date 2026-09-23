import { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { environment } from "../src/config/environment";
import { createRecordsApi, type AuthMode } from "../src/client/records-api";
import { RecordsController } from "../src/client/records-controller";
import { useRecordsBrowser } from "../src/client/use-records-browser";
import { createChatApi } from "../src/client/chat-api";
import { ChatController } from "../src/client/chat-controller";
import { ChatPanel } from "../src/client/ChatPanel";

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("zh-HK", { hour12: false });
}

export default function HomeScreen() {
  const [recordsApi] = useState(() => createRecordsApi(environment.apiBaseUrl));
  const [chatController] = useState(() => new ChatController(createChatApi(environment.apiBaseUrl, recordsApi.getSession)));
  const [controller] = useState(() => new RecordsController(recordsApi, true, {
    begin: childId => chatController.beginChildDeletion(childId),
    release: childId => chatController.releaseChildDeletion(childId),
    forget: childId => chatController.forgetChild(childId),
    reconcile: (childIds, pendingDeletionId) => chatController.reconcileChildren(childIds, pendingDeletionId),
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const chatState = useSyncExternalStore(chatController.subscribe, chatController.getSnapshot, chatController.getSnapshot);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [chatLogoutConfirmation, setChatLogoutConfirmation] = useState(false);
  const serverAddress = useRecordsBrowser(controller, environment.apiBaseUrl, Boolean(name || email || password));
  const busy = state.busy !== null;
  const child = state.children.find(item => item.id === state.selectedChildId);
  const draft = child ? state.drafts[child.id] : undefined;
  const uncertainRecord = draft?.outcome === "unknown" || draft?.outcome === "checked";
  const uncertainChild = state.childOutcome === "unknown" || state.childOutcome === "checked";
  const deleting = state.deletion !== null;

  useEffect(() => {
    if (state.user) {
      setName("");
      setEmail("");
      setPassword("");
    }
  }, [state.user?.id]);

  useEffect(() => {
    if (state.auth === "signedOut") setChatLogoutConfirmation(false);
  }, [state.auth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (chatController.hasUnsavedInput()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      chatController.dispose();
    };
  }, [chatController]);

  function requestLogout(): void {
    if (chatController.hasUnsavedInput()) {
      setChatLogoutConfirmation(true);
      return;
    }
    void controller.signOut();
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>育伴港</Text>
        <Text style={styles.body}>孩子與照顧記錄</Text>
        <Text style={styles.hint}>P1 試玩階段，請只使用合成資料。</Text>
        <View style={styles.section}>
          <Text style={styles.label}>目前 Server</Text>
          <Text selectable style={styles.body}>{serverAddress}</Text>
          <Text style={styles.hint}>已確認的資料保存於這個 Server。登入同一帳號後可重新讀取。</Text>
          <Text accessibilityLiveRegion="polite" style={state.online ? styles.hint : styles.warning}>
            {state.online ? "瀏覽器顯示網絡可用；實際保存以 Server 確認為準。"
              : "目前離線，畫面資料可能過期。不能提交；未保存輸入只保留在本頁，連線後請重新讀取。"}
          </Text>
          {state.notice && <Text accessibilityRole="alert" style={styles.warning}>{state.notice}</Text>}
        </View>

        {state.auth === "checking" ? (
          <Text accessibilityLiveRegion="polite" style={styles.body}>正在確認登入狀態…</Text>
        ) : state.auth === "unavailable" ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>暫時未能確認登入</Text>
            <Text style={styles.body}>尚未確認你已登出，請稍後重試現有登入狀態。</Text>
            {state.hasRetainedInput && <Text style={styles.warning}>未提交內容已隱藏，只保留在本頁；確認為同一帳號後可恢復。請勿重新整理或關閉頁面。</Text>}
            <Action label="重新確認登入" onPress={() => { void controller.restoreSession(); }} disabled={busy || !state.online} />
          </View>
        ) : state.auth === "signedOut" ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>{authMode === "signUp" ? "建立帳號" : "登入"}</Text>
            {state.hasRetainedInput && <Text style={styles.warning}>本頁有已隱藏的未提交內容。登入原帳號可恢復；登入另一帳號會清除原帳號的頁面草稿。</Text>}
            <Action label="重新檢查登入狀態" onPress={() => { void controller.restoreSession(); }} disabled={busy || !state.online} />
            <View style={styles.row}>
              <Action label="使用現有帳號" onPress={() => setAuthMode("signIn")} disabled={busy || authMode === "signIn"} />
              <Action label="註冊帳號" onPress={() => setAuthMode("signUp")} disabled={busy || authMode === "signUp"} />
            </View>
            {authMode === "signUp" && <>
              <Text style={styles.label}>你的稱呼</Text>
              <TextInput accessibilityLabel="你的稱呼" value={name} onChangeText={setName} editable={!busy} autoComplete="name" style={styles.input} />
            </>}
            <Text style={styles.label}>電郵</Text>
            <TextInput accessibilityLabel="電郵" value={email} onChangeText={setEmail} editable={!busy}
              keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} style={styles.input} />
            <Text style={styles.label}>密碼{authMode === "signUp" ? "（至少 12 個字元）" : ""}</Text>
            <TextInput accessibilityLabel="密碼" value={password} onChangeText={setPassword} editable={!busy}
              secureTextEntry autoCapitalize="none" autoComplete={authMode === "signUp" ? "new-password" : "current-password"} style={styles.input} />
            <Action label={state.busy === "auth" ? "正在確認…" : authMode === "signUp" ? "建立帳號並登入" : "登入"}
              onPress={() => { void controller.authenticate(authMode, { name, email, password }); }} disabled={busy || !state.online} />
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.body}>已登入：{state.user?.name}（{state.user?.email}）</Text>
              <Action label={state.busy === "logout" ? "正在登出…" : "登出"} onPress={requestLogout} disabled={busy || !state.online} />
              {chatLogoutConfirmation && <View style={styles.confirmation}>
                <Text style={styles.warning}>登出成功後會清除本頁聊天草稿、未完成回覆狀態及其他孩子的照顧記錄草稿；已保存的訊息仍可重新登入讀取。</Text>
                <Action label="確認捨棄未提交內容並登出" onPress={() => { setChatLogoutConfirmation(false); void controller.signOut(true); }} disabled={busy || !state.online} />
                <Action label="返回，繼續保留草稿" onPress={() => setChatLogoutConfirmation(false)} disabled={busy} />
              </View>}
              {state.logoutConfirmation && <View style={styles.confirmation}>
                <Text style={styles.warning}>登出成功後會清除本頁所有未提交內容，包括其他孩子的草稿；這些內容尚未保存。</Text>
                <Action label="確認捨棄未提交內容並登出" onPress={() => { void controller.signOut(true); }} disabled={busy || !state.online} />
                <Action label="返回，繼續保留草稿" onPress={() => controller.cancelLogout()} disabled={busy} />
              </View>}
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>選擇孩子</Text>
              <Action label={state.childrenLoading ? "正在讀取孩子…" : "重新讀取孩子列表"} onPress={() => { void controller.reloadChildren(); }} disabled={busy || state.childrenLoading || !state.online} />
              {state.childrenError && <Text accessibilityRole="alert" style={styles.warning}>{state.childrenError}</Text>}
              {state.childrenLoadedAt && <Text style={styles.hint}>孩子列表最後讀取：{dateTime(state.childrenLoadedAt)}</Text>}
              <View style={styles.row}>
                {state.children.map(item => <Action key={item.id}
                  label={`${item.id === child?.id ? "目前：" : ""}${item.displayName}${state.drafts[item.id]?.text ? "（有未保存內容）" : ""}`}
                  onPress={() => { void controller.selectChild(item.id); }} disabled={busy || deleting || state.childrenLoading || item.id === child?.id} />)}
              </View>
              {!state.childrenLoading && state.childrenLoadedAt && state.children.length === 0 && <Text style={styles.body}>尚未有孩子，請先建立。</Text>}
              <Text style={styles.label}>新孩子的稱呼</Text>
              <TextInput accessibilityLabel="新孩子的稱呼" value={state.childName} onChangeText={value => controller.setChildName(value)}
                editable={!busy && state.childOutcome === "draft"} style={styles.input} />
              <Text style={styles.hint}>確認後會在目前帳號的 Server 資料空間建立孩子。</Text>
              <Action label={state.busy === "createChild" ? "正在提交…" : "確認建立孩子"} onPress={() => { void controller.createChild(); }}
                disabled={busy || deleting || state.childrenLoading || !state.online || uncertainChild} />
              {state.childMessage && <Text accessibilityLiveRegion="polite" style={styles.warning}>{state.childMessage}</Text>}
              {uncertainChild && <Text style={styles.hint}>請先使用「重新讀取孩子列表」核對這次建立是否已完成。</Text>}
              {state.childOutcome === "checked" && <View style={styles.row}>
                <Action label="已找到孩子，清除稱呼" onPress={() => controller.resolveUnknownChild(true)} disabled={busy || state.childrenLoading} />
                <Action label="已核對未見孩子，解鎖重試" onPress={() => controller.resolveUnknownChild(false)} disabled={busy || state.childrenLoading} />
              </View>}
            </View>

            {child && <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>刪除「{child.displayName}」</Text>
              {!deleting && <Action label="檢視永久刪除孩子及全部資料" onPress={() => controller.reviewDeleteChild()}
                disabled={busy || state.childrenLoading || !state.online || chatState.busy !== null} />}
              {state.deletion?.childId === child.id && <View style={styles.confirmation}>
                <Text style={styles.warning}>永久刪除「{child.displayName}」後，這位孩子及其全部已保存照顧記錄、私人聊天和本頁草稿都會清除，無法復原。其他孩子的草稿會保留。</Text>
                {state.deletion.message && <Text accessibilityRole="alert" style={styles.warning}>{state.deletion.message}</Text>}
                {state.deletion.phase === "confirm" && <Action label={state.busy === "deleteChild" ? "正在刪除…" : `再次確認：永久刪除「${child.displayName}」及全部資料`}
                  onPress={() => { void controller.confirmDeleteChild(); }} disabled={busy || !state.online || chatState.busy !== null} />}
                {state.deletion.phase === "unknown" && <Action label="重新讀取孩子列表核對刪除結果"
                  onPress={() => { void controller.reloadChildren(); }} disabled={busy || state.childrenLoading || !state.online} />}
                {state.deletion.phase === "checked" && <Action label="再次檢視永久刪除"
                  onPress={() => controller.reviewDeleteChild()} disabled={busy || !state.online} />}
                {state.deletion.phase !== "unknown" && <Action label="取消刪除，保留孩子"
                  onPress={() => controller.cancelDeleteChild()} disabled={busy} />}
              </View>}
            </View>}

            {child && !deleting && <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.heading}>{child.displayName}的文字記錄</Text>
              <Text style={styles.hint}>請保留約數、單位及原來寫法。草稿只留在本頁；切換孩子會保留各自草稿，重新整理或關閉可能失去內容。</Text>
              <TextInput accessibilityLabel={`為${child.displayName}輸入文字記錄`} value={draft?.text ?? ""}
                onChangeText={value => controller.setRecordText(value)} editable={!busy && !uncertainRecord}
                multiline numberOfLines={5} style={[styles.input, styles.textArea]} />
              <Text accessibilityLiveRegion="polite" style={styles.hint}>
                {state.busy === "saveRecord" ? "正在提交，等候 Server 確認…" : uncertainRecord ? "尚未確認保存，結果未知。" : draft?.text ? "尚未保存。" : "輸入文字後，請先檢視並確認保存。"}
              </Text>
              {draft?.message && <Text accessibilityRole="alert" style={styles.warning}>{draft.message}</Text>}
              {draft?.receipt && <Text accessibilityLiveRegion="polite" style={styles.body}>
                Server 已確認保存：{dateTime(draft.receipt.createdAt)}{"\n"}記錄編號：{draft.receipt.id}
              </Text>}
              <Action label="檢視並確認保存" onPress={() => controller.reviewRecord()} disabled={busy || state.recordsLoading || !state.online || uncertainRecord} />
              {state.confirmation && <View style={styles.confirmation}>
                <Text style={styles.label}>請確認保存到「{child.displayName}」</Text>
                <Text selectable style={styles.recordText}>{state.confirmation.text}</Text>
                <Text style={styles.hint}>以下操作會把這段原文保存到上方顯示的 Server。</Text>
                <Action label={state.busy === "saveRecord" ? "正在提交…" : "確認保存到 Server"} onPress={() => { void controller.confirmRecord(); }} disabled={busy || !state.online} />
                <Action label="返回修改" onPress={() => controller.cancelReview()} disabled={busy} />
              </View>}
              {uncertainRecord && <Text style={styles.hint}>先重新讀取下方記錄。只有最近 {state.recordLimit} 則可在此核對；如果未能確定，請保留草稿，避免重複提交。</Text>}
              {draft?.outcome === "checked" && <View style={styles.row}>
                <Action label="已找到記錄，清除草稿" onPress={() => controller.resolveUnknownRecord(true)} disabled={busy || state.recordsLoading} />
                <Action label="已核對未見記錄，解鎖重試" onPress={() => controller.resolveUnknownRecord(false)} disabled={busy || state.recordsLoading} />
              </View>}

              <Text accessibilityRole="header" style={styles.heading}>最近 {state.recordLimit} 則記錄</Text>
              <Action label={state.recordsLoading ? "正在讀取記錄…" : uncertainRecord ? "重新讀取記錄並核對" : "重新讀取記錄"}
                onPress={() => { void controller.reloadRecords(); }} disabled={busy || state.recordsLoading || !state.online} />
              {state.recordsError && <Text accessibilityRole="alert" style={styles.warning}>{state.recordsError}</Text>}
              {state.recordsLoadedAt && <Text style={styles.hint}>記錄列表最後讀取：{dateTime(state.recordsLoadedAt)}。只顯示 Server 已確認的記錄。</Text>}
              {!state.recordsLoading && state.recordsLoadedAt && state.records.length === 0 && <Text style={styles.body}>尚未有已保存的文字記錄。</Text>}
              {state.records.map(record => <View key={record.id} style={styles.record}>
                <Text style={styles.label}>Server 保存時間：{dateTime(record.createdAt)}</Text>
                <Text selectable style={styles.recordText}>{record.text}</Text>
                <Text selectable style={styles.hint}>記錄編號：{record.id}</Text>
              </View>)}
            </View>}
          </>
        )}
        <ChatPanel controller={chatController} auth={state.auth} userId={state.user?.id ?? null} online={state.online} child={deleting ? null : child ?? null} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#f5f6f5", padding: 20 },
  container: { width: "100%", maxWidth: 840, alignSelf: "center", gap: 16, paddingBottom: 32 },
  section: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d4dbd6", borderRadius: 8, padding: 16, gap: 12 },
  title: { fontSize: 26, fontWeight: "600", color: "#17291f" },
  heading: { fontSize: 20, fontWeight: "600", color: "#17291f" },
  body: { fontSize: 16, lineHeight: 25, color: "#233429" },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#233429" },
  hint: { fontSize: 14, lineHeight: 22, color: "#4f5e54" },
  warning: { fontSize: 15, lineHeight: 24, color: "#744300" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  input: { borderWidth: 1, borderColor: "#718078", borderRadius: 4, padding: 12, fontSize: 16, color: "#17291f", backgroundColor: "#ffffff" },
  textArea: { minHeight: 140, textAlignVertical: "top", lineHeight: 25 },
  button: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#244e38", borderRadius: 5 },
  buttonText: { color: "#ffffff", fontSize: 15, lineHeight: 22 },
  disabled: { opacity: 0.5 },
  confirmation: { borderWidth: 1, borderColor: "#718078", backgroundColor: "#f4f7f3", padding: 14, gap: 12 },
  record: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 14, gap: 8 },
  recordText: { fontSize: 16, lineHeight: 26, color: "#17291f" },
});
