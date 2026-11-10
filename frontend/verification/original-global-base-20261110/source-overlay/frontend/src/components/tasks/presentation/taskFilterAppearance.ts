import type { AppTextFieldAppearance, UnderlineTabsAppearance } from "../../ui";
import type { TaskPresentationVariant } from "./contracts";
import { chineseFont } from "../../../theme";
import { taskWorkbenchColors, taskWorkbenchPaperTheme } from "../../../preview/tasks-global-base/contract";

const sources = {
  care: { colors: taskWorkbenchColors, font: chineseFont, theme: taskWorkbenchPaperTheme, radius: 8 },
  handbook: { colors: taskWorkbenchColors, font: chineseFont, theme: taskWorkbenchPaperTheme, radius: 8 },
  fourth: { colors: taskWorkbenchColors, font: chineseFont, theme: taskWorkbenchPaperTheme, radius: 10 },
} as const;
const fields: Partial<Record<TaskPresentationVariant, AppTextFieldAppearance>> = {};
const tabs: Partial<Record<TaskPresentationVariant, UnderlineTabsAppearance>> = {};
for (const variant of ["care", "handbook", "fourth"] as const) {
  const { colors, font, theme, radius } = sources[variant];
  fields[variant] = {
    style: { backgroundColor: colors.controlSurface, fontFamily: font },
    outlineStyle: { borderColor: colors.controlOutline, borderRadius: radius }, theme,
  };
  tabs[variant] = {
    railStyle: { borderBottomColor: colors.line, backgroundColor: "transparent", borderTopLeftRadius: 0, borderTopRightRadius: 0 },
    tabStyle: { minHeight: 46, paddingHorizontal: 8 },
    activeStyle: { borderBottomColor: colors.teal },
    pressedStyle: { backgroundColor: colors.paleTeal },
    labelStyle: { color: colors.muted, fontFamily: font },
    activeLabelStyle: { color: colors.deepTeal },
    countStyle: { backgroundColor: colors.sage },
    countLabelStyle: { color: colors.ink, fontFamily: font },
    markerColor: colors.teal,
  };
}
export const taskSearchAppearance = (variant?: TaskPresentationVariant) => variant === undefined ? undefined : fields[variant];
export const taskTabsAppearance = (variant: TaskPresentationVariant) => tabs[variant];
export const handbookFilterHeadingStyle = { borderBottomColor: taskWorkbenchColors.line };
