import { useId, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { MotionDisclosure } from "../../motion";
import { AppIcon } from "../AppIcon";
import { growthStyles as s } from "./growth-styles";

// Keep the original form and confirmation mounted in the page's owner context.
export function GrowthConcernActions({ scopeKey, primary, children, hasManagement }: {
  scopeKey: string; primary: ReactNode; children: ReactNode; hasManagement: boolean;
}) {
  const id = useId();
  const [state, setState] = useState({ scopeKey, open: false });
  const open = hasManagement && state.scopeKey === scopeKey && state.open;
  return <View style={s.concernActions} testID="growth-concern-actions">
    <View style={s.concernActionRow}>
      {primary}
      {hasManagement ? <Pressable nativeID={`${id}-trigger`} accessibilityRole="button" accessibilityLabel="管理關注"
        accessibilityState={{ expanded: open }} aria-expanded={open} aria-controls={`${id}-content`}
        onPress={() => setState({ scopeKey, open: !open })}
        style={({ pressed }) => [s.concernManagementTrigger, pressed && s.pressed]}>
        <Text style={s.concernManagementLabel}>管理</Text><AppIcon name={open ? "chevron-up" : "chevron-down"} size={18} />
      </Pressable> : null}
    </View>
    <MotionDisclosure expanded={open} scopeKey={scopeKey} nativeID={`${id}-content`}>
      <View style={s.concernManagementMenu} testID="growth-concern-management-menu">{children}</View>
    </MotionDisclosure>
  </View>;
}
