import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import { AppDialog } from "../../components/AppDialog";
import { AppDateField, AppTimeField } from "../../components/DateTimeFields";
import { AppButton } from "../../components/ui";
import { ToolbarIconButton } from "../../components/ToolbarIconButton";
import { MotionDrawerOverlay } from "../../motion/MotionDrawerOverlay.web";
import { useProductionStartupReadiness } from "../../production/ProductionFirstScreenGate";
import { TasksChoiceSceneContext } from "../tasks-choice-host/TasksChoiceSceneContext";
import { createSceneFixtureTrace, type SceneFixtureTrace } from "./trace";
import type { TasksChoiceSceneObserver } from "../tasks-choice-host/scene-barrier";

function TracePanel({ trace, scene }: { trace: SceneFixtureTrace; scene: TasksChoiceSceneObserver | null }) {
  const [output, setOutput] = useState("");
  return <View style={styles.trace}>
    <AppButton label="讀取觀測" variant="quiet" onPress={() => setOutput(JSON.stringify(trace.read(scene), null, 2))} />
    <ScrollView style={styles.output}><Text testID="scene-qa-trace" selectable>{output || "尚未讀取；觀測事件不會觸發此面板更新。"}</Text></ScrollView>
  </View>;
}

function PortalContextProbe({ rootScene, trace }: { rootScene: TasksChoiceSceneObserver | null; trace: SceneFixtureTrace }) {
  const portalScene = useContext(TasksChoiceSceneContext);
  useLayoutEffect(() => {
    trace.record(portalScene && portalScene === rootScene ? "paper-portal-context-match" : "paper-portal-context-MISSING-OR-MISMATCH", portalScene);
    return () => trace.record("paper-portal-probe-detach", portalScene);
  }, [portalScene, rootScene, trace]);
  return null;
}

function ActiveFixture() {
  // This route has local synthetic values, no data read of its own. Shared auth/data gate is unchanged.
  useProductionStartupReadiness("ready");
  const scene = useContext(TasksChoiceSceneContext);
  const traceRef = useRef<SceneFixtureTrace | null>(null);
  if (traceRef.current === null) traceRef.current = createSceneFixtureTrace();
  const trace = traceRef.current;
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(true);
  const [fieldsMounted, setFieldsMounted] = useState(true);
  const [date, setDate] = useState("2026-11-08");
  const [time, setTime] = useState("09:30");
  const background = useRef<View>(null), drawerTrigger = useRef<View>(null);

  useLayoutEffect(() => {
    trace.record("root-context-attach", scene);
    const stop = scene?.subscribe(() => trace.record("observer-publish", scene));
    return () => { stop?.(); trace.record("root-context-detach", scene); };
  }, [scene, trace]);
  useEffect(() => {
    const onFocus = () => trace.record("focusin", scene);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [scene, trace]);
  const requestDialogClose = () => { trace.record("dialog-request-close", scene); setDialog(false); };
  const dialogClosed = () => {
    trace.record("product-onClosed-enter", scene);
    // No focus substitution, exception suppression or observer confirmation in the product callback.
    trace.record("product-onClosed-return", scene);
  };
  const requestDrawerClose = () => { trace.record("drawer-request-close", scene); setDrawer(false); };
  return <View style={styles.root} testID="scene-qa-root">
    <View ref={background} style={styles.background} testID="scene-qa-background">
    <ScrollView style={styles.background} contentContainerStyle={styles.content}>
      <Text variant="titleLarge">Scene observation-only QA</Text>
      <Text>合成資料 · 無 Enter/Apply · 無工作區綁定 · BINDING_MISSING 不代表沒有彈窗。</Text>
      <Text testID="scene-qa-context">{scene ? "root scene context present" : "root scene context missing"}</Text>
      <AppButton label="開啟真 AppDialog" onPress={() => { trace.record("dialog-open-request", scene); setDialog(true); }} />
      <ToolbarIconButton ref={drawerTrigger} icon="page-layout-sidebar-right" label="開啟真抽屜" expanded={drawer} onPress={() => {
        trace.record("drawer-open-request", scene); setDrawerMounted(true); setDrawer(true);
      }} />
      <AppButton label={fieldsMounted ? "卸載日期時間欄位" : "掛載日期時間欄位"} variant="quiet" onPress={() => setFieldsMounted(value => !value)} />
      {fieldsMounted ? <View style={styles.fields}>
        <AppDateField label="QA 日期" value={date} onChange={setDate} />
        <AppTimeField label="QA 時間" value={time} onChange={setTime} />
      </View> : null}
      <TracePanel trace={trace} scene={scene} />
    </ScrollView>
    </View>
    <Portal><PortalContextProbe rootScene={scene} trace={trace} /></Portal>
    <AppDialog visible={dialog} accessibilityLabel="QA 真 AppDialog" onDismiss={requestDialogClose} onClosed={dialogClosed}>
      <AppDialog.Title>QA 真 AppDialog</AppDialog.Title>
      <AppDialog.Content><Text>使用真正 RN Web Modal；保留產品焦點與關閉流程。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="關閉 QA 對話框" onPress={requestDialogClose} /></AppDialog.Actions>
    </AppDialog>
    {drawerMounted ? <MotionDrawerOverlay open={drawer} scopeKey="scene-observer-qa-synthetic" label="QA 真抽屜"
      backgroundRef={background} returnFocusRef={drawerTrigger} onRequestClose={requestDrawerClose}>
      <View style={styles.content}>
        <Text>真正 body portal 和原有 drawer focus hook</Text>
        <AppButton label="抽屜上開啟真 AppDialog" onPress={() => setDialog(true)} />
        <AppButton label="關閉 QA 抽屜" onPress={requestDrawerClose} />
        <AppButton label="卸載 QA 抽屜" variant="quiet" onPress={() => {
          trace.record("drawer-unmount-request", scene); setDrawer(false); setDrawerMounted(false);
        }} />
      </View>
    </MotionDrawerOverlay> : null}
  </View>;
}

export default function SceneObserverFixture() {
  return process.env.EXPO_PUBLIC_SCENE_OBSERVER_QA === "1" ? <ActiveFixture />
    : <Text testID="scene-qa-disabled">Local scene fixture disabled. No admission.</Text>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, width: "100%" },
  background: { flex: 1, minWidth: 0, width: "100%" },
  content: { padding: 16, gap: 12, width: "100%", minWidth: 0 },
  fields: { gap: 12, width: "100%", maxWidth: 480 },
  trace: { width: "100%", minWidth: 0 },
  output: { maxHeight: 220, width: "100%", minWidth: 0 },
});
