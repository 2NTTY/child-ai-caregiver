import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { PhotoItem, PhotosActions } from '../../photo-view-model';
import { chineseFont, colors, readingType, spacing } from '../../theme';
import { AppIcon } from '../AppIcon';
import { AppStatusBadge } from '../AppStatusBadge';
import { ReadTargetLink } from '../ReadTargetLink';
import { ReadStateNotice } from '../ReadStateNotice';
import { MotionList } from '../../motion';
import { AppButton, SectionHeader } from '../ui';

// Presentation projections only. The source owns authorization, paging and original-media reads.
export type AttachmentReviewItem = {
  id: string; kind: 'voice' | 'video' | 'file'; title: string; createdAtLabel: string;
  sizeLabel: string; sourceLabel: string; version: number; content: ReactNode;
};
export type AttachmentReviewPage = {
  items: readonly AttachmentReviewItem[]; state: 'loading' | 'ready' | 'error' | 'unavailable';
  message?: string; hasMore: boolean; busy: boolean; refreshing?: boolean; online: boolean;
  refresh(): void; loadMore(): void;
};
export type AttachmentReviewCollections = { voices: AttachmentReviewPage; files: AttachmentReviewPage };
export const PHOTO_READ_WINDOW = 4;

function PhotoThumbnail({ item, scopeKey, readThumbnail }: { item: PhotoItem; scopeKey: string; readThumbnail?: PhotosActions['readThumbnail'] }) {
  const host = useRef<View>(null), read = useRef(readThumbnail); read.current = readThumbnail;
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (item.imageSource || item.state !== 'ready' || !read.current) return;
    const request = new AbortController(); let started = false, released = false, local: { uri: string; dispose(): void } | null = null;
    const start = () => {
      if (started || released) return; started = true;
      void read.current!(item, request.signal).then(value => {
        if (released || request.signal.aborted) { value?.dispose(); return; }
        local = value; setUri(value?.uri ?? null);
      }).catch(() => { /* The full-card action remains available if a thumbnail cannot be read. */ });
    };
    const node = host.current as unknown as Element | null;
    const observer = Platform.OS === 'web' && typeof IntersectionObserver !== 'undefined' && node
      ? new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { start(); observer?.disconnect(); } }, { rootMargin: '80px' }) : null;
    if (observer && node) observer.observe(node); else start();
    return () => { released = true; observer?.disconnect(); request.abort(); local?.dispose(); setUri(null); };
  }, [scopeKey, item.id, item.version, item.sha256, item.state, item.imageSource, !!readThumbnail]);
  const source = item.imageSource ?? (uri ? { uri } : null);
  return <View ref={host} style={styles.thumbnail} testID={`attachment-thumbnail-${item.id}`}>
    {source ? <Image source={source} resizeMode="cover" accessibilityLabel={`${item.fileName}縮圖`} style={styles.image} />
      : <View style={styles.placeholder}><AppIcon name="image-outline" size={28} color={colors.teal} /><Text style={styles.meta}>{item.state === 'ready' ? '點開查看原圖' : '原圖待上傳'}</Text></View>}
  </View>;
}

/** At most four original-backed thumbnails are mounted; changing the window releases their URLs. */
export function PhotoGallery({ items, scopeKey, disabled, selectedId, initialPhotoId, openPhoto, readThumbnail, rowRef, motionEligible = false }: {
  items: readonly PhotoItem[]; scopeKey: string; disabled: boolean; selectedId?: string; initialPhotoId?: string;
  motionEligible?: boolean; openPhoto(item: PhotoItem): void; readThumbnail?: PhotosActions['readThumbnail']; rowRef(id: string, node: View | null): void;
}) {
  const [window, setWindow] = useState(() => Math.floor(Math.max(0, items.findIndex(item => item.id === initialPhotoId)) / PHOTO_READ_WINDOW));
  const last = Math.max(0, Math.ceil(items.length / PHOTO_READ_WINDOW) - 1), current = Math.min(window, last);
  const visible = items.slice(current * PHOTO_READ_WINDOW, (current + 1) * PHOTO_READ_WINDOW);
  return <View style={styles.stack}>
    <MotionList items={visible} keyExtractor={item => item.id} scopeKey={`${scopeKey}:window:${current}`} regionKey="photo-list" eligible={motionEligible} style={styles.gallery} itemStyle={styles.photoCell} testID="photo-list-motion" renderItem={(item, row) => <View>
      <ReadTargetLink ref={node => rowRef(item.id, node)} testID={`photo-item-${item.id}`} style={[styles.photoCard, item.id === selectedId && styles.selected]}
        href={{pathname: "/photos", params: {tab: "photos", photoId: item.id}}} preserveFocusWhenDisabled availability={disabled || row.exiting ? "unavailable" : "ready"} onOpen={() => {if (!disabled && !row.exiting) openPhoto(item);}}
        label={`開啟照片：${item.visibility === 'private' ? '私人' : '家庭共享'} · ${item.fileName}，${item.createdAtLabel}`}>
        <PhotoThumbnail key={`${scopeKey}:${item.id}:${item.version}:${item.sha256}`} item={item} scopeKey={scopeKey} readThumbnail={row.exiting ? undefined : readThumbnail} />
        <View style={styles.photoCopy}><Text style={styles.title} numberOfLines={2}>{item.fileName}</Text>
          <Text style={styles.meta}>{item.createdAtLabel}</Text>
          <AppStatusBadge label={item.visibility === 'private' ? '私人' : '家庭共享'} tone="neutral" />
        </View>
      </ReadTargetLink>
    </View>} />
    {last > 0 ? <View style={styles.pager} testID="attachment-photo-pager">
      <AppButton label="上一組照片" variant="quiet" disabled={disabled || current === 0} onPress={() => setWindow(current - 1)} />
      <Text style={styles.meta}>第 {current + 1} 組</Text>
      <AppButton label="下一組照片" variant="quiet" disabled={disabled || current === last} onPress={() => setWindow(current + 1)} />
    </View> : null}
  </View>;
}

function OriginalMediaRow({ item }: { item: AttachmentReviewItem }) {
  return <View style={styles.mediaRow} testID={`attachment-${item.kind}-${item.id}`}>
    <View style={styles.mediaHeader}><AppIcon name={item.kind === 'voice' ? 'microphone-outline' : item.kind === 'video' ? 'paperclip' : 'file-document-outline'} size={24} color={colors.teal} />
      <View style={styles.mediaCopy}><Text accessibilityRole="header" aria-level={3} style={styles.title}>{item.title}</Text>
        <Text style={styles.meta}>{item.kind === 'voice' ? '語音' : item.kind === 'video' ? '影片原檔' : '文件'} · {item.sizeLabel} · 本人</Text>
        <Text style={styles.body}>來源：{item.sourceLabel}</Text><Text style={styles.meta}>附件建立於 {item.createdAtLabel}</Text>
      </View>
    </View>
    {item.kind === 'video' ? <Text style={styles.body}>可下載原檔；這裏不播放或分析影片。</Text> : null}
    {item.content}
  </View>;
}

export function OriginalMediaLibrary({ page, kind, onChat }: { page?: AttachmentReviewPage; kind: 'voice' | 'file'; onChat?: () => void }) {
  const title = kind === 'voice' ? '語音' : '影片與文件';
  const state = !page ? 'unavailable' : page.state === 'ready' && !page.online ? 'stale' : page.state === 'ready' && !page.items.length && !page.hasMore ? 'empty' : page.state;
  return <View style={styles.stack} testID={`attachment-library-${kind}`}>
    <SectionHeader density="compact" title={title} icon={kind === 'voice' ? 'microphone-outline' : 'file-document-outline'} />
    <Text style={styles.body}>這裏保留私人聊天的原附件；可直接播放或下載，不必另行提取。</Text>
    {onChat ? <ReadTargetLink label="前往聊天" href="/chat" onOpen={onChat} style={styles.chatLink}><Text style={[styles.body, styles.linkText]}>前往聊天</Text></ReadTargetLink> : null}
    <ReadStateNotice state={state} message={page?.message || (!page ? '附件清單尚未接通；可返回原聊天查看。' : state === 'empty' ? `目前沒有可讀取的${title}附件。` : state === 'loading' ? `正在讀取${title}…` : state === 'error' ? '暫時未能讀取附件，請重新讀取。' : '')}>
      {page && ['error', 'unavailable', 'stale'].includes(state) ? <AppButton label={`重新讀取${title}`} variant="quiet" disabled={!page.online || page.busy && !page.refreshing} onPress={page.refresh} /> : null}
    </ReadStateNotice>
    {page?.items.map(item => <OriginalMediaRow key={item.id} item={item} />)}
    {page?.hasMore ? <View style={styles.stack}>{!page.items.length ? <Text style={styles.body}>這次尚未找到可顯示附件，可繼續讀取；不代表沒有其他附件。</Text> : null}
      <AppButton label={`載入更多${title}`} variant="quiet" disabled={!page.online || page.busy && !page.refreshing} loading={page.busy && !page.refreshing} onPress={page.loadMore} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, minWidth: 0 }, gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  photoCell: { flexBasis: 200, flexGrow: 1, minWidth: 0, maxWidth: '100%' }, photoCard: { minHeight: 44, minWidth: 0, paddingBottom: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine }, selected: { backgroundColor: colors.quietSurface },
  thumbnail: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.canvas }, image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  photoCopy: { paddingHorizontal: spacing.xs, gap: spacing.xs }, pager: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: '700' }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  mediaRow: { minWidth: 0, gap: spacing.sm, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  mediaHeader: { flexDirection: 'row', gap: spacing.md, minWidth: 0 }, mediaCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  chatLink: { alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: spacing.xs }, linkText: { color: colors.teal, textDecorationLine: 'underline' },
});
