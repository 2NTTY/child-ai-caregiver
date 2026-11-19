import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SourceReading } from '../../../src/shared/source-card-reading';
import { AppDialog } from '../components/AppDialog';
import { SourceDocumentCard } from '../components/memory/SourceDocumentCard';
import { AppButton } from '../components/ui';
import { useDomainEnvironment } from './useDomainEnvironment';
import { createRegisteredSourceCardsApi } from './registered-source-cards-api';

type Reading = Awaited<ReturnType<ReturnType<typeof createRegisteredSourceCardsApi>['reading']>>;

export function RegisteredReadingCard({ target, active }: { target: SourceReading; active: boolean }) {
  const router = useRouter();
  const env = useDomainEnvironment();
  const api = useMemo(() => createRegisteredSourceCardsApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const [value, setValue] = useState<Reading | null>(null);
  const [error, setError] = useState(false);
  const [opened, setOpened] = useState(false);
  const active = useRef<AbortController | null>(null);
  // The parent keys the component by the immutable location and remounts it on a scope change.
  const location = useRef(target).current;
  const { current, currentIdentity, online, sharedMode, userId } = env;
  const load = useCallback(() => {
    active.current?.abort();
    setValue(null);
    setError(false);
    if (!userId || !online || sharedMode || !current() || !currentIdentity()) return;
    const request = new AbortController();
    active.current = request;
    const visible = () => !request.signal.aborted && current() && currentIdentity();
    void api.reading(userId, request.signal, location).then(read => {
      if (visible()) setValue(read);
    }).catch(() => { if (visible()) setError(true); });
  }, [api, current, currentIdentity, online, sharedMode, userId, location]);
  useFocusEffect(useCallback(() => {
    if (!active) return;
    load();
    return () => { active.current?.abort(); setOpened(false); setValue(null); };
  }, [active, load]));
  if (!userId || sharedMode) return null;
  const title = value?.title ?? '來源卡';
  const byline = [location.page ? '第 ' + location.page + ' 頁' : null, value?.kind === 'visual_description' ? '圖像描述' : null].filter(Boolean).join(' · ');
  const content = value?.excerpt ?? (error ? '暫未能讀取這份引用' : !online ? '連線後可讀取引用' : '正在讀取引用…');
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={'查看' + title} onPress={() => { setOpened(true); load(); }}>
      <SourceDocumentCard title={title} byline={byline}><Text numberOfLines={3}>{content}</Text></SourceDocumentCard>
    </Pressable>
    <AppDialog visible={opened} onDismiss={() => setOpened(false)} accessibilityLabel={title}>
      <AppDialog.ScrollArea><ScrollView>
        <SourceDocumentCard title={title} byline={byline}><Text selectable>{content}</Text></SourceDocumentCard>
      </ScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions>
        {value && <AppButton label="查看來源卡" onPress={() => {
          setOpened(false);
          router.push({ pathname: '/memory', params: { sourceCard: location.cardId } });
        }} variant="secondary" />}
        <AppButton label="關閉" onPress={() => setOpened(false)} variant="quiet" />
      </AppDialog.Actions>
    </AppDialog>
  </>;
}
