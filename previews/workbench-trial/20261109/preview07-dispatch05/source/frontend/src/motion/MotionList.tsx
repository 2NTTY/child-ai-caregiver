import { motionData, type MotionViewProps } from "./viewProps";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { motionTokens } from "./tokens";
import { useMotionPreferences } from "./preferences";
import { planListProjection } from "./lifecycle";

type Row<T> = { id: string; item: T; exiting: boolean; entering: boolean };
export interface MotionListProps<T> {
  items: readonly T[]; keyExtractor: (item: T) => string; scopeKey: string; regionKey: string;
  /** True only for a confirmed local mutation, never initial loads, pagination, or refresh. */
  eligible?: boolean;
  renderItem: (item: T, state: { exiting: boolean; entering: boolean }) => ReactNode;
  style?: StyleProp<ViewStyle>; itemStyle?: StyleProp<ViewStyle>; testID?: string;
  onBeforeExitFocus?: (removedIds: readonly string[], survivingIds: readonly string[]) => boolean | void;
}

export function MotionList<T>({ items, keyExtractor, scopeKey, regionKey, eligible = false, renderItem, style, itemStyle, testID, onBeforeExitFocus }: MotionListProps<T>) {
  const preferences = useMotionPreferences();
  const initial = () => items.map(item => ({ id: keyExtractor(item), item, exiting: false, entering: false }));
  const [rows, setRows] = useState<Row<T>[]>(initial);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const live = new Map(items.map(item => [keyExtractor(item), item]));
  const lastItems = useRef(live);
  const previous = useRef({ scopeKey, keys: items.map(keyExtractor).join("\u0000"), epoch: preferences.epoch });
  const latest = useRef({ items, keyExtractor, scopeKey }); latest.current = { items, keyExtractor, scopeKey };
  const root = useRef<View>(null);
  const refs = useRef(new Map<string, View>());
  const [flipGeneration, setFlipGeneration] = useState(0);
  const mounted = useRef(true);
  const version = useRef(0);
  const signature = items.map(keyExtractor).join("\u0000");
  const animate = preferences.enabled && eligible;
  const projection = planListProjection(rows.map(row => row.id), items.map(keyExtractor), previous.current.scopeKey, scopeKey, animate);
  const sameScope = projection.sameScope;

  const transferFocus = useCallback((removed: string[], next: string[], oldIds: string[]) => {
    if (onBeforeExitFocus?.(removed, next) === true || Platform.OS !== "web" || typeof document === "undefined") return;
    const focused = removed.find(id => (refs.current.get(id) as unknown as HTMLElement | undefined)?.contains(document.activeElement));
    if (!focused) return;
    const index = oldIds.indexOf(focused);
    const ordered = [...oldIds.slice(index + 1).filter(id => next.includes(id)), ...oldIds.slice(0, index).reverse().filter(id => next.includes(id))];
    for (const id of ordered) {
      const element = refs.current.get(id) as unknown as HTMLElement | undefined;
      const target = Array.from(element?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).find(node => !node.hasAttribute("disabled") && node.getClientRects().length > 0);
      if (target) { target.focus({ preventScroll: true }); return; }
    }
    (root.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, [onBeforeExitFocus]);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { scopeKey, keys: signature, epoch: preferences.epoch };
    const changed = old.keys !== signature;
    const fresh = items.map(item => ({ id: keyExtractor(item), item, exiting: false, entering: false }));
    // Same-scope removed rows survive this pre-paint commit only until focus moves,
    // even with reduced motion. A changed scope never renders retained old data.
    if (projection.focusRemovedIds.length) transferFocus(projection.focusRemovedIds, fresh.map(row => row.id), rowsRef.current.map(row => row.id));
    if (old.scopeKey !== scopeKey || old.epoch !== preferences.epoch || !animate) {
      version.current += 1;
      if (changed || rowsRef.current.some(row => row.exiting || row.entering) || old.scopeKey !== scopeKey) setRows(fresh);
      lastItems.current = live; return;
    }
    if (!changed) { lastItems.current = live; return; }
    version.current += 1;
    // A newer mutation settles earlier exits before measuring the latest layout.
    const oldRows = rowsRef.current.filter(row => !row.exiting);
    const oldIds = oldRows.map(row => row.id);
    const nextIds = fresh.map(row => row.id);
    const removed = oldIds.filter(id => !live.has(id));

    const next: Row<T>[] = fresh.map(row => ({ ...row, entering: !oldIds.includes(row.id) }));
    for (const [oldIndex, row] of oldRows.entries()) {
      if (live.has(row.id)) continue;
      const after = oldIds.slice(oldIndex + 1).find(id => next.some(candidate => candidate.id === id));
      const beforeIndex = after ? next.findIndex(candidate => candidate.id === after) : next.length;
      next.splice(beforeIndex, 0, { ...row, item: lastItems.current.get(row.id) ?? row.item, entering: false, exiting: true });
    }
    setRows(next);
    setFlipGeneration(value => value + 1);
    lastItems.current = live;
  }, [items, signature, scopeKey, preferences.epoch, animate, keyExtractor, transferFocus]);

  const completeExit = useCallback((id: string, generation: number) => {
    if (!mounted.current || generation !== version.current) return;
    setRows(current => current.filter(row => row.id !== id));
    setFlipGeneration(value => value + 1);
  }, []);
  const completeEntry = useCallback((id: string) => {
    if (mounted.current) setRows(current => current.map(row => row.id === id ? { ...row, entering: false } : row));
  }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; version.current += 1; }; }, []);
  const visible = projection.retainUntilLayout ? rows : initial();
  return <View ref={root} tabIndex={-1} testID={testID} style={style} {...motionData({ motionKind: "list", motionRegion: regionKey })}>
    {visible.map(row => <MotionListRow key={row.id} id={row.id} exiting={row.exiting} entering={row.entering} eligible={animate && sameScope} scopeKey={scopeKey}
      generation={version.current} flipGeneration={flipGeneration} style={itemStyle} register={node => { if (node) refs.current.set(row.id, node); else refs.current.delete(row.id); }} onExit={completeExit} onEntry={completeEntry}>
      {renderItem(live.has(row.id) ? live.get(row.id)! : row.item, { exiting: row.exiting, entering: row.entering })}
    </MotionListRow>)}
  </View>;
}

function MotionListRow({ id, exiting, entering, eligible, scopeKey, generation, flipGeneration, style, children, register, onExit, onEntry }: {
  id: string; exiting: boolean; entering: boolean; eligible: boolean; scopeKey: string; generation: number; flipGeneration: number;
  style?: StyleProp<ViewStyle>; children: ReactNode; register: (node: View | null) => void;
  onExit: (id: string, generation: number) => void; onEntry: (id: string) => void;
}) {
  const x = useSharedValue(0), y = useSharedValue(0), opacity = useSharedValue(1);
  const node = useRef<View>(null);
  const layout = useRef<{ y: number; generation: number } | null>(null);
  const token = useRef(0);
  const mounted = useRef(true);
  const [flipping, setFlipping] = useState(false);
  const preferences = useMotionPreferences();
  const previousScope = useRef(scopeKey);
  const done = useCallback((kind: "entry" | "exit" | "flip", localToken: number) => {
    if (!mounted.current || localToken !== token.current) return;
    if (kind === "exit") onExit(id, generation);
    else if (kind === "entry") onEntry(id);
    else setFlipping(false);
  }, [id, generation, onExit, onEntry]);
  useLayoutEffect(() => {
    if (Platform.OS === "web" && node.current) (node.current as unknown as HTMLElement).inert = exiting;
    const changedScope = previousScope.current !== scopeKey; previousScope.current = scopeKey;
    const current = ++token.current;
    cancelAnimation(x); cancelAnimation(y); cancelAnimation(opacity);
    x.value = 0; y.value = 0; opacity.value = 1; setFlipping(false);
    if (changedScope) layout.current = null;
    if (!eligible || !preferences.enabled || changedScope) return;
    if (exiting) {
      x.value = withTiming(motionTokens.exit.distance, { duration: motionTokens.exit.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System });
      opacity.value = withTiming(0, { duration: motionTokens.exit.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(done)("exit", current); });
    } else if (entering) {
      y.value = motionTokens.add.distance; opacity.value = 0;
      opacity.value = withTiming(1, { duration: motionTokens.add.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System });
      y.value = withTiming(0, { duration: motionTokens.add.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(done)("entry", current); });
    }
  }, [exiting, entering, eligible, scopeKey, generation, preferences.enabled, preferences.epoch, x, y, opacity, done]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current += 1; cancelAnimation(x); cancelAnimation(y); cancelAnimation(opacity); }; }, [x, y, opacity]);
  const recordPosition = useCallback((nextY: number) => {
    const old = layout.current;
    layout.current = { y: nextY, generation: flipGeneration };
    if (!old || !eligible || !preferences.enabled || exiting || entering || old.generation === flipGeneration) return;
    const difference = old.y - nextY;
    if (Math.abs(difference) < 0.5) return;
    const current = ++token.current; cancelAnimation(y); y.value = difference; setFlipping(true);
    y.value = withTiming(0, { duration: motionTokens.flip.duration, easing: motionTokens.ease, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(done)("flip", current); });
  }, [flipGeneration, eligible, preferences.enabled, exiting, entering, y, done]);
  useLayoutEffect(() => {
    // RN Web onLayout observes size only. offsetTop observes this commit's position,
    // in the common list parent and without including any animated transform.
    if (Platform.OS === "web" && node.current) recordPosition((node.current as unknown as HTMLElement).offsetTop);
  }, [recordPosition, scopeKey, preferences.epoch]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: x.value === 0 && y.value === 0 ? [] : [{ translateX: x.value }, { translateY: y.value }] }));
  return <Animated.View ref={(value: View | null) => { node.current = value; register(value); }} style={[styles.row, style, animatedStyle]} pointerEvents={exiting ? "none" : "auto"}
    aria-hidden={exiting} accessibilityElementsHidden={exiting} importantForAccessibility={exiting ? "no-hide-descendants" : "auto"}
    {...motionData({ motionRow: id, motionExiting: String(exiting), motionEntering: String(entering), motionFlip: String(flipping) })}
    onLayout={event => {
      recordPosition(Platform.OS === "web" && node.current ? (node.current as unknown as HTMLElement).offsetTop : event.nativeEvent.layout.y);
    }}>{children}</Animated.View>;
}
const styles = StyleSheet.create({ row: { minWidth: 0 } });
