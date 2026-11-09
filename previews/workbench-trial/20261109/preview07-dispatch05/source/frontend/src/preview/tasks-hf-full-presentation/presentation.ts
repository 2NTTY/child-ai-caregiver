import type { TextStyle, ViewStyle } from 'react-native';

export type HFTasksSource = 'harbour' | 'fourth';
export type HFTasksPresentationOptions = Readonly<{ compact: boolean; platform: 'web' | 'native' }>;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** Freeze only newly constructed presentation data, never caller-owned models or refs. */
function immutable<T extends object>(value: T): DeepReadonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') immutable(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

/**
 * Pure source-local ingredients for permanent host nodes. No selection authority.
 * Unknown/empty/other source choices stay absent rather than acquiring Harbour.
 * See the packet coverage contract before binding empty/read structure differences.
 */
export function getHFTasksPresentation(source: unknown, options: HFTasksPresentationOptions) {
  if (source !== 'harbour' && source !== 'fourth') return undefined;
  const harbour = source === 'harbour';
  const { compact, platform } = options;
  const colors = harbour ? {
    ink: '#233A35', teal: '#245C50', muted: '#52655F', white: '#FFFFFF',
    line: '#CAD5CF', softLine: '#E0E8E3', neutralSurface: '#F2F6F3',
    errorInk: '#AB2631', paleCoral: '#FFF0F0', controlOutline: '#7D9087',
    pressedOverlay: 'rgba(35, 58, 53, 0.08)',
  } : {
    ink: '#183E45', teal: '#0C6E72', muted: '#52656B', white: '#FFFFFE',
    line: '#C8D9D7', softLine: '#DFE9E6', neutralSurface: '#F3F8F7',
    errorInk: '#B52D3A', paleCoral: '#FFF2F1', controlOutline: '#718B8C',
    pressedOverlay: 'rgba(24, 62, 69, 0.08)',
  };
  const fontFamily = platform === 'web'
    ? harbour ? "'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif"
      : "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif"
    : undefined;
  const tool = harbour ? { fontSize: 14, lineHeight: 22 } : { fontSize: 16, lineHeight: 24 };
  const meta = harbour ? { fontSize: 12, lineHeight: 18 } : { fontSize: 13, lineHeight: 20 };
  const body = { fontSize: 16, lineHeight: 26 };
  const smallRadius = harbour ? 8 : 10;
  const mediumRadius = harbour ? 14 : 16;

  const headingStyles = {
    root: harbour ? {
      flexDirection: 'row', alignItems: compact ? 'flex-start' : 'flex-end', justifyContent: 'space-between',
      flexWrap: 'wrap', columnGap: 24, rowGap: 12, paddingBottom: compact ? 16 : 24,
      borderBottomWidth: 1, borderBottomColor: colors.line,
    } : {
      flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
      columnGap: 24, rowGap: 12, minWidth: 0, paddingBottom: 8,
    },
    copy: harbour ? { flex: 1, minWidth: 180, gap: 8 } : { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 },
    title: harbour ? {
      fontFamily, fontSize: compact ? 24 : 30, lineHeight: compact ? 32 : 40,
      fontWeight: '700', color: colors.ink, letterSpacing: -0.5,
    } : {
      fontFamily, fontSize: compact ? 26 : 28, lineHeight: compact ? 36 : 38,
      fontWeight: '700', color: colors.ink,
    },
    description: harbour ? {
      maxWidth: 660, fontFamily, fontSize: 14, lineHeight: compact ? 20 : 23, color: colors.muted,
    } : null,
  } satisfies { root: ViewStyle; copy: ViewStyle; title: TextStyle; description: TextStyle | null };
  const listStyles = {
    scheduleList: { minWidth: 0, gap: 8 },
    timeGroup: { minWidth: 0 },
    groupHeading: { flexDirection: 'row', gap: 8, alignItems: 'baseline', paddingBottom: 8 },
    groupTitle: { fontFamily, color: colors.teal, ...tool, fontWeight: '700' },
    meta: { fontFamily, color: colors.muted, ...meta },
    pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 8 },
    loadMore: { gap: 8, alignItems: 'flex-start' },
    emptyCard: { minHeight: 176, padding: 24, justifyContent: 'center' },
  } satisfies Record<string, ViewStyle | TextStyle>;
  const emptyStyles = harbour ? {
    card: { minWidth: 0, alignSelf: 'stretch', gap: 8, padding: 24,
      backgroundColor: colors.neutralSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: mediumRadius },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
    icon: { width: 44, height: 44, flexShrink: 0, backgroundColor: colors.white, borderRadius: smallRadius,
      alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, gap: 4 },
    actions: { alignItems: 'flex-start', gap: 8 },
    title: { minWidth: 0, fontFamily, color: colors.ink, ...body, fontWeight: '600' },
    detail: { fontFamily, color: colors.muted, ...tool },
  } satisfies Record<string, ViewStyle | TextStyle> : {
    card: { minWidth: 0, alignSelf: 'stretch', gap: 8, padding: 16,
      backgroundColor: colors.neutralSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: mediumRadius },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    title: { flex: 1, minWidth: 0, fontFamily, color: colors.ink, ...body, fontWeight: '600' },
    detail: { fontFamily, color: colors.muted, ...tool },
  } satisfies Record<string, ViewStyle | TextStyle>;
  const readStyles = {
    staticIndicator: { width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 2, borderColor: colors.teal },
    notice: harbour ? {
      flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16,
      borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.white,
    } : { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8 },
    error: harbour ? { borderLeftWidth: 3, borderLeftColor: colors.errorInk, backgroundColor: colors.paleCoral }
      : { borderLeftWidth: 2, borderLeftColor: colors.errorInk, paddingLeft: 12 },
    copy: { flex: 1, minWidth: 0, gap: 8 },
    title: { fontFamily, color: colors.ink, ...tool, fontWeight: '700' },
    body: { fontFamily, color: colors.muted, ...tool },
  } satisfies Record<string, ViewStyle | TextStyle>;
  const buttonStyles = {
    button: { maxWidth: '100%', borderRadius: smallRadius },
    buttonContent: { minHeight: 44, paddingHorizontal: 4 },
    compactButtonContent: { minHeight: 40 },
    buttonLabel: { fontFamily, fontSize: 14, fontWeight: '700' },
    outlineButton: { borderColor: colors.controlOutline },
    quietButton: harbour ? { alignSelf: 'flex-start', borderColor: 'transparent' } : { alignSelf: 'flex-start' },
    disabledOutlineButton: { backgroundColor: 'transparent', borderColor: colors.line },
    disabledLabel: { color: colors.muted },
    focusedButton: { borderColor: colors.ink },
    buttonPressed: { backgroundColor: colors.pressedOverlay },
    mobileTarget: { minHeight: 48, minWidth: 48 },
  } satisfies Record<string, ViewStyle | TextStyle>;

  return immutable({
    source: {
      variantId: source,
      sourceId: harbour ? 'harbour-h629' : 'fourth-f599',
      baseCommit: harbour ? '4050c0a16d0a9735923434abc9749ecd416d7926' : '76493c5e0747cb5da908fdb708879fd96509d093',
      payloadCommit: '384a056f749f583ac92416c66dbe10f0e0fea6be',
      assemblySha256: harbour ? '3f1fbfbe61217f75898e88276cb06e203d19c7ecf54c4febd4018e64329cc3e1'
        : '690eedec12c76940c236b9f5317783fd835b679dd14a49d1654bd09298d0d9bc',
      kind: 'restored-source-assembly-not-single-app-commit',
    },
    scope: { appearance: 'source-local-ingredients', semantics: 'existing-harbour-host', integrated: false },
    admission: { wholeHeader: false, wholeDateList: false, runtime: false, release: false },
    reuse: {
      headerActions: 'task-header-actions-hf01-parent-final-20261107',
      rows: 'tasks-row-appearance-parent-final01-20261108',
      rowAppearance: source, rowTheme: 'harbour-hosted-partial',
    },
    header: {
      title: harbour ? '待辦與預約' : '待辦',
      description: harbour ? '看清近期安排，接續待處理的事情。' : null,
      titleRole: 'header', titleLevel: 1, titleLevelPlatform: harbour ? 'web-only' : 'all',
      placement: 'before-notices-and-workspace',
      actionsPlacement: 'existing-list-toolbar-and-compact-disclosure',
      styles: headingStyles,
    },
    dateList: {
      styles: listStyles,
      placement: { readAndEmpty: 'inside-schedule-list-before-sections', sections: 'inside-schedule-list' },
      section: { headingRole: 'header', headingLevel: 2, countSuffix: ' 項',
        sections: 'existing-owner-nonempty-sections', rows: 'existing-MotionList-and-TaskListRow' },
      empty: {
        structure: harbour ? 'icon-tile-copy-action-rail' : 'inline-icon-title-direct-actions',
        styles: emptyStyles,
        icon: { name: 'clipboard-check-outline', size: 22, color: harbour ? colors.teal : colors.muted,
          importantForAccessibility: harbour ? 'no' : undefined },
        titleRole: 'text', titleContent: 'existing-owner-readMessage',
        clearFilter: { label: '清除篩選', variant: 'quiet', density: 'compact',
          visibility: 'existing-owner-pending-and-not-noPendingTasks-and-openCount-positive' },
      },
      read: {
        styles: readStyles,
        stateAndMessage: 'existing-owner-readState-and-readMessage',
        loading: { delayMs: 500, timingOwner: 'existing-ReadStateNotice', color: colors.teal,
          reducedMotion: 'existing-static-indicator' },
        nonLoadingIcon: harbour ? { error: 'alert-outline', other: 'information-outline', size: 20,
          errorColor: colors.errorInk, otherColor: colors.muted, importantForAccessibility: 'no' } : null,
        retry: { label: '重新讀取事項', variant: 'secondary', density: 'compact',
          visibility: 'existing-owner-error-or-stale-and-reloadCurrent', disabled: 'existing-owner-input' },
        announcement: 'existing-StatusAnnouncement',
        backgroundDecoration: 'existing-BackgroundSurface',
      },
      readCopy: {
        loading: '正在讀取事項…', error: '未能讀取事項，請重試。',
        offline: '目前離線，已載入內容只供參考；恢復連線後才可提交。',
        stale: '未能更新，現正顯示上次讀取的事項。',
        noPending: '暫無待辦', loadedNoPending: '已載入的事項中暫無待辦',
        noMatches: '沒有符合篩選的事項', loadedNoCompleted: '已載入的事項中暫無已完成的事項',
        noCompleted: '暫無已完成的事項',
      },
      paging: {
        placement: 'inside-schedule-list-after-sections',
        visibility: 'existing-owner-pending-and-pageCount-greater-than-one',
        previous: { label: '上一頁', accessibilityLabel: '已載入事項上一頁', variant: 'quiet', density: 'compact' },
        next: { label: '下一頁', accessibilityLabel: '已載入事項下一頁', variant: 'quiet', density: 'compact' },
        pageText: { prefix: '第 ', separator: '／', suffix: ' 頁', numbering: 'owner-page-plus-one' },
        disabled: 'existing-owner-occupied-and-page-boundaries',
      },
      loadMore: {
        placement: 'after-AppTabPanel-inside-list-surface', visibility: 'existing-owner-hasMoreTasks',
        notice: '仍有事項未載入；月曆、搜尋及數目只包括已載入事項。',
        button: { label: '載入更多事項', loadingLabel: '正在載入更多事項…', variant: 'secondary', density: 'standard' },
        disabled: 'existing-owner-loadingMoreTasks-or-offline-or-occupied',
      },
      buttonAppearance: {
        stateOwner: 'existing-AppButton', styles: buttonStyles,
        compactLabel: harbour ? { fontSize: 14, lineHeight: 20 } : { fontSize: 16, lineHeight: 24 },
        compactAndTouch: 'existing-AppButton-measurement-not-page-heading-compact',
        textColor: colors.ink, buttonColor: 'transparent', mode: 'outlined',
        theme: { colors: { surfaceDisabled: colors.softLine, onSurfaceDisabled: colors.muted } },
        // Source plain buttons leave these to Paper; they are disclosure-only style literals.
        notAppliedToPlainButtons: ['disabledLabel', 'focusedButton', 'buttonPressed'],
      },
    },
  } as const);
}

export type HFTasksPresentation = NonNullable<ReturnType<typeof getHFTasksPresentation>>;
