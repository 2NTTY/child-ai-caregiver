import { historyPage } from "../history/history-page";
import { HistoryPager } from "../history/HistoryPager";
import { useEffect, useRef, type RefObject } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { profileAgeUnitOptions, type ProfileActions, type ProfileViewModel, type ProfileRevisionView } from "../../profile-view-model";
import { serializeHistoryRoute, type HistoryRouteState } from "../../navigation/route-state";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../../theme";
import { AppButton } from "../ui";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { ReadTargetLink } from "../ReadTargetLink";

type Props = { model: ProfileViewModel; actions: ProfileActions; scopeKey: string; route: HistoryRouteState; onSelect(id: string | null): void; onPageChange(page: number): void; scrollRef?: RefObject<ScrollView | null>; getScrollPosition?(): number };

// History only requests the original owner's first page. Local version links
// resolve the authorized loaded history, never a fabricated arbitrary-ID read.
export function ProfileHistoryView({ model, actions, scopeKey, route, onSelect, onPageChange, scrollRef, getScrollPosition }: Props) {
  const requested = useRef<{ scope: string; current: ProfileViewModel["current"] } | null>(null);
  const scope = `${scopeKey}:${model.access}`;
  const pending = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const locked = !model.online || model.reading || pending;
  const currentReady = !!model.current && !model.needsRefresh;
  // A successfully read version zero is authoritative absence, not an unread page.
  // The existing history API only accepts a positive beforeVersion.
  const neverConfirmed = currentReady && model.current!.version === 0;
  useEffect(() => {
    if (requested.current?.scope !== scope || !scopeKey || model.access === "lost" || !model.child) requested.current = null;
    if (!scopeKey || model.access === "lost" || !model.child || locked || !currentReady || neverConfirmed || model.historyOpen || model.notice) return;
    if (requested.current?.scope === scope && requested.current.current === model.current) return;
    // Record admission before invoking the owner, including StrictMode's effect
    // replay. A new canonical snapshot may invalidate even the same version.
    requested.current = { scope, current: model.current };
    actions.showHistory();
  }, [scopeKey, scope, model.access, model.child, locked, currentReady, neverConfirmed, model.historyOpen, model.notice, model.current, actions]);
  const page = historyPage(model.history, route.page);
  const selected = model.access !== "lost" && model.child ? model.history.find(revision => String(revision.version) === route.selectedId) : null;
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), localScroll = useRef<ScrollView>(null);
  const position = useReaderReturn({ scopeKey: JSON.stringify([scope, model.child?.id, "profile-history", page.page]), selectedId: selected ? String(selected.version) : null,
    enabled: model.access !== "lost" && !!model.child && (!route.selectedId || !!selected), listRef, readerRef, scrollRef: scrollRef ?? localScroll });
  const close = () => { position.returning(); onSelect(null); };
  if (model.access === "lost") return <ReadStateNotice headingLevel={3} state="unavailable" title="孩子權限已失效" message="檔案及修改歷史已隱藏。" />;
  if (!model.child) return <ReadStateNotice headingLevel={3} state="unavailable" title="先選擇有權查看的孩子" />;
  const emptyReady = model.online && !model.reading && !pending && !model.notice && currentReady && (neverConfirmed || model.historyOpen && !model.history.length);
  return <View style={styles.list} testID="profile-history">
    {model.current && model.current.version > 0 ? <Text style={styles.meta}>目前版本 {model.current.version}</Text> : null}
    {model.access === "read_only" ? <Text style={styles.body}>目前為唯讀，可查看檔案修改記錄。</Text> : null}
    {!model.online ? <ReadStateNotice headingLevel={3} state="stale" title="目前離線" message="已載入版本保留，最新修改歷史尚未核對。" /> : null}
    {model.notice ? <ReadStateNotice headingLevel={3} state="unavailable" title={model.notice} /> : null}
    {pending ? <ReadStateNotice headingLevel={3} state="unavailable" title="檔案有未完成操作" message="請先在檔案頁查核原操作；這裏不會另建或重送操作。" /> : null}
    {model.reading ? <ReadStateNotice headingLevel={3} state="loading" title="正在讀取檔案資料…" /> : null}
    {!currentReady && !model.reading ? <View style={styles.list}><Text style={styles.body}>目前檔案尚未核對，不能據此判斷沒有修改記錄。</Text><AppButton label="重新讀取檔案" variant="secondary" onPress={actions.refresh} disabled={locked} /></View>
      : currentReady && !neverConfirmed && !model.reading && model.notice && !model.historyOpen ? <AppButton label="重試讀取修改歷史" variant="secondary" onPress={actions.showHistory} disabled={locked} /> : null}
    <View testID="profile-history-index" aria-hidden={!!route.selectedId} style={[styles.list, !!route.selectedId && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel="檔案修改記錄清單" testID="profile-history-list">
        {page.items.map(revision => <ReadTargetLink key={revision.version} ref={node => position.rowRef(String(revision.version), node)} testID={`profile-history-version-${revision.version}`}
          href={{ pathname: "/history", params: serializeHistoryRoute({ ...route, category: "profile", selectedId: String(revision.version) }) }} label={`查看檔案版本 ${revision.version}：${revision.reason ?? "確認記錄"}，${revision.confirmedAtLabel ?? "確認時間未知"}，確認人${revision.confirmedByLabel ?? "未知"}`}
          onOpen={() => { position.remember(String(revision.version), getScrollPosition?.()); onSelect(String(revision.version)); }} style={styles.row}>
          <Text numberOfLines={2} style={styles.title}>{revision.reason ?? "已確認的孩子檔案"}</Text><Text numberOfLines={2} style={styles.body}>{revision.data?.source ?? "資料來源未知"}</Text>
          <Text style={styles.meta}>版本 {revision.version} · {revision.confirmedAtLabel ?? "確認時間未知"} · {revision.confirmedByLabel ?? "確認人未知"}</Text>
        </ReadTargetLink>)}
      </View>
      <HistoryPager page={page.page} total={page.total} onChange={onPageChange} />
      {emptyReady ? <EmptyListCard testID="profile-history-empty" title={neverConfirmed ? "尚未有檔案修改記錄" : model.hasMoreHistory ? "這一頁沒有較早版本" : "沒有較早的檔案版本"} detail={neverConfirmed ? "這位孩子的檔案尚未確認。" : model.hasMoreHistory ? "仍有較早版本未讀取，可繼續載入。" : "目前已讀取的版本範圍沒有較早記錄。"} /> : null}
      {model.historyOpen && model.hasMoreHistory ? <AppButton label="載入更早版本" variant="quiet" onPress={actions.loadOlderHistory} disabled={locked || !currentReady} /> : null}
    </View>
    {route.selectedId ? <View testID="profile-history-reader" style={styles.reader}>
      <AppButton label="返回檔案修改記錄" variant="quiet" onPress={close} />
      {selected ? <><View ref={readerRef} tabIndex={-1} testID="profile-history-reader-heading" accessibilityLabel={`檔案版本 ${selected.version}`} style={styles.list}>
        <Text accessibilityRole="header" aria-level={3} style={styles.readerTitle}>{selected.reason ?? "已確認的孩子檔案"}</Text><Text style={styles.meta}>版本 {selected.version} · 確認人：{selected.confirmedByLabel ?? "未知"} · {selected.confirmedAtLabel ?? "確認時間未知"}</Text>
      </View><HistoricalProfileData revision={selected} /></> : <ReadStateNotice headingLevel={3} state={model.reading ? "loading" : "unavailable"} message={model.reading ? "正在讀取檔案修改記錄…" : "這個檔案版本不在已載入且可讀的修改記錄，沒有代選其他版本。"} />}
    </View> : null}
  </View>;
}
function HistoricalProfileData({ revision }: { revision: ProfileRevisionView }) {
  const data = revision.data;
  if (!data) return <Text style={styles.body}>這個版本沒有檔案內容。</Text>;
  const age = data.age, ageLabel = age.kind === "unknown" ? "未知" : age.kind === "birth_date" ? `出生日期 ${age.date}` : `約 ${age.rawValue} ${profileAgeUnitOptions.find(option => option.value === age.unit)?.label ?? age.unit}（截至 ${age.asOf}）`;
  const groups = [
    { title: "健康與照顧", rows: [["過敏資料", data.allergies], ["特別需要", data.specialNeeds], ["照顧偏好", data.preferences]] },
    { title: "基本資料", rows: [["年齡資料", ageLabel], ["預產期", data.dueDate], ["出生孕週原文", data.gestationalWeeksRaw], ["地區", data.region], ["語言", data.language]] },
    { title: "資料來源", rows: [["資料來源", data.source], ["資料有效至", data.validUntil]] },
  ];
  return <View style={styles.sections}>{groups.map(group => <View key={group.title} style={styles.section}>
    <Text accessibilityRole="header" aria-level={4} style={styles.sectionTitle}>{group.title}</Text>
    {group.rows.map(([label, value]) => <View key={label} style={styles.fact}><Text style={styles.meta}>{label}</Text><Text selectable style={styles.body}>{value ?? "未知"}</Text></View>)}
  </View>)}</View>;
}
const styles = StyleSheet.create({ list: { gap: spacing.md, minWidth: 0 }, hidden: { display: "none" }, row: { minWidth: 0, minHeight: 48, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0 },
  reader: { width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0, gap: spacing.lg }, sections: { gap: spacing.lg }, section: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md }, fact: { gap: spacing.xs },
  readerTitle: { fontFamily: chineseFont, ...workspaceType.section, color: colors.ink, fontWeight: "700" }, sectionTitle: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, fontWeight: "700" }, title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
