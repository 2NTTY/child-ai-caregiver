import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, mobileLayout } from '../../theme';

export function CompanionPopover({ children }: { children: ReactNode }) {
  const host = useRef<View>(null);
  const [height, setHeight] = useState(0), [covered, setCovered] = useState(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = window.visualViewport;
      const update = () => {
        const element = host.current as unknown as HTMLElement | null;
        if (!element || !viewport) return;
        const rect = element.getBoundingClientRect(), scale = rect.height / (element.clientHeight || 1);
        setCovered(Math.max(0, (rect.bottom - viewport.height - viewport.offsetTop) / (scale || 1)));
      };
      update();
      viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
      return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
    }
    const show = Keyboard.addListener('keyboardDidShow', event => host.current?.measureInWindow((_x, y, _w, h) =>
      setCovered(Math.max(0, y + h - event.endCoordinates.screenY))));
    const hide = Keyboard.addListener('keyboardDidHide', () => setCovered(0));
    return () => { show.remove(); hide.remove(); };
  }, [height]);
  const bottom = Math.max(covered, Platform.OS === 'web' ? 0 : insets.bottom + mobileLayout.tabMinHeight);
  return <View ref={host} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill}
    onLayout={e => setHeight(e.nativeEvent.layout.height)}>
    <View testID="companion-popover" accessibilityLabel="頁內對話" style={[styles.panel, {
      bottom: bottom + 8, maxHeight: height ? Math.max(0, height - bottom - 16) : '94%',
    }]}>{children}</View>
  </View>;
}
const styles = StyleSheet.create({
  panel: { position: 'absolute', right: 8, width: '96%', maxWidth: 316, backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 12, gap: 6,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 5 }, shadowOpacity: .15, shadowRadius: 16, elevation: 5 },
});
