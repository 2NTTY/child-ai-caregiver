// Expo's runtime must precede entry side effects for web Fast Refresh.
import "@expo/metro-runtime";
import "./src/platform/runtime";
// Observe native browser traversal before Expo installs its router listener.
import "./src/preview/browser-history-events";
import { App } from "./src/entry/Application";
import { renderRootComponent } from "expo-router/build/renderRootComponent";

// Preserve Expo's registration, splash handling and platform entry behavior.
renderRootComponent(App);
