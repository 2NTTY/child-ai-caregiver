import { Platform } from "react-native";
import type { AppSelectionTriggerAppearance } from "../../ui";
import type { TaskPresentationVariant } from "./contracts";

// Exact ui.tsx/theme.ts differences from the pinned Care, Handbook and Fourth
// sources. Shared geometry, touch targets and behavior stay on the host primitive.
const careFont = Platform.select({ web: "Inter, -apple-system, BlinkMacSystemFont, 'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif", default: undefined });
const handbookFont = Platform.select({ web: "'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif", default: undefined });
const fourthFont = Platform.select({ web: "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif", default: undefined });

const appearances: Readonly<Record<Exclude<TaskPresentationVariant, "harbour">, AppSelectionTriggerAppearance>> = {
  care: {
    style: { borderColor: "#708A7C", backgroundColor: "#FFFFFF", borderRadius: 8 },
    labelStyle: { color: "#173534", fontFamily: careFont },
    countStyle: { backgroundColor: "#DCEEE7" },
    countLabelStyle: { color: "#173534", fontFamily: careFont },
    pressedStyle: { backgroundColor: "#EAF4EF" }, iconColor: "#104E49",
  },
  handbook: {
    style: { borderColor: "#657F8A", backgroundColor: "#FFFFFF", borderRadius: 8 },
    labelStyle: { color: "#183747", fontFamily: handbookFont },
    countStyle: { backgroundColor: "#D5E9E6" },
    countLabelStyle: { color: "#183747", fontFamily: handbookFont },
    pressedStyle: { backgroundColor: "#E4F0F1" }, iconColor: "#14556B",
  },
  fourth: {
    style: { borderColor: "#718B8C", backgroundColor: "#FFFFFE", borderRadius: 10 },
    labelStyle: { color: "#183E45", fontFamily: fourthFont },
    countStyle: { backgroundColor: "#D9ECE7" },
    countLabelStyle: { color: "#183E45", fontFamily: fourthFont },
    pressedStyle: { backgroundColor: "#E8F4F0" }, iconColor: "#07585D",
  },
};

/** Undefined retains the ordinary app/Harbour appearance. No source admission. */
export function taskSelectionAppearance(variant?: TaskPresentationVariant): AppSelectionTriggerAppearance | undefined {
  return variant === undefined || variant === "harbour" ? undefined : appearances[variant];
}
