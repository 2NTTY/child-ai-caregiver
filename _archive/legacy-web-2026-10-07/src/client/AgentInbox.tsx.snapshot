import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { AgentRunPanel } from "./AgentRunPanel.tsx";

interface Props { apiBaseUrl: string; userId: string; childId: string; online: boolean }
const runsSchema = z.object({ runs: z.array(z.object({ runId: z.uuid(), createdAt: z.iso.datetime({ offset: true }) })).max(20) });
type Run = z.infer<typeof runsSchema>["runs"][number];
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function dateTime(value: string): string { return new Date(value).toLocaleString("zh-HK", { hour12: false }); }
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

export function AgentInbox(props: Props) {
  // A new private scope gets empty state immediately, before effects run.
  return <AgentInboxContents key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId])} {...props} />;
}
function AgentInboxContents({ apiBaseUrl, userId, childId, online }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const currentOnline = useRef(online);
  currentOnline.current = online;

  function clearPrivateData(message: string) {
    setRuns([]); setSelectedRunId(null); setLoadedAt(null); setNotice(message);
  }
  async function readRuns() {
    if (!mounted.current || !currentOnline.current || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const token = ++generation.current;
    const current = () => mounted.current && token === generation.current;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setLoading(true); setNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/children/${encodeURIComponent(childId)}/agent/runs`, {
        method: "GET", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId }, signal: controller.signal,
      });
      if (!current()) return;
      if ([401, 403, 404].includes(response.status)) {
        clearPrivateData(response.status === 404
          ? "此環境未啟用背景處理結果，或已無存取權；已清除舊資料。"
          : "登入或存取權已改變；已清除舊資料。請重新確認登入及孩子資料。");
        return;
      }
      if (response.status === 409) {
        let sessionChanged = false;
        try {
          const value: unknown = await response.json();
          sessionChanged = object(value) && object(value.error) && value.error.code === "session_changed";
        } catch { /* Never display response error prose. */ }
        if (!current()) return;
        if (sessionChanged) { clearPrivateData("登入帳號已改變；已清除舊資料。請重新確認登入。"); return; }
      }
      if (!response.ok) throw new Error("Agent inbox request failed");
      const value: unknown = await response.json();
      if (!current()) return;
      const parsed = runsSchema.safeParse(value);
      if (!parsed.success || new Set(parsed.data.runs.map(run => run.runId)).size !== parsed.data.runs.length) throw new Error("Invalid agent inbox response");
      setRuns(parsed.data.runs);
      setSelectedRunId(previous => parsed.data.runs.some(run => run.runId === previous) ? previous : null);
      setLoadedAt(new Date().toISOString());
    } catch {
      if (current()) setNotice("未能讀取背景處理結果；請連線後再試。沒有自動重新請求。");
    } finally {
      clearTimeout(timeout);
      if (inFlight.current === controller) inFlight.current = null;
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; inFlight.current?.abort(); inFlight.current = null; };
  }, []);
  useEffect(() => { if (!online) inFlight.current?.abort(); }, [online]);

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>背景處理結果</Text>
    <Text style={styles.hint}>手動讀取這位孩子最近最多 20 次、只屬你本人的背景處理結果。</Text>
    {!online && <Text style={styles.warning}>目前離線；連線後才可讀取或確認事項。</Text>}
    <Action label={loading ? "正在讀取背景處理結果…" : "讀取背景處理結果"} onPress={() => { void readRuns(); }} disabled={loading || !online} />
    {notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {loadedAt && <Text style={styles.hint}>最後讀取：{dateTime(loadedAt)}。以下是 Server 已保存的運行清單。</Text>}
    {loadedAt && runs.length === 0 && <Text style={styles.body}>尚未有背景處理結果。</Text>}
    {runs.map(run => <View key={run.runId} style={styles.row}>
      <Text style={styles.body}>建立時間：{dateTime(run.createdAt)}</Text>
      <Action label="查看這次背景處理結果" onPress={() => setSelectedRunId(run.runId)} disabled={loading || !online} />
    </View>)}
    {selectedRunId && <>
      <Action label="收起這次背景處理結果" onPress={() => setSelectedRunId(null)} />
      <AgentRunPanel apiBaseUrl={apiBaseUrl} userId={userId} childId={childId} runId={selectedRunId} online={online} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#d4dbd6", borderRadius: 8, padding: 16, gap: 12 },
  row: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 12, gap: 8 },
  heading: { fontSize: 20, fontWeight: "600", color: "#17291f" }, body: { fontSize: 16, lineHeight: 25, color: "#233429" },
  hint: { fontSize: 14, lineHeight: 22, color: "#4f5e54" }, warning: { fontSize: 15, lineHeight: 24, color: "#744300" },
  button: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#244e38", borderRadius: 5 },
  buttonText: { color: "#ffffff", fontSize: 15, lineHeight: 22 }, disabled: { opacity: 0.5 },
});
