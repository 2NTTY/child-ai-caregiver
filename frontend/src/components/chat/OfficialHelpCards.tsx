import { Linking, View } from 'react-native';
import { Text } from 'react-native-paper';
import {
  AGENT_PROGRESS_LABELS,
  AGENT_PROGRESS_SOURCE_DISCLAIMER,
  AGENT_PROGRESS_SOURCE_STAGE_LABELS,
  OFFICIAL_HELP,
  formatProgressSourceDateText,
  type AgentProgressSource,
  type OfficialHelpId,
} from '../../../../src/shared/agent-feedback';
import { AppButton } from '../ui';

/** Published fixed content; no modal, diagnosis or inferred permission. */
export function OfficialHelpCards({ ids }: { ids: readonly OfficialHelpId[] }) {
  return <>{[...new Set(ids)].map(id => {
    const card = OFFICIAL_HELP[id]; if (!card) return null;
    return <View key={id} testID="official-help-card" accessibilityLabel={card.title} accessibilityLiveRegion="polite">
      <Text variant="titleSmall">{card.title}</Text><Text selectable>{card.text}</Text>
      {card.sources.map(source => <AppButton key={source.url} variant="quiet" density="compact" label={source.title}
        onPress={() => { void Linking.openURL(source.url).catch(() => {}); }} />)}
    </View>;
  })}</>;
}

const APPLICABILITY_NOTES: Record<NonNullable<AgentProgressSource['applicabilityStatus']>, string> = {
  conditional: '需視乎條件適用（尚待獨立核對回覆）',
  requires_clarification: '需補充孩子資料以確定適用性（尚待獨立核對回覆）',
};
const DEFAULT_UNREVIEWED_NOTE = '尚待獨立核對回覆';

/** Stage records retrieval, not excerpt provenance. Show metadata only until a verified quote is available. */
export function ProgressSourceCards({
  sources,
  reviewing = false,
  retainedAfterFailure = false,
}: {
  sources: readonly AgentProgressSource[];
  reviewing?: boolean;
  retainedAfterFailure?: boolean;
}) {
  if (!sources.length) return null;
  return <View testID="chat-progress-sources" accessibilityLiveRegion="polite">
    <Text variant="labelSmall">{AGENT_PROGRESS_SOURCE_DISCLAIMER}</Text>
    {retainedAfterFailure ? <Text testID="chat-progress-sources-retained-notice" variant="labelSmall">已保留今次檢索的官方來源預覽。正式回覆未完成或尚未通過核對，未核草稿不會作正式建議顯示。請查看上方狀態或重試。</Text> : null}
    {reviewing ? <Text testID="chat-progress-sources-reviewing" variant="labelSmall">{AGENT_PROGRESS_LABELS.reviewing}</Text> : null}
    {sources.map(source => {
      const dateText = formatProgressSourceDateText(source);
      return <View key={source.chunkId} testID="chat-progress-source-card" accessibilityLabel={`${source.publisher}：${source.title}`}>
        <Text variant="labelSmall">{AGENT_PROGRESS_SOURCE_STAGE_LABELS[source.stage]} · {source.applicabilityStatus ? APPLICABILITY_NOTES[source.applicabilityStatus] : DEFAULT_UNREVIEWED_NOTE}</Text>
        <Text variant="titleSmall">{source.publisher} · {source.title}</Text>
        {source.section && source.section !== source.title ? <Text variant="bodySmall">{source.section}</Text> : null}
        {dateText ? <Text variant="bodySmall">更新／檢查：{dateText}</Text> : null}
        {source.url ? <AppButton variant="quiet" density="compact" label="開啟官方來源"
          onPress={() => { void Linking.openURL(source.url!).catch(() => {}); }} /> : null}
      </View>;
    })}
  </View>;
}

