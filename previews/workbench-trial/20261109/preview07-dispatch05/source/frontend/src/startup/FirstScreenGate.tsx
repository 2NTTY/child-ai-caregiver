import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { firstScreenImageFallbackMs, firstScreenImagesSettled, requiredFirstScreenImages, settleFirstScreenImage, type FirstScreenImage, type ImageOutcome, type ImageOutcomes } from "./imageReadiness";

import type { StartupReadiness } from "./dataReadiness";

type FirstScreenContextValue = {
  ready: boolean;
  outcomes: ImageOutcomes;
  settle: (image: FirstScreenImage, outcome: ImageOutcome) => void;
};
const FirstScreenContext = createContext<FirstScreenContextValue>({ ready: true, outcomes: {}, settle: () => {} });

export function FirstScreenGate({ pathname, width, launch, children, dataState = "ready", startupKey = "initial" }: { pathname: string; width: number; launch: ReactNode; children: ReactNode; dataState?: StartupReadiness; startupKey?: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const revealed = revealedKey === startupKey;
  const [outcomes, setOutcomes] = useState<ImageOutcomes>({});
  const required = useMemo(() => requiredFirstScreenImages(pathname, width), [pathname, width]);
  const requiredKey = required.join(":");
  const ready = hydrated && (revealed || dataState !== "loading" && (dataState === "error" || firstScreenImagesSettled(required, outcomes)));
  const gate = useRef({ revealed, required });
  gate.current = { revealed, required };

  useEffect(() => { setHydrated(true); }, []);
  useLayoutEffect(() => { if (ready) setRevealedKey(startupKey); }, [ready, startupKey]);
  const settle = useCallback((image: FirstScreenImage, outcome: ImageOutcome) => {
    if (gate.current.revealed || !gate.current.required.includes(image)) return;
    setOutcomes(current => settleFirstScreenImage(current, image, outcome));
  }, []);

  useEffect(() => {
    if (!hydrated || revealed || required.length === 0) return;
    const timer = setTimeout(() => {
      setOutcomes(current => required.reduce((next, image) => settleFirstScreenImage(next, image, "fallback"), current));
    }, firstScreenImageFallbackMs);
    return () => { clearTimeout(timer); };
  }, [hydrated, revealed, requiredKey]);

  const context = useMemo(() => ({ ready, outcomes, settle }), [ready, outcomes, settle]);
  return <FirstScreenContext.Provider value={context}>
    <View style={styles.root} testID={ready ? "frontend-preview-ready" : undefined} aria-busy={!ready}
      {...{ dataSet: { startupState: ready ? "ready" : "loading", startupData: dataState, startupImages: Object.entries(outcomes).map(([image, outcome]) => `${image}:${outcome}`).join(",") } }}>
      <View style={[styles.routes, !ready && styles.pending]} pointerEvents={ready ? "auto" : "none"}
        accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"} aria-hidden={!ready}
        {...(Platform.OS === "web" ? { inert: !ready } : {})}>
        {hydrated ? children : null}
      </View>
      {!ready ? <View testID="frontend-startup-loading" style={styles.launch} accessibilityLiveRegion="polite">{launch}</View> : null}
    </View>
  </FirstScreenContext.Provider>;
}

export function useFirstScreenReady() { return useContext(FirstScreenContext).ready; }

export function useFirstScreenImage(image: FirstScreenImage, layoutReady = true) {
  const { outcomes, settle } = useContext(FirstScreenContext);
  const [loaded, setLoaded] = useState(false);
  const [failedImage, setFailedImage] = useState<FirstScreenImage | null>(null);
  const onLoad = useCallback(() => { setLoaded(true); }, []);
  const onError = useCallback(() => { setFailedImage(image); settle(image, "fallback"); }, [image, settle]);
  // RN Web 0.21.2 Image already waits for HTMLImageElement.decode before onLoad.
  // Wait for the actual image geometry too, then reveal this mounted tree.
  useLayoutEffect(() => { if (loaded && layoutReady) settle(image, "loaded"); }, [image, loaded, layoutReady, settle]);
  return { onLoad, onError, fallback: failedImage === image || outcomes[image] === "fallback" };
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  routes: { flex: 1, minHeight: 0 },
  pending: { opacity: 0 },
  launch: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas },
});
