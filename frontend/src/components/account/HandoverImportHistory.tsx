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
const concernStates: Record<string, string> = { following: '持續關注', closed: '已結束' };
const concernKinds: Record<string, string> = { observation: '原觀察', confirmed_action: '來源已確認行動' };
const growthStates: Record<string, string> = { proposed: '待處理', snoozed: '已暫緩', accepted: '已接受', dismissed: '已忽略', inapplicable: '不適用' };
const growthTopics: Record<string, string> = { solid_food: '引入固體食物', toddler_play: '幼兒遊戲與溝通', preschool_development: '學前發展觀察', school_vision: '學童視力關注' };
const growthKinds: Record<string, string> = { observe: '留意觀察', arrange: '安排事項', consult: '諮詢專業意見' };
const growthActions: Record<string, string> = { accept: '接受', snooze: '暫緩', dismiss: '忽略', proposed: '提出建議', snooze_due: '暫緩到期',
  topic_disabled: '停用主題', basis_unavailable: '適用依據已變更', imported_context_unavailable: '匯入資料未符合目前適用條件' };
const taskStates: Record<string, string> = { scheduled: '已安排', completed: '已完成', cancelled: '已取消', needs_review: '待核對' };
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
      const attention = object(value.item), growthSource = object(attention?.source), growthEvidence = object(attention?.evidence);
      const growthFacts = Array.isArray(growthEvidence?.facts) ? growthEvidence.facts.map(object).filter((fact): fact is Record<string, unknown> => fact !== null) : [];
      const period = object(value.period);
      const questions = Array.isArray(value.questions) ? value.questions.filter((question): question is string => typeof question === 'string') : [];
      const checklist = Array.isArray(value.checklist) ? value.checklist.map(object).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
      const key = handoverSourceHistoryKey(item), reading = history.documentContent?.key === key ? history.documentContent : null;
      const messageIds = Array.isArray(value.coveredMessageIds) ? value.coveredMessageIds.filter((id): id is string => typeof id === 'string') : [];
      return <View key={key} style={styles.item}>
        <Text style={styles.title}>{module === 'memory_facts' ? '記憶事實來源歷史' : module === 'memory_topics' ? '記憶話題來源歷史' : module === 'private_sources' ? '私人來源管理歷史'
          : module === 'documents' ? '文件來源修訂' : module === 'visit_preparation' ? '到診準備來源歷史'
          : module === 'growth_attention' ? '成長事項來源歷史' : module === 'growth_topics' ? '成長主題設定來源歷史'
          : module === 'concerns' ? source.section === 'concern_events' ? '關注來源事件' : '關注來源歷史' : '外來摘要歷史'}</Text>
        <Text style={styles.body}>來源版本 {source.resourceVersion} · {module === 'documents' ? '匯入綁定版本' : '本地接收版本'} {item.resource.version}</Text>
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
        </> : module === 'visit_preparation' ? <>
          <Text style={styles.body}>原核對狀態只作來源記錄，不代表本地已核對。</Text>
          <Text style={styles.body}>原核對狀態：{value.reviewed === true ? '原已核對' : value.reviewed === false ? '原未核對' : '未提供'}</Text>
          {questions.map((question, index) => <Text key={`question-${index}`} selectable style={styles.content}>原問題 {index + 1}：{question}</Text>)}
          {checklist.map((entry, index) => <Text key={`check-${index}`} selectable style={styles.content}>原清單 {index + 1}（{entry.done === true ? '原已完成' : '原未完成'}）：{content(entry, 'text')}</Text>)}
          <Text selectable style={styles.body}>原核對基準：{content(value, 'reviewedBasis')}</Text>
          {period ? <Text style={styles.body}>原期間：{content(period, 'startDay')} · {period.period === 'day' ? '一日' : period.period === 'week' ? '一週' : '未提供'} · {content(period, 'timeZone')}</Text> : null}
          <Text selectable style={styles.body}>原預約待辦（外來識別）：{content(value, 'appointmentTaskId')}</Text>
          <Text style={styles.body}>來源更新者：{content(value, 'updatedBy')} · 時間：{content(value, 'updatedAt')}</Text>
        </> : module === 'growth_attention' || module === 'growth_topics' ? <>
          <Text style={styles.body}>原狀態、資料與行動只作來源記錄，不代表本地用戶已確認或再次執行；來源建議須按目前資料重新核對適用性。</Text>
          <Text style={styles.body}>原主題：{growthTopics[String(module === 'growth_topics' ? value.topicId : attention?.topicId)] ?? '未提供'}</Text>
          {module === 'growth_attention' && attention ? <>
            <Text selectable style={styles.content}>{content(attention, 'title')}</Text>
            <Text style={styles.body}>原狀態：{growthStates[String(attention.state)] ?? '未提供'} · 原建議種類：{growthKinds[String(attention.kind)] ?? '未提供'}</Text>
            <Text selectable style={styles.content}>原原因：{content(attention, 'whyNow')}</Text>
            <Text selectable style={styles.content}>原建議：{content(attention, 'advice')}</Text>
            <Text selectable style={styles.content}>原限制：{content(attention, 'limits')}</Text>
            <Text selectable style={styles.content}>原處理記錄：{content(attention, 'note')}</Text>
            <Text style={styles.body}>原最後行動：{growthActions[String(attention.lastAction)] ?? content(attention, 'lastAction')}</Text>
            <Text style={styles.body}>來源行動者：{content(attention, 'actorUserId')} · 原建立時間：{content(attention, 'createdAt')} · 更新時間：{content(attention, 'updatedAt')}</Text>
            {typeof attention.snoozeUntil === 'string' ? <Text style={styles.body}>原暫緩至：{attention.snoozeUntil}</Text> : null}
            <Text selectable style={styles.body}>原關聯待辦（外來識別）：{content(attention, 'taskId')} · 原狀態：{taskStates[String(attention.taskState)] ?? '未提供'}</Text>
            <Text style={styles.body}>原資料依據：孩子資料版本 {revisionNumber(growthEvidence?.profileVersion)}</Text>
            {growthFacts.map((fact, index) => <Text key={`growth-fact-${index}`} selectable style={styles.body}>原記憶依據（外來識別）：{content(fact, 'id')} · 版本 {revisionNumber(fact.version)}</Text>)}
            {growthSource ? <>
              <Text selectable style={styles.body}>原建議來源：{content(growthSource, 'title')} · {content(growthSource, 'url')}</Text>
              <Text selectable style={styles.content}>原來源摘錄：{content(growthSource, 'excerpt')}</Text>
              <Text style={styles.body}>原來源核對時間：{content(growthSource, 'checkedAt')} · 原可用狀態：{attention.sourceAvailable === true ? '原可用' : attention.sourceAvailable === false ? '原不可用' : '未提供'}</Text>
            </> : null}
          </> : module === 'growth_topics' ? <>
            <Text style={styles.body}>原主題設定：{value.disabled === true ? '已停用' : value.disabled === false ? '已啟用' : '未提供'}</Text>
            <Text style={styles.body}>來源設定者：{content(value, 'actor')} · 時間：{content(value, 'at')}</Text>
          </> : <Text style={styles.body}>未有可顯示的來源事項內容。</Text>}
        </> : module === 'concerns' ? <>
          <Text selectable style={styles.content}>{content(value, 'title')}</Text>
          {source.section === 'concern_events' ? <>
            <Text style={styles.body}>事件種類：{concernKinds[String(value.kind)] ?? '未提供'}</Text>
            <Text selectable style={styles.content}>{content(value, 'text')}</Text>
            <Text selectable style={styles.body}>原來源：{content(value, 'sourceLabel')}</Text>
            <Text style={styles.body}>來源作者：{content(value, 'actorUserId')} · 時間：{content(value, 'at')}</Text>
            <Text style={styles.body}>原行動只作來源記錄，不代表本地用戶已確認或再次執行。</Text>
          </> : <>
            <Text selectable style={styles.content}>{content(value, 'reason')}</Text>
            <Text style={styles.body}>來源狀態：{concernStates[String(value.status)] ?? '未提供'}{typeof value.archivedAt === 'string' ? ' · 原已歸檔' : ''}</Text>
            <Text style={styles.body}>來源建立時間：{content(value, 'createdAt')} · 更新時間：{content(value, 'updatedAt')}</Text>
          </>}
        </> : module === 'documents' ? <>
          <Text style={styles.body}>原文件內容與引用只作來源記錄，不代表目前孩子已核對或完整資料。</Text>
          <Text selectable style={styles.body}>來源修訂識別：{content(value, 'snapshotId')} · 版本 {revisionNumber(value.snapshotVersion)}</Text>
          <Text style={styles.body}>來源建立時間：{content(value, 'generatedAt')}</Text>
          {value.invalidated === true ? <Text style={styles.body}>此來源修訂已失效，正文不予顯示。</Text> : <AppButton label={reading ? '重新讀取原文件正文' : '閱讀原文件正文'} variant="quiet"
            disabled={locked} onPress={() => { void controller.openDocumentContent(key); }} />}
          {reading ? <View style={styles.group}>
            <Text style={styles.body}>已讀取 {reading.complete ? reading.totalCharacters : reading.text.length}／{reading.totalCharacters ?? '待確認'} 字元{reading.complete ? ' · 原正文已完整讀取。' : ' · 尚未完整。'}</Text>
            {reading.documentVersion !== null ? <Text style={styles.body}>目前讀取文件版本 {reading.documentVersion}</Text> : null}
            {reading.loading ? <Text accessibilityLiveRegion="polite" style={styles.body}>正在讀取原文件正文…</Text> : null}
            {reading.error ? <Text accessibilityLiveRegion="polite" style={styles.body}>{reading.error}</Text> : null}
            {reading.invalidated ? <Text style={styles.body}>此來源修訂已失效，正文已清除；請重新讀取來源歷史。</Text> : null}
            {!reading.complete && !reading.invalidated && !reading.error && reading.nextOffset !== null ? <AppButton label="繼續讀取原文件正文" variant="quiet" disabled={locked || reading.loading}
              onPress={() => { void controller.readDocumentContent(); }} /> : null}
            {reading.complete && reading.snapshot ? <View style={styles.group}>
              <Text selectable style={styles.title}>{reading.snapshot.title}</Text>
              <Text selectable style={styles.content}>{reading.snapshot.summary}</Text>
              <Text style={styles.body}>原期間：{reading.snapshot.period.from} 至 {reading.snapshot.period.to}{reading.snapshot.ageLabel ? ` · ${reading.snapshot.ageLabel}` : ''}</Text>
              <Text selectable style={styles.body}>{reading.snapshot.coverageNote}</Text>
              {reading.snapshot.sections.map(section => <View key={section.id} style={styles.group}>
                <Text selectable style={styles.title}>{section.title}</Text>
                {section.items.map(entry => <Text key={entry.id} selectable style={styles.content}>{entry.checked === undefined ? '' : entry.checked ? '原已勾選：' : '原未勾選：'}{entry.text}</Text>)}
              </View>)}
              {reading.snapshot.sources.map(entry => <View key={entry.id} style={styles.group}>
                <Text selectable style={styles.body}>原引用：{entry.label}</Text><Text selectable style={styles.content}>{entry.text}</Text>
              </View>)}
              {reading.snapshot.changes.map((change, index) => <Text key={`change-${index}`} selectable style={styles.body}>{change}</Text>)}
            </View> : null}
            <AppButton label="關閉原文件正文" variant="quiet" onPress={controller.closeDocumentContent} />
          </View> : null}
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
