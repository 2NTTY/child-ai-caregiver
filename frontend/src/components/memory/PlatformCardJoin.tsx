import { Text } from 'react-native-paper';
import { platformLibraryJoin } from '../../../../src/shared/personal-library';
import { childHealthSeries } from '../../../../src/shared/source-series';
import { useMemoryReferenceWorkspace } from '../../workspaces/MemoryReferenceWorkspace';
import { AppButton } from '../ui';

export function PlatformCardJoin({ seriesId, citation }: {
  seriesId: string; citation?: { sourceId: string; versionId: string };
}) {
  const workspace = useMemoryReferenceWorkspace();
  const references = workspace?.model.references;
  const save = workspace?.reads?.setLibraryPreference;
  if (!workspace || !save || references?.state !== 'ready') return null;
  const catalogue = references.data.catalog ?? [];
  const target = citation && catalogue.find(item => item.sourceId === citation.sourceId && item.versionId === citation.versionId);
  const group = seriesId === childHealthSeries.id ? catalogue.find(item => item.childHealth)?.childHealth : target?.childHealth;
  if (group && (!citation || target?.childHealth)) {
    if (group.adopted === group.total) return <Text accessibilityLiveRegion="polite">已採用整個系列</Text>;
    return <AppButton label={group.adopted ? '採用其餘教材並跟隨更新' : '下載到我的參考資料'}
      accessibilityLabel={`下載平台卡「${childHealthSeries.name}」`} density="compact" variant="secondary"
      disabled={!workspace.model.online || workspace.reads?.referencesBusy}
      onPress={() => save({ action: 'manage', seriesId: childHealthSeries.id, operation: 'join', expectedState: group.stateHash })} />;
  }
  const items = catalogue.filter(item => item.series?.id === seriesId);
  if (citation && !items.some(item => item.sourceId === citation.sourceId && item.versionId === citation.versionId)) return null;
  const { series, preference } = items[0] ?? {};
  const join = platformLibraryJoin(items);
  if (!series || !preference || !join) return null;
  if (preference.mode !== 'platform') {
    const mode = preference.mode === 'fixed' ? '固定快照' : '跟隨同範圍更新';
    return <Text accessibilityLiveRegion="polite">已下載 · {mode}{preference.enabled ? '' : ' · 已停用'}</Text>;
  }
  return <AppButton label="下載到我的參考資料" accessibilityLabel={`下載平台卡「${series.name}」`} density="compact" variant="secondary"
    disabled={!workspace.model.online || workspace.reads?.referencesBusy} onPress={() => save(references.data.hasMore ? { ...join, wholeSeries: true } : join)} />;
}
