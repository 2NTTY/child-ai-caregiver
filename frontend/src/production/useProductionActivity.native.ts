import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";

/** Device state only. Network metadata never substitutes for Server identity or permissions. */
export function useProductionActivity() {
  const [active, setActive] = useState(AppState.currentState === "active");
  const [network, setNetwork] = useState<NetworkState>({});
  useEffect(() => {
    let live = true, observed = false;
    const app = AppState.addEventListener("change", value => setActive(value === "active"));
    const connection = addNetworkStateListener(value => { observed = true; if (live) setNetwork(value); });
    void getNetworkStateAsync().then(value => { if (live && !observed) setNetwork(value); }).catch(() => {});
    return () => { live = false; app.remove(); connection.remove(); };
  }, []);
  const online = network.isConnected === false || network.isInternetReachable === false ? false
    : network.isConnected === true || network.isInternetReachable === true ? true : undefined;
  return { active, online };
}
