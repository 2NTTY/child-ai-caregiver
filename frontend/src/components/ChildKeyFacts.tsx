import { useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { HomeChild, RecordsLoadState } from '../view-model';
import type { HeaderOperationHintView } from '../header-operation-hints';
import { spacing } from '../theme';
import { HorizontalOverflowRail } from './HorizontalOverflowRail';
import type { HorizontalRailItem } from './horizontalOverflow';
import { HeaderOperationHint } from './HeaderOperationHint';

type ChildKeyFactsProps = { child: HomeChild | undefined; load: RecordsLoadState; leading?: ReactNode; hints?: readonly HeaderOperationHintView[] };

/** The former profile-confirmed chip slot now contains real, actionable operation hints. */
export function ChildKeyFacts({ child, leading, hints = [] }: ChildKeyFactsProps) {
  const [positions, setPositions] = useState<Record<string, HorizontalRailItem>>({});
  const controls = useRef(new Map<string, View>());
  const items = [...(leading ? ['child'] : []), ...hints.map(hint => hint.id)];
  function item(key: string, content: ReactNode) {
    return <View key={key} ref={node => { if (node) controls.current.set(key, node); else controls.current.delete(key); }}
      tabIndex={key === 'child' ? undefined : -1} style={styles.item}
      onLayout={event => {
        const { x, width } = event.nativeEvent.layout;
        setPositions(current => current[key]?.x === x && current[key]?.width === width ? current : { ...current, [key]: { key, x, width } });
      }}>{content}</View>;
  }
  return <HorizontalOverflowRail style={styles.rail} contentContainerStyle={styles.content}
    rowTestID="header-child-facts" hintTestID="header-child-facts-more" accessibilityLabel="孩子及操作提示"
    items={items.flatMap(key => positions[key] ? [positions[key]] : [])}
    layoutRevision={`${child?.id ?? 'none'}:${hints.map(hint => `${hint.id}:${hint.status}`).join(':')}`}
    hintLabel="顯示更多操作提示" onRevealItem={key => {
      if (Platform.OS !== 'web') return;
      const node = controls.current.get(key) as unknown as HTMLElement | undefined;
      (node?.querySelector<HTMLElement>('button,[role="button"]') ?? node)?.focus({ preventScroll: true });
    }}>
    {leading ? item('child', leading) : null}
    {hints.map(hint => item(hint.id, <HeaderOperationHint hint={hint} />))}
  </HorizontalOverflowRail>;
}
const styles = StyleSheet.create({
  rail: { flex: 1, height: 48, minWidth: 0 },
  content: { alignItems: 'center', gap: spacing.sm },
  item: { flexShrink: 0, justifyContent: 'center', minHeight: 48 },
});
