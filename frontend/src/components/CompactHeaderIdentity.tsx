import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { MotionInlineSwap } from "../motion";
import type { HomeActions, HomeViewModel } from "../view-model";
import { ChildKeyFacts } from "./ChildKeyFacts";
import { ChildPicker } from "./ChildPicker";

export function CompactHeaderIdentity({ showContext, scopeKey, routeKey, model, actions, brand }: {
  showContext: boolean; scopeKey: string; routeKey: string; model: HomeViewModel; actions: HomeActions; brand: ReactNode;
}) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const contextKey = `${scopeKey}:${routeKey}:${showContext ? "visible" : "hidden"}`;
  return <MotionInlineSwap active={showContext} scopeKey={scopeKey} resetKey={routeKey} primary={brand}
    testID="mobile-header-identity" style={styles.slot}>
    <ChildKeyFacts key={contextKey} child={child} load={model.profileLoad} leading={
      <ChildPicker children={model.children} selectedId={model.selectedChildId} onSelect={actions.selectChild} compact />
    } />
  </MotionInlineSwap>;
}

const styles = StyleSheet.create({ slot: { flex: 1, minWidth: 0, height: 48 } });
