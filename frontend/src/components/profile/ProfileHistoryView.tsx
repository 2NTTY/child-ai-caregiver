import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { ProfileActions, ProfileViewModel } from "../../profile-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppButton, SectionCard } from "../ui";
import { EmptyListCard } from "../EmptyListCard";
import { ReadStateNotice } from "../ReadStateNotice";
import { ProfileRevisionSummary } from "./ProfileSummary";

// Read-only consumer of the existing child-scoped profile owner. No copied history,
// eager reads or client-side full-history search is introduced by the category.
export function ProfileHistoryView({ model, actions }: { model: ProfileViewModel; actions: ProfileActions }) {
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
  return <View style={styles.list} testID="profile-history">
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
    {model.history.map(revision => <SectionCard key={revision.version} testID={`profile-history-version-${revision.version}`}><ProfileRevisionSummary revision={revision} /></SectionCard>)}
    {emptyReady ? <EmptyListCard testID="profile-history-empty" title={neverConfirmed ? "尚未有檔案修改記錄" : model.hasMoreHistory ? "這一頁沒有較早版本" : "沒有較早的檔案版本"}
      detail={neverConfirmed ? "這位孩子的檔案尚未確認。" : model.hasMoreHistory ? "仍有較早版本未讀取，可繼續載入。" : "目前已讀取的版本範圍沒有較早記錄。"} /> : null}
    {model.historyOpen && model.hasMoreHistory ? <AppButton label="載入更早版本" variant="quiet" onPress={actions.loadOlderHistory} disabled={locked || !currentReady} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md, minWidth: 0 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
