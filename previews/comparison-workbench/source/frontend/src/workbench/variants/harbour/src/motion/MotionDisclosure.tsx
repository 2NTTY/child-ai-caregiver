import { motionData, type MotionViewProps } from "./viewProps";
import { useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { MotionEntrance } from "./MotionEntrance";

export interface MotionDisclosureProps extends MotionViewProps { expanded: boolean; scopeKey: string }

/** Layout reaches its terminal state immediately; only the retained content moves. */
export function MotionDisclosure({ expanded, scopeKey, style, children, ...props }: MotionDisclosureProps) {
  const inner = useRef<View>(null);
  const previous = useRef(false);
  const origin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inner.current as unknown as HTMLElement | null;
    if (!node) return;
    if (expanded && !previous.current && !node.contains(document.activeElement)) origin.current = document.activeElement as HTMLElement | null;
    if (!expanded && node.contains(document.activeElement)) {
      const target = origin.current;
      if (target?.isConnected && !target.hasAttribute("disabled") && target.getAttribute("aria-disabled") !== "true"
        && !target.closest('[inert],[aria-hidden="true"]')) target.focus({ preventScroll: true });
    }
    node.inert = !expanded;
    previous.current = expanded;
  }, [expanded, scopeKey]);
  return <View {...props} {...motionData({ ...props.dataSet, motionKind: "disclosure", motionPhase: "settled" })}
    style={[styles.outer, style, { display: expanded ? "flex" : "none", pointerEvents: expanded ? "auto" : "none" }]}>
    <View ref={inner} aria-hidden={!expanded} accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>
      <MotionEntrance triggerKey={expanded ? "expanded" : null} scopeKey={scopeKey} preset="panel">{children}</MotionEntrance>
    </View>
  </View>;
}
const styles = StyleSheet.create({ outer: { minWidth: 0 } });
