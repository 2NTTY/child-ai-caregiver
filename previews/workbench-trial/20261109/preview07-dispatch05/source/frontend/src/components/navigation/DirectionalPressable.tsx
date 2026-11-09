import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { PanResponder, View, type StyleProp, type ViewStyle } from "react-native";

export type DirectionalPressableProps = {
  children: ReactNode; label: string; hint?: string; disabled?: boolean; expanded?: boolean; selected?: boolean; current?: boolean; testID?: string;
  style: StyleProp<ViewStyle>; scopeKey: string; onPress(): void; onExpand?(): void; onLongPress?(): void;
  onGestureStart(): void; onGestureMove(dx: number, dy: number): void;
  onGestureEnd(dx: number, dy: number, dragged: boolean): void; onGestureCancel(): void;
};

// Native responder adapter. Web uses pointer capture and the same direction policy.
export function DirectionalPressable(props: DirectionalPressableProps) {
  const latest = useRef(props); latest.current = props;
  const cancelled = useRef(false), moved = useRef(false), held = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLongPress = () => { if (longPressTimer.current !== null) clearTimeout(longPressTimer.current); longPressTimer.current = null; };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: () => {
      clearLongPress(); cancelled.current = false; moved.current = false; held.current = false; latest.current.onGestureStart();
      if (latest.current.onLongPress) longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        if (cancelled.current || moved.current || latest.current.disabled) return;
        held.current = true; latest.current.onLongPress?.();
      }, 450);
    },
    onPanResponderMove: (_, gesture) => { moved.current ||= Math.hypot(gesture.dx, gesture.dy) > 8; if (moved.current) clearLongPress(); latest.current.onGestureMove(gesture.dx, gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      clearLongPress();
      if (cancelled.current) return;
      const dragged = moved.current || Math.hypot(gesture.dx, gesture.dy) > 8;
      if (held.current && !dragged) return;
      latest.current.onGestureEnd(gesture.dx, gesture.dy, dragged);
      if (!dragged) latest.current.onPress();
    },
    onPanResponderTerminate: () => { clearLongPress(); cancelled.current = true; latest.current.onGestureCancel(); },
    onPanResponderTerminationRequest: () => true,
  }), []);
  useEffect(() => {
    if (props.disabled) { clearLongPress(); cancelled.current = true; latest.current.onGestureCancel(); }
    return () => { clearLongPress(); cancelled.current = true; latest.current.onGestureCancel(); };
  }, [props.scopeKey, props.disabled]);
  return <View {...responder.panHandlers} accessible accessibilityRole="button" accessibilityLabel={props.label}
    accessibilityHint={props.hint} accessibilityState={{ disabled: !!props.disabled, expanded: props.expanded, selected: props.selected }}
    accessibilityActions={[{ name: "activate", label: props.label }, ...(props.onExpand ? [{ name: props.expanded ? "collapse" : "expand", label: props.expanded ? "收起選項" : "更多選項" }] : [])]}
    onAccessibilityAction={event => { if (props.disabled) return; if (event.nativeEvent.actionName === "expand") props.onExpand?.(); else if (event.nativeEvent.actionName === "collapse") props.onGestureCancel(); else if (event.nativeEvent.actionName === "activate") props.onPress(); }}
    onAccessibilityEscape={() => { if (props.expanded) props.onGestureCancel(); }}
    onAccessibilityTap={() => { if (!props.disabled) props.onPress(); }}
    testID={props.testID} style={props.style}>
    {props.children}
  </View>;
}
