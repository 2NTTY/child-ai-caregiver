import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";

/** Device state only. Network metadata never substitutes for Server identity or permissions. */
export function useProductionActivity() {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [network, setNetwork] = useState<NetworkState>({});
  useEffect(() => {
    let live = true, revision = 0;
    const refresh = () => {
      const expected = ++revision;
      void getNetworkStateAsync().then(value => { if (live && expected === revision) setNetwork(value); }).catch(() => {});
    };
    const app = AppState.addEventListener("change", value => {
      setActive(value === "active");
      // Android may miss a connectivity event while suspended. Re-read on foreground;
      // never invent an online state or overwrite a newer event with a late read.
      if (value === "active") refresh();
    });
    const connection = addNetworkStateListener(value => { revision++; if (live) setNetwork(value); });
    refresh();
    return () => { live = false; app.remove(); connection.remove(); };
  }, []);
  const online = network.isConnected === false || network.isInternetReachable === false ? false
    : network.isConnected === true || network.isInternetReachable === true ? true : undefined;
  return { active, online };
}
