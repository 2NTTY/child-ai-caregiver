import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import type { ImageSourcePropType } from "react-native";
import type { PickedBackgroundImage } from "../background-view-model";

export const defaultHomeBackground: ImageSourcePropType = require("../../assets/images/harbour-family-hero.png");
type BackgroundContextValue = {
  source: ImageSourcePropType;
  selected: PickedBackgroundImage | null;
  select: (image: PickedBackgroundImage) => void;
  restore: () => void;
};
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

// Session-only preview; remount with a real identity/session key during formal integration.
export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<PickedBackgroundImage | null>(null);
  const current = useRef<PickedBackgroundImage | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; current.current?.dispose(); current.current = null; };
  }, []);
  const select = useCallback((image: PickedBackgroundImage) => {
    if (!alive.current) { image.dispose(); return; }
    const previous = current.current;
    current.current = image;
    setSelected(image);
    previous?.dispose();
  }, []);
  const restore = useCallback(() => {
    const previous = current.current;
    current.current = null;
    setSelected(null);
    previous?.dispose();
  }, []);
  // Router Stack may retain the previous screen. Clear local images on route-group blur too.
  useFocusEffect(useCallback(() => {
    alive.current = true;
    return () => { alive.current = false; restore(); };
  }, [restore]));
  return <BackgroundContext.Provider value={{ source: selected ? { uri: selected.uri } : defaultHomeBackground, selected, select, restore }}>{children}</BackgroundContext.Provider>;
}

export function useBackground() {
  const value = useContext(BackgroundContext);
  if (!value) throw new Error("BackgroundProvider is required for homepage background preview");
  return value;
}
