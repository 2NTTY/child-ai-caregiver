import { chineseFont } from "../../../theme";
import { taskWorkbenchColors as colors } from "../../../preview/tasks-global-base/contract";
import type { AppSelectionTriggerAppearance } from "../../ui";
import type { TaskPresentationVariant } from "./contracts";

// Pinned source geometry with fixed host color/font roles. Shared touch targets
// and behavior stay on the host primitive; source identities remain historical.

const appearances: Readonly<Record<Exclude<TaskPresentationVariant, "harbour">, AppSelectionTriggerAppearance>> = {
  care: {
    style: { borderColor: colors.controlOutline, backgroundColor: colors.controlSurface, borderRadius: 8 },
    labelStyle: { color: colors.ink, fontFamily: chineseFont },
    countStyle: { backgroundColor: colors.sage },
    countLabelStyle: { color: colors.ink, fontFamily: chineseFont },
    pressedStyle: { backgroundColor: colors.paleTeal }, iconColor: colors.deepTeal,
  },
  handbook: {
    style: { borderColor: colors.controlOutline, backgroundColor: colors.controlSurface, borderRadius: 8 },
    labelStyle: { color: colors.ink, fontFamily: chineseFont },
    countStyle: { backgroundColor: colors.sage },
    countLabelStyle: { color: colors.ink, fontFamily: chineseFont },
    pressedStyle: { backgroundColor: colors.paleTeal }, iconColor: colors.deepTeal,
  },
  fourth: {
    style: { borderColor: colors.controlOutline, backgroundColor: colors.controlSurface, borderRadius: 10 },
    labelStyle: { color: colors.ink, fontFamily: chineseFont },
    countStyle: { backgroundColor: colors.sage },
    countLabelStyle: { color: colors.ink, fontFamily: chineseFont },
    pressedStyle: { backgroundColor: colors.paleTeal }, iconColor: colors.deepTeal,
  },
};

/** Undefined retains the ordinary app/Harbour appearance. No source admission. */
export function taskSelectionAppearance(variant?: TaskPresentationVariant): AppSelectionTriggerAppearance | undefined {
  return variant === undefined || variant === "harbour" ? undefined : appearances[variant];
}
