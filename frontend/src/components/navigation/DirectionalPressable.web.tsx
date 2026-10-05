import { useEffect, useLayoutEffect, useRef } from "react";
import { Pressable, type View } from "react-native";
import type { DirectionalPressableProps } from "./DirectionalPressable";
import { createPointerClickGate } from "./pointer-click-gate";

export function DirectionalPressable(props: DirectionalPressableProps) {
  const node = useRef<View>(null), latest = useRef(props); latest.current = props;
  // Navigation can replace listeners between pointerup and its compatibility click.
  const clickGate = useRef(createPointerClickGate()).current;
  useLayoutEffect(() => {
    const element = node.current as unknown as HTMLElement | null;
    if (!element) return;
    let pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
    const cancel = () => {
      if (!pointer) return;
      const id = pointer.id; pointer = null; clickGate.suppressNextClick();
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      latest.current.onGestureCancel();
    };
    const down = (event: PointerEvent) => {
      if (latest.current.disabled || event.button !== 0 || !event.isPrimary) return;
      clickGate.beginActivation();
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      element.setPointerCapture(event.pointerId); latest.current.onGestureStart();
    };
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      pointer.moved ||= Math.hypot(dx, dy) > 8;
      latest.current.onGestureMove(dx, dy);
    };
    const up = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const gesture = pointer; pointer = null;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      const dragged = gesture.moved || Math.hypot(dx, dy) > 8;
      if (dragged) clickGate.suppressNextClick();
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      latest.current.onGestureEnd(dx, dy, dragged);
    };
    const click = (event: MouseEvent) => {
      // Keyboard and assistive activation do not belong to the cancelled pointer.
      if (event.detail === 0) { clickGate.beginActivation(); return; }
      if (!clickGate.consumeClick()) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") clickGate.beginActivation();
      if (event.key === "Escape") { cancel(); latest.current.onGestureCancel(); }
      if (event.key === "ArrowUp" && latest.current.onExpand && !latest.current.disabled) {
        event.preventDefault(); latest.current.onExpand();
      }
    };
    const hidden = () => { if (document.hidden) cancel(); };
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up); element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", cancel); element.addEventListener("click", click, true);
    element.addEventListener("keydown", key); window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel(); element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel); element.removeEventListener("click", click, true);
      element.removeEventListener("keydown", key); window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [props.scopeKey, props.disabled, clickGate]);
  useEffect(() => { if (props.disabled) props.onGestureCancel(); }, [props.disabled]);
  return <Pressable ref={node} accessibilityRole="button" accessibilityLabel={props.label} accessibilityHint={props.hint}
    accessibilityState={{ disabled: !!props.disabled }} disabled={props.disabled} testID={props.testID}
    style={props.style} onPress={props.onPress}>{props.children}</Pressable>;
}
