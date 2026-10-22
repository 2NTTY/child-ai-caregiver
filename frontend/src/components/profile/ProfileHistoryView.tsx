import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { ProfileActions, ProfileViewModel } from "../../profile-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton } from "../ui";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { HistoryCardGrid, HistoryEntryCard } from "../history/HistoryCards";
import { FormDialog } from "../FormDialog";
import { ProfileRevisionSummary } from "./ProfileSummary";

// Read-only consumer of the existing child-scoped profile owner. No copied history,
// eager reads or client-side full-history search is introduced by the category.
export function ProfileHistoryView({ model, actions, scopeKey }: { model: ProfileViewModel; actions: ProfileActions; scopeKey: string }) {
  const [selection, setSelection] = useState<{ scope: string; version: number } | null>(null);
  const returnFocus = useRef<View>(null), listRef = useRef<View>(null), cards = useRef(new Map<number, View>());
  const scope = `${scopeKey}:${model.access}`;
  useEffect(() => { setSelection(null); }, [scope]);
  const selected = selection?.scope === scope && model.access !== "lost" ? model.history.find(revision => revision.version === selection.version) : null;
  useEffect(() => { if (selection && !selected) setSelection(null); }, [selection, selected]);
  if (model.access === "lost") return <ReadStateNotice state="unavailable" title="孩子權限已失效" message="檔案及修改歷史已隱藏。" />;
  if (!model.child) return <ReadStateNotice state="unavailable" title="先選擇有權查看的孩子" />;
  const pending = ["saving", "unknown", "conflict"].includes(model.operation.state);
  const locked = !model.online || model.reading || pending;
  const currentReady = !!model.current && !model.needsRefresh;
  // A successfully read version zero is authoritative absence, not an unread page.
  // The existing history API only accepts a positive beforeVersion.
  const neverConfirmed = currentReady && model.current!.version === 0;
  const emptyReady = model.online && !model.reading && !pending && !model.notice && currentReady
    && (neverConfirmed || model.historyOpen && !model.history.length);
  return <View ref={listRef} tabIndex={-1} accessibilityLabel="檔案修改記錄" style={styles.list} testID="profile-history">
    <Text style={styles.meta}>{model.child.name} · 按版本查閱確認及更正記錄；較早版本逐頁讀取，不與日常照顧記錄混合。</Text>
    {model.current && model.current.version > 0 ? <Text style={styles.meta}>目前版本 {model.current.version}；最新資料可到檔案頁查看。</Text> : null}
    {model.access === "read_only" ? <Text style={styles.meta}>目前為唯讀，可查看檔案修改記錄。</Text> : null}
    {!model.online ? <ReadStateNotice state="stale" title="目前離線" message="已載入版本保留，最新修改歷史尚未核對。" /> : null}
    {model.notice ? <ReadStateNotice state="unavailable" title={model.notice} /> : null}
    {pending ? <ReadStateNotice state="unavailable" title="檔案有未完成操作" message="請先在檔案頁查核原操作；這裏不會另建或重送操作。" /> : null}
    {model.reading ? <ReadStateNotice state="loading" title="正在讀取檔案資料…" /> : null}
    {!currentReady ? <View style={styles.list}>
      {!model.reading ? <Text style={styles.meta}>目前檔案尚未核對，不能據此判斷沒有修改記錄。</Text> : null}
      <AppButton label="重新讀取檔案" variant="secondary" onPress={actions.refresh} disabled={locked} />
    </View> : !neverConfirmed ? <AppButton label={model.historyOpen ? "重新讀取修改歷史" : "讀取修改歷史"} variant="secondary" onPress={actions.showHistory} disabled={locked} /> : null}
    <HistoryCardGrid testID="profile-history-cards">{model.history.map(revision => <HistoryEntryCard key={revision.version} testID={`profile-history-version-${revision.version}`}
      cardRef={node => { if (node) cards.current.set(revision.version, node); else cards.current.delete(revision.version); }}
      accessibilityLabel={`查看檔案版本 ${revision.version}：${revision.reason ?? "確認記錄"}`}
      onPress={() => { returnFocus.current = cards.current.get(revision.version) ?? null; setSelection({ scope, version: revision.version }); }}>
      <Text numberOfLines={3} style={styles.title}>{revision.reason ?? "已確認的孩子檔案"}</Text>
      <Text numberOfLines={2} style={styles.body}>{revision.data?.source ?? "資料來源未知"}</Text>
      <Text style={styles.meta}>版本 {revision.version} · {revision.confirmedAtLabel ?? "確認時間未知"}</Text>
      <Text numberOfLines={1} style={styles.meta}>確認人：{revision.confirmedByLabel ?? "未知"}</Text>
    </HistoryEntryCard>)}</HistoryCardGrid>
    <FormDialog visible={!!selected} scopeKey={scope} formKey={selected?.version} title={`檔案版本 ${selected?.version ?? ""}`}
      returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={() => setSelection(null)}>
      {selected ? <ProfileRevisionSummary revision={selected} /> : null}
    </FormDialog>
    {emptyReady ? <EmptyListCard testID="profile-history-empty" title={neverConfirmed ? "尚未有檔案修改記錄" : model.hasMoreHistory ? "這一頁沒有較早版本" : "沒有較早的檔案版本"}
      detail={neverConfirmed ? "這位孩子的檔案尚未確認。" : model.hasMoreHistory ? "仍有較早版本未讀取，可繼續載入。" : "目前已讀取的版本範圍沒有較早記錄。"} /> : null}
    {model.historyOpen && model.hasMoreHistory ? <AppButton label="載入更早版本" variant="quiet" onPress={actions.loadOlderHistory} disabled={locked || !currentReady} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
