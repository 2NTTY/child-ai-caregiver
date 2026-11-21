import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GripHorizontal from 'lucide-react-native/icons/grip-horizontal';
import { DirectionalPressable } from '../navigation/DirectionalPressable';
import { AppIcon } from '../AppIcon';
import { colors, mobileLayout } from '../../theme';
import { DialoguePlacement } from './DialoguePlacement';
import CharacterFrame, { type CharacterAction } from './CharacterFrame';

class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function CharacterDock({ src, page, unread, foreground, panelOpen = false, inToolbar = false, listening = false, performance, onChat, onVoice, onCollapse, children }: {
  src: string; page: string; unread?: string; foreground: boolean; panelOpen?: boolean; inToolbar?: boolean; onChat?(): void;
  listening?: boolean; performance?: { action: CharacterAction; serial: number }; onVoice?(): void; onCollapse?(): void; children?: ReactNode;
}) {
  const quiet = page === '/chat', small = useWindowDimensions().width < mobileLayout.breakpoint;
  const insets = useSafeAreaInsets();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [placement, setPosition] = useState<{ x: number; y: number } | null>(null);
  const position = placement ?? { x: small ? .96 : page === '/tasks' ? .49 : .32, y: 1 };
  const [minimized, setMinimized] = useState(false), [ready, setReady] = useState(false);
  const [occluded, setOccluded] = useState(0);
  const [gesture, setGesture] = useState<{ action: CharacterAction; serial: number }>({ action: 'nod', serial: 0 });
  const play = useCallback((action: CharacterAction) => setGesture(last => ({ action, serial: last.serial + 1 })), []);
  const collapsed = !quiet && minimized;
  const safeBottom = inToolbar || Platform.OS === 'web' ? 0 : mobileLayout.tabMinHeight + insets.bottom;
  const room = Math.max(0, bounds.height - Math.max(safeBottom, occluded));
  const figureHeight = page === '/tasks' ? (small ? 154 : 214) : (small ? 166 : 232);
  const height = inToolbar ? room : Math.min(figureHeight, room * .49);
  const headHeight = Math.min(height / 2, Math.max(44, height * .39));
  const width = Math.round(height * .71), trayHeight = quiet ? 0 : 40;
  const dockWidth = collapsed ? 46 : Math.max(quiet ? 0 : 102, width), dockHeight = collapsed ? 46 : height + trayHeight;
  const margin = small ? 8 : 15;
  const travelX = Math.max(0, bounds.width - dockWidth - 2 * margin);
  const travelY = Math.max(0, room - dockHeight - 2 * margin);
  const preferredX = margin + position.x * travelX;
  const leftOfFace = preferredX + dockWidth / 2 >= bounds.width / 2;
  // Both slots meet the same cheek. Reserve space at the centre of a narrow window.
  const cheekOffset = dockWidth / 2 + (leftOfFace ? -.24 : .27) * width;
  const required = Math.min(174, Math.max(0, bounds.width - dockWidth - 2 * margin));
  const x = quiet ? 0 : !panelOpen ? preferredX : leftOfFace
    ? Math.max(preferredX, margin + required - cheekOffset)
    : Math.min(preferredX, bounds.width - margin - required - cheekOffset);
  const seam = x + cheekOffset;
  const sideRoom = Math.max(0, leftOfFace ? seam - margin : bounds.width - margin - seam);
  const preferredY = margin + position.y * travelY;
  const y = quiet ? 0 : panelOpen ? Math.max(preferredY, Math.min(margin + travelY, 132 - height * .31)) : preferredY;
  const cheekBottom = Math.max(0, bounds.height - y - height * .32);
  const entryTop = Math.max(0, Math.min(room - 82, y + height * .54));
  const surface = useRef<View>(null);
  const drag = useRef({ x: 0, y: 0, travelX: 0, travelY: 0, moved: false });
  const startDrag = () => {
    const rect = Platform.OS === 'web' ? (surface.current as unknown as HTMLElement | null)?.getBoundingClientRect() : undefined;
    // Pointer deltas on Web include the parent's display scale. Layout units do not.
    drag.current = { ...position, moved: false,
      travelX: travelX * (rect && bounds.width ? rect.width / bounds.width : 1),
      travelY: travelY * (rect && bounds.height ? rect.height / bounds.height : 1) };
  };
  const moveDrag = (dx: number, dy: number) => {
    const start = drag.current;
    if (quiet || (!start.moved && Math.hypot(dx, dy) <= 8)) return;
    start.moved = true;
    setPosition({ x: start.travelX ? clamp(start.x + dx / start.travelX) : start.x,
      y: start.travelY ? clamp(start.y + dy / start.travelY) : start.y });
  };
  const gestures = { scopeKey: page, activateOnPointerUp: true, onGestureStart: startDrag, onGestureMove: moveDrag,
    onGestureEnd: (dx: number, dy: number, dragged: boolean) => { if (dragged) moveDrag(dx, dy); },
    onGestureCancel: () => { drag.current.moved = false; } };
  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = window.visualViewport;
      const update = () => {
        const element = surface.current as unknown as HTMLElement | null;
        if (!viewport || !element || !element.clientHeight) return;
        const rect = element.getBoundingClientRect();
        setOccluded(Math.max(0, (rect.bottom - viewport.height - viewport.offsetTop) / (rect.height / element.clientHeight || 1)));
      };
      update();
      viewport?.addEventListener('resize', update);
      viewport?.addEventListener('scroll', update);
      return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
    }
    const show = Keyboard.addListener('keyboardDidShow', event => surface.current?.measureInWindow((_x, top, _w, h) =>
      setOccluded(Math.max(0, top + h - event.endCoordinates.screenY))));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOccluded(0));
    return () => { show.remove(); hide.remove(); };
  }, [bounds.height]);
  const hideDock = occluded > 100 && !panelOpen && !quiet;
  useEffect(() => { if (performance?.serial) play(performance.action); }, [performance, play]);
  const paused = !foreground || hideDock || collapsed;
  useEffect(() => {
    if (!unread || !ready || paused || quiet || panelOpen) return;
    play('wave');
    const repeat = setInterval(() => play('wave'), 18000);
    return () => clearInterval(repeat);
  }, [unread, ready, paused, quiet, panelOpen, play]);
  return <View ref={surface} pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={({ nativeEvent: { layout } }) =>
    setBounds(b => b.width === layout.width && b.height === layout.height ? b : { width: layout.width, height: layout.height })}>
    <View testID="companion-dock" pointerEvents={hideDock ? 'none' : 'box-none'} style={[s.dock, {
      width: dockWidth, height: dockHeight, left: x,
      top: y, opacity: hideDock || !bounds.width ? 0 : 1,
    }]}>
      <View pointerEvents="none" style={[s.ground, { width: width * .42, height: width * .42, transform: [{ scaleY: .12 }], bottom: trayHeight + height * .027 - width * .21 }, collapsed && s.invisible]} />
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[s.frame, { left: (dockWidth - width) / 2, width, height }, (!ready || collapsed) && s.invisible]}>
        <RenderBoundary><CharacterFrame src={src} mode={paused ? 'hidden' : quiet ? 'quiet' : listening ? (leftOfFace ? 'listen-left' : 'listen-right') : 'idle'}
          action={gesture.action} serial={gesture.serial} onState={async value => setReady(value)}
          dom={{ style: { width: '100%', height: '100%', backgroundColor: 'transparent' }, scrollEnabled: false }} /></RenderBoundary>
      </View>
      {collapsed ? <DirectionalPressable {...gestures} testID="companion-expand" label="展開小助手" style={s.restore}
        onPress={() => setMinimized(false)}><AppIcon name="message-text-outline" size={22} />{unread && <View style={s.dot} />}</DirectionalPressable>
        : quiet ? <DirectionalPressable {...gestures} testID="site-companion" label="跟助手揮手"
          style={[s.touch, { height, width }]} onPress={() => play('wave')}>{!ready && <AppIcon name="message-text-outline" />}</DirectionalPressable>
        : <>
          <DirectionalPressable {...gestures} testID="companion-head" label="摸摸助手的頭" hint="按住並拖動可移動小助手" style={[s.touch, { height: headHeight, width: Math.max(44, width * .68) }]}
            onPress={() => play('nod')}>{null}</DirectionalPressable>
          <DirectionalPressable {...gestures} activateOnPointerUp={false} testID="site-companion" label={panelOpen ? '收起角色對話' : unread ? '查看助手提醒' : '跟小助手對話'}
            expanded={panelOpen} hint="按住並拖動可移動小助手"
            onPress={() => onChat?.()} style={[s.touch, { height: height - headHeight, width: Math.max(44, width * .58) }]}>{!ready && <AppIcon name="message-text-outline" size={30} />}</DirectionalPressable>
          {unread && <View pointerEvents="none" style={s.badge}><AppIcon name="message-text-outline" size={15} /></View>}
          <View style={s.tray}>
            {!panelOpen && <Pressable testID="companion-microphone" accessibilityRole="button" accessibilityLabel="錄製語音訊息"
              disabled={!onVoice} accessibilityState={{ disabled: !onVoice }} onPress={onVoice} style={[s.control, !onVoice && s.disabled]}>
              <AppIcon name="microphone-outline" size={19} color={colors.ink} /></Pressable>}
            <DirectionalPressable {...gestures} testID="companion-move" label="移動小助手" hint="拖動調整位置，或點按切換左右"
              onPress={() => setPosition({ x: position.x >= .5 ? 0 : 1, y: position.y })} style={s.control}>
              <GripHorizontal size={18} color={colors.muted} /></DirectionalPressable>
            <DirectionalPressable {...gestures} testID="companion-minimize" label="收起小助手" style={s.control}
              onPress={() => { onCollapse?.(); setMinimized(true); }}><AppIcon name="chevron-down" size={16} /></DirectionalPressable>
          </View>
        </>}
    </View>
    {!quiet && !collapsed && <DialoguePlacement.Provider value={{ leftOfFace, seam, sideRoom, cheekBottom, entryTop, room: bounds.height }}>
      {children}
    </DialoguePlacement.Provider>}
  </View>;
}

const s = StyleSheet.create({
  dock: { position: 'absolute', alignItems: 'center', ...(Platform.OS === 'web' ? { touchAction: 'none' } : {}) },
  frame: { position: 'absolute', top: 0, left: 0 }, invisible: { opacity: 0 },
  ground: { position: 'absolute', borderRadius: 120, backgroundColor: 'rgba(69,96,82,.14)' },
  touch: { alignItems: 'center', justifyContent: 'center' },
  tray: { height: 38, flexDirection: 'row', alignItems: 'center' },
  control: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(246,251,249,.9)', borderRadius: 17 },
  disabled: { opacity: .4 },
  restore: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleTeal, borderWidth: 1, borderColor: colors.line },
  badge: { position: 'absolute', right: 4, top: '27%', backgroundColor: colors.accent, padding: 5, borderRadius: 11 },
  dot: { position: 'absolute', right: 4, top: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
});
