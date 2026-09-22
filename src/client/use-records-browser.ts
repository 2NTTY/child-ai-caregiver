import { useEffect, useRef, useState } from "react";
import type { RecordsController } from "./records-controller";

/** Browser events stay outside the shared input rules and page-memory controller. */
export function useRecordsBrowser(controller: RecordsController, apiBaseUrl: string, authDirty: boolean): string {
  const [serverAddress, setServerAddress] = useState(apiBaseUrl);
  const dirtyAuth = useRef(authDirty);
  dirtyAuth.current = authDirty;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const base = apiBaseUrl.replace(/\/$/, "");
    setServerAddress(new URL(base.endsWith("/api") ? base : `${base}/api`, window.location.href).href);
    controller.setOnline(window.navigator.onLine);
    void controller.restoreSession();

    const online = () => controller.setOnline(true);
    const offline = () => controller.setOnline(false);
    const focus = () => {
      if (document.visibilityState === "visible" && controller.getSnapshot().online && controller.getSnapshot().auth === "signedIn") {
        void controller.restoreSession();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.hasUnsavedInput() || dirtyAuth.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("beforeunload", beforeUnload);
      controller.dispose();
    };
  }, [apiBaseUrl, controller]);

  return serverAddress;
}
