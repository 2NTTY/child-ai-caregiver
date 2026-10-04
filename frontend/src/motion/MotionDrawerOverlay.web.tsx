import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { MotionDrawerRight } from "./MotionDrawerRight";
import { MotionPaperScope } from "./MotionPaperScope";
import { useDrawerFocus } from "./useDrawerFocus.web";
import { colors } from "../theme";
import type { DrawerOverlayProps } from "./DrawerOverlay.types";

function DrawerContents(props: DrawerOverlayProps) {
  const surface = useRef<View>(null);
  const width = Math.min(useWindowDimensions().width * 0.92, 370);
  useDrawerFocus(props, surface);
  return <View style={styles.overlay} pointerEvents={props.open ? "auto" : "none"}>
    <MotionPaperScope>
      <View style={styles.row} pointerEvents="box-none">
        <MotionDrawerRight open={props.open} width={width} mode="overlay" scopeKey={props.scopeKey} surfaceRef={surface}
          onBackdropPress={props.onRequestClose}
          role="dialog" aria-modal={props.open} accessibilityLabel={props.label} tabIndex={-1} style={styles.surface}>{props.children}</MotionDrawerRight>
      </View>
    </MotionPaperScope>
  </View>;
}

export function MotionDrawerOverlay(props: DrawerOverlayProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = document.createElement("div");
    Object.assign(element.style, { position: "fixed", inset: "0", zIndex: "9998", pointerEvents: "none" });
    document.body.appendChild(element); setHost(element);
    return () => { element.remove(); };
  }, []);
  return host ? createPortal(<DrawerContents {...props} />, host) : null;
}
const styles = StyleSheet.create({ overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }, row: { flex: 1, flexDirection: "row", justifyContent: "flex-end" }, surface: { backgroundColor: colors.sidebar } });
