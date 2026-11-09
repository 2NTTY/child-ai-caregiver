import { useEffect, useState } from "react";
import { observeNormalSourceProbe } from "./workbench-normal-source-control.mjs";
/** Observation only: actual native contexts determine data and readiness. */
import { Pressable, ScrollView, Text, View } from "react-native";
import { useProduction } from "../production/ProductionProvider";
import { useProductionSwitchReadiness } from "../production/ProductionFirstScreenGate";
import { useProfileWorkspace } from "../workspaces/ProfileWorkspace";
import { useTasksWorkspace } from "../workspaces/TasksWorkspace";

export function NormalTasksSourceProbe() {
  const { identityKey, scopeKey, userId } = useProduction();
  const profile = useProfileWorkspace(), tasks = useTasksWorkspace();
  const startup = useProductionSwitchReadiness();
  const currentProfile = scopeKey && profile?.scopeKey === scopeKey ? profile.model : null;
  const currentTasks = scopeKey && tasks?.scopeKey === scopeKey ? tasks.model : null;
  const observation = {
    schemaVersion: 1, variant: "harbour", evidenceKind: "actual-context-observation-not-frame-admission",
    identityKey, scopeKey, userId,
    profile: currentProfile ? { reading: currentProfile.reading, needsRefresh: currentProfile.needsRefresh, current: currentProfile.current } : null,
    tasks: currentTasks ? { readState: currentTasks.readState, access: currentTasks.access,
      itemCount: currentTasks.items.length, items: currentTasks.items.slice(0, 6), scheduleContext: currentTasks.scheduleContext } : null,
    startup: { key: startup.key, state: startup.state },
  };
  const diagnostic = JSON.stringify(observation);
  useEffect(() => observeNormalSourceProbe(diagnostic), [diagnostic]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  return <View testID="normal-tasks-source-probe" accessibilityLabel="DERIVED synthetic normal source probe">
    <Pressable accessibilityRole="button" accessibilityLabel="合成來源診斷"
      accessibilityState={{ expanded: diagnosticsOpen }} aria-expanded={diagnosticsOpen} aria-controls="normal-tasks-source-evidence"
      onPress={() => setDiagnosticsOpen(open => !open)} style={{ minHeight: 32, padding: 6 }}>
      <Text>Harbour · DERIVED · {diagnosticsOpen ? "收起" : "展開"}合成來源診斷</Text>
    </Pressable>
    <ScrollView nativeID="normal-tasks-source-evidence" style={{ maxHeight: 180, display: diagnosticsOpen ? "flex" : "none" }}>
      <Text>Harbour · DERIVED · synthetic normal READ + Tasks clock + Account lifecycle guard</Text>
      <Text testID="normal-tasks-source-observation" selectable>{diagnostic.length <= 16_384 ? diagnostic : "PROBE_DIAGNOSTIC_LIMIT"}</Text>
    </ScrollView>
  </View>;
}
