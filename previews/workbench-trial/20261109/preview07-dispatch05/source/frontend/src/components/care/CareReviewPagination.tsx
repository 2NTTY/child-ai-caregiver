import { Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { useContainerWidth } from "../useContainerWidth";

type Props = { page: number; pageSize: number; loadedCount: number; disabled: boolean; onPageChange(page: number): void };
type ControlInteraction = PressableStateCallbackType & { focused?: boolean };

// Only the loaded, filtered window is addressable; its last page is not a remote last page.
export function careReviewPageSlots(page: number, pageCount: number, compact: boolean): (number | "before" | "after")[] {
  const limit = compact ? 5 : 7;
  if (pageCount <= limit) return Array.from({ length: pageCount }, (_, index) => index);
  if (compact) {
    if (page < 2) return [0, 1, 2, "after", pageCount - 1];
    if (page >= pageCount - 2) return [0, "before", pageCount - 3, pageCount - 2, pageCount - 1];
    return [0, "before", page, "after", pageCount - 1];
  }
  if (page < 4) return [0, 1, 2, 3, 4, "after", pageCount - 1];
  if (page >= pageCount - 4) return [0, "before", pageCount - 5, pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1];
  return [0, "before", page - 1, page, page + 1, "after", pageCount - 1];
}

export function CareReviewPagination({ page, pageSize, loadedCount, disabled, onPageChange }: Props) {
  const layout = useContainerWidth(), compact = layout.width < 480;
  const pageCount = Math.ceil(loadedCount / pageSize);
  if (pageCount < 2) return null;
  const changePage = (next: number) => { if (!disabled && next >= 0 && next < pageCount && next !== page) onPageChange(next); };
  return <View ref={layout.ref} onLayout={layout.onLayout} style={s.footer} testID="care-review-pagination">
    <View role="navigation" accessibilityLabel="核對記錄已載入頁面" style={s.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一頁" accessibilityState={{ disabled: disabled || page === 0 }} disabled={disabled || page === 0}
        onPress={() => changePage(page - 1)} style={({ pressed, focused }: ControlInteraction) => [s.control, !compact && s.direction, (disabled || page === 0) && s.disabled, pressed && !disabled && s.pressed, focused && s.focused]}>
        <AppIcon name="chevron-left" size={18} color={colors.deepTeal} />{!compact ? <Text style={s.label}>上一頁</Text> : null}
      </Pressable>
      <View role="list" style={s.pages}>
        {careReviewPageSlots(page, pageCount, compact).map(slot => <View role="listitem" key={slot}>
          {typeof slot === "number" ? <Pressable accessibilityRole="button" accessibilityLabel={`第 ${slot + 1} 頁，已載入`} aria-current={slot === page ? "page" : undefined}
            accessibilityState={{ disabled }} disabled={disabled} onPress={() => changePage(slot)}
            style={({ pressed, focused }: ControlInteraction) => [s.control, slot === page && s.current, disabled && s.disabled, pressed && !disabled && s.pressed, focused && (slot === page ? s.focusedCurrent : s.focused)]}>
            <Text style={[s.label, slot === page && s.currentLabel]}>{slot + 1}</Text>
          </Pressable> : <Text accessibilityLabel="其他已載入頁面" style={s.ellipsis}>…</Text>}
        </View>)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="下一頁" accessibilityState={{ disabled: disabled || page === pageCount - 1 }} disabled={disabled || page === pageCount - 1}
        onPress={() => changePage(page + 1)} style={({ pressed, focused }: ControlInteraction) => [s.control, !compact && s.direction, (disabled || page === pageCount - 1) && s.disabled, pressed && !disabled && s.pressed, focused && s.focused]}>
        {!compact ? <Text style={s.label}>下一頁</Text> : null}<AppIcon name="chevron-right" size={18} color={colors.deepTeal} />
      </Pressable>
    </View>
    <Text accessibilityLiveRegion="polite" style={s.summary}>第 {page * pageSize + 1}–{Math.min((page + 1) * pageSize, loadedCount)} 項 · 已載入 {loadedCount} 項</Text>
  </View>;
}

const s = StyleSheet.create({
  footer: { minWidth: 0, alignItems: "center", gap: spacing.xs, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  navigation: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  pages: { flexDirection: "row", alignItems: "center", gap: 4 },
  control: { minWidth: 32, minHeight: 44, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: radius.small, borderWidth: 2, borderColor: "transparent" },
  direction: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  label: { fontFamily: chineseFont, ...readingType.tool, color: colors.deepTeal },
  current: { backgroundColor: colors.deepTeal, borderColor: colors.deepTeal },
  currentLabel: { color: colors.white, fontWeight: "700" },
  ellipsis: { minWidth: 12, textAlign: "center", fontFamily: chineseFont, ...readingType.meta, color: colors.muted },
  summary: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, textAlign: "center" },
  disabled: { opacity: 0.45 }, pressed: { borderColor: colors.deepTeal }, focused: { borderColor: colors.ink }, focusedCurrent: { borderColor: colors.white },
});
