import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import type { ImageSourcePropType } from "react-native";
import type { PickedBackgroundImage } from "../background-view-model";
import { backgroundStorage } from "../platform/background-storage";

export const defaultHomeBackground: ImageSourcePropType = require("../../assets/images/harbour-family-hero.png");
type BackgroundContextValue = {
  source: ImageSourcePropType; selected: PickedBackgroundImage | null;
  busy: boolean; notice: string;
  select(image: PickedBackgroundImage): Promise<void>;
  restore(): Promise<void>;
  imageFailed(image: PickedBackgroundImage): void;
};
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

// Existing dashboard provider, now backed by a device-local presentation port.
// The stable storage scope is service + user; the host still keys lifetime by session identity.
export function BackgroundProvider({ children, scope = null }: { children: ReactNode; scope?: string | null }) {
  const [selection, setSelection] = useState<{ scope: string | null; image: PickedBackgroundImage | null }>({ scope, image: null });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const current = useRef<PickedBackgroundImage | null>(null);
  const generation = useRef(0), active = useRef(false), currentScope = useRef(scope), writing = useRef(false);
  currentScope.current = scope;
  const release = () => { current.current?.dispose(); current.current = null; };
  useFocusEffect(useCallback(() => {
    active.current = true; const token = ++generation.current;
    release(); setSelection({ scope, image: null }); setNotice(""); setBusy(!!scope);
    if (scope) void backgroundStorage.read(scope).then(image => {
      if (!active.current || token !== generation.current || currentScope.current !== scope) { image?.dispose(); return; }
      current.current = image; setSelection({ scope, image });
    }).catch(() => {
      if (active.current && token === generation.current) setNotice("未能讀取本機背景，暫用預設背景。可重新選圖或恢復預設。");
    }).finally(() => { if (active.current && token === generation.current) setBusy(false); });
    return () => { active.current = false; generation.current++; release(); setSelection({ scope: null, image: null }); };
  }, [scope]));
  async function select(image: PickedBackgroundImage) {
    if (!scope || !active.current || writing.current || currentScope.current !== scope) { image.dispose(); return; }
    writing.current = true; const token = ++generation.current; setBusy(true); setNotice("");
    try {
      const saved = await backgroundStorage.save(scope, image);
      if (!active.current || token !== generation.current || currentScope.current !== scope) { saved.dispose(); return; }
      release(); current.current = saved; setSelection({ scope, image: saved });
      setNotice("背景已保存在此裝置，不會同步到其他裝置。");
    } catch {
      if (active.current && token === generation.current) setNotice("未能保存本機背景，原有背景仍然保留。請檢查裝置儲存空間後再試。");
    } finally {
      image.dispose(); writing.current = false;
      if (active.current && token === generation.current) setBusy(false);
    }
  }
  async function restore() {
    if (!scope || !active.current || writing.current || currentScope.current !== scope) return;
    writing.current = true; const token = ++generation.current; setBusy(true);
    try {
      await backgroundStorage.remove(scope);
      if (!active.current || token !== generation.current || currentScope.current !== scope) return;
      release(); setSelection({ scope, image: null }); setNotice("已恢復預設背景。");
    } catch { if (active.current && token === generation.current) setNotice("未能清除本機背景，請重試；目前設定沒有當成已重設。"); }
    finally { writing.current = false; if (active.current && token === generation.current) setBusy(false); }
  }
  const selected = selection.scope === scope && active.current ? selection.image : null;
  function imageFailed(image: PickedBackgroundImage) {
    if (!active.current || currentScope.current !== scope || current.current !== image) return;
    release(); setSelection({ scope, image: null }); setNotice("這張圖片未能顯示，暫用預設背景。請重新選圖或恢復預設。");
  }
  return <BackgroundContext.Provider value={{ source: selected ? { uri: selected.uri } : defaultHomeBackground, selected, busy, notice, select, restore, imageFailed }}>{children}</BackgroundContext.Provider>;
}
export function useBackground() {
  const value = useContext(BackgroundContext);
  if (!value) throw new Error("BackgroundProvider is required for homepage background");
  return value;
}
