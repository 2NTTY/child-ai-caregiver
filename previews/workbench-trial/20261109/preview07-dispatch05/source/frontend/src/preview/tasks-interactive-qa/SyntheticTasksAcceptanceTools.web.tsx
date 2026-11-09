import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Portal, Text } from 'react-native-paper';
import { AppDialog } from '../../components/AppDialog';
import { AppDateField, AppTimeField } from '../../components/DateTimeFields';
import { AppButton } from '../../components/ui';
import { ToolbarIconButton } from '../../components/ToolbarIconButton';
import { MotionDrawerOverlay } from '../../motion/MotionDrawerOverlay.web';
import { useProductionOwner } from '../../production/ProductionProvider';
import { PreviewLink, usePreviewExternalGuard, usePreviewLeaveGuard } from '../PreviewNavigationGuard';
import { TasksChoiceSceneContext } from '../tasks-choice-host/TasksChoiceSceneContext';
import { TasksChoiceSceneControls } from '../tasks-choice-host/TasksChoiceSceneControls';
import type { TasksChoiceSceneObserver } from '../tasks-choice-host/scene-barrier';
import { TASKS_ACCEPTANCE_POLICY } from './acceptance-policy';
import { getAcceptanceTrace, observeAcceptanceSources, type AcceptanceTrace } from './trace';
import { invokeRetained, retainCurrentCallbacks, callbackBalance } from './callback-witness';
import { useMountedLifecycleWitness } from './MountedLifecycleWitness.web';

type GuardMode = 'dirty' | 'saving' | 'unknown';
function SyntheticGuard({ mode }: { mode: GuardMode }) {
  usePreviewLeaveGuard(mode === 'dirty', mode !== 'dirty', 'child', undefined, false, mode === 'unknown' ? 'unknown' : 'saving');
  return null;
}
function TracePanel({ trace }: { trace: AcceptanceTrace }) {
  const scene = useContext(TasksChoiceSceneContext), owner = useProductionOwner(), guard = usePreviewExternalGuard();
  const [output,setOutput] = useState('');
  return <View>
    <View testID="tasks-qa-read"><AppButton label="讀取驗收觀測" variant="quiet" onPress={()=>setOutput(JSON.stringify({policy:TASKS_ACCEPTANCE_POLICY,callbacks:callbackBalance(),...trace.read(scene,owner,guard)},null,2))} /></View>
    <ScrollView style={{maxHeight:120}}><Text selectable testID="tasks-qa-trace">{output || '尚未讀取。先記錄還焦，再按讀取；觀測事件不會自動更新畫面。'}</Text></ScrollView>
  </View>;
}
function PortalProbe({ trace, rootScene }: { trace: AcceptanceTrace; rootScene: TasksChoiceSceneObserver | null }) {
  const scene = useContext(TasksChoiceSceneContext), owner = useProductionOwner(), guard = usePreviewExternalGuard();
  useLayoutEffect(()=>{trace.record(scene && scene===rootScene?'paper-portal-context-match':'paper-portal-context-missing-or-mismatch',scene,owner,guard);},[scene,rootScene,owner,guard,trace]);
  return null;
}
function ActiveTools() {
  const scene = useContext(TasksChoiceSceneContext), owner = useProductionOwner(), guard = usePreviewExternalGuard();
  const [trace] = useState(getAcceptanceTrace);
  const lifecycle=useMountedLifecycleWitness();
  const [witnessResult,setWitnessResult]=useState('回調呼叫是合成觸發；不代表 native 事件交付。');
  const [dialog,setDialog]=useState(false), [drawer,setDrawer]=useState(false), [drawerMounted,setDrawerMounted]=useState(true);
  const [date,setDate]=useState('2026-11-09'), [time,setTime]=useState('09:30'), [mode,setMode]=useState<GuardMode|null>(null);
  const panel=useRef<View>(null), background=useRef<View>(null), trigger=useRef<View>(null);
  const record=(event:string)=>trace.record(event,scene,owner,guard);
  useLayoutEffect(()=> {
    const node=panel.current as unknown as HTMLElement|null;
    background.current=(node?.closest('[data-tasks-choice-scene-root]') ?? null) as unknown as View|null;
    return observeAcceptanceSources(trace,{scene,owner,guard,listenFocus(listener) {
      document.addEventListener('focusin',listener,true);
      return ()=>document.removeEventListener('focusin',listener,true);
    }});
  },[scene,owner,guard,trace]);
  const closeDialog=()=>{record('dialog-close-request');setDialog(false);};
  const closeDrawer=()=>{
    const button=document.querySelector('[data-testid="tasks-qa-close-drawer"]');
    trace.witness('fixture-drawer-close-request',{coordinator:trace.identity(scene),
      opener:trace.identity(trigger.current),drawer:trace.identity(button?.closest('[data-motion-kind="drawer-right"]'))});
    record('drawer-close-request');setDrawer(false);
  };
  return <>
    {mode ? <SyntheticGuard mode={mode}/> : null}
    <TasksChoiceSceneControls>
      <ScrollView style={{maxHeight:220,flexShrink:1}}>
        <View ref={panel} testID="tasks-qa-tools" style={{padding:8,gap:8}}>
          <Text testID="tasks-qa-policy">合成驗收工具 · {TASKS_ACCEPTANCE_POLICY.buildIdentity} · releaseAdmission=false · syntheticQABuildGrant={String(TASKS_ACCEPTANCE_POLICY.syntheticQAAdmission)}</Text>
          <Text>目標 viewport={TASKS_ACCEPTANCE_POLICY.acceptedViewport.innerWidth}×{TASKS_ACCEPTANCE_POLICY.acceptedViewport.innerHeight} / DPR={TASKS_ACCEPTANCE_POLICY.acceptedViewport.devicePixelRatio} / scale={TASKS_ACCEPTANCE_POLICY.acceptedViewport.visualViewportScale} · targetProductRootWidth={TASKS_ACCEPTANCE_POLICY.acceptedViewport.productRootWidth}（QA 比對目標，不限制互動尺寸；非產品量測，實際 DOM 與目標差異另行記錄，匹配也不代表已通過驗收）</Text>
          <View testID="tasks-qa-open-dialog"><AppButton label="開啟驗收對話框" onPress={()=>{record('dialog-open-request');setDialog(true);}}/></View>
          <AppDateField label="驗收日期" value={date} onChange={setDate}/>
          <AppTimeField label="驗收時間" value={time} onChange={setTime}/>
          <View testID="tasks-qa-open-drawer"><ToolbarIconButton ref={trigger} icon="page-layout-sidebar-right" label="開啟驗收抽屜" expanded={drawer} onPress={()=>{record('drawer-open-request');setDrawerMounted(true);setDrawer(true);}}/></View>
          <View testID="tasks-qa-dirty"><AppButton label="設定驗收 dirty" onPress={()=>setMode('dirty')}/></View>
          <View testID="tasks-qa-saving"><AppButton label="設定驗收 saving" onPress={()=>setMode('saving')}/></View>
          <View testID="tasks-qa-unknown"><AppButton label="設定驗收 unknown" onPress={()=>setMode('unknown')}/></View>
          <View testID="tasks-qa-remove-guard"><AppButton label="移除驗收 guard" onPress={()=>setMode(null)}/></View>
          <View testID="tasks-qa-owner-cancel-logout"><AppButton label="僅取消 owner 登出" onPress={()=>{record('owner-only-cancel-logout-before');owner.controller.cancelLogout();record('owner-only-cancel-logout-after');}}/></View>
          <PreviewLink href="/"><Pressable accessibilityRole="link" accessibilityLabel="前往首頁（驗收離頁）" testID="tasks-qa-leave-tasks"><Text>前往首頁（驗收離頁）</Text></Pressable></PreviewLink>
          <AppButton label="保留目前 Apply／Exit 回調" onPress={()=>setWitnessResult(retainCurrentCallbacks(scene).status)}/>
          <AppButton label="呼叫保留 Apply" onPress={()=>{record('stale-apply-before');setWitnessResult(invokeRetained('apply').status);record('stale-apply-after');}}/>
          <AppButton label="呼叫保留 Exit" onPress={()=>{record('stale-exit-before');setWitnessResult(invokeRetained('exit').status);record('stale-exit-after');}}/>
          <AppButton label="預先武裝：下次還焦後暫停整個場景" onPress={()=>setWitnessResult(lifecycle?.arm(trigger.current as unknown as HTMLElement|null,scene)??'INCONCLUSIVE：supervisor missing')}/>
          <Text>{witnessResult}</Text>
          <TracePanel trace={trace}/>
        </View>
      </ScrollView>
    </TasksChoiceSceneControls>
    <Portal><PortalProbe trace={trace} rootScene={scene}/></Portal>
    <AppDialog visible={dialog} onDismiss={closeDialog} onClosed={()=>record('dialog-product-onClosed')} accessibilityLabel="驗收對話框">
      <AppDialog.Title>驗收對話框</AppDialog.Title><AppDialog.Content><Text>僅合成資料。保留產品關閉與還焦流程。</Text></AppDialog.Content>
      <AppDialog.Actions><View testID="tasks-qa-close-dialog"><AppButton label="關閉驗收對話框" onPress={closeDialog}/></View></AppDialog.Actions>
    </AppDialog>
    {drawerMounted ? <MotionDrawerOverlay open={drawer} scopeKey="tasks-interactive-qa" label="驗收抽屜" onRequestClose={closeDrawer} backgroundRef={background} returnFocusRef={trigger}>
      <Text>驗收抽屜</Text>
      <View testID="tasks-qa-close-drawer"><AppButton label="關閉驗收抽屜" onPress={closeDrawer}/></View>
      <AppButton label="在抽屜上開啟驗收對話框" onPress={()=>{record('overlap-dialog-open-request');setDialog(true);}}/>
      <View testID="tasks-qa-unmount-drawer"><AppButton label="卸載驗收抽屜" onPress={()=>{record('drawer-direct-unmount-request');setDrawer(false);setDrawerMounted(false);}}/></View>
    </MotionDrawerOverlay> : null}
  </>;
}
/** Build-owned synthetic tools. Only normal Control can exercise the shared synthetic policy. */
export function SyntheticTasksAcceptanceTools() { return TASKS_ACCEPTANCE_POLICY.syntheticTools ? <ActiveTools/> : null; }
