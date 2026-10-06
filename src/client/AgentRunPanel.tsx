import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { AgentDecision, AgentProposal, ProductAgentResult } from "../shared/product-agent.ts";
import { createProductAgentApi, ProductAgentApiError, requiresFreshAgentConfirmation } from "./product-agent-api.ts";

interface Props { apiBaseUrl: string; userId: string; childId: string; runId: string; online: boolean }
interface UnknownDecision { proposalId: string; input: AgentDecision; reviewed: boolean; reconfirm: boolean }
const runStatus: Record<ProductAgentResult["status"], string> = { running: "處理中", completed: "已結束", stopped: "已停止", unknown: "結果未知" };
const proposalStatus: Record<AgentProposal["status"], string> = { pending: "待你確認", accepted: "已接受", dismissed: "已略過", expired: "已過期" };
const stopReasons: Record<string, string> = {
  cancelled: "已取消", deadline: "處理時間已到上限", model_limit: "AI 調用次數已到上限", tool_limit: "工具調用次數已到上限",
  embedding_limit: "知識查詢次數已到上限", input_limit: "輸入長度已到上限", unauthorized: "存取權已改變",
  quota_exceeded: "用量已到上限", unavailable: "服務暫時未能使用", invalid_response: "未能確認 AI 回覆",
  invalid_tool: "工具要求未能通過核對", tool_unknown: "工具結果未能確認", interrupted: "處理中斷，沒有自動重新執行",
};
const toolNames: Record<string, string> = { stage_private_summary: "整理私有輔助摘要", read_context: "讀取已確認記憶及任務", search_knowledge: "檢索知識來源",
  propose_task: "保存建立任務候選", propose_task_change: "保存任務變更候選", propose_fact: "保存記憶候選", present_answer: "整理回覆及引用" };
const toolStatuses: Record<ProductAgentResult["tools"][number]["status"], string> = { succeeded: "成功", rejected: "已拒絕", conflict: "出現衝突", failed: "失敗", unknown: "結果未知" };
const taskActions = { reschedule: "改期／轉派", complete: "記錄完成", cancel: "取消", resolve: "覆核終態" };
const isShared = (proposal: AgentProposal) => proposal.value.kind === "task_create" || proposal.value.kind === "task_change" || proposal.value.kind === "memory_fact" && proposal.value.intendedVisibility === "family";
const expired = (proposal: AgentProposal) => Date.parse(proposal.expiresAt) <= Date.now();
const privateAccessLost = (error: unknown) => error instanceof ProductAgentApiError
  && ([401, 403, 404].includes(error.status) || ["session_changed", "unauthorized", "not_found"].includes(error.code ?? ""));

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function SharedConfirmation({ checked, disabled, onToggle }: { checked: boolean; disabled: boolean; onToggle: () => void }) {
  const label = "我已核對內容及對象，明確同意寫入家庭共享資料";
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={[styles.row, disabled && styles.disabled]}
    {...(Platform.OS === "web" ? { "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); if (!disabled) onToggle(); }
      } } : {})}>
    <Text style={styles.body}>{checked ? "☑" : "☐"} {label}</Text>
  </Pressable>;
}
function dateTime(value: string): string { return new Date(value).toLocaleString("zh-HK", { hour12: false }); }
function safeHttps(value: string): string | null {
  try {
    if (/[\u0000-\u0020\u007f]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function ProposalDetails({ proposal }: { proposal: AgentProposal }) {
  const value = proposal.value;
  if(value.kind==="concern_create"||value.kind==="concern_change")return <View style={styles.stack}><Text style={styles.label}>持續關注：{proposal.targetLabel}</Text><Text style={styles.hint}>請使用正式新前端核對共享內容及站內跟進後接受。</Text></View>;
  if(value.kind==="private_source_create"||value.kind==="private_source_change")return <View style={styles.stack}>
    <Text style={styles.label}>私人來源設定：{proposal.targetLabel}</Text>
    <Text style={styles.hint}>請使用正式新前端核對完整來源用途、選取正文及授權後接受；私人來源不等於已確認事實。</Text>
  </View>;
  if (value.kind === "task_create") return <View style={styles.stack}>
    <Text style={styles.label}>建立任務：{value.values.title}</Text>
    <Text selectable style={styles.body}>{value.values.details || "沒有詳細內容"}</Text>
    <Text style={styles.body}>種類：{value.values.kind === "ordinary" ? "普通任務" : "預約"}；負責人：{proposal.targetLabel ?? "未能確認對象"}</Text>
    <Text style={styles.body}>到期時間：{value.values.dueAt}；時區：{value.values.timeZone}</Text>
    <Text style={styles.hint}>這是家庭共享任務候選；接受前尚未建立任務。</Text>
  </View>;
  if (value.kind === "task_change") return <View style={styles.stack}>
    <Text style={styles.label}>變更任務：{proposal.targetLabel ?? "未能確認任務及對象"}</Text>
    <Text style={styles.body}>操作：{taskActions[value.change.action]}；原任務版本：{value.change.expectedVersion}</Text>
    {value.change.action === "reschedule" && <Text style={styles.body}>新到期時間：{value.change.dueAt}；時區：{value.change.timeZone}</Text>}
    {value.change.action === "resolve" && <Text style={styles.body}>覆核為：{value.change.outcome === "completed" ? "已完成" : "已取消"}</Text>}
    <Text selectable style={styles.body}>原因／備註：{value.change.note || "沒有備註"}</Text>
    <Text style={styles.hint}>這是家庭任務的操作候選；候選保存不代表任務已完成。</Text>
  </View>;
  return <View style={styles.stack}>
    <Text style={styles.label}>確認記憶：{value.key}</Text>
    <Text selectable style={styles.body}>{value.content}</Text>
    <Text style={styles.body}>來源：你在這次聊天提供的內容，需由你核對。</Text>
    <Text style={styles.body}>接受後可見範圍：{value.intendedVisibility === "private" ? "只限你本人" : "家庭共享"}；有效至：{value.validUntil ? dateTime(value.validUntil) : "未設定"}</Text>
    <Text style={styles.hint}>尚未接受時只屬你的私人候選，並非已確認事實。</Text>
  </View>;
}

export function AgentRunPanel(props: Props) {
  // Changing any private scope remounts the contents before an old result can render.
  return <AgentRunContents key={JSON.stringify([props.apiBaseUrl, props.userId, props.childId, props.runId])} {...props} />;
}
function AgentRunContents({ apiBaseUrl, userId, childId, runId, online }: Props) {
  const api = useMemo(() => createProductAgentApi(apiBaseUrl), [apiBaseUrl]);
  const [result, setResult] = useState<ProductAgentResult | null>(null);
  const [busy, setBusy] = useState<"read" | "write" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<UnknownDecision | null>(null);
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const [revoked, setRevoked] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const currentOnline = useRef(online);
  currentOnline.current = online;

  function begin(kind: "read" | "write") {
    if (!mounted.current || !currentOnline.current || inFlight.current || revoked) return null;
    const controller = new AbortController();
    inFlight.current = controller;
    const token = ++generation.current;
    setBusy(kind);
    return { controller, current: () => mounted.current && token === generation.current,
      finish: () => {
        if (inFlight.current === controller) inFlight.current = null;
        if (mounted.current && token === generation.current) setBusy(null);
      } };
  }
  function clearPrivateResult() {
    setResult(null); setUnknown(null); setShared({}); setRevoked(true); setReadFailed(true);
    setNotice("登入、存取權或資料已改變；已清除這次私人結果。請重新確認登入及孩子資料。");
  }
  async function reload() {
    const request = begin("read");
    if (!request) return;
    try {
      const latest = await api.getRun(childId, runId, request.controller.signal, userId);
      if (!request.current()) return;
      setResult(latest); setShared({}); setReadFailed(false);
      if (!unknown) { setNotice(null); return; }
      const proposal = latest.proposals.find(item => item.id === unknown.proposalId);
      if (!proposal) {
        setUnknown({ ...unknown, reviewed: false });
        setNotice("原事項仍未能核對；已停止新的變更，請再次讀取原運行結果。");
      } else if (proposal.status !== "pending") {
        setUnknown(null);
        setNotice(`Server 已確認原事項狀態：${proposalStatus[proposal.status]}。以下顯示實際保存結果。`);
      } else if (unknown.reconfirm || proposal.version !== unknown.input.expectedVersion) {
        setUnknown(null);
        setNotice("事項、版本或確認期限已改變。請重新核對下方內容，再作新的明確確認。");
      } else {
        setUnknown({ ...unknown, reviewed: true });
        setNotice("Server 仍顯示原事項待確認。只可明確重試原操作；沒有自動重新提交。");
      }
    } catch (error) {
      if (!request.current()) return;
      if (privateAccessLost(error)) clearPrivateResult();
      else { setReadFailed(true); setNotice("未能讀取原運行結果；請連線後重新讀取。現時不會提交任何變更。"); }
    } finally { request.finish(); }
  }
  async function submit(proposal: AgentProposal, input: AgentDecision) {
    if (readFailed || proposal.status !== "pending") return;
    if (expired(proposal)) { setReadFailed(true); setShared({}); setNotice("這項確認期限已過；請先重新讀取，不能使用過期確認。"); return; }
    const request = begin("write");
    if (!request) return;
    try {
      const saved = await api.decideProposal(childId, runId, proposal.id, input, request.controller.signal, userId);
      if (!request.current()) return;
      setResult(previous => previous ? { ...previous, proposals: previous.proposals.map(item => item.id === saved.id ? saved : item) } : previous);
      setUnknown(null); setShared({});
      setNotice(`Server 已確認此事項：${proposalStatus[saved.status]}。${saved.result?.kind === "task"
        ? "任務的最新狀態可在任務頁重新讀取核對。" : saved.result?.kind === "memory_fact" ? "已保存確認記憶，可在記憶頁重新讀取。" : ""}`);
    } catch (error) {
      if (!request.current()) return;
      if (privateAccessLost(error)) clearPrivateResult();
      else {
        setUnknown({ proposalId: proposal.id, input, reviewed: false,
          reconfirm: error instanceof ProductAgentApiError && requiresFreshAgentConfirmation(error) });
        setShared({});
        setNotice("操作結果未能確認；新的變更已停止。請先讀取原運行結果核對，再決定是否重試。");
      }
    } finally { request.finish(); }
  }
  function decide(proposal: AgentProposal, decision: AgentDecision["decision"]) {
    if (unknown || busy || revoked || !online || readFailed || (decision === "accept" && isShared(proposal) && !shared[proposal.id])) return;
    void submit(proposal, { expectedVersion: proposal.version, decision, confirmShared: decision === "accept" && isShared(proposal) && !!shared[proposal.id] });
  }
  function retryOriginal() {
    const proposal = result?.proposals.find(item => item.id === unknown?.proposalId);
    if (!unknown?.reviewed || !proposal || proposal.version !== unknown.input.expectedVersion
      || (unknown.input.decision === "accept" && isShared(proposal) && !shared[proposal.id])) return;
    void submit(proposal, unknown.input);
  }

  useEffect(() => {
    mounted.current = true;
    if (currentOnline.current) void reload();
    return () => { mounted.current = false; generation.current++; inFlight.current?.abort(); inFlight.current = null; };
  }, [api]);
  useEffect(() => { if (!online) inFlight.current?.abort(); }, [online]);

  const locked = !!busy || revoked || !online || readFailed || !!unknown;
  const original = result?.proposals.find(item => item.id === unknown?.proposalId);
  const retryDisabled = !!busy || revoked || !online || readFailed || !unknown?.reviewed || !original
    || original.status !== "pending" || expired(original) || original.version !== unknown.input.expectedVersion
    || (unknown.input.decision === "accept" && isShared(original) && !shared[original.id]);

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>來源與待確認事項</Text>
    <Text style={styles.hint}>以下只顯示 Server 已保存的運行及候選狀態。工具成功保存候選，不代表任務已執行或已完成。</Text>
    {!online && <Text style={styles.warning}>目前離線；確認及略過需要連線。</Text>}
    <Action label={busy === "read" ? "正在讀取原運行…" : unknown ? "讀取原運行並核對" : "重新讀取運行結果"}
      onPress={() => { void reload(); }} disabled={!!busy || revoked || !online} />
    {notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    {unknown && <View style={styles.box}>
      <Text style={styles.label}>原操作：{unknown.input.decision === "accept" ? "接受事項" : "略過事項"}；候選版本 {unknown.input.expectedVersion}</Text>
      <Text style={styles.hint}>需先核對同一運行及事項。重試沿用原事項、版本及決定。</Text>
      <Action label={unknown.input.decision === "accept" ? "明確重試原確認" : "明確重試原略過"} onPress={retryOriginal} disabled={retryDisabled} />
    </View>}
    {result && <>
      <Text style={styles.label}>運行狀態：{runStatus[result.status]}</Text>
      {result.stopReason && <Text style={styles.warning}>停止原因：{stopReasons[result.stopReason] ?? "未能確認停止原因"}</Text>}
      {result.status === "running" && <Text style={styles.hint}>處理尚未結束，可稍後手動重新讀取。</Text>}
      {result.status === "unknown" && <Text style={styles.warning}>這次運行結果仍未知；沒有自動重新執行。</Text>}
      {result.countsKnown === false ? <Text style={styles.hint}>這次運行統計未保存，不能當作零用量；請以帳號用量紀錄核對。</Text>
        : <Text style={styles.hint}>AI 調用 {result.counts.modelCalls} 次；工具 {result.counts.toolCalls} 次；知識向量查詢 {result.counts.queryEmbeddings} 次。</Text>}
      {!!result.text && <Text selectable style={styles.body}>{result.text}</Text>}
      {result.retrievalMode === "keyword_degraded" && <Text style={styles.warning}>知識向量檢索未能使用，這次已降級為關鍵詞檢索。以下引用仍需按適用內容理解。</Text>}
      {result.retrievalMode === "not_used" && <Text style={styles.hint}>這次沒有使用公共知識檢索。</Text>}
      {result.tools.map((tool, index) => <Text key={`${index}-${tool.name}`} style={styles.body}>
        {toolNames[tool.name] ?? "其他工具"}：{toolStatuses[tool.status]}
        {tool.status === "succeeded" && ["propose_task", "propose_task_change", "propose_fact"].includes(tool.name) ? "（候選已保存，確認結果見下方）" : ""}
      </Text>)}
      <Text accessibilityRole="header" style={styles.label}>回答當時的引用來源</Text>
      <Text style={styles.hint}>以下保留原回答使用的片段及核對時間，不代表來源或孩子情況目前仍然適用；新建議會重新檢索。</Text>
      {result.citations.length === 0 && <Text style={styles.hint}>沒有已保存的適用引用片段；不能據此聲稱有官方來源支持。</Text>}
      {result.citations.map((citation, index) => {
        const url = safeHttps(citation.url);
        return <View key={`${citation.chunkId}-${index}`} style={styles.box}>
          <Text style={styles.label}>{citation.title} · {citation.section}</Text>
          <Text selectable style={styles.body}>{citation.sourceExcerpt}</Text>
          <Text style={styles.hint}>發布者：{citation.publisher}；{citation.classification === "official_guidance" ? "官方指引" : "近期資訊"}</Text>
          <Text selectable style={styles.hint}>版本：{citation.versionId}；版本校驗：{citation.versionHash}</Text>
          <Text style={styles.hint}>內容核對：{dateTime(citation.checkedAt)}；來源讀取：{dateTime(citation.fetchedAt)}</Text>
          {citation.lastSuccessfulCheckAt && <Text style={styles.hint}>最近成功查核：{dateTime(citation.lastSuccessfulCheckAt)}</Text>}
          {(citation.sourceDateText || citation.sourcePublishedAt || citation.sourceUpdatedAt) && <Text style={styles.hint}>
            來源日期：{citation.sourceDateText ?? (citation.sourceUpdatedAt ?? citation.sourcePublishedAt)}
          </Text>}
          {citation.validUntil && <Text style={styles.hint}>來源有效至：{dateTime(citation.validUntil)}</Text>}
          {citation.usageScope === "internal_noncommercial" && <Text style={styles.hint}>只限組內非商業試用。</Text>}
          {url ? <Action label="開啟 HTTPS 來源" onPress={() => { void Linking.openURL(url).catch(() => setNotice("未能開啟來源連結。")); }} />
            : <Text style={styles.warning}>來源連結未能通過 HTTPS 核對，不能開啟。</Text>}
        </View>;
      })}
      <Text accessibilityRole="header" style={styles.label}>待確認事項</Text>
      {result.proposals.length === 0 && <Text style={styles.hint}>沒有已保存的候選事項。</Text>}
      {result.proposals.map(proposal => {
        const pastDeadline = expired(proposal);
        const allowShared = !busy && !revoked && online && !readFailed && proposal.status === "pending" && !pastDeadline
          && (!unknown || (unknown.reviewed && unknown.proposalId === proposal.id && unknown.input.decision === "accept"));
        return <View key={proposal.id} style={styles.box}>
          <ProposalDetails proposal={proposal} />
          <Text style={styles.label}>候選狀態：{proposalStatus[proposal.status]}；候選版本：{proposal.version}</Text>
          <Text style={styles.hint}>建立：{dateTime(proposal.createdAt)}；確認期限：{dateTime(proposal.expiresAt)}</Text>
          {proposal.status === "pending" && pastDeadline && <Text style={styles.warning}>確認期限已過，請重新讀取最新狀態。</Text>}
          {proposal.result && <Text style={styles.hint}>Server 已保存{proposal.result.kind === "task" ? "任務操作" : "已確認記憶"}結果，版本 {proposal.result.version}。</Text>}
          {proposal.status === "pending" && isShared(proposal) && <SharedConfirmation checked={!!shared[proposal.id]} disabled={!allowShared}
            onToggle={() => setShared(previous => ({ ...previous, [proposal.id]: !previous[proposal.id] }))} />}
          {proposal.status === "pending" && <View style={styles.row}>
            <Action label={busy === "write" ? "正在確認操作…" : "明確接受此事項"} onPress={() => decide(proposal, "accept")}
              disabled={locked || pastDeadline || proposal.value.kind.startsWith("private_source_") || proposal.value.kind.startsWith("concern_") || (isShared(proposal) && !shared[proposal.id])} />
            <Action label="略過此事項" onPress={() => decide(proposal, "dismiss")} disabled={locked || pastDeadline} />
          </View>}
        </View>;
      })}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, borderColor: "#d4dbd6", paddingTop: 14, gap: 12 },
  box: { borderWidth: 1, borderColor: "#d4dbd6", borderRadius: 4, padding: 12, gap: 8 },
  stack: { gap: 6 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  heading: { fontSize: 20, fontWeight: "600", color: "#17291f" }, label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: "#233429" },
  body: { fontSize: 16, lineHeight: 25, color: "#233429" }, hint: { fontSize: 14, lineHeight: 22, color: "#4f5e54" },
  warning: { fontSize: 15, lineHeight: 24, color: "#744300" },
  button: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#244e38", borderRadius: 5 },
  buttonText: { color: "#ffffff", fontSize: 15, lineHeight: 22 }, disabled: { opacity: 0.5 },
});
