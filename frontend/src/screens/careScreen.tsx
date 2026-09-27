import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { ActivityIndicator, Dialog, Portal, Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton, AppTextField, SectionCard, SectionHeader } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import type { HomeRecord } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

type Draft = { kind: HomeRecord["kind"]; text: string; source: string; eventTime: string; reviewed: boolean };
const emptyDraft: Draft = { kind: "note", text: "", source: "", eventTime: "", reviewed: false };
const kinds: { key: HomeRecord["kind"]; label: string }[] = [
  { key: "note", label: "日常" }, { key: "sleep", label: "睡眠" }, { key: "feeding", label: "飲食" },
  { key: "measurement", label: "量度" }, { key: "appointment", label: "預約" },
];

export default function CarePage() {
  const { width } = useWindowDimensions();
  const { model, actions } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const key = child?.id ?? "no-child";
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HomeRecord | null>(null);
  const draft = drafts[key] ?? emptyDraft;
  const records = model.records.filter(item => item.childId === child?.id);
  const filtered = records.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK")));
  const stacked = width < 1200;
  const updateDraft = (change: Partial<Draft>) => setDrafts(previous => ({ ...previous, [key]: { ...(previous[key] ?? emptyDraft), ...change, reviewed: false } }));

  return <PageFrame title="照顧記錄" description="查看孩子的已確認資料；候選與未提交草稿不會混入時間軸。" eyebrow="育伴港 · 孩子資料">
    {!child ? <SectionCard><Text style={styles.body}>尚未選擇孩子。不同孩子的資料必須分開顯示。</Text><AppButton label="查看子女檔案" onPress={() => actions.open("profile")} /></SectionCard> : <>
      <View style={styles.context}><Text style={styles.contextTitle}>{child.displayName}的記錄</Text><Text style={styles.contextDetail}>{child.ageLabel} · {model.lastReadLabel ? `最後讀取：${model.lastReadLabel}` : "正在讀取"}</Text></View>
      {model.connection === "offline" ? <View style={styles.warning}><Text style={styles.warningText}>目前離線；以下可能是較早讀取的資料。草稿只保留在本次預覽，沒有保存。</Text></View> : null}
      <View style={[styles.columns, stacked && styles.stack]}>
        <View style={styles.column}>
          <SectionCard><SectionHeader title="已確認時間軸" subtitle="事件時間與加入時間分開顯示。" />
            <AppTextField dense label="篩選已載入記錄" accessibilityLabel="篩選已載入記錄" value={query} onChangeText={setQuery} />
            {model.recordsLoad === "loading" ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.body}>正在讀取記錄…</Text></View> : filtered.length === 0 ? <Text style={styles.body}>{query ? "已載入的記錄中沒有符合內容。" : "目前沒有已確認記錄。"}</Text> : filtered.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看${item.title}`} onPress={() => setSelected(item)} style={({ pressed }) => [styles.recordRow, pressed && styles.pressed]}>
              <View style={styles.recordIcon}><Text style={styles.recordGlyph}>▤</Text></View><View style={styles.recordCopy}><Text style={styles.recordTitle}>{item.title}</Text><Text style={styles.body}>{item.detail}</Text><Text style={styles.meta}>事件：{item.eventTimeLabel} · 加入：{item.confirmedAtLabel}</Text></View><Text style={styles.arrow}>›</Text>
            </Pressable>)}
            <Text style={styles.meta}>此清單只代表目前載入的一頁合成資料；正式搜尋、版本與更正歷史須由現有 CarePanel 接線。</Text>
          </SectionCard>
        </View>
        <View style={styles.column}>
          <SectionCard><SectionHeader title="新增共享記錄" subtitle="填寫後先預覽與家庭共享的內容；此頁不提交 Server。" />
            <View style={styles.kindRow}>{kinds.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.label}記錄`} accessibilityState={{ selected: draft.kind === item.key }} onPress={() => updateDraft({ kind: item.key })} style={({ pressed }) => [styles.kind, draft.kind === item.key && styles.kindSelected, pressed && styles.pressed]}><Text style={[styles.kindText, draft.kind === item.key && styles.kindSelectedText]}>{item.label}</Text></Pressable>)}</View>
            <AppTextField label="記錄原文" accessibilityLabel="記錄原文草稿" multiline value={draft.text} onChangeText={text => updateDraft({ text })} />
            <AppTextField label="資料來源（例如由我觀察）" accessibilityLabel="資料來源草稿" value={draft.source} onChangeText={source => updateDraft({ source })} />
            <AppTextField label="事件時間原文（可留空）" accessibilityLabel="事件時間草稿" value={draft.eventTime} onChangeText={eventTime => updateDraft({ eventTime })} />
            <Text style={styles.meta}>未知欄位可以留空；數值精度、版本及原操作 ID 須由正式資料流程提供。</Text>
            <View style={styles.buttonRow}><AppButton label="預覽共享內容" onPress={() => setDrafts(previous => ({ ...previous, [key]: { ...draft, reviewed: true } }))} disabled={!draft.text.trim() || !draft.source.trim()} /><AppButton label="清空草稿" variant="quiet" onPress={() => setDrafts(previous => ({ ...previous, [key]: emptyDraft }))} disabled={!draft.text && !draft.source && !draft.eventTime} /></View>
            {draft.reviewed ? <View style={styles.review}><Text style={styles.reviewTitle}>待確認 · 尚未保存</Text><Text style={styles.body}>將與家庭共享：{kinds.find(item => item.key === draft.kind)?.label}記錄；原文「{draft.text}」；事件時間「{draft.eventTime || "未知"}」；來源「{draft.source}」。</Text><Text style={styles.meta}>正式版須再核對權限、版本及原操作收據，這裏沒有提交按鈕。</Text></View> : null}
          </SectionCard>
        </View>
      </View>
      <Portal><Dialog visible={selected !== null} onDismiss={() => setSelected(null)}>
        <Dialog.Title>{selected?.title ?? "記錄"}</Dialog.Title>
        <Dialog.Content><Text style={styles.body}>{selected?.detail}</Text><Text style={styles.meta}>事件：{selected?.eventTimeLabel} · 加入：{selected?.confirmedAtLabel}</Text><Text style={styles.meta}>合成預覽只展示摘要；正式版須提供原文、來源、版本及更正歷史。</Text></Dialog.Content>
        <Dialog.Actions><AppButton label="關閉" variant="quiet" onPress={() => setSelected(null)} /></Dialog.Actions>
      </Dialog></Portal>
    </>}
  </PageFrame>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, context: { backgroundColor: colors.mintSurface, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.xs }, contextTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "800" }, contextDetail: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption }, warning: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small }, warningText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 21 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, width: "100%" }, loading: { flexDirection: "row", alignItems: "center", gap: spacing.md }, recordRow: { minHeight: 78, borderBottomWidth: 1, borderBottomColor: colors.softLine, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm }, recordIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, recordGlyph: { color: colors.deepTeal, fontSize: 22 }, recordCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, recordTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, arrow: { color: colors.teal, fontSize: 23 },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, kind: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, justifyContent: "center" }, kindSelected: { backgroundColor: colors.teal, borderColor: colors.teal }, kindText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700" }, kindSelectedText: { color: colors.white }, buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, review: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md, gap: spacing.sm }, reviewTitle: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "800" },
});
