import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { PanResponder, View, type StyleProp, type ViewStyle } from "react-native";

export type DirectionalPressableProps = {
  children: ReactNode; label: string; hint?: string; disabled?: boolean; testID?: string;
  style: StyleProp<ViewStyle>; scopeKey: string; onPress(): void; onExpand?(): void;
  onGestureStart(): void; onGestureMove(dx: number, dy: number): void;
  onGestureEnd(dx: number, dy: number, dragged: boolean): void; onGestureCancel(): void;
};

// Native responder adapter. Web uses pointer capture and the same direction policy.
export function DirectionalPressable(props: DirectionalPressableProps) {
  const latest = useRef(props); latest.current = props;
  const cancelled = useRef(false), moved = useRef(false);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: () => { cancelled.current = false; moved.current = false; latest.current.onGestureStart(); },
    onPanResponderMove: (_, gesture) => { moved.current ||= Math.hypot(gesture.dx, gesture.dy) > 8; latest.current.onGestureMove(gesture.dx, gesture.dy); },
    onPanResponderRelease: (_, gesture) => {
      if (cancelled.current) return;
      const dragged = moved.current || Math.hypot(gesture.dx, gesture.dy) > 8;
      latest.current.onGestureEnd(gesture.dx, gesture.dy, dragged);
      if (!dragged) latest.current.onPress();
    },
    onPanResponderTerminate: () => { cancelled.current = true; latest.current.onGestureCancel(); },
    onPanResponderTerminationRequest: () => true,
  }), []);
  useEffect(() => () => { cancelled.current = true; latest.current.onGestureCancel(); }, [props.scopeKey]);
  return <View {...responder.panHandlers} accessible accessibilityRole="button" accessibilityLabel={props.label}
    accessibilityHint={props.hint} accessibilityState={{ disabled: !!props.disabled }}
    accessibilityActions={[{ name: "activate", label: props.label }, ...(props.onExpand ? [{ name: "expand", label: "更多選項" }] : [])]}
    onAccessibilityAction={event => { if (props.disabled) return; if (event.nativeEvent.actionName === "expand") props.onExpand?.(); else if (event.nativeEvent.actionName === "activate") props.onPress(); }}
    onAccessibilityTap={() => { if (!props.disabled) props.onPress(); }}
    testID={props.testID} style={props.style}>
    {props.children}
  </View>;
}
