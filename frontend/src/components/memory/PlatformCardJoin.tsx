import { Text } from 'react-native-paper';
import { platformLibraryJoin } from '../../../../src/shared/personal-library';
import { useMemoryReferenceWorkspace } from '../../workspaces/MemoryReferenceWorkspace';
import { AppButton } from '../ui';

export function PlatformCardJoin({ seriesId, citation }: {
  seriesId: string; citation?: { sourceId: string; versionId: string };
}) {
  const workspace = useMemoryReferenceWorkspace();
  const references = workspace?.model.references;
  const save = workspace?.reads?.setLibraryPreference;
  if (!workspace || !save || references?.state !== 'ready' || references.data.hasMore) return null;
  const items = references.data.catalog?.filter(item => item.series?.id === seriesId) ?? [];
  if (citation && !items.some(item => item.sourceId === citation.sourceId && item.versionId === citation.versionId)) return null;
  const { series, preference } = items[0] ?? {};
  const join = platformLibraryJoin(items);
  if (!series || !preference || !join) return null;
  if (preference.mode !== 'platform') {
    const mode = preference.mode === 'fixed' ? '固定快照' : '跟隨同範圍更新';
    return <Text accessibilityLiveRegion="polite">已加入 · {mode}{preference.enabled ? '' : ' · 已停用'}</Text>;
  }
  return <AppButton label="免費加入平台卡" accessibilityLabel={`免費加入平台卡「${series.name}」`} density="compact" variant="secondary"
    disabled={!workspace.model.online || workspace.reads?.referencesBusy} onPress={() => save(join)} />;
}
