import { useId, useState, type ReactNode } from "react";
import { View } from "react-native";
import { MotionDisclosure } from "../../motion";
import { AppButton } from "../ui";
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
      {hasManagement ? <AppButton nativeID={`${id}-trigger`} label="管理關注" variant="quiet"
        expanded={open} controls={`${id}-content`} onPress={() => setState({ scopeKey, open: !open })} /> : null}
    </View>
    <MotionDisclosure expanded={open} scopeKey={scopeKey} nativeID={`${id}-content`}>
      <View style={s.concernManagementMenu} testID="growth-concern-management-menu">{children}</View>
    </MotionDisclosure>
  </View>;
}
