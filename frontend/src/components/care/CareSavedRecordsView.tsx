import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { careKindOptions, type CareFilter, type CareRecordsActions, type CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton, AppSelect, AppTextField } from "../ui";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadStateNotice } from "../ReadStateNotice";
import { CareWriteNotice } from "./CareReviewHistoryView";
import { CareRecordDetail } from "./CareRecordDetail";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";

// History consumes the same Care owner. The current page replaces, never appends to, the visible list.
export function CareSavedRecordsView(props: { model: CareRecordsViewModel; actions: CareRecordsActions }) { return <><CareWriteNotice {...props} /><CareSavedRecordsBody {...props} /></>; }
function CareSavedRecordsBody({ model, actions }: { model: CareRecordsViewModel; actions: CareRecordsActions }) {
  const [query, setQuery] = useState(model.list.activeQuery), [kind, setKind] = useState<CareFilter>(model.list.activeKind);
  const occupied = ["saving", "unknown"].includes(model.operation.state) || !!model.draft || !!model.deletion;
  const loading = ["loading", "loading_more"].includes(model.list.state);
  const hasSnapshot = model.list.hasSnapshot ?? model.list.records.length > 0;
  const filtered = !!model.list.activeQuery.trim() || model.list.activeKind !== "all";
  const empty = (model.list.state === "ready" || loading && hasSnapshot) && !model.list.records.length && model.list.message === null;
  const showSearch = !empty || filtered || !!query.trim() || kind !== "all" || model.list.hasPrevious || model.list.hasMore;
  const readState = loading && !hasSnapshot ? "loading" : model.list.state === "error" ? "error" : model.list.state === "stale" ? hasSnapshot ? "stale" : "unavailable" : model.list.message ? "unavailable" : model.list.records.length ? "ready" : "empty";
  const readMessage = model.list.message ?? (loading && !hasSnapshot ? "正在讀取記錄…" : model.list.state === "error" ? "未能讀取記錄，請重試。" : model.list.state === "stale" ? model.online ? "記錄尚待重新核對。" : "目前離線，記錄尚未核對。" : empty ? filtered ? "沒有符合篩選的已保存記錄" : model.list.hasMore || model.list.hasPrevious ? "此頁暫無已保存記錄" : "暫無已保存記錄" : "");
  if (model.access === "lost") return <ReadStateNotice state="unavailable" message="目前沒有權限查看這個孩子的記錄。" />;
  if (model.deletion) return <CareRecordDelete model={model} actions={actions} />;
  if (model.draft) return <CareRecordForm key={model.draft.key} model={model} actions={actions} />;
  if (model.detail) return <CareRecordDetail detail={model.detail} actions={actions} canEdit={model.access === "editable"} online={model.online} />;
  return <View style={s.workspace}>
    {showSearch ? <><AppTextField label="搜尋已保存記錄" accessibilityLabel="搜尋已保存記錄" value={query} onChangeText={setQuery} maxLength={200} disabled={occupied} />
    <View style={s.controls}><View style={s.filter}><AppSelect<CareFilter> label="種類" value={kind} options={[{ value: "all", label: "全部" }, ...careKindOptions]} onChange={setKind} disabled={occupied} /></View>
      <AppButton label="搜尋" density="compact" disabled={occupied || loading || !model.online} onPress={() => actions.search(query, kind)} /></View></> : null}
    <ReadStateNotice state={readState} message={readMessage}>
      {(model.list.state === "error" || model.list.state === "stale") ? <AppButton label="重新讀取記錄" density="compact" variant="quiet" disabled={occupied || loading || !model.online} onPress={() => actions.search(model.list.activeQuery, model.list.activeKind)} /> : null}
      {empty && filtered ? <AppButton label="清除篩選" variant="quiet" density="compact" disabled={occupied || loading || !model.online} onPress={() => { if (occupied || loading || !model.online) return; setQuery(""); setKind("all"); actions.search("", "all"); }} /> : null}
    </ReadStateNotice>
    {(loading && !hasSnapshot ? [] : model.list.records).map(record => <Pressable key={record.id} accessibilityRole="button" accessibilityLabel={`查看${record.title}`} disabled={occupied || loading} onPress={() => actions.openRecord(record.id)} style={s.row}>
      <Text style={s.title}>{record.title}</Text><Text numberOfLines={2} style={s.body}>{record.current.values.text}</Text><AppStatusBadge label={record.current.version > 1 ? "已更正" : "已保存"} tone="success" />
    </Pressable>)}
    {model.list.hasPrevious || model.list.hasMore ? <View style={s.controls}><AppButton label="上一頁" density="compact" variant="secondary" onPress={() => actions.previousPage?.()} disabled={occupied || loading || !model.online || !model.list.hasPrevious || !actions.previousPage} /><Text style={s.meta}>第 {model.list.page ?? 1} 頁</Text><AppButton label="下一頁" density="compact" variant="secondary" onPress={actions.loadMore} disabled={occupied || loading || !model.online || !model.list.hasMore || model.list.state === "stale"} /></View> : null}
  </View>;
}
const s = StyleSheet.create({ workspace: { gap: spacing.md }, controls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }, filter: { flexGrow: 1, minWidth: 0 }, row: { padding: spacing.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.controlSurface, gap: spacing.sm }, title: { fontFamily: chineseFont, ...readingType.tool, fontWeight: "700", color: colors.ink }, body: { fontFamily: chineseFont, ...readingType.tool, color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted } });
