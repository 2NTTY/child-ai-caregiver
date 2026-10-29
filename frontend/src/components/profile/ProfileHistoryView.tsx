import { useEffect, useLayoutEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { ProfileActions, ProfileViewModel } from "../../profile-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton } from "../ui";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { HistoryEntryLink } from "../history/HistoryEntryLink";
import type { ProfileHistoryNavigation } from "../../navigation/useHistoryProfileRoute";
import { FormDialog } from "../FormDialog";
import { ProfileRevisionSummary } from "./ProfileSummary";

// Read-only consumer of the existing child-scoped profile owner. Entering this
// category requests only the first page; older versions remain owner-paginated.
export function ProfileHistoryView({ model, actions, scopeKey, navigation }: { model: ProfileViewModel; actions: ProfileActions; scopeKey: string; navigation: ProfileHistoryNavigation }) {
  const returnFocus = useRef<View>(null), listRef = useRef<View>(null), cards = useRef(new Map<number, View>());
  const requested = useRef<{ scope: string; current: ProfileViewModel["current"] } | null>(null);
  const scope = `${scopeKey}:${model.access}`;
  const selected = navigation.version !== null && model.access !== "lost" ? model.history.find(revision => String(revision.version) === navigation.version) : null;
  useLayoutEffect(() => { if (selected) returnFocus.current = cards.current.get(selected.version) ?? null; }, [selected?.version, scope]);
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
  if (model.access === "lost") return <ReadStateNotice headingLevel={3} state="unavailable" title="孩子權限已失效" message="檔案及修改歷史已隱藏。" />;
  if (!model.child) return <ReadStateNotice headingLevel={3} state="unavailable" title="先選擇有權查看的孩子" />;
  const emptyReady = model.online && !model.reading && !pending && !model.notice && currentReady
    && (neverConfirmed || model.historyOpen && !model.history.length);
  return <View ref={listRef} tabIndex={-1} accessibilityLabel="檔案修改記錄" style={styles.list} testID="profile-history">
    {model.current && model.current.version > 0 ? <Text style={styles.meta}>目前版本 {model.current.version}</Text> : null}
    {model.access === "read_only" ? <Text style={styles.meta}>目前為唯讀，可查看檔案修改記錄。</Text> : null}
    {!model.online ? <ReadStateNotice headingLevel={3} state="stale" title="目前離線" message="已載入版本保留，最新修改歷史尚未核對。" /> : null}
    {model.notice ? <ReadStateNotice headingLevel={3} state="unavailable" title={model.notice} /> : null}
    {pending ? <ReadStateNotice headingLevel={3} state="unavailable" title="檔案有未完成操作" message="請先在檔案頁查核原操作；這裏不會另建或重送操作。" /> : null}
    {model.reading ? <ReadStateNotice headingLevel={3} state="loading" title="正在讀取檔案資料…" /> : null}
    {!currentReady && !model.reading ? <View style={styles.list}>
      <Text style={styles.meta}>目前檔案尚未核對，不能據此判斷沒有修改記錄。</Text>
      <AppButton label="重新讀取檔案" variant="secondary" onPress={actions.refresh} disabled={locked} />
    </View> : currentReady && !neverConfirmed && !model.reading && model.notice && !model.historyOpen ? <AppButton label="重試讀取修改歷史" variant="secondary" onPress={actions.showHistory} disabled={locked} /> : null}
    {navigation.version !== null && !selected && !model.reading ? <ReadStateNotice headingLevel={3} state="unavailable" title="這個版本未在目前已載入的記錄中" message={model.hasMoreHistory ? "可載入更早版本，或返回清單。" : "目前可讀的記錄中沒有這個版本。"}>
      {model.historyOpen && model.hasMoreHistory ? <AppButton label="載入更早版本" variant="secondary" onPress={actions.loadOlderHistory} disabled={locked || !currentReady} /> : null}
      <AppButton label="返回檔案修改清單" variant="quiet" onPress={navigation.close} />
    </ReadStateNotice> : null}
    <View testID="profile-history-cards" style={styles.revisions}>{model.history.map(revision => <HistoryEntryLink href={navigation.href(String(revision.version))} selected={selected?.version === revision.version} key={revision.version} testID={`profile-history-version-${revision.version}`}
      cardRef={node => { if (node) cards.current.set(revision.version, node); else cards.current.delete(revision.version); }}
      label={`查看檔案版本 ${revision.version}：${revision.reason ?? "確認記錄"}`}
      onOpen={() => { returnFocus.current = cards.current.get(revision.version) ?? null; navigation.open(String(revision.version)); }}>
      <Text numberOfLines={3} style={styles.title}>{revision.reason ?? "已確認的孩子檔案"}</Text>
      <Text numberOfLines={2} style={styles.body}>{revision.data?.source ?? "資料來源未知"}</Text>
      <Text style={styles.meta}>版本 {revision.version} · {revision.confirmedAtLabel ?? "確認時間未知"}</Text>
      <Text numberOfLines={1} style={styles.meta}>確認人：{revision.confirmedByLabel ?? "未知"}</Text>
    </HistoryEntryLink>)}</View>
    <FormDialog visible={!!selected} scopeKey={scope} formKey={selected?.version} title={`檔案版本 ${selected?.version ?? ""}`}
      dismissMode="local" returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={navigation.close}>
      {selected ? <ProfileRevisionSummary revision={selected} /> : null}
    </FormDialog>
    {emptyReady ? <EmptyListCard testID="profile-history-empty" title={neverConfirmed ? "尚未有檔案修改記錄" : model.hasMoreHistory ? "這一頁沒有較早版本" : "沒有較早的檔案版本"}
      detail={neverConfirmed ? "這位孩子的檔案尚未確認。" : model.hasMoreHistory ? "仍有較早版本未讀取，可繼續載入。" : "目前已讀取的版本範圍沒有較早記錄。"} /> : null}
    {(navigation.version === null || !!selected) && model.historyOpen && model.hasMoreHistory ? <AppButton label="載入更早版本" variant="quiet" onPress={actions.loadOlderHistory} disabled={locked || !currentReady} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  revisions: { gap: 0, minWidth: 0 },
  list: { gap: spacing.md, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
