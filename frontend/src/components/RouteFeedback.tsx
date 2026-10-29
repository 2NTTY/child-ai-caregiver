import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type ErrorBoundaryProps } from "expo-router";
import { routeErrorReference } from "./route-error-reference";

// Keep the fallback outside Paper, motion and product owners: any of them may
// be the failing subtree. Retry remounts the view, never resubmits an operation.
export function RouteError({ error, retry, returnHome = false }: ErrorBoundaryProps & { returnHome?: boolean }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  async function reloadView() {
    if (retrying) return;
    setRetrying(true);
    try { await retry(); } finally { setRetrying(false); }
  }
  return <View testID="route-error" style={styles.panel}>
    <Text accessibilityRole="header" aria-level={1} style={styles.title}>暫時未能顯示這個頁面</Text>
    <Text style={styles.body}>已提交的事項不會重新送出。你可以重新載入畫面；未送出的內容仍以目前裝置的草稿為準。</Text>
    <Text selectable style={styles.reference}>參考：{routeErrorReference(error)}</Text>
    <Pressable accessibilityRole="button" disabled={retrying} onPress={() => { void reloadView(); }} style={styles.button}>
      <Text style={styles.buttonText}>{retrying ? "正在載入…" : "重新載入畫面"}</Text>
    </Pressable>
    {returnHome ? <Pressable accessibilityRole="button" onPress={() => router.replace("/")} style={styles.button}>
      <Text style={styles.buttonText}>返回首頁</Text>
    </Pressable> : null}
  </View>;
}

export function ChatRouteError(props: ErrorBoundaryProps) { return <RouteError {...props} returnHome />; }

export function RouteLoading() {
  return <View testID="route-loading" style={styles.panel} accessibilityLiveRegion="polite">
    <ActivityIndicator color="#245444" /><Text style={styles.body}>正在開啟頁面…</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: "#f7f9f8", justifyContent: "center", padding: 24, gap: 16 },
  title: { color: "#173b30", fontSize: 20, fontWeight: "700" },
  body: { color: "#173b30", fontSize: 15, lineHeight: 24 },
  reference: { color: "#566c64", fontSize: 12 },
  button: { alignSelf: "flex-start", backgroundColor: "#245444", borderRadius: 10, minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { color: "white", fontSize: 15 },
});
