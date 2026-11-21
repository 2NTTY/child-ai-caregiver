import { useIsFocused, usePathname } from 'expo-router';
import { createContext, lazy, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutRectangle } from 'react-native';
import { useProduction } from '../../production/ProductionProvider';
const SiteCompanion = lazy(async () => ({ default: (await import('./SiteCompanion')).SiteCompanion }));

type Slot = { node: View; page: string; identity: string };
const SlotContext = createContext<((slot: Slot) => () => void) | null>(null);

// Each authorised surface lends its space to the session's character.
export function CompanionSlot({ quietHeight, admin = false }: { quietHeight?: number; admin?: boolean }) {
  const register = useContext(SlotContext), { identityKey } = useProduction();
  const page = usePathname(), focused = useIsFocused(), node = useRef<View>(null);
  const [layout, setLayout] = useState(0);
  const active = focused && (page === '/admin') === admin && (page === '/chat') === !!quietHeight;
  useLayoutEffect(() => {
    if (active && identityKey && node.current && register) return register({ node: node.current, page, identity: identityKey });
  }, [active, identityKey, page, register, layout]);
  if (!active) return null;
  return <View ref={node} collapsable={false} pointerEvents="none" testID="companion-position"
    onLayout={() => setLayout(count => count + 1)}
    style={quietHeight ? { height: quietHeight, width: Math.ceil(quietHeight * .71), flexShrink: 0 } : StyleSheet.absoluteFill} />;
}

export function CompanionViewport({ children }: { children: ReactNode }) {
  const { identityKey, account } = useProduction(), page = usePathname();
  const root = useRef<View>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [box, setBox] = useState<(LayoutRectangle & { slot: Slot }) | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const register = useCallback((next: Slot) => {
    setSlot(next);
    return () => setSlot(current => current === next ? null : current);
  }, []);
  useLayoutEffect(() => {
    if (!slot || !root.current || slot.page !== page || slot.identity !== identityKey) {
      setBox(null);
      return;
    }
    let live = true;
    const update = (x: number, y: number, width: number, height: number) => {
      if (live) setBox(previous => previous?.slot === slot && previous.x === x && previous.y === y &&
        previous.width === width && previous.height === height ? previous : { slot, x, y, width, height });
    };
    if (Platform.OS !== 'web') {
      slot.node.measureLayout(root.current, update);
      return () => { live = false; };
    }
    const host = root.current as unknown as HTMLElement, anchor = slot.node as unknown as HTMLElement;
    const measure = () => {
      if (!anchor.isConnected || anchor.closest('[inert], [aria-hidden="true"]')) { update(0, 0, 0, 0); return; }
      const outer = host.getBoundingClientRect(), inner = anchor.getBoundingClientRect();
      const scale = outer.width / (host.clientWidth || 1) || 1;
      update((inner.left - outer.left) / scale, (inner.top - outer.top) / scale, inner.width / scale, inner.height / scale);
    };
    const size = new ResizeObserver(measure), motion = new MutationObserver(measure);
    for (let node: HTMLElement | null = anchor; node; node = node.parentElement) {
      size.observe(node);
      motion.observe(node, { attributes: true, attributeFilter: ['style', 'inert', 'aria-hidden', 'data-motion-phase'] });
      if (node === host) break;
    }
    // Startup and account barriers may also hide the entire route tree.
    for (let node = host.parentElement; node; node = node.parentElement) {
      motion.observe(node, { attributes: true, attributeFilter: ['inert', 'aria-hidden'] });
    }
    host.addEventListener('scroll', measure, true);
    measure();
    return () => { live = false; size.disconnect(); motion.disconnect(); host.removeEventListener('scroll', measure, true); };
  }, [slot, page, identityKey]);
  const authorised = !!identityKey && account.gate === 'ready' && slot?.identity === identityKey && slot.page === page;
  const available = authorised && box?.slot === slot && box.width > 0 && box.height > 0;
  useLayoutEffect(() => {
    if (!identityKey || account.gate !== 'ready') setStarted(null);
    else if (available) setStarted(identityKey);
  }, [identityKey, account.gate, available]);
  return <SlotContext.Provider value={register}><View ref={root} collapsable={false} style={styles.root}>
    {children}
    {identityKey && account.gate === 'ready' && (available || started === identityKey) &&
      <View pointerEvents={available ? 'box-none' : 'none'} aria-hidden={!available} accessibilityElementsHidden={!available}
        importantForAccessibility={available ? 'auto' : 'no-hide-descendants'} style={[styles.overlay, {
          left: box?.x ?? 0, top: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0, opacity: available ? 1 : 0,
        }]}>
        <Suspense fallback={null}><SiteCompanion key={identityKey} bounds={box ?? { width: 0, height: 0 }} authorised={authorised} visible={available} /></Suspense>
      </View>}
  </View></SlotContext.Provider>;
}
const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0 }, overlay: { position: 'absolute' } });
