import { StyleSheet, View } from "react-native";
import { HelperText, Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton } from "./ui";
import { StatusAnnouncement } from "./StatusAnnouncement";

export function FormFieldMessage({ id, error, help }: { id: string; error?: string; help?: string }) {
  return error || help ? <HelperText nativeID={id} type={error ? "error" : "info"} visible>{error ?? help}</HelperText> : null;
}

export function FormErrorSummary({ entries, onFocus, headingLevel = 3 }: {
  headingLevel?: 2 | 3 | 4;
  entries: readonly { field: string; label: string; message: string }[]; onFocus: (field: string) => void;
}) {
  const message = entries.length ? `有 ${entries.length} 項資料需要修正。${entries.map(item => `${item.label}：${item.message}`).join(" ")}` : "";
  return <><StatusAnnouncement eventKey={message} message={message} urgent />
    {entries.length ? <View testID="form-error-summary" style={styles.summary}>
      <Text accessibilityRole="header" aria-level={headingLevel} style={styles.heading}>請修正以下資料</Text>
      {entries.map(item => <View key={item.field} style={styles.entry}>
        <AppButton label={`修正${item.label}`} accessibilityLabel={`修正${item.label}`} variant="quiet" density="compact" style={styles.action} onPress={() => onFocus(item.field)} />
        <Text selectable style={styles.error}>{item.message}</Text>
      </View>)}
    </View> : null}</>;
}
const styles = StyleSheet.create({
  summary: { borderLeftWidth: 3, borderLeftColor: colors.errorInk, paddingLeft: spacing.md, gap: spacing.xs },
  entry: { minWidth: 0, gap: spacing.xs },
  action: { alignSelf: "flex-start", maxWidth: "100%" },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool, flexShrink: 1 },
  heading: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool, fontWeight: "700" },
});
