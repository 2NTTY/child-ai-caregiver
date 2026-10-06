import type { ReactNode } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppButton } from "../components/ui";
import { BrandLogo } from "../components/BrandLogo";
import { colors, spacing } from "../theme";
import { useProduction } from "./ProductionProvider";

export function ProductionGate({ children }: { children: ReactNode }) {
  const { identityKey, auth, recordsState, refresh, online } = useProduction();
  if (identityKey) return children;
  if (auth === "signedOut") return <Redirect href="/login" />;
  return <View style={styles.gate} testID="production-session-gate">
    <BrandLogo style={styles.logo} />
    <Text accessibilityLiveRegion="polite">{recordsState.busy === "logout" ? "正在確認登出…" : auth === "checking" ? "正在確認登入狀態…" : "暫時未能確認登入狀態；私人內容已隱藏。"}</Text>
    {recordsState.notice ? <Text>{recordsState.notice}</Text> : null}
    {auth !== "checking" && recordsState.busy !== "logout" ? <AppButton label="重新檢查登入狀態" disabled={!online} onPress={() => { void refresh(); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({ gate: { flex: 1, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg }, logo: { width: 164, height: 53 } });
