import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { RegisteredSourceCard } from '../../../src/shared/registered-source-card';
import { CatalogChoice, LibraryAction, LibraryRow } from '../components/memory/SourceLibrary';
import { useDomainEnvironment } from './useDomainEnvironment';
import { createRegisteredSourceCardsApi, RegisteredSourceCardsError } from './registered-source-cards-api';

export function RegisteredSourceDirectory({ card }: { card: RegisteredSourceCard }) {
  const env = useDomainEnvironment();
  const api = useMemo(() => createRegisteredSourceCardsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const [filter, setFilter] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['production', env.scopeKey, env.identityKey, 'registered-documents', card.cardId, card.revision, card.lastCheckedAt],
    enabled: !!env.userId && env.online && !env.sharedMode,
    initialPageParam: undefined as string | undefined, retry: false, gcTime: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await api.documents(env.userId!, signal, card.cardId, pageParam);
      if (signal.aborted || !env.currentIdentity() || env.sharedMode) throw Error('Source card scope changed');
      return page;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
  }, env.queryClient);
  const items = [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.documentId, item])).values()];
  const labels = [...new Set(items.flatMap(item => item.categories.labels))];
  const selected = filter && labels.includes(filter) ? filter : null;
  if (!env.userId || env.sharedMode || !env.online || !env.currentIdentity()) return null;
  if (query.error instanceof RegisteredSourceCardsError && [401, 403, 404, 409].includes(query.error.status))
    return <Text>目前未能查閱這張卡的文件。</Text>;
  if (query.isError && !query.isFetchNextPageError) return <LibraryAction label="重新讀取文件目錄" onPress={() => { void query.refetch(); }} />;
  if (query.isPending) return <Text accessibilityLiveRegion="polite">正在讀取文件目錄…</Text>;
  if (!items.length) return <Text>暫未有已保存的文件。</Text>;
  return <View style={s.list}>
    {labels.length > 0 && <CatalogChoice label="分類" value={selected ?? ''}
      options={[{ value: '', label: '全部文件' }, ...labels.map(label => ({ value: label, label }))]}
      onChange={value => { setFilter(value || null); setOpened(null); setLinkError(false); }} />}
    {items.filter(item => !selected || item.categories.labels.includes(selected)).map(item => {
      const expanded = opened === item.documentId, categories = item.categories;
      const byline = categories.basis === 'publisher' ? '網站分類 · ' + categories.labels.join('、')
        : categories.basis === 'document' ? '按原文分類 · ' + categories.labels.join('、') : '未分類';
      return <View key={item.documentId}>
        <LibraryRow title={item.title} subtitle={byline} art="document" onOpen={() => {
          setOpened(expanded ? null : item.documentId); setLinkError(false);
        }} />
        {expanded && <View style={s.detail}>
          {categories.evidence && <Text>原文用詞「{categories.evidence}」</Text>}
          {!!item.preview && <Text selectable numberOfLines={5}>{item.preview}</Text>}
          <Pressable accessibilityRole="link" accessibilityLabel={'開啟原網站的' + item.title}
            {...(Platform.OS === 'web' ? { href: item.url, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } }
              : { onPress: () => { void Linking.openURL(item.url).catch(() => setLinkError(true)); } })}>
            <Text style={s.link}>開啟原網站</Text>
          </Pressable>
          {linkError && <Text>暫未能開啟原網站。</Text>}
        </View>}
      </View>;
    })}
    {query.hasNextPage && <LibraryAction label={query.isFetchNextPageError ? '重新載入更多文件' : '載入更多文件'}
      disabled={query.isFetching} onPress={() => { void query.fetchNextPage(); }} />}
  </View>;
}
const s = StyleSheet.create({
  list: { gap: 6 }, detail: { gap: 6, paddingHorizontal: 10 },
  link: { textDecorationLine: 'underline', paddingVertical: 6 },
});
