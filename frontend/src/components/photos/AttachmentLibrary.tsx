import type { Href } from 'expo-router';
import { PhotoEntryLink } from './PhotoEntryLink';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { PhotoItem, PhotosActions } from '../../photo-view-model';
import { chineseFont, colors, radius, readingType, spacing } from '../../theme';
import { AppIcon } from '../AppIcon';
import { AppStatusBadge } from '../AppStatusBadge';
import { HistoryEntryCard } from '../history/HistoryCards';
import { ReadStateNotice } from '../ReadStateNotice';
import { useContainerWidth } from '../useContainerWidth';
import { MotionList } from '../../motion';
import { AppButton } from '../ui';

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
export const ATTACHMENT_INDEX_WINDOW = 8;
const EMPTY_ATTACHMENTS: readonly AttachmentReviewItem[] = [];

function focusAttachment(node: View | null) {
  if (!node) return;
  if (Platform.OS === 'web') {
    const element = node as unknown as HTMLElement;
    if (!element.isConnected) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  } else node.focus();
}

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
export function PhotoGallery({ items, scopeKey, disabled, selectedId, openPhoto, photoHref, readThumbnail, rowRef, motionEligible = false }: {
  items: readonly PhotoItem[]; scopeKey: string; disabled: boolean; selectedId?: string;
  motionEligible?: boolean; photoHref?(id: string): Href; openPhoto(item: PhotoItem): void; readThumbnail?: PhotosActions['readThumbnail']; rowRef(id: string, node: View | null): void;
}) {
  const [window, setWindow] = useState(0);
  const last = Math.max(0, Math.ceil(items.length / PHOTO_READ_WINDOW) - 1), current = Math.min(window, last);
  const visible = items.slice(current * PHOTO_READ_WINDOW, (current + 1) * PHOTO_READ_WINDOW);
  return <View style={styles.stack}>
    <MotionList items={visible} keyExtractor={item => item.id} scopeKey={`${scopeKey}:window:${current}`} regionKey="photo-list" eligible={motionEligible} style={styles.gallery} itemStyle={styles.photoCell} testID="photo-list-motion" renderItem={(item, row) => {
      const content = <><PhotoThumbnail key={`${scopeKey}:${item.id}:${item.version}:${item.sha256}`} item={item} scopeKey={scopeKey} readThumbnail={row.exiting ? undefined : readThumbnail} />
        <View style={styles.photoCopy}><Text style={styles.title}>{item.fileName}</Text><Text style={styles.meta}>{item.createdAtLabel}</Text>
          <AppStatusBadge label={item.visibility === 'private' ? '私人' : '家庭共享'} tone="neutral" /></View></>;
      const label = `開啟照片：${item.visibility === 'private' ? '私人' : '共享'} · ${item.fileName}`;
      return photoHref ? <PhotoEntryLink ref={node => rowRef(item.id, node)} testID={`photo-item-${item.id}`} href={photoHref(item.id)}
        selected={item.id === selectedId} disabled={disabled || row.exiting} label={label} onOpen={() => {if (!row.exiting) openPhoto(item);}}>{content}</PhotoEntryLink>
        : <HistoryEntryCard cardRef={node => rowRef(item.id, node)} testID={`photo-item-${item.id}`} style={styles.photoCard}
          selected={item.id === selectedId} preserveFocusWhenDisabled disabled={disabled || row.exiting} accessibilityLabel={label} onPress={() => {if (!row.exiting) openPhoto(item);}}>{content}</HistoryEntryCard>;
    }} />
    {last > 0 ? <View style={styles.pager} testID="attachment-photo-pager">
      <AppButton label="上一組照片" variant="quiet" disabled={disabled || current === 0} onPress={() => setWindow(current - 1)} />
      <Text style={styles.meta}>第 {current + 1} 組</Text>
      <AppButton label="下一組照片" variant="quiet" disabled={disabled || current === last} onPress={() => setWindow(current + 1)} />
    </View> : null}
  </View>;
}

export function OriginalMediaLibrary({ page, kind, onChat }: { page?: AttachmentReviewPage; kind: 'voice' | 'file'; onChat?: () => void }) {
  const title = kind === 'voice' ? '語音' : '影片與文件';
  const { ref, onLayout, width } = useContainerWidth(), wide = width >= 760;
  const items = page?.items ?? EMPTY_ATTACHMENTS;
  const positions = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items]);
  const [window, setWindow] = useState(0), [readerId, setReaderId] = useState<string | null>(null);
  const selectedIndex = readerId ? positions.get(readerId) : undefined;
  const selected = selectedIndex === undefined ? null : items[selectedIndex];
  const last = Math.max(0, Math.ceil(items.length / ATTACHMENT_INDEX_WINDOW) - 1), current = Math.min(window, last);
  const visible = items.slice(current * ATTACHMENT_INDEX_WINDOW, (current + 1) * ATTACHMENT_INDEX_WINDOW);
  const rowRefs = useRef(new Map<string, View>()), indexHeading = useRef<View>(null), readerHeading = useRef<View>(null);
  const previousOrder = useRef(items.map(item => item.id)), readerFocused = useRef(false), rowFocused = useRef<string | null>(null);
  const previousReader = useRef<{ id: string; version: number } | null>(null), focusedOriginal = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<{ kind: 'reader' | 'index'; id: string | null } | null>(null);
  useLayoutEffect(() => {
    const before = previousReader.current;
    previousReader.current = selected ? { id: selected.id, version: selected.version } : null;
    if (Platform.OS === 'web' && selected && before?.id === selected.id && before.version !== selected.version
      && focusedOriginal.current && !focusedOriginal.current.isConnected && document.activeElement === document.body) {
      // Only the replaced original control lost focus. A surviving control or
      // another task's newer focus must not be pulled back into this reader.
      focusedOriginal.current = null;
      focusRequest.current = { kind: 'reader', id: selected.id };
    }
    const removed = readerId && !positions.has(readerId) ? readerId : rowFocused.current && !positions.has(rowFocused.current) ? rowFocused.current : null;
    if (removed) {
      const oldIndex = previousOrder.current.indexOf(removed);
      const nextId = [...previousOrder.current.slice(oldIndex + 1), ...previousOrder.current.slice(0, oldIndex).reverse()]
        .find(id => positions.has(id)) ?? items[0]?.id ?? null;
      if (readerFocused.current || rowFocused.current === removed) {
        focusRequest.current = { kind: 'index', id: nextId };
        setWindow(Math.floor((nextId ? positions.get(nextId) ?? 0 : 0) / ATTACHMENT_INDEX_WINDOW));
      }
      if (readerId === removed) setReaderId(null);
      rowFocused.current = null; readerFocused.current = false;
    }
    previousOrder.current = items.map(item => item.id);
    const request = focusRequest.current;
    // Wait for the requested reader/index to be committed, never focus a removed sibling.
    if (request?.kind === 'reader' && selected?.id === request.id && readerHeading.current) {
      focusRequest.current = null; focusAttachment(readerHeading.current);
    } else if (request?.kind === 'index' && (wide || !selected) && (request.id ? rowRefs.current.has(request.id) : indexHeading.current)) {
      focusRequest.current = null; focusAttachment(request.id ? rowRefs.current.get(request.id)! : indexHeading.current);
    }
  }, [items, positions, readerId, selected, current, wide]);
  const select = (id: string) => {
    if (selected?.id === id) { focusAttachment(readerHeading.current); return; }
    focusRequest.current = { kind: 'reader', id }; setReaderId(id);
  };
  const closeReader = () => {
    focusRequest.current = { kind: 'index', id: selected?.id ?? null };
    setWindow(Math.floor((selectedIndex ?? 0) / ATTACHMENT_INDEX_WINDOW)); setReaderId(null);
  };
  const state = !page ? 'unavailable' : page.state === 'ready' && !page.online ? 'stale' : page.state === 'ready' && !page.items.length && !page.hasMore ? 'empty' : page.state;
  return <View ref={ref} onLayout={onLayout} style={styles.stack} testID={`attachment-library-${kind}`}>
    <View style={styles.libraryHeading}><View style={styles.mediaCopy}>
      <Text accessibilityRole="header" aria-level={2} style={styles.libraryTitle}>{title}</Text>
      <Text style={styles.meta}>本人私人聊天的原附件</Text>
    </View>{onChat ? <AppButton label="前往聊天" variant="quiet" onPress={onChat} /> : null}</View>
    <ReadStateNotice state={state} message={page?.message || (!page ? '附件清單尚未接通；可返回原聊天查看。' : state === 'empty' ? `目前沒有可讀取的${title}附件。` : state === 'loading' ? `正在讀取${title}…` : state === 'error' ? '暫時未能讀取附件，請重新讀取。' : '')}>
      {page && ['error', 'unavailable', 'stale'].includes(state) ? <AppButton label={`重新讀取${title}`} variant="quiet" disabled={!page.online || page.busy && !page.refreshing} onPress={page.refresh} /> : null}
    </ReadStateNotice>
    <View style={[styles.mediaColumns, wide && styles.mediaColumnsWide]}>
      {wide || !selected ? <View style={[styles.mediaIndex, wide && selected && styles.mediaIndexAside]} testID="attachment-index">
        <View ref={indexHeading} tabIndex={-1} accessibilityRole="header" aria-level={3}><Text style={styles.indexTitle}>附件目錄</Text></View>
        {visible.map(item => <View key={item.id} onFocus={() => { rowFocused.current = item.id; }} onBlur={() => { rowFocused.current = null; }}>
          <HistoryEntryCard cardRef={node => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}
            testID={`attachment-index-${item.id}`} style={styles.mediaRow} selected={selected?.id === item.id}
            accessibilityLabel={`閱讀附件：${item.title}`} onPress={() => select(item.id)}>
            <Text style={styles.title}>{item.title}</Text><View style={styles.rowMeta}>
              <Text style={styles.meta}>{item.createdAtLabel}</Text><Text style={styles.meta}>{item.kind === 'video' ? '影片原檔 ' : ''}{item.sizeLabel}</Text>
            </View>
          </HistoryEntryCard>
        </View>)}
        {last > 0 ? <View style={styles.pager}>
          <AppButton label="上一組附件" variant="quiet" disabled={current === 0} onPress={() => setWindow(current - 1)} />
          <Text style={styles.meta}>第 {current + 1}／{last + 1} 組已載入附件</Text>
          <AppButton label="下一組附件" variant="quiet" disabled={current === last} onPress={() => setWindow(current + 1)} />
        </View> : null}
        {page?.hasMore ? <View style={styles.stack}>{!page.items.length ? <Text style={styles.meta}>這次尚未找到可顯示附件，可繼續讀取；不代表沒有其他附件。</Text> : null}
          <AppButton label={`載入更多${title}`} variant="quiet" disabled={!page.online || page.busy && !page.refreshing} loading={page.busy && !page.refreshing} onPress={page.loadMore} /></View> : null}
      </View> : null}
      {selected ? <View style={[styles.mediaReader, wide && styles.mediaReaderWide]} testID={`attachment-reader-${selected.id}`} onFocus={() => { readerFocused.current = true; }} onBlur={() => { readerFocused.current = false; }}>
        <AppButton label="返回附件目錄" variant="quiet" onPress={closeReader} />
        <View ref={readerHeading} tabIndex={-1} accessibilityRole="header" aria-level={3} testID="attachment-reader-heading"><Text style={styles.readerTitle}>{selected.title}</Text></View>
        <View style={styles.readerMeta}><Text style={styles.meta}>{selected.createdAtLabel}</Text><Text style={styles.meta}>{selected.sizeLabel}</Text><Text style={styles.meta}>來源：{selected.sourceLabel}</Text></View>
        {selected.kind === 'video' ? <Text style={styles.meta}>可下載原檔；這裏不播放或分析影片。</Text> : null}
        <View key={`${selected.id}:${selected.version}`} style={styles.originalBody}
          onFocus={event => { if (Platform.OS === 'web') focusedOriginal.current = event.target as unknown as HTMLElement; }}
          onBlur={() => { focusedOriginal.current = null; }}>{selected.content}</View>
      </View> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, minWidth: 0 }, gallery: { gap: 0, minWidth: 0 },
  photoCell: { width: '100%', minWidth: 0 }, photoCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, gap: spacing.md, borderWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line, borderRadius: 0 },
  thumbnail: { width: 76, height: 76, flexShrink: 0, backgroundColor: colors.canvas, borderRadius: radius.small, overflow: 'hidden' }, image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  photoCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, pager: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '700' }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  libraryHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  libraryTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '700' },
  mediaCopy: { flexGrow: 1, minWidth: 0, gap: spacing.xs },
  mediaColumns: { gap: spacing.xl, minWidth: 0 }, mediaColumnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mediaIndex: { flexGrow: 1, minWidth: 0, gap: spacing.md }, mediaIndexAside: { flexGrow: 0, flexBasis: 270, maxWidth: '40%' },
  indexTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: '600' },
  mediaRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm, minHeight: 72 },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  mediaReader: { minWidth: 0, gap: spacing.md }, mediaReaderWide: { flexGrow: 2, flexBasis: 0 },
  readerTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '700' },
  readerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, originalBody: { minWidth: 0 },
});
