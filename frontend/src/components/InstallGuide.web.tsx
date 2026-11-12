import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";

export function InstallGuide() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () => setShow(/iPhone/u.test(navigator.userAgent) && !display.matches
      && (navigator as Navigator & {standalone?:boolean}).standalone !== true);
    update(); display.addEventListener("change", update);
    return () => display.removeEventListener("change", update);
  }, []);
  if (!show) return null;
  return <View testID="home-screen-install-guide" style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>加入 iPhone 主畫面</Text>
    <Text style={styles.body}>在 Safari 開啟育有方，按分享按鈕 →「加入主畫面」→「加入」。如有「作為網頁 App 開啟」，請保持開啟，再由主畫面的育有方圖示進入。</Text>
    <Text style={styles.body}>若在其他 App 內開啟，先選「在 Safari 開啟」。加入後仍使用同一帳戶；如需登入，請使用原有登入方式。</Text>
    <Text style={styles.body}>拍照、相簿、錄音及文件會先加入未送出草稿，按送出才上傳。HEIC 會嘗試在本機轉為 JPEG；未能轉換時可改選 JPEG／PNG。</Text>
    <Text style={styles.body}>iPhone 主畫面通知需要 iOS 16.4 或以上，加入後到「設定」由你開啟。使用時需要網絡連線。</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool } });
