import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { handoverSourceHistoryKey, type HandoverImportOwner, type HandoverSourceHistoryState } from '../../production/HandoverImportOwner';
import { AppButton } from '../ui';
import { chineseFont, colors, readingType, spacing } from '../../theme';

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const content = (value: Record<string, unknown>, key: string) => typeof value[key] === 'string' && value[key] ? value[key] as string : '未提供';
const factStates: Record<string, string> = { candidate: '待確認候選', confirmed: '已確認', inactive: '已停用' };
const topicStates: Record<string, string> = { pending: '待處理', answered: '已回答', snoozed: '已暫緩', resolved: '已解決' };
const sourcePurposes: Record<string, string> = { answer_reference: '回答參考', record_candidate: '記錄候選', track_topic: '追蹤話題' };
const revisionNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : '未提供';

/** Known source histories rendered as text without interpreting foreign references or markup. */
export function HandoverImportHistory({ controller, history, locked }: {
  controller: HandoverImportOwner; history: HandoverSourceHistoryState; locked: boolean;
}) {
  return <View style={styles.group}>
    <Text style={styles.title}>來源歷史（唯讀）</Text>
    <Text style={styles.body}>已讀取 {history.page} 頁 · {history.items.length} 項{history.loaded
      ? history.complete ? ' · 目前可讀範圍已讀完。' : ' · 仍有歷史未讀取。' : ' · 尚未確認完整度。'}</Text>
    {history.loading ? <Text accessibilityLiveRegion="polite" style={styles.body}>正在讀取來源歷史…</Text> : null}
    {history.error ? <Text accessibilityLiveRegion="polite" style={styles.body}>{history.error}</Text> : null}
    {history.loaded && !history.items.length ? <Text style={styles.body}>目前已讀頁面沒有可顯示的來源歷史。</Text> : null}
    {history.items.map(item => {
      const { module, value, source: provenance } = item.evidence, source = provenance.current.source;
      const factSource = object(value.source), original = factSource?.kind === 'imported' ? object(factSource.original) : factSource;
      const management = object(value.management);
      const messageIds = Array.isArray(value.coveredMessageIds) ? value.coveredMessageIds.filter((id): id is string => typeof id === 'string') : [];
      return <View key={handoverSourceHistoryKey(item)} style={styles.item}>
        <Text style={styles.title}>{module === 'memory_facts' ? '記憶事實來源歷史' : module === 'memory_topics' ? '記憶話題來源歷史' : module === 'private_sources' ? '私人來源管理歷史' : '外來摘要歷史'}</Text>
        <Text style={styles.body}>來源版本 {source.resourceVersion} · 本地接收版本 {item.resource.version}</Text>
        {module === 'memory_facts' ? <>
          <Text style={styles.body}>記憶欄目：{content(value, 'key')}</Text>
          <Text selectable style={styles.content}>{content(value, 'content')}</Text>
          <Text style={styles.body}>來源狀態：{factStates[String(value.status)] ?? '未提供'}</Text>
          {factSource ? <Text selectable style={styles.body}>來源描述：{content(factSource, 'description')}</Text> : null}
          {original && original !== factSource ? <Text selectable style={styles.body}>原來源描述：{content(original, 'description')}</Text> : null}
          <Text style={styles.body}>來源確認者：{content(value, 'confirmedBy')} · 時間：{content(value, 'confirmedAt')}</Text>
        </> : module === 'memory_topics' ? <>
          <Text style={styles.body}>來源話題：{content(value, 'title')}</Text>
          <Text selectable style={styles.content}>{content(value, 'note')}</Text>
          <Text style={styles.body}>來源狀態：{topicStates[String(value.status)] ?? '未提供'}</Text>
          <Text style={styles.body}>來源更新者：{content(value, 'updatedBy')} · 時間：{content(value, 'updatedAt')}</Text>
        </> : module === 'private_sources' ? <>
          <Text style={styles.body}>管理歷史，不是正文修訂；原摘錄不代表本地授權。</Text>
          <Text selectable style={styles.content}>原管理意圖：{management ? content(management, 'intention') : '未提供'}</Text>
          <Text style={styles.body}>原管理用途：{sourcePurposes[String(management?.purpose)] ?? '未提供'} · {management?.enabled === true ? '已啟用' : management?.enabled === false ? '已停用' : '啟用狀態未提供'}</Text>
          <Text selectable style={styles.content}>原模型摘錄：{management ? content(management, 'modelExcerpt') : '未提供'}</Text>
          <Text style={styles.body}>原管理版本：{revisionNumber(value.previousVersion)} → {revisionNumber(value.version)}</Text>
          <Text selectable style={styles.body}>變更原因：{content(value, 'reason')}</Text>
          <Text style={styles.body}>變更時間：{content(value, 'changedAt')}</Text>
        </> : <>
          <Text style={styles.body}>此為外來摘要歷史，覆蓋來源訊息，不是本地活動摘要。</Text>
          <Text selectable style={styles.content}>{content(value, 'text')}</Text>
          <Text style={styles.body}>來源建立時間：{content(value, 'createdAt')}</Text>
          <Text selectable style={styles.body}>原覆蓋訊息（外來識別）：{messageIds.length ? messageIds.join('、') : '未提供'}</Text>
          <Text selectable style={styles.body}>原最後覆蓋訊息：{content(value, 'lastCoveredMessageId')}</Text>
        </>}
        <Text selectable style={styles.body}>來源 Server：{source.serverId}</Text>
        <Text selectable style={styles.body}>來源帳戶：{source.accountId} · 孩子：{source.childId}</Text>
        <Text selectable style={styles.body}>來源項目：{source.resourceId}</Text>
      </View>;
    })}
    <View style={styles.actions}>
      <AppButton label="重新讀取來源歷史" variant="quiet" disabled={locked || history.loading} onPress={() => { void controller.readSourceHistory(); }} />
      {history.nextCursor ? <AppButton label="載入更多來源歷史" variant="quiet" disabled={locked || history.loading} onPress={() => { void controller.readSourceHistory(true); }} /> : null}
      <AppButton label="關閉來源歷史" variant="quiet" onPress={controller.closeSourceHistory} />
    </View>
  </View>;
}
const styles = StyleSheet.create({ group: { gap: spacing.md }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  content: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
});
