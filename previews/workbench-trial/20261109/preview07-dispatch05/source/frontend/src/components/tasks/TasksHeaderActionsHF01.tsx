import type { KeyboardEvent, Ref } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { TasksViewModel } from "../../task-view-model";
import { spacing } from "../../theme";
import { MotionDisclosure } from "../../motion";
import { AppButton, type AppButtonAppearance } from "../ui";

export type HeaderActionsVariant = "harbour" | "fourth";
export type HeaderAction = "create" | "assistant" | "history";
export type HeaderActionRefs = {
  toolbarRegion: Ref<View>; disclosureRegion: Ref<View>; trigger: Ref<View>;
  create: Ref<View>; assistant: Ref<View>; history: Ref<View>;
};
export interface TasksHeaderActionsHF01Props {
  variant: HeaderActionsVariant; region: "toolbar" | "disclosure";
  compact: boolean; access: TasksViewModel["access"]; occupied: boolean;
  selectionMode: boolean; expanded: boolean; scopeToken: string;
  disclosureSessionId: number; refs: HeaderActionRefs;
  appearance?: Readonly<Partial<Record<HeaderAction | 'trigger', AppButtonAppearance>>>;
  onToggle(): void; onActivate(action: HeaderAction): void;
}

// Source lineage: H TasksView:142-148,160-161; F TasksView:132-135,147-148.
// The host retains H heading, toolbar stacking, callbacks and all task behavior.
export function TasksHeaderActionsHF01({ variant, region, compact, access, occupied,
  selectionMode, expanded, scopeToken, disclosureSessionId, refs, onToggle, onActivate, appearance,
}: TasksHeaderActionsHF01Props) {
  if (access === "lost") return null;
  const disabled = occupied || selectionMode;
  const create = access === "editable" ? <AppButton appearance={appearance?.create} ref={refs.create}
    label={variant === "harbour" ? "新增事項" : "手動新增"}
    accessibilityLabel={variant === "harbour" ? "新增共享事項" : "手動新增共享事項"}
    variant={variant === "harbour" ? "primary" : "secondary"} density="compact"
    disabled={disabled} onPress={() => onActivate("create")} /> : null;
  const assistant = access === "editable" ? <AppButton appearance={appearance?.assistant} ref={refs.assistant} label="請助手安排"
    variant={variant === "harbour" ? "secondary" : "primary"} density="compact"
    disabled={disabled} onPress={() => onActivate("assistant")} /> : null;
  const history = <AppButton appearance={appearance?.history} ref={refs.history} label="歷史" accessibilityLabel="事項歷史"
    variant="quiet" density="compact" disabled={disabled} onPress={() => onActivate("history")} />;
  const ordered = variant === "harbour"
    ? <>{!compact ? create : null}{assistant}{history}</>
    : <>{assistant}{create}{history}</>;
  if (region === "toolbar") return <View ref={refs.toolbarRegion} style={styles.actions}>
    {compact ? <>
      {variant === "harbour" ? create : null}
      <AppButton appearance={appearance?.trigger} ref={refs.trigger} label={variant === "harbour" ? "其他" : "操作"}
        accessibilityLabel={variant === "harbour" ? "其他待辦操作" : "待辦操作"}
        variant="quiet" density="compact" expanded={expanded} disabled={disabled} onPress={onToggle} />
    </> : ordered}
  </View>;
  // Never send expanded=false to a retained HF01 primitive. Its collapse-origin
  // effect is intentionally unreachable; only this local subtree receives a key.
  if (!compact || !expanded) return null;
  const keyboard = Platform.OS === "web" ? { onKeyDown: (event: KeyboardEvent) => {
    if (event.key === "Escape" && !disabled) { event.preventDefault(); event.stopPropagation(); onToggle(); }
  } } : {};
  return <MotionDisclosure key={disclosureSessionId} expanded={true} scopeKey={scopeToken}>
    <View ref={refs.disclosureRegion} testID="tasks-page-actions" style={styles.actions} {...keyboard}>{ordered}</View>
  </MotionDisclosure>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
});
