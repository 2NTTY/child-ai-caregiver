// Keep context-module imports separate from entry side effects, as in Expo's qualified entry.
import { createElement } from "react";
import { ctx } from "expo-router/_ctx";
import { ExpoRoot } from "expo-router";
import Head from "expo-router/head";
import "expo-router/build/fast-refresh";
import { ProductionOwnerHost } from "../production/ProductionProvider";

// The original owner outlives Expo's replaceable __root screen, not the application.
export function App() {
  return createElement(Head.Provider, null, createElement(ExpoRoot, { context: ctx, wrapper: ProductionOwnerHost }));
}
