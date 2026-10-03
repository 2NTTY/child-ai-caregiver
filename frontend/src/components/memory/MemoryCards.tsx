import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { canManageMemory, factConfirmationLabel, factIsApplicable, factSourceLabel, factStatusLabels, factUnavailableReason, isTerminalTopic, topicMayAsk, topicStatusLabels, visibilityLabels, type MemoryFactView, type MemoryRole, type MemorySummaryView, type MemoryTopicView } from "../../memory-view-model";
import type { MemoryPreviewController } from "../../preview/useMemoryPreview";
import { chineseFont, colors, radius, readingType, spacing, typeScale, workspaceType } from "../../theme";
import { MotionFeedback, MotionList, MotionReveal } from "../../motion";
import { AppButton, SectionCard, SectionHeader } from "../ui";

export function MemoryFactList({ preview, role, disabled, scopeKey, motionActive }: { preview: MemoryPreviewController; role: MemoryRole; disabled: boolean; scopeKey: string; motionActive: boolean }) {
  const operation = preview.controller.operation;
  const revealIntent = ["saving", "saved"].includes(operation.state) ? operation.reference : null;
  const [readReference, setReadReference] = useState<string | null>(null);
  const eligible = motionActive && operation.state === "saved" && operation.reference !== readReference;
  return <SectionCard><SectionHeader density="compact" title="已確認與候選" subtitle="合成記憶；候選即使預期共享，確認前仍只供本人。"
    action={<AppButton label="新增候選" variant="secondary" disabled={disabled} onPress={() => preview.beginFact("create")} />} />
    {!preview.sampleActive && preview.data.facts.length > 0 && preview.data.topics.length > 0 ? <AppButton label="示範 50+1 合成分頁" variant="quiet" disabled={disabled} onPress={() => { setReadReference(operation.reference); preview.showPaginationSample(); }} /> : null}
    <Text style={styles.meta}>已載入 {preview.factsPage.items.length} 項合成事實{preview.factsPage.nextAfterId ? "；仍有未載入頁面" : "；本次合成清單已到最後一頁"}。</Text>
    {preview.factsPage.items.length === 0 && preview.factsPage.nextAfterId ? <Text style={styles.body}>目前已載入頁面沒有可見事實；可繼續載入。</Text> : null}
    <MotionList items={preview.factsPage.items} keyExtractor={fact => fact.id} scopeKey={scopeKey} regionKey="memory-facts" eligible={eligible} style={styles.list} renderItem={(fact, { exiting }) => {
      const manage = canManageMemory(role, fact);
      const confirm = manage && (fact.intendedVisibility === "private" || role !== "viewer") && fact.sourceState === "current";
      return <View key={fact.id} testID={`memory-fact-${fact.id}`} style={styles.entry}>
        <View style={styles.top}><Text style={styles.title}>{fact.key}</Text><MotionFeedback active={eligible && !exiting} triggerKey={fact.status} scopeKey={`${scopeKey}:${fact.id}`}><Text style={[styles.badge, fact.status !== "confirmed" && styles.warningBadge]}>{factStatusLabels[fact.status]}</Text></MotionFeedback></View>
        <MotionReveal value={fact.content} contentKey={fact.content} scopeKey={`${scopeKey}:${fact.id}`} regionKey="fact-content" triggerKey={revealIntent} eligible={eligible && !exiting} preset="local">{text => <Text style={styles.body}>{text}</Text>}</MotionReveal>
        <View style={styles.details}><Text style={styles.meta}>{visibilityLabels[fact.visibility]} · 版本 {fact.version} · {factConfirmationLabel(fact)}</Text>
        {fact.status === "candidate" ? <Text style={styles.warning}>擬確認範圍：{visibilityLabels[fact.intendedVisibility]}；目前仍是私人候選。</Text> : null}
        <Text style={styles.meta}>{factSourceLabel(fact.source)}</Text>
        <Text style={styles.meta}>來源狀態：{fact.sourceState === "current" ? "目前版本" : "來源已更改"} · 有效至：{fact.validUntil ?? "未設定"}</Text>
        <Text style={factIsApplicable(fact) ? styles.applicable : styles.warning}>適用性：{factUnavailableReason(fact)}</Text>
        {fact.reason ? <Text style={styles.meta}>最近原因：{fact.reason}</Text> : null}</View>
        <View style={styles.actions}>
          <AppButton label="查看版本" variant="quiet" disabled={disabled || exiting} onPress={() => preview.showHistory("fact", fact.id)} />
          {manage ? <AppButton label="更正內容" variant="quiet" disabled={disabled || exiting} onPress={() => preview.beginFact("revise", fact)} /> : null}
          {manage && fact.status !== "confirmed" ? <AppButton label={fact.status === "inactive" ? "重新核對及確認" : "核對及確認"} variant="secondary" disabled={disabled || exiting || !confirm} onPress={() => preview.beginFact("confirm", fact)} /> : null}
          {manage && fact.status !== "inactive" ? <AppButton label="停用" variant="quiet" disabled={disabled || exiting} onPress={() => preview.beginFact("deactivate", fact)} /> : null}
          {manage ? <AppButton label="刪除" variant="quiet" disabled={disabled || exiting} onPress={() => preview.beginFact("delete", fact)} /> : <Text style={styles.meta}>目前角色只可查看這項家庭共享記憶。</Text>}
        </View>
        {role === "viewer" && fact.visibility === "private" && fact.intendedVisibility === "family" ? <Text style={styles.meta}>你可更正或刪除本人的私人候選；確認為家庭共享須由有權成員處理。</Text> : null}
      </View>;
    }} />
    {preview.factsPage.nextAfterId ? <AppButton label="載入更多事實" variant="quiet" disabled={disabled} onPress={() => { setReadReference(operation.reference); preview.loadMoreFacts(); }} /> : null}
  </SectionCard>;
}

export function MemoryTopicList({ preview, role, disabled, scopeKey, motionActive }: { preview: MemoryPreviewController; role: MemoryRole; disabled: boolean; scopeKey: string; motionActive: boolean }) {
  const operation = preview.controller.operation;
  const revealIntent = ["saving", "saved"].includes(operation.state) ? operation.reference : null;
  const [readReference, setReadReference] = useState<string | null>(null);
  const eligible = motionActive && operation.state === "saved" && operation.reference !== readReference;
  return <SectionCard><SectionHeader density="compact" title="話題清單" subtitle="已回答及已解決是終態；話題回答不代表任務已完成。"
    action={<AppButton label="新增話題" variant="secondary" disabled={disabled} onPress={() => preview.beginTopic("create")} />} />
    {!preview.sampleActive && preview.data.facts.length > 0 && preview.data.topics.length > 0 ? <AppButton label="示範 50+1 合成分頁" variant="quiet" disabled={disabled} onPress={() => { setReadReference(operation.reference); preview.showPaginationSample(); }} /> : null}
    <Text style={styles.meta}>已載入 {preview.topicsPage.items.length} 項合成話題{preview.topicsPage.nextAfterId ? "；仍有未載入頁面" : "；本次合成清單已到最後一頁"}。</Text>
    {preview.topicsPage.items.length === 0 && preview.topicsPage.nextAfterId ? <Text style={styles.body}>目前已載入頁面沒有可見話題；可繼續載入。</Text> : null}
    <MotionList items={preview.topicsPage.items} keyExtractor={topic => topic.id} scopeKey={scopeKey} regionKey="memory-topics" eligible={eligible} style={styles.list} renderItem={(topic, { exiting }) => {
      const manage = canManageMemory(role, topic);
      const terminal = isTerminalTopic(topic);
      const reopened = preview.data.topics.some(item => item.reopenedFrom === topic.id);
      return <View key={topic.id} testID={`memory-topic-${topic.id}`} style={styles.entry}>
        <View style={styles.top}><Text style={styles.title}>{topic.title}</Text><MotionFeedback active={eligible && !exiting} triggerKey={topic.status} scopeKey={`${scopeKey}:${topic.id}`}><Text style={[styles.badge, !terminal && styles.warningBadge]}>{topicStatusLabels[topic.status]}</Text></MotionFeedback></View>
        <MotionReveal value={topic.note} contentKey={topic.note} scopeKey={`${scopeKey}:${topic.id}`} regionKey="topic-note" triggerKey={revealIntent} eligible={eligible && !exiting} preset="local">{text => <Text style={styles.body}>{text || "沒有備註"}</Text>}</MotionReveal>
        <View style={styles.details}><Text style={styles.meta}>{visibilityLabels[topic.visibility]} · 版本 {topic.version} · 更新：{topic.updatedAt}</Text>
        <Text style={topicMayAsk(topic) ? styles.applicable : styles.warning}>{topicMayAsk(topic) ? "目前可以再次提問" : terminal ? "終態不再提問；如需繼續，須明確按原因重開" : "目前不可再次提問；請核對 Server 狀態"}</Text>
        {topic.resumeAfter ? <Text style={styles.meta}>暫緩至：{topic.resumeAfter}</Text> : null}
        {topic.reopenedFrom ? <Text style={styles.meta}>由舊話題 {topic.reopenedFrom} 重開；原因：{topic.reopenReason}</Text> : null}
        {reopened ? <Text style={styles.meta}>已建立新的關聯話題；這項原終態保留。</Text> : null}</View>
        <View style={styles.actions}>
          <AppButton label="查看版本" variant="quiet" disabled={disabled || exiting} onPress={() => preview.showHistory("topic", topic.id)} />
          {manage ? <AppButton label={terminal ? "按原因重開" : "更新狀態"} variant="secondary" disabled={disabled || exiting || terminal && reopened} onPress={() => preview.beginTopic(terminal ? "reopen" : "change", topic)} /> : null}
          {manage ? <AppButton label="刪除話題" variant="quiet" disabled={disabled || exiting} onPress={() => preview.beginTopic("delete", topic)} /> : <Text style={styles.meta}>目前角色只可查看這項家庭共享話題。</Text>}
        </View>
      </View>;
    }} />
    {preview.topicsPage.nextAfterId ? <AppButton label="載入更多話題" variant="quiet" disabled={disabled} onPress={() => { setReadReference(operation.reference); preview.loadMoreTopics(); }} /> : null}
  </SectionCard>;
}

export function MemorySummaryCard({ summary }: { summary: MemorySummaryView | null }) {
  return <SectionCard><SectionHeader density="compact" title="本人的私人對話摘要" subtitle="合成摘要只示範覆蓋資料；摘要不會改寫事實、話題或任務終態。" />
    {summary ? <>
      <Text style={styles.body}>{summary.text}</Text>
      <View style={styles.details}><Text style={styles.meta}>摘要 ID：{summary.id} · 版本 {summary.version}</Text>
      <Text style={styles.meta}>建立時間：{summary.createdAt}</Text>
      <Text style={styles.meta}>前一摘要：{summary.previousId ?? "沒有（首個版本）"}</Text></View>
      <View style={styles.details}>
      <Text style={styles.title}>覆蓋的私人訊息（{summary.coveredMessageIds.length} 則）</Text>
      {summary.coveredMessageIds.map(id => <Text key={id} style={styles.meta}>{id}</Text>)}
      <Text style={styles.meta}>最後覆蓋訊息：{summary.lastCoveredMessageId}</Text></View>
    </> : null}
  </SectionCard>;
}

export function MemoryHistoryCard({ preview }: { preview: MemoryPreviewController }) {
  if (!preview.history) return null;
  const versions: (MemoryFactView | MemoryTopicView)[] = preview.historyPage.items;
  return <SectionCard><SectionHeader density="compact" title="合成版本記錄" subtitle="只含預覽資料及本次操作；正式版本須由 Server 核對可見範圍。"
    action={<AppButton label="關閉版本" variant="quiet" onPress={preview.closeHistory} />} />
    <Text style={styles.meta}>已載入 {versions.length} 個版本{preview.historyPage.nextAfterId ? "；仍有未載入頁面" : "；本次合成記錄已到最後一頁"}。</Text>
    {versions.map(version => <View key={version.version} style={styles.entry}>
      <Text style={styles.title}>版本 {version.version} · {"key" in version ? factStatusLabels[version.status] : topicStatusLabels[version.status]}</Text>
      <Text style={styles.body}>{"key" in version ? `${version.key}：${version.content}` : `${version.title}：${version.note || "沒有備註"}`}</Text>
      <View style={styles.details}><Text style={styles.meta}>範圍：{visibilityLabels[version.visibility]}</Text>
      {"key" in version ? <><Text style={styles.meta}>{factSourceLabel(version.source)} · 有效至：{version.validUntil ?? "未設定"}</Text>
        <Text style={styles.meta}>適用性：{factUnavailableReason(version)}</Text>
        <Text style={styles.meta}>{factConfirmationLabel(version)}</Text>
        <Text style={styles.meta}>原因：{version.reason || "沒有"}</Text></>
        : <><Text style={styles.meta}>更新：{version.updatedAt} · 暫緩至：{version.resumeAfter ?? "沒有"}</Text><Text style={styles.meta}>{topicMayAsk(version) ? "目前可以再次提問" : "目前不可再次提問"}</Text>{version.reopenReason ? <Text style={styles.meta}>重開原因：{version.reopenReason}</Text> : null}</>}</View>
    </View>)}
    {preview.historyPage.nextAfterId ? <AppButton label="載入更多版本" variant="quiet" onPress={preview.loadMoreHistory} /> : null}
  </SectionCard>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  entry: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg, gap: spacing.sm, minWidth: 0 },
  details: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, gap: spacing.xs, minWidth: 0 },
  top: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, flexShrink: 1 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool },
  applicable: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, fontWeight: "700" },
  badge: { fontFamily: chineseFont, color: colors.deepTeal, backgroundColor: colors.paleTeal, fontSize: typeScale.caption, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  warningBadge: { backgroundColor: colors.paleAmber, color: colors.warningInk },
  actions: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs, minWidth: 0 },
});
