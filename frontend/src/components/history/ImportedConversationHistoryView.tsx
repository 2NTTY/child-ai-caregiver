import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { personalHistoryDateMatches, type HistoryDateRange } from '../../history-view-model';
import { memoryDateLabel } from '../../memory-reference-view-model';
import { useImportedChatHistory } from '../../production/useImportedChatHistory';
import { chineseFont, colors, readingType, spacing } from '../../theme';
import { BackgroundSurface } from '../appearance/BackgroundSurface';
import { EmptyListCard } from '../EmptyListCard';
import { FormDialog } from '../FormDialog';
import { ReadStateNotice } from '../ReadStateNotice';
import { AppButton } from '../ui';
import { HistoryCardGrid, HistoryEntryCard } from './HistoryCards';
import { ImportedChatAttachment } from './ImportedChatAttachment';

export function ImportedConversationHistoryView({ searchText, dateRange }: { searchText: string; dateRange: HistoryDateRange }) {
  const read = useImportedChatHistory(), filterKey = JSON.stringify([searchText, dateRange.from, dateRange.to]);
  const [openedFilter, setOpenedFilter] = useState(filterKey);
  const listRef = useRef<View>(null), returnFocus = useRef<View>(null), cards = useRef(new Map<string, View>());
  useEffect(() => { read.close(); }, [filterKey]);
  const query = searchText.trim().toLocaleLowerCase();
  const rows = read.items.filter(item => personalHistoryDateMatches(item.message.createdAt, dateRange)
    && (!query || item.message.text.toLocaleLowerCase().includes(query)));
  const visible = read.selectedId !== null && openedFilter === filterKey;
  const detail = visible ? read.detail : null, source = detail?.importedFrom.current;
  return <View ref={listRef} tabIndex={-1} accessibilityLabel="匯入對話歷史" style={styles.list}>
    <BackgroundSurface padded>
      <Text style={styles.meta}>以下是匯入資料包的來源歷史。來源模型回覆並非本地確認或新建議；這裏只供查閱。</Text>
      <Text style={styles.meta}>搜尋與日期只篩已載入頁面，每頁最多 20 則。已載入 {read.items.length} 則{read.phase !== 'ready' ? '；尚未完成讀取。' : read.hasMore ? '，尚有記錄未載入。' : '；目前沒有下一頁。'}</Text>
    </BackgroundSurface>
    {read.phase === 'loading' ? <ReadStateNotice state="loading" title="正在讀取匯入對話…" /> : null}
    {read.phase === 'error' || read.phase === 'unavailable' ? <ReadStateNotice state={read.phase} title={read.error ?? '匯入對話歷史暫未提供'}>
      <AppButton label="重新讀取匯入對話" variant="secondary" disabled={!read.online || read.busy} onPress={read.refresh} />
    </ReadStateNotice> : null}
    {read.phase === 'ready' ? <>
      <HistoryCardGrid testID="imported-conversation-cards">{rows.map(item => <HistoryEntryCard key={item.id} testID={`imported-chat-${item.id}`}
        cardRef={node => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id); }}
        accessibilityLabel={`閱讀${item.message.role === 'model' ? '來源模型回覆' : '來源使用者訊息'}：${item.message.text.slice(0, 100) || '附件'}`}
        disabled={!read.online || read.detailLoading} onPress={() => {
          returnFocus.current = cards.current.get(item.id) ?? null; setOpenedFilter(filterKey); read.open(item);
        }}>
        <Text numberOfLines={4} style={styles.body}>{item.message.text || '來源附件訊息'}</Text>
        <Text style={styles.meta}>{item.message.role === 'model' ? '來源模型回覆（歷史）' : '來源使用者訊息'} · {memoryDateLabel(item.message.createdAt)}</Text>
        <Text style={styles.meta}>{item.importedFrom.current.source.serverId} · {item.importedFrom.current.source.accountId}</Text>
      </HistoryEntryCard>)}</HistoryCardGrid>
      {!rows.length ? <EmptyListCard testID="imported-conversation-empty" title={read.items.length ? '已載入頁面沒有符合篩選的對話' : '已載入頁面沒有匯入對話'}
        detail={read.hasMore ? '仍有記錄未載入，可繼續載入。' : undefined} /> : null}
      {read.hasMore ? <AppButton label={read.busy ? '正在讀取…' : '載入更多匯入對話'} variant="secondary" disabled={!read.online || read.busy} onPress={read.loadMore} /> : null}
    </> : null}
    <FormDialog visible={visible} scopeKey={read.scopeKey} formKey={read.selectedId ?? undefined} title="匯入對話原文"
      dismissMode="local" returnFocusRef={returnFocus} fallbackFocusRef={listRef} onClose={read.close}>
      {visible && read.detailLoading ? <ReadStateNotice state="loading" title="正在核對來源歷史…" /> : null}
      {visible && read.detailError ? <ReadStateNotice state="error" title={read.detailError} /> : null}
      {detail && source ? <View style={styles.list} testID="imported-conversation-detail">
        <Text style={styles.meta}>{detail.message.role === 'model' ? '來源模型回覆（歷史）' : '來源使用者訊息'} · {memoryDateLabel(detail.message.createdAt)}</Text>
        {detail.message.text ? <Text selectable style={styles.body}>{detail.message.text}</Text> : null}
        <ImportedChatAttachment item={detail} />
        <Text selectable style={styles.meta}>原作者：{detail.message.authorUserId ?? '來源模型'}{`\n`}原訊息 ID：{detail.message.id}{detail.message.inReplyTo ? `\n原回覆對象 ID：${detail.message.inReplyTo}` : ''}</Text>
        <Text selectable style={styles.meta}>來源：{source.source.serverId}{`\n`}來源帳戶：{source.source.accountId}{`\n`}來源孩子 ID：{source.source.childId}{`\n`}來源記錄 ID：{source.source.resourceId} · 版本 {source.source.resourceVersion}</Text>
        <Text style={styles.meta}>匯入時間：{memoryDateLabel(source.importedAt)}{detail.importedFrom.previous.length ? ` · 保留 ${detail.importedFrom.previous.length} 段較早來源` : ''}</Text>
      </View> : null}
    </FormDialog>
  </View>;
}
const styles = StyleSheet.create({ list: { gap: spacing.md, minWidth: 0 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
