import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from "react";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";
import { Linking, Pressable, ScrollView, StyleSheet, View, type ScrollView as NativeScrollView, type StyleProp, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import type { ChatCitationView } from "../../chat-view-model";
import { colors, spacing } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { SourceDocumentCard } from "../memory/SourceDocumentCard";
import { PlatformCardJoin } from '../memory/PlatformCardJoin';
import { CitationMarker } from "./CitationMarker";
import { chatColors, chatFont, chatLayout, chatType } from "./chat-presentation";

import { CHAT_CLASSIFICATION_LABELS, CHAT_LIVE_ACQUISITION_BADGE, CHAT_LIVE_SOURCE_KIND_LABELS, CHAT_SOURCE_COPY } from "./chat-copy";

type CitationOrigin = { sourceId: string; anchor: RefObject<View | null> };
const CitationContext = createContext<{ sources: readonly ChatCitationView[]; locate(id: string, anchor?: RefObject<View | null>): void } | null>(null);
export type LocateAnswerSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => void;
const classificationLabels = CHAT_CLASSIFICATION_LABELS;
function liveSourceLabel(source: ChatCitationView): string {
  const kind = source.liveSourceKind ? CHAT_LIVE_SOURCE_KIND_LABELS[source.liveSourceKind] : classificationLabels[source.classification];
  return `${CHAT_LIVE_ACQUISITION_BADGE} · ${kind}`;
}
function sourceTime(value: string | null): string {
  return !value ? CHAT_SOURCE_COPY.missingTime : Number.isFinite(Date.parse(value))
    ? `${new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`
    : CHAT_SOURCE_COPY.invalidTime;
}
function websiteUrl(source: ChatCitationView): string | null {
  try {
    const url = new URL(source.url ?? '');
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const page = source.excerptPage ?? source.pageStart;
    if (!url.hash && page) url.hash = 'page=' + page;
    else if (!url.hash && source.readSegments?.some(part => part.includes(source.excerpt)) && source.excerpt.trim())
      url.hash = ':~:text=' + encodeURIComponent(source.excerpt.trim());
    return url.href;
  } catch { return null; }
}
function Detail({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return <View style={styles.detail}><Text style={styles.meta}>{label}</Text><Text selectable style={technical ? styles.meta : styles.body}>{value}</Text></View>;
}

function CitationReference({ number, source, locate }: { number: number; source: ChatCitationView; locate(id: string, anchor: RefObject<View | null>): void }) {
  const anchor = useRef<View>(null);
  const live = source.acquisition === 'live';
  return <CitationMarker ref={anchor} number={number} live={live}
    label={`查看引用【${number}】${live ? `（${CHAT_LIVE_ACQUISITION_BADGE}）` : ''}：${source.title}`}
    onPress={() => locate(source.id, anchor)} />;
}

export function CitationText({ children, style, careCitationCount = 0, onOpenCareCitation, materialCount = 0, onOpenMaterial }: {
  materialCount?:number; onOpenMaterial?:(ordinal:number)=>void;
  children: string; style?: StyleProp<TextStyle>; careCitationCount?: number; onOpenCareCitation?: (ordinal: number) => void;
}) {
  const context = useContext(CitationContext);
  if (!context && !onOpenCareCitation && !onOpenMaterial) return <Text selectable style={style}>{children}</Text>;
  const parts: ReactNode[] = [];
  const pattern = /【([1-9]\d*)】|\[([1-9]\d*)\]|\[(照護記錄|孩子資料) ([1-9]\d*)\]/g;
  let offset = 0;
  for (const match of children.matchAll(pattern)) {
    if (match[3]) {
      const ordinal = Number(match[4]);
      const care = match[3] === '照護記錄', open = care ? onOpenCareCitation : onOpenMaterial;
      if (!open || !Number.isSafeInteger(ordinal) || ordinal > (care ? careCitationCount : materialCount)) continue;
      const position = match.index!;
      parts.push(children.slice(offset, position));
      parts.push(<CitationMarker key={position} number={ordinal} markerText={match[0]} label={`查看${match[3]} ${ordinal} 原文`}
        onPress={() => open(ordinal)} />);
      offset = position + match[0].length;
      continue;
    }
    const sourceNumber = Number(match[1] ?? match[2]);
    const source = context?.sources[sourceNumber - 1];
    if (!source) continue;
    const position = match.index!;
    parts.push(children.slice(offset, position));
    parts.push(<CitationReference key={position} number={sourceNumber} source={source} locate={context!.locate} />);
    offset = position + match[0].length;
  }
  parts.push(children.slice(offset));
  return <Text selectable style={style}>{parts}</Text>;
}

function pageLabel(source: ChatCitationView) {
  if (source.excerptPage) return `第 ${source.excerptPage} 頁`;
  if (!source.pageStart) return null;
  return source.pageEnd && source.pageEnd !== source.pageStart
    ? `第 ${source.pageStart}–${source.pageEnd} 頁` : `第 ${source.pageStart} 頁`;
}

function OriginalCard({ source, onClose, onOpenSource }: { source: ChatCitationView; onClose(): void; onOpenSource?: (id: string) => void }) {
  const [showMetadata, setShowMetadata] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const external = websiteUrl(source);
  const page = pageLabel(source);
  const original = source.readSegments?.filter(Boolean) ?? [];
  return <AppDialog visible accessibilityLabel={source.title} onDismiss={onClose}>
    <AppDialog.ScrollArea style={styles.scrollArea}><ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      <SourceDocumentCard title={source.title} byline={[source.publisher, source.acquisition === 'live' ? liveSourceLabel(source) : classificationLabels[source.classification], page].filter(Boolean).join(' · ')}>
        {source.section ? <Text style={styles.section}>{source.section}</Text> : null}
        {source.excerpt ? <View style={styles.quote}>
          {source.excerptKind === 'visual_page' ? <Text style={styles.meta}>圖像說明（助手整理）</Text>
            : source.excerptKind === 'page_transcription' ? <Text style={styles.meta}>掃描頁辨讀</Text> : null}
          <Text selectable style={styles.body}>{source.excerpt}</Text>
        </View> : <Text style={styles.meta}>此引用沒有可顯示的原文摘錄。</Text>}
        {source.validUntil && Date.parse(source.validUntil) <= Date.now() ? <Text style={styles.warning}>這份引用已過有效期。</Text> : null}
        {source.cautionLabels?.length ? <View testID="live-source-cautions" style={styles.detail}>{source.cautionLabels.map((item, idx) => <Text key={idx} style={styles.warning}>{item}</Text>)}</View> : null}
        {source.productSpecLabel ? <Detail label="商品規格／型號" value={source.productSpecLabel} /> : null}
        {source.applicabilityLabel ? <Detail label="適用範圍" value={source.applicabilityLabel} /> : null}
        {source.savedPdf && onOpenSource ? <AppButton label="查看當時 PDF" variant="secondary" onPress={() => onOpenSource(source.id)} /> : null}
        {external ? <AppButton label="開啟現行網站" variant="quiet" onPress={() => { void Linking.openURL(external).catch(() => setLinkError(true)); }} /> : null}
        {linkError ? <Text style={styles.warning}>暫未能開啟原網站。</Text> : null}
        {source.acquisition === 'library' && source.seriesId && source.sourceId && !source.internalOnly
          ? <PlatformCardJoin seriesId={source.seriesId} citation={{ sourceId: source.sourceId, versionId: source.versionId }} /> : null}
        {source.seriesId ? <PreviewLink href={{ pathname: '/memory', params: { series: source.seriesId, sourceDocument: source.sourceId } }}>
          <Pressable accessibilityRole="link" onPress={onClose} style={styles.libraryLink}><Text style={styles.linkText}>查看來源庫</Text></Pressable>
        </PreviewLink> : null}
        <AppButton label="版本與核對資料" variant="quiet" density="compact" expanded={showMetadata} onPress={() => setShowMetadata(value => !value)} />
        {showMetadata ? <View style={styles.sheetDetails}>
          {original.some(part => part !== source.excerpt) ? <View style={styles.detail}><Text style={styles.meta}>當時已讀段落</Text>{original.map((part, index) => <Text key={index} selectable style={styles.body}>{part}</Text>)}</View> : null}
          {source.versionId ? <Detail technical label="引用版本" value={source.versionId} /> : null}
          {source.versionHash ? <Detail technical label="版本校驗" value={source.versionHash} /> : null}
          {source.sourceDate ? <Detail label="來源日期" value={source.sourceDate} /> : null}
          {source.validUntil ? <Detail label="有效至" value={sourceTime(source.validUntil)} /> : null}
          {source.checkedAt ? <Detail label="核對時間" value={sourceTime(source.checkedAt)} /> : null}
          {source.fetchedAt ? <Detail label="取得時間" value={sourceTime(source.fetchedAt)} /> : null}
          {source.lastSuccessfulCheckAt ? <Detail label="最近成功核對" value={sourceTime(source.lastSuccessfulCheckAt)} /> : null}
          {source.originalRange ? <Detail label="已讀字元" value={source.originalRange} /> : null}
          {source.termsUrl ? <Detail technical label="來源使用條款" value={source.termsUrl} /> : null}
          {source.internalOnly ? <Text style={styles.meta}>限內部使用</Text> : null}
        </View> : null}
      </SourceDocumentCard>
    </ScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="關閉" onPress={onClose} variant="secondary" density="compact" /></AppDialog.Actions>
  </AppDialog>;
}

export function AnswerSources({ sources, children, testID, onOpenSource, onLocateSource, degraded = false }: {
  sources: readonly ChatCitationView[]; children: ReactNode; testID?: string;
  onOpenSource?: (id: string) => void; onLocateSource?: LocateAnswerSource; degraded?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const origin = useRef<CitationOrigin | null>(null);
  const selected = sources.find(source => source.id === selectedId);
  function open(id: string, anchor?: RefObject<View | null>) {
    origin.current = anchor ? { sourceId: id, anchor } : null;
    setSelectedId(id);
  }
  function close() {
    setSelectedId(null);
    const target = origin.current?.anchor.current;
    if (target) onLocateSource?.(target, undefined, target);
    origin.current = null;
  }
  return <CitationContext.Provider value={{ sources, locate: open }}>
    <View testID={testID} style={styles.answer}>
      {children}
      {degraded || sources.length > 0 ? <View testID="answer-sources" style={styles.footer}>
        {degraded ? <Text testID="answer-sources-degraded" style={styles.warning}>{CHAT_SOURCE_COPY.degradedWarning}</Text> : null}
        {sources.length ? <View testID="answer-source-panel" style={styles.cards}>
          {sources.map((source, i) => {
            const page = pageLabel(source);
            const isLive = source.acquisition === 'live';
            const liveLabel = isLive ? liveSourceLabel(source) : null;
            const preview = source.excerptKind === 'visual_page' ? '' : source.excerpt.replace(/\s+/gu, ' ').trim();
            return <Pressable key={source.id} testID={`citation-card-${i + 1}`}
              accessibilityRole="button" accessibilityLabel={`來源【${i + 1}】${liveLabel ? ' · ' + liveLabel : ''}：${source.title}${page ? ' · ' + page : ''}`}
              accessibilityHint={preview || undefined}
              onPress={() => open(source.id)} style={({ pressed }) => [styles.card, isLive && styles.liveCard, pressed && styles.pressed]}>
              <View style={styles.cardHead}><Text numberOfLines={2} style={styles.title}>{source.title}</Text>
                {page ? <Text style={styles.page}>{page}</Text> : null}</View>
              {preview ? <Text numberOfLines={3} style={styles.excerpt}>{preview}</Text> : null}
              {liveLabel ? <View style={styles.liveTag}><Text testID={`live-source-badge-${i + 1}`} style={styles.liveBadge}>{liveLabel}</Text></View> : null}
            </Pressable>;
          })}
        </View> : null}
      </View> : null}
      {selected ? <OriginalCard key={selected.id} source={selected} onClose={close} onOpenSource={onOpenSource} /> : null}
    </View>
  </CitationContext.Provider>;
}

const styles = StyleSheet.create({
  answer: { gap: chatLayout.paragraphGap, minWidth: 0 },
  footer: { gap: spacing.sm, minWidth: 0 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, minWidth: 0 },
  card: { flexBasis: 236, flexGrow: 1, flexShrink: 1, maxWidth: 356, minWidth: 0, minHeight: 46, gap: spacing.xs,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  liveCard: { borderColor: colors.statusWarmLine, backgroundColor: colors.paleAmber },
  liveTag: { alignSelf: 'flex-start', borderRadius: 4, borderWidth: 1, borderColor: colors.statusWarmLine, backgroundColor: colors.paper, paddingHorizontal: spacing.xs, paddingVertical: 1 },
  liveBadge: { fontFamily: chatFont, color: colors.warningInk, ...chatType.meta, fontWeight: '700' },
  pressed: { backgroundColor: colors.quietSurface, borderColor: colors.controlOutline },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: spacing.sm, minWidth: 0 },
  title: { flexGrow: 1, flexShrink: 1, minWidth: 0, fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: '700' },
  page: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  excerpt: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool },
  scrollArea: { flexShrink: 1, paddingHorizontal: 0 },
  sheet: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  sheetDetails: { gap: spacing.sm, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: spacing.md },
  section: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  body: { fontFamily: chatFont, color: chatColors.ink, ...chatType.body },
  detail: { gap: 2, minWidth: 0 }, quote: { gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.sage, paddingLeft: spacing.md },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.meta },
  libraryLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  linkText: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, textDecorationLine: 'underline' },
});
