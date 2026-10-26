import { StyleSheet, View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton } from "./ui";
import { StatusAnnouncement } from "./StatusAnnouncement";

export function FormFieldMessage({ id, error, help }: { id: string; error?: string; help?: string }) {
  return error || help ? <HelperText nativeID={id} type={error ? "error" : "info"} visible>{error ?? help}</HelperText> : null;
}

export function FormErrorSummary({ entries, onFocus }: {
  entries: readonly { field: string; label: string; message: string }[]; onFocus: (field: string) => void;
}) {
  const message = entries.length ? `有 ${entries.length} 項資料需要修正。${entries.map(item => `${item.label}：${item.message}`).join(" ")}` : "";
  return <><StatusAnnouncement eventKey={message} message={message} urgent />
    {entries.length ? <View testID="form-error-summary" style={styles.summary}>
      <Text accessibilityRole="header" aria-level={2} style={styles.heading}>請修正以下資料</Text>
      {entries.map(item => <AppButton key={item.field} label={`${item.label}：${item.message}`} accessibilityLabel={`修正${item.label}`} variant="quiet" density="compact" onPress={() => onFocus(item.field)} />)}
    </View> : null}</>;
}
const styles = StyleSheet.create({
  summary: { borderLeftWidth: 3, borderLeftColor: colors.errorInk, paddingLeft: spacing.md, gap: spacing.xs },
  heading: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool, fontWeight: "700" },
});
