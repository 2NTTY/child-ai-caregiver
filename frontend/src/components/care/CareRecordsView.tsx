import { brand } from "../../branding";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { AppIcon } from "../AppIcon";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { PageFrame } from "../PageFrame";
import { AppButton, AppSelect, AppTextField, OperationPill, SectionCard, SectionHeader } from "../ui";
import { CareRecordDetail } from "./CareRecordDetail";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";

export function CareRecordsView({ model, actions, previewControls, onPhotos }: { model: CareRecordsViewModel; actions: CareRecordsActions; previewControls?: ReactNode; onPhotos?: () => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CareFilter>("all");
  const [width, setWidth] = useState(0);
  const loading = model.list.state === "loading" || model.list.state === "loading_more";
  const locked = ["saving", "unknown"].includes(model.operation.state);
  const occupied = locked || !!model.draft || !!model.deletion;
  const showPanel = !!(model.detail || model.draft || model.deletion);
  const split = width >= 780;
  const search = () => actions.search(query, kind);
  return <PageFrame title="照顧記錄" description="保留日常觀察的原文與來源；事件時間、加入時間及更正版本分開顯示。" eyebrow={`${brand.name} · 孩子資料`}>
    <View style={styles.context}><View style={styles.contextCopy}><Text style={styles.title}>{model.child.name}的記錄</Text><Text style={styles.body}>{model.child.summary}</Text></View>
      <View style={styles.actions}>{onPhotos ? <AppButton label="照片與記錄" variant="secondary" onPress={onPhotos} disabled={occupied || loading} /> : null}<AppButton label="新增記錄" onPress={actions.startCreate} disabled={model.access !== "editable" || occupied || loading} /></View></View>
    <Text style={styles.meta}>{model.dataLabel}</Text>
    {!model.online ? <View style={styles.notice}><Text style={styles.noticeText}>目前離線。已載入資料可能不是最新；本次草稿保留，恢復連線後由你重試。</Text></View> : null}
    {model.access === "read_only" ? <View style={styles.notice}><Text style={styles.noticeText}>你是檢視者，可閱讀記錄及歷史；新增、更正及刪除須由擁有人或照顧者處理。</Text></View> : null}
    {model.operation.state !== "none" || model.operation.message ? <View accessibilityRole="alert" style={styles.operation}>
      {model.operation.state === "conflict" ? <Text style={styles.noticeText}>版本衝突 · 尚未保存</Text> : model.operation.kind === "delete" && model.operation.state === "saved" ? <Text style={styles.title}>已確認刪除（預覽）</Text> : <OperationPill state={model.operation.state} />}
      <Text style={styles.body}>{model.operation.message}</Text>
      {model.operation.reference ? <Text style={styles.meta}>合成操作參考：{model.operation.reference}；不是 Server opId。</Text> : null}
      {model.operation.state === "unknown" ? <AppButton label={model.checkLabel} disabled={!model.online} onPress={actions.checkOriginalOperation} /> : null}
    </View> : null}
    {model.access === "lost" ? <SectionCard><SectionHeader title="已無權查看這個孩子" /><Text style={styles.body}>記錄、歷史與草稿已清除。請返回有權存取的孩子或重新確認登入身份。</Text></SectionCard> : <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.columns, !split && styles.stack]}>
      {split || !showPanel ? <View style={styles.listColumn} testID="care-record-list"><SectionCard><SectionHeader title="已確認記錄" subtitle="按最初加入時間排列；搜尋內容不寫入 URL。" />
        <AppTextField dense label="搜尋照顧記錄" accessibilityLabel="搜尋照顧記錄" maxLength={200} value={query} onChangeText={setQuery} onSubmitEditing={search} disabled={occupied} />
        <View style={styles.actions}><AppSelect label="篩選種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} />
          <AppButton label="搜尋記錄" onPress={search} disabled={!model.online || loading || occupied} /><AppButton label="清除搜尋" variant="quiet" disabled={!model.online || loading || occupied} onPress={() => { setQuery(""); setKind("all"); actions.search("", "all"); }} /></View>
        <Text style={styles.meta}>目前條件：{model.list.activeQuery || "不限文字"} · {model.list.activeKind === "all" ? "全部種類" : careKindOptions.find(item => item.value === model.list.activeKind)?.label}；已載入 {model.list.records.length} 筆。</Text>
        {model.list.state === "loading" ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.body}>正在讀取記錄…</Text></View> : model.list.state === "error" ? <View style={styles.notice}><Text style={styles.noticeText}>{model.list.message}</Text><AppButton label="重試搜尋" onPress={search} disabled={!model.online} /></View> : <>
          {model.list.state === "stale" ? <View style={styles.notice}><Text style={styles.noticeText}>{model.list.message}</Text><AppButton label="重新搜尋" onPress={search} disabled={!model.online} /></View> : null}
          {model.list.records.length === 0 ? <Text style={styles.body}>{model.list.hasMore ? "這一頁未找到符合內容，但仍有未掃描的記錄；請載入下一頁。" : "已載入範圍沒有符合條件的已確認記錄。"}</Text> : model.list.records.map(record => {
            const option = careKindOptions.find(item => item.value === record.current.values.kind)!;
            return <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`查看${record.title}`} disabled={occupied} onPress={() => actions.openRecord(record.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.icon}><AppIcon name={option.icon} size={23} color={colors.teal} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{record.title}</Text><Text numberOfLines={2} style={styles.body}>{record.current.values.text}</Text>
                <Text style={styles.meta}>事件：{record.current.values.eventTimeRaw || "未知"}</Text><Text style={styles.meta}>加入：{record.createdAtLabel}</Text><Text style={styles.version}>已確認 · 版本 {record.current.version}</Text></View><AppIcon name="chevron-right" size={18} />
            </Pressable>;
          })}
        </>}
        <Text style={styles.meta}>已掃描 {model.list.scanned} 筆；以上數量不是全部記錄總數。</Text>
        {model.list.hasMore && model.list.state !== "error" ? <AppButton label="載入下一頁" variant="secondary" loading={model.list.state === "loading_more"} disabled={!model.online || loading || occupied} onPress={actions.loadMore} /> : model.list.state === "ready" ? <Text style={styles.meta}>這次搜尋已到最後一頁。</Text> : null}
      </SectionCard></View> : null}
      {showPanel ? <View style={[styles.panel, !split && styles.fullPanel]}>{model.deletion ? <CareRecordDelete model={model} actions={actions} /> : model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={actions} /> : model.detail ? <CareRecordDetail detail={model.detail} actions={actions} canEdit={model.access === "editable"} online={model.online} /> : null}</View> : null}
    </View>}
    {previewControls}
  </PageFrame>;
}

const styles = StyleSheet.create({
  columns: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, stack: { flexDirection: "column" }, listColumn: { flex: 1, minWidth: 0, width: "100%" }, panel: { width: 360, minWidth: 0 }, fullPanel: { width: "100%" },
  context: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md, padding: spacing.lg, backgroundColor: colors.mintSurface, borderRadius: radius.medium }, contextCopy: { flexGrow: 1, flexShrink: 1, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }, loading: { flexDirection: "row", alignItems: "center", gap: spacing.md }, operation: { backgroundColor: colors.white, padding: spacing.lg, borderRadius: radius.medium, gap: spacing.sm },
  notice: { backgroundColor: colors.paleAmber, padding: spacing.md, borderRadius: radius.small, gap: spacing.sm }, noticeText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.softLine, paddingVertical: spacing.md, minHeight: 90 }, rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700" },
  icon: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, arrow: { fontSize: 22, color: colors.teal }, version: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption }, pressed: { opacity: 0.65 },
});
