import type { CareRoutePort } from "../../navigation/useCareRoute";
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { CareRecordsActions, CareRecordsViewModel } from "../../care-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { useReaderReturn } from "../../navigation/useReaderReturn";
import { PageFrame } from "../PageFrame";
import { AppButton, AppTabPanel } from "../ui";
import { WorkspaceSwitch } from "../workspace/WorkspaceSwitch";
import { ReadStateNotice } from "../ReadStateNotice";
import { FormDialog } from "../FormDialog";
import { CareWriteNotice } from "./CareReviewHistoryView";
import { CareSavedRecordsList } from "./CareSavedRecordsView";
import { CareRecordDetail } from "./CareRecordDetail";
import { CareRecordForm } from "./CareRecordForm";
import { CareRecordDelete } from "./CareRecordDelete";

type Props = {
  navigation: CareRoutePort; model: CareRecordsViewModel; actions: CareRecordsActions;
  pendingReview?: { content: ReactNode; loadedCount?: string };
  manualCreateFocusRef?: RefObject<View | null>; manualCreateAction?: ReactNode;
};

/** Active capture/reading is a different surface from historical review. */
export function CareRecordsView(props: Props) {
  const { model, actions, navigation, pendingReview, manualCreateAction } = props;
  const tabsId = useId(), scrollRef = useRef<ScrollView>(null);
  const tab = navigation.state.tab === "records" ? "recorded" : "pending";
  const requestedId = navigation.state.recordId;
  const awaiting = !!requestedId && model.detail?.record.id !== requestedId && !model.draft && !model.deletion;
  const loading = awaiting && model.detailRead?.id === requestedId && model.detailRead.state === "loading";
  const scrollPosition = useRef(0);
  return <PageFrame title="記低" density="compact" scrollRef={scrollRef} scrollTestID="care-page-scroll"
    onScroll={event => { if (!requestedId) scrollPosition.current = event.nativeEvent.contentOffset.y; }}>
    {!model.online ? <Text style={styles.warning}>目前離線，不能確認提交；已載入資料及草稿保留。</Text> : null}
    {model.access === "read_only" ? <Text style={styles.warning}>你可閱讀及對照內容；確認寫入或更正須由擁有人或照顧者處理。</Text> : null}
    <CareWriteNotice model={model} actions={actions} />
    {model.access === "lost" ? <Text style={styles.warning}>已無權查看這個孩子；原文、提案、記錄與草稿已隱藏。</Text> : <>
      <View testID="care-review-tabs-bar" style={styles.toolbar}>
        <WorkspaceSwitch id={tabsId} label="記錄分類" items={[{ key: "pending", label: "待確認", count: pendingReview?.loadedCount }, { key: "recorded", label: "已保存" }]}
          value={tab} onChange={next => navigation.change({ tab: next === "recorded" ? "records" : "review", recordId: null }, "push")} />
        {manualCreateAction}
      </View>
      <AppTabPanel tabsId={tabsId} tabKey={tab} active style={styles.stack}>
        {awaiting ? <View testID="care-reader-loading" style={styles.stack}>
          <ReadStateNotice state={loading ? "loading" : "unavailable"} message={loading ? "正在讀取所選記錄…" : "目前未能讀取所選記錄，沒有代選其他內容。"}>
            {!loading ? <AppButton label="重新讀取所選記錄" variant="secondary" disabled={!model.online} onPress={() => actions.openRecord(requestedId!)} /> : null}
            <AppButton label="返回記錄清單" variant="quiet" onPress={actions.closePanel} />
          </ReadStateNotice>
        </View> : <ActiveCareReader {...props} tab={tab} scrollRef={scrollRef} getScrollPosition={() => scrollPosition.current} />}
      </AppTabPanel>
    </>}
  </PageFrame>;
}

function ActiveCareReader({ model, actions, navigation, pendingReview, manualCreateFocusRef, tab, scrollRef, getScrollPosition }: Props & {
  tab: "pending" | "recorded"; scrollRef: RefObject<ScrollView | null>; getScrollPosition(): number;
}) {
  const listRef = useRef<View>(null), readerRef = useRef<View>(null), createOrigin = useRef(false);
  if (model.draft) createOrigin.current = model.draft.mode === "create" && !model.draft.captureSnapshot;
  const selected = model.detail?.record.id === navigation.state.recordId ? model.detail : null;
  const position = useReaderReturn({ enabled: !model.draft && !model.deletion, scopeKey: JSON.stringify([model.scopeKey, model.access, tab]), selectedId: selected?.record.id ?? null, listRef, readerRef, scrollRef });
  const close = () => { position.returning(); actions.closePanel(); };
  const panelActions = { ...actions, closePanel: close };
  const reading = ["loading", "loading_more"].includes(model.list.state);
  return <>
    <View testID="care-index-surface" aria-hidden={!!selected || !!model.deletion} style={[styles.stack, (selected || model.deletion) && styles.hidden]}>
      <View ref={listRef} tabIndex={-1} accessibilityLabel={tab === "recorded" ? "已保存記錄清單" : "待確認事項"} testID="care-review-list">
        {tab === "recorded" ? <CareSavedRecordsList model={model} actions={{ ...actions, openRecord: id => { position.remember(id, getScrollPosition()); actions.openRecord(id); } }}
          rowRef={position.rowRef} searchText={navigation.query} onSearchText={navigation.setQuery} /> : pendingReview?.content}
      </View>
    </View>
    {model.deletion ? <View style={styles.reader}><CareRecordDelete model={model} actions={panelActions} /></View> : selected ? <View testID="care-reader-surface" style={styles.reader}>
      <CareRecordDetail detail={selected} actions={panelActions} canEdit={model.access === "editable"} online={model.online} reading={reading} active={false} headingRef={readerRef} onReturnToList={close} />
    </View> : null}
    <FormDialog formKey={model.draft?.key} visible={!!model.draft} scopeKey={model.scopeKey ?? model.child.id} title="記錄資料"
      returnFocusRef={createOrigin.current && manualCreateFocusRef ? manualCreateFocusRef : selected ? readerRef : listRef} fallbackFocusRef={listRef} onClose={close}
      closeOutcome={{ revision: model, ready: !model.detail && !model.draft && !model.deletion && model.operation.state === "none" }} recovery={<CareWriteNotice model={model} actions={actions} />}>
      {model.draft ? <CareRecordForm key={model.draft.key} model={model} actions={panelActions} /> : null}
    </FormDialog>
  </>;
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.md, minWidth: 0 },
  stack: { gap: spacing.md, minWidth: 0 }, hidden: { display: "none" },
  reader: { width: "100%", maxWidth: 760, alignSelf: "center", minWidth: 0 },
  warning: { fontFamily: chineseFont, ...readingType.body, color: colors.warningInk },
});
