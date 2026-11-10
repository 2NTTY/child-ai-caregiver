import { readTaskRecipePrefill } from './recipe-handoff';
import { CallbackCommitWitness, MountedRequestContext } from '../tasks-interactive-qa/MountedLifecycleWitness';
import { beginPublication, endPublication, recordControlRender, candidateWitnessFields, type RequestLabel } from '../tasks-interactive-qa/callback-witness';
import { projectTaskModulePresentation, taskHeaderBehaviorVariant, legacyTaskRowAppearance, type TaskModulePresentation } from "./module-presentation";
import { Component, createContext, createRef, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { AppButton, AppTextField } from '../../components/ui';
import { AppScrollView as ScrollView } from '../../components/AppScrollView';
import { colors, spacing } from '../../theme';
import type { HeaderActionsHF01Controller } from '../task-header-actions-hf01/HeaderActionsHF01FocusBoundary';
import type { HeaderActionsHF01SceneProps } from '../task-header-actions-hf01/TaskHeaderActionsHF01Control';
import { commitHeaderSession, createHeaderSession, enterHeaderSelection, exitHeaderSelection,
  observeHeaderSession, retireHeaderSession, type HeaderEvent, type HeaderScope, type HeaderSession } from '../task-header-actions-hf01/selection';
import { VARIANT_IDS, TASK_SLOT_IDS, getTaskSlot, checkTaskSlotCapability } from '../tasks-variant-catalog/catalog.mjs';
import { createTaskRecipeDraft, createHandbookTaskRecipeDraft, makeTaskRecipeSelection, mayEditTaskRecipeDraft, parseTaskRecipe,
  projectTaskRecipe, reduceTaskRecipeDraft, restoreTaskRecipeDraft, serializeTaskRecipe,
  type TaskRecipeCommand, type TaskRecipeDraft, type TaskRecipeSnapshot, type TaskSlotId } from './recipe';
import { readCandidateReceipt, prepareCandidatePublication, commitCandidatePublication,
  type CandidateReceipt, type CandidateMetadata } from './candidate-receipt';
import { TasksChoiceSceneControls } from './TasksChoiceSceneControls';
import type { SceneBindingStamp, SceneFrameAuthority, SceneSnapshot, SceneTicket, TasksChoiceSceneObserver } from './scene-barrier';
import type { AppliedPresentation } from './applied-presentation';
import type { AppliedPresentationLeaf, TasksAppliedPresentationPort } from './TasksAppliedPresentationProvider';

export type TasksChoiceHostConfiguration = Readonly<{kind:'synthetic-workbench'}>;
const CONFIGURATION:TasksChoiceHostConfiguration = Object.freeze({kind:'synthetic-workbench'});
export const TasksChoiceHostPreviewContext = createContext<TasksChoiceHostConfiguration|null>(null);
/** Opt-in only at the separately verified private synthetic entry; not a data provider. */
export function TasksChoiceHostPreview({children}:{children:ReactNode}) {
  return <TasksChoiceHostPreviewContext.Provider value={CONFIGURATION}>{children}</TasksChoiceHostPreviewContext.Provider>;
}
export function useTasksChoiceHostPreview() { return useContext(TasksChoiceHostPreviewContext); }
// Release verification remains false in this synthetic-only artifact.
// No catalog, context, recipe, URL, environment or UI prop can grant admission.
const RUNTIME_ADMISSION_VERIFIED = false;
import { tasksSyntheticBuildAllows } from '../tasks-interactive-qa/acceptance-policy';
const EMPTY_SCENE:HeaderActionsHF01SceneProps = Object.freeze({});
const VERSION_LABELS = {original:'原版',harbour:'Harbour',care:'Care',handbook:'Handbook',fourth:'Fourth'} as const;
const SLOT_LABELS:Record<TaskSlotId,string> = {'header-actions':'頁首與操作',filters:'分類與篩選','date-list':'日期分組與清單','calendar-layout':'月曆與布局'};
const COVERAGE_LABELS = {'historical-filters-combination':'分類＋搜尋框組合','historical-search-frame-fragment':'歷史搜尋框外框片段','historical-tabs-fragment':'歷史分類分頁片段','historical-actions-fragment':'歷史操作按鈕片段','historical-row-fragment':'歷史事項列片段','actions-only':'操作區局部','row-appearance':'事項列外觀',
  'header-appearance':'標題與操作外觀','controlled-filters-h-theme':'篩選外觀／H 元件',
  'header-source-regions-partial-host':'頁首完整區域／宿主元件限制','date-list-source-regions-partial-host':'清單完整區域／宿主元件限制',
  'date-groups-and-rows':'日期分組與事項列','controlled-calendar-layout-h-theme':'月曆布局／H 元件'} as const;
interface Binding {
  controller:HeaderActionsHF01Controller|undefined;
  rowAppearance:'harbour'|'fourth'|'handbook'|'original-row-fragment01'|undefined;
  modulePresentation:TaskModulePresentation|undefined;
  sceneProps:HeaderActionsHF01SceneProps;
  controls:ReactNode;
}
interface Props {
  configuration:TasksChoiceHostConfiguration|null;
  presentation:CandidateReceipt|null;
  scene:TasksChoiceSceneObserver|null;
  appliedPresentation?:TasksAppliedPresentationPort|null;
  appliedLeaf?:AppliedPresentationLeaf;
  authorityToken:string; live:boolean; occupied:boolean; access:HeaderScope['access'];
  children(binding:Binding):ReactNode;
}
type Frame = Readonly<{configuration:TasksChoiceHostConfiguration|null;scope:HeaderScope;session:HeaderSession;
  presentation:CandidateReceipt|null;expected:CandidateMetadata|null;
  appliedOwner:TasksAppliedPresentationPort|null;appliedEpoch:object|null;
  scene:TasksChoiceSceneObserver|null;bindingStamp:SceneBindingStamp|null}>;
interface State {
  draft:TaskRecipeDraft; applied:TaskRecipeSnapshot|null; frame:Frame;
  importText:string; exportText:string; message:string; handoffNotice:string;
  sceneSnapshot:SceneSnapshot|null;
  appliedReceipt:AppliedPresentation|null;presentationCommitted:Frame|null;
}
function scopeFor(props:Props,draft:TaskRecipeDraft,applied:TaskRecipeSnapshot|null):HeaderScope {
  return {authorityToken:props.authorityToken,live:props.live&&props.configuration!==null,occupied:props.occupied,
    access:props.access,admissionVerified:Platform.OS==='web'&&props.configuration!==null&&tasksSyntheticBuildAllows()
      &&props.scene?.read().releaseAllowed===true,
    variantId:taskHeaderBehaviorVariant(applied),revision:draft.revision};
}
function sameScope(a:HeaderScope,b:HeaderScope):boolean {
  return (Object.keys(a) as (keyof HeaderScope)[]).every(key=>a[key]===b[key]);
}
function presentationFor(props:Props):CandidateReceipt|null {
  return props.configuration!==null&&props.access!=='lost'&&props.authorityToken.length>0
    &&props.presentation?.scopeKey===props.authorityToken?props.presentation:null;
}
function appliedFor(props:Props):AppliedPresentation|null {
  return presentationFor(props)&&props.appliedLeaf?props.appliedPresentation?.readFor(props.appliedLeaf)??null:null;
}
function frameFor(props:Props,draft:TaskRecipeDraft,applied:TaskRecipeSnapshot|null,session:HeaderSession,
  expected:CandidateMetadata|null):Frame {
  const scope=scopeFor(props,draft,applied), observed=observeHeaderSession(session,scope);
  const effective=observed.generation===null&&observed.mode==='select'
    ?observeHeaderSession(retireHeaderSession(observed),scope):observed;
  return {configuration:props.configuration,scope,session:effective,presentation:presentationFor(props),expected,
    appliedOwner:props.appliedPresentation??null,appliedEpoch:appliedFor(props)?.epoch??null,
    scene:props.scene,bindingStamp:props.scene?.read().bindingStamp??null};
}
function initialState(props:Props):State {
  // Read only. Every route mount gets a new epoch and no applied renderer.
  const receipt=presentationFor(props),saved=readCandidateReceipt(receipt,props.authorityToken);
  // An intentionally empty or imported retained candidate is authoritative.
  // Unknown retained metadata must not be overwritten with a new default.
  const draft=saved?.draft??(receipt?.current===null?createHandbookTaskRecipeDraft():createTaskRecipeDraft());
  const prefill=receipt?.current===null&&Platform.OS==='web'&&props.configuration!==null
    ?readTaskRecipePrefill(receipt.current,typeof window==='undefined'?'':window.location.hash)
    :{importText:'',message:''};
  return {draft,applied:null,frame:frameFor(props,draft,null,createHeaderSession(),saved),
    importText:saved?.importText??prefill.importText,exportText:saved?.exportText??'',message:'',handoffNotice:prefill.message,sceneSnapshot:props.scene?.read()??null,
    appliedReceipt:null,presentationCommitted:null};
}
function eventFor(session:HeaderSession):HeaderEvent|null {
  if (!session.current||session.generation===null) return null;
  return {epoch:session.epoch,authorityToken:session.current.authorityToken,generation:session.generation,
    mode:session.mode,variantId:session.current.variantId,revision:session.current.revision};
}
// Emergency loss changes only local mode/callback authority. It is not a
// successful normal Exit and never dismisses, restores focus or clears metadata.
function interactSession(session:HeaderSession):HeaderSession {
  return session.mode==='select'?exitHeaderSelection(session,eventFor(session)).state:session;
}

/** Owns candidate metadata only. It never receives or calls a task action. */
export class TasksChoiceHostControl extends Component<Props,State> {
  static contextType=MountedRequestContext;
  state:State=initialState(this.props);
  private mounted=false;
  private restart=false;
  private committedFrame:Frame|null=null;
  private committedSession:HeaderSession|null=null;
  private published:{presentation:CandidateReceipt;epoch:object;value:CandidateMetadata}|null=null;
  private workbenchFocusRef=createRef<View>();
  private observedScene:TasksChoiceSceneObserver|null=null;
  private stopScene:(()=>void)|null=null;
  private stopExit:(()=>void)|null=null;
  private observedApplied:TasksAppliedPresentationPort|null=null;
  private stopApplied:(()=>void)|null=null;
  private publishingApplied=false;
  private pendingApplied:{frame:Frame;expected:AppliedPresentation;value:TaskRecipeSnapshot}|null=null;
  private sceneTicket:SceneTicket|null=null;
  private sceneAuthority:SceneFrameAuthority|null=null;

  static getDerivedStateFromProps(props:Props,state:State):Partial<State>|null {
    const configurationChanged=props.configuration!==state.frame.configuration;
    // Scope/configuration retirement never carries the previous instance's draft
    // or event authority into a new one. Temporary occupancy is not retirement.
    if(configurationChanged||presentationFor(props)!==state.frame.presentation)return initialState(props);
    const scope=scopeFor(props,state.draft,state.applied);
    const snapshot=props.scene?.read()??null,sceneLifetimeChanged=props.scene!==state.frame.scene;
    const sceneChanged=sceneLifetimeChanged||state.frame.bindingStamp!==(snapshot?.bindingStamp??null);
    const authorityChanged=scope.authorityToken!==state.frame.scope.authorityToken||scope.access!==state.frame.scope.access;
    const appliedData=appliedFor(props),appliedOwnerChanged=(props.appliedPresentation??null)!==state.frame.appliedOwner;
    const appliedEpochChanged=(appliedData?.epoch??null)!==state.frame.appliedEpoch;
    // A new provider lifetime or unverified viewport retires only the applied
    // appearance. Returning to an allowed tuple never automatically reapplies it.
    const resetApplied=authorityChanged||!scope.live||sceneLifetimeChanged||snapshot?.releaseAllowed!==true
      ||appliedOwnerChanged||appliedEpochChanged||!!props.appliedPresentation&&state.appliedReceipt!==null&&state.appliedReceipt!==appliedData;
    const applied=resetApplied?null:state.applied;
    if (sameScope(scope,state.frame.scope)&&!sceneChanged&&applied===state.applied&&!appliedOwnerChanged&&!appliedEpochChanged
      &&(!resetApplied||state.appliedReceipt===null)) return null;
    const session=sceneChanged?interactSession(state.frame.session):state.frame.session;
    // Observe occupancy/lost HF authority in this render. Scene suppression is
    // retired by its owner; becoming clean never reenters automatically.
    return {applied,frame:frameFor(props,state.draft,applied,session,state.frame.expected),message:'',
      sceneSnapshot:snapshot,appliedReceipt:resetApplied?null:state.appliedReceipt};
  }
  componentDidMount() {
    this.mounted=true;
    this.observeAppliedPort();
    this.observeScenePort();
    if (this.restart) {
      this.restart=false;
      // Strict-mode remount obeys the same fresh-session rule as an Expo leaf.
      this.setState(initialState(this.props));
      return;
    }
    this.publish();
  }
  componentDidUpdate() { this.observeAppliedPort();this.observeScenePort();this.publish(); }
  componentWillUnmount() {
    this.mounted=false;this.restart=true;
    this.stopScene?.();this.stopScene=null;
    this.stopApplied?.();this.stopApplied=null;this.observedApplied=null;
    this.releaseScene('CONTROL_UNMOUNTED');this.observedScene=null;
    this.invalidateCallbacks();
    this.published=null;
    // No storage, focus, owner, route, dialog or deferred-operation cleanup.
  }
  private invalidateCallbacks() {
    this.pendingApplied=null;
    this.committedFrame=null;this.committedSession=null;this.sceneAuthority=null;
    this.stopExit?.();this.stopExit=null;
  }
  private observeAppliedPort() {
    const port=this.props.appliedPresentation??null;
    if(this.observedApplied===port)return;
    this.stopApplied?.();this.stopApplied=null;this.observedApplied=port;
    this.stopApplied=port?.subscribe(this.appliedChanged)??null;
    if(port)this.appliedChanged();
  }
  private appliedChanged=() => {
    if(!this.mounted||this.publishingApplied||this.observedApplied!==(this.props.appliedPresentation??null))return;
    const data=appliedFor(this.props),frame=this.state.frame;
    if(data===this.state.appliedReceipt&&(data?.epoch??null)===frame.appliedEpoch)return;
    this.releaseScene('APPLIED_PRESENTATION_CHANGED');this.invalidateCallbacks();
    this.setState({applied:null,appliedReceipt:null,
      frame:frameFor(this.props,this.state.draft,null,interactSession(frame.session),this.expectedFor(frame)),
      sceneSnapshot:this.props.scene?.read()??null});
  };
  private releaseScene(reason:string) {
    const scene=this.observedScene,ticket=this.sceneTicket;
    this.sceneTicket=null;this.sceneAuthority=null;this.stopExit?.();this.stopExit=null;
    // Never revoke a newer Control's ticket during delayed cleanup.
    if(scene&&ticket&&scene.read().ticket===ticket)scene.revoke(reason);
  }
  private observeScenePort() {
    if(this.observedScene===this.props.scene)return;
    this.stopScene?.();this.stopScene=null;
    this.releaseScene('CONTROL_SCENE_CHANGED');this.invalidateCallbacks();
    this.observedScene=this.props.scene;
    this.stopScene=this.observedScene?.subscribe(this.sceneChanged)??null;
    this.sceneChanged();
  }
  private sceneChanged=() => {
    const scene=this.observedScene;if(!this.mounted||scene!==this.props.scene)return;
    const snapshot=scene?.read()??null,frame=this.state.frame;
    const lostTicket=this.sceneTicket!==null&&snapshot?.ticket!==this.sceneTicket;
    const lostBinding=frame.scene!==scene||frame.bindingStamp!==(snapshot?.bindingStamp??null);
    if(lostTicket||lostBinding) {
      this.sceneTicket=null;this.invalidateCallbacks();
      this.setState({frame:frameFor(this.props,this.state.draft,this.state.applied,interactSession(frame.session),this.expectedFor(frame)),
        sceneSnapshot:snapshot,message:lostTicket?'選配已暫停，產品互動由原頁面管理。':this.state.message});
    } else if(snapshot!==this.state.sceneSnapshot)this.setState({sceneSnapshot:snapshot});
  };
  private authorityFor(frame:Frame):SceneFrameAuthority|null {
    const scene=frame.scene,authority=this.sceneAuthority,snapshot=scene?.read();
    return scene===this.props.scene&&authority&&authority.frame===frame&&authority.ticket===this.sceneTicket
      &&snapshot?.phase==='select'&&snapshot.authority===authority&&snapshot.ticket===this.sceneTicket
      &&snapshot.bindingStamp===frame.bindingStamp?authority:null;
  }
  private publish() {
    const frame=this.state.frame;
    // Join only the child's current committed lease, never a render-written token.
    const witness=beginPublication(this,frame,frame.presentation?.current??null);
    let admitted=false,outcome='rejected';
    try {
    this.props.appliedPresentation?.reconcile();
    const appliedData=appliedFor(this.props);
    if (!this.mounted||frame.configuration!==this.props.configuration
      ||frame.presentation!==presentationFor(this.props)
      ||frame.scene!==this.props.scene||frame.bindingStamp!==(this.props.scene?.read().bindingStamp??null)
      ||!sameScope(frame.scope,scopeFor(this.props,this.state.draft,this.state.applied))
      ||this.props.appliedPresentation&&(!appliedData||frame.appliedOwner!==this.props.appliedPresentation||frame.appliedEpoch!==appliedData.epoch)) return;
    this.committedFrame=frame;this.committedSession=commitHeaderSession(frame.session);
    const committedSession=this.committedSession;
    if(frame.session.mode==='select') {
      const scene=frame.scene,ticket=this.sceneTicket;
      const authority=scene&&ticket?scene.commitFrame(ticket,frame):null;
      if(!authority) {
        this.releaseScene('HF_COMMIT_REJECTED');this.invalidateCallbacks();
        this.setState({frame:frameFor(this.props,this.state.draft,this.state.applied,interactSession(frame.session),this.expectedFor(frame)),
          sceneSnapshot:scene?.read()??null,message:'選配已暫停，產品互動由原頁面管理。'});
        return;
      }
      this.sceneAuthority=authority;this.stopExit?.();
      const event=eventFor(this.committedSession);
      this.stopExit=scene!.registerExit(authority,()=>this.exit(frame,event));
      if(!this.authorityFor(frame))return;
    } else {
      this.releaseScene('HF_CONTEXT_CHANGED');
    }
    admitted=true;
    const {draft,importText,exportText}=this.state;
    const request=prepareCandidatePublication(frame.presentation,this.expectedFor(frame),
      {draft,importText,exportText},frame,frame.session);
    const saved=commitCandidatePublication(request,presentationFor(this.props),frame,this.committedSession);
    if(saved&&frame.presentation)this.published={presentation:frame.presentation,epoch:frame.session.epoch,value:saved};
    outcome=saved?'published':'not-published';
    if(this.props.appliedPresentation&&this.props.appliedLeaf&&appliedData) {
      const pending=this.pendingApplied;
      if(pending?.frame===frame) {
        // Only this exact explicit Apply frame may publish stable data, after
        // its genuine scene/HF commit. No frame or ticket enters that data store.
        this.pendingApplied=null;
        let applied:AppliedPresentation|null=null;
        if(saved&&pending.expected===appliedData&&this.authorityFor(frame)
          &&projectTaskRecipe(draft,committedSession,eventFor(committedSession)).status==='eligible') {
          this.publishingApplied=true;
          try { applied=this.props.appliedPresentation.publishExplicitApply(appliedData,this.props.appliedLeaf,pending.value); }
          finally { this.publishingApplied=false; }
        }
        if(applied) this.setState({applied:applied.applied,appliedReceipt:applied,presentationCommitted:frame});
        else {
          this.releaseScene('APPLIED_PUBLICATION_REJECTED');this.invalidateCallbacks();
          this.setState({applied:null,appliedReceipt:null,
            frame:frameFor(this.props,draft,null,interactSession(frame.session),this.expectedFor(frame))});
        }
      } else if(saved&&frame.session.mode==='interact'&&this.state.appliedReceipt!==appliedData) {
        // A new leaf starts unapplied. Copy data only after this leaf's own
        // committed binding/frame joins; never acquire selection authority here.
        if(this.state.applied!==appliedData.applied) {
          this.invalidateCallbacks();
          this.setState({applied:appliedData.applied,appliedReceipt:appliedData,
            frame:frameFor(this.props,draft,appliedData.applied,committedSession,this.expectedFor(frame))});
        } else this.setState({appliedReceipt:appliedData,presentationCommitted:frame});
      } else if(saved&&this.state.presentationCommitted!==frame)this.setState({presentationCommitted:frame});
    }
    } catch(error) { outcome='product-threw';throw error;
    } finally { endPublication(witness,{admitted,outcome,receiptAfter:frame.presentation?.current??null}); }
  }
  private expectedFor(frame:Frame):CandidateMetadata|null {
    const published=this.published;
    return published&&published.presentation===frame.presentation&&published.epoch===frame.session.epoch
      ?published.value:frame.expected;
  }
  private ownsPresentation(frame:Frame):boolean {
    return frame.presentation===null||frame.presentation.current===this.expectedFor(frame);
  }
  private current(frame:Frame):boolean {
    const applied=appliedFor(this.props);
    return this.mounted&&this.committedFrame===frame&&this.state.frame===frame
      &&frame.configuration===this.props.configuration
      &&frame.presentation===presentationFor(this.props)&&this.ownsPresentation(frame)
      &&frame.scene===this.props.scene&&frame.bindingStamp===(this.props.scene?.read().bindingStamp??null)
      &&(frame.session.mode!=='select'||this.authorityFor(frame)!==null)
      &&(!this.props.appliedPresentation||frame.appliedOwner===this.props.appliedPresentation&&applied?.epoch===frame.appliedEpoch)
      &&sameScope(frame.scope,scopeFor(this.props,this.state.draft,this.state.applied));
  }
  private sessionFor(frame:Frame):HeaderSession|null { return this.current(frame)?this.committedSession:null; }
  private transition(draft:TaskRecipeDraft,session:HeaderSession,applied=this.state.applied,message='候選配方已更新，尚未套用或保存。',kind:'edit'|'apply'='edit') {
    const previous=this.state.frame,frame=frameFor(this.props,draft,applied,session,previous.expected);
    const appliedExpected=kind==='apply'?appliedFor(this.props):null;
    if(kind==='apply'&&this.props.appliedPresentation&&!appliedExpected)return;
    if(previous.session.mode==='select') {
      const authority=this.authorityFor(previous);
      if(!authority||!previous.scene?.stageFrame(authority,frame,kind))return;
    }
    // Retire callback authority immediately, before React can process a second press.
    this.invalidateCallbacks();
    if(kind==='apply'&&appliedExpected&&applied)this.pendingApplied={frame,expected:appliedExpected,value:applied};
    this.setState({draft,applied,frame,exportText:'',message,sceneSnapshot:this.props.scene?.read()??null});
  }
  private textTransition(update:Partial<Pick<State,'importText'|'exportText'|'message'>>) {
    // Text may change without recipe revision; frame identity still changes and
    // immediately retires callbacks before React processes a second old event.
    const previous=this.state.frame,frame={...previous};
    if(previous.session.mode==='select') {
      const authority=this.authorityFor(previous);
      if(!authority||!previous.scene?.stageFrame(authority,frame,'edit'))return;
    }
    this.invalidateCallbacks();
    this.setState({importText:this.state.importText,exportText:this.state.exportText,message:this.state.message,
      ...update,frame,sceneSnapshot:this.props.scene?.read()??null});
  }
  private choose(frame:Frame,event:HeaderEvent|null,command:TaskRecipeCommand) {
    const session=this.sessionFor(frame);if(!session)return;
    const result=reduceTaskRecipeDraft(this.state.draft,command,session,event);
    if(result.outcome==='updated')this.transition(result.state,session);
  }
  private enter(frame:Frame,event:HeaderEvent|null) {
    const session=this.sessionFor(frame),scene=frame.scene;
    if(!session||!scene||session.lastSessionNonce===Number.MAX_SAFE_INTEGER)return;
    const result=enterHeaderSelection(session,event,session.lastSessionNonce+1);
    if(result.outcome!=='applied')return;
    // Prepare the exact next HF frame before acquiring scene authority. The only
    // acknowledgment is publish() after its genuine React mount/update commit.
    const next=frameFor(this.props,this.state.draft,this.state.applied,result.state,frame.expected);
    this.invalidateCallbacks();
    const entered=scene.beginEnter(frame.bindingStamp,next);
    if(entered.status!=='arming'||scene.read().ticket!==entered.ticket) {
      this.setState({sceneSnapshot:scene.read(),message:'目前不能進入選配，請先完成或恢復產品操作。'});return;
    }
    this.sceneTicket=entered.ticket;
    this.setState({frame:next,exportText:'',message:'候選配方尚未套用。',sceneSnapshot:scene.read()});
  }
  private exit(frame:Frame,event:HeaderEvent|null) {
    const session=this.sessionFor(frame),authority=this.authorityFor(frame);if(!session||!authority||!frame.scene)return;
    const result=exitHeaderSelection(session,event);
    if(result.outcome!=='applied'||!frame.scene.exit(authority))return;
    this.sceneTicket=null;this.invalidateCallbacks();
    this.setState({frame:frameFor(this.props,this.state.draft,this.state.applied,result.state,frame.expected),
      sceneSnapshot:frame.scene.read(),exportText:'',message:'已返回產品互動模式。'});
  }
  private apply(frame:Frame,event:HeaderEvent|null) {
    const session=this.sessionFor(frame);if(!session)return;
    if(projectTaskRecipe(this.state.draft,session,event).status!=='eligible')return;
    this.transition(this.state.draft,session,this.state.draft.current,'已套用局部配方；其他部分仍由 H 宿主管理。','apply');
  }
  private exportDraft(frame:Frame,event:HeaderEvent|null) {
    const session=this.sessionFor(frame);if(!session||!mayEditTaskRecipeDraft(this.state.draft,session,event))return;
    const result=serializeTaskRecipe(this.state.draft);
    if(result.status==='valid')this.textTransition({exportText:result.json,message:'已產生候選配方文字，尚未保存到本機。'});
  }
  private updateImport(frame:Frame,event:HeaderEvent|null,text:string) {
    const session=this.sessionFor(frame);if(!session||!mayEditTaskRecipeDraft(this.state.draft,session,event))return;
    this.textTransition({importText:text.slice(0,65536),message:''});
  }
  private restore(frame:Frame,event:HeaderEvent|null,text:string) {
    const session=this.sessionFor(frame);
    if(!session||text!==this.state.importText||!mayEditTaskRecipeDraft(this.state.draft,session,event))return;
    const parsed=parseTaskRecipe(text);
    if(parsed.status!=='valid') {this.setState({message:'配方格式或來源已改變，未還原或套用。'});return;}
    const result=restoreTaskRecipeDraft(this.state.draft,parsed.recipe,session,event);
    if(result.outcome==='updated')this.transition(result.state,session,this.state.applied,'已還原候選配方，尚未套用或保存。');
  }
  render() {
    const {draft,applied,frame,importText,exportText,message,sceneSnapshot}=this.state;
    const {scope,session,configuration}=frame;
    const token={},request=this.context as RequestLabel|null;
    recordControlRender(this,token,frame,request);
    const available=scope.live&&scope.access!=='lost';
    const selecting=session.mode==='select';
    const sceneCommitted=sceneSnapshot?.phase==='select'&&sceneSnapshot.authority?.frame===frame
      &&sceneSnapshot.ticket===this.sceneTicket&&frame.scene===this.props.scene;
    const candidateEditable=available&&!scope.occupied&&this.ownsPresentation(frame)&&session.generation!==null
      &&session.generation<Number.MAX_SAFE_INTEGER&&draft.revision<Number.MAX_SAFE_INTEGER&&(!selecting||sceneCommitted);
    const canEnter=candidateEditable&&scope.admissionVerified&&!selecting&&sceneSnapshot?.enterReady===true
      &&session.lastSessionNonce<Number.MAX_SAFE_INTEGER;
    const event=eventFor(session);
    const apply=()=>this.apply(frame,event),exit=()=>this.exit(frame,event);
    // An unadmitted context must not replace or disable original H controls.
    const appliedData=appliedFor(this.props);
    const rendererReady=configuration!==null&&scope.admissionVerified&&scope.live&&sceneSnapshot?.releaseAllowed===true
      &&(!this.props.appliedPresentation||this.state.presentationCommitted===frame&&appliedData!==null
        &&this.state.appliedReceipt===appliedData&&appliedData.applied===applied);
    const controller:HeaderActionsHF01Controller|undefined=rendererReady&&applied?.['header-actions']?{
      authorityToken:scope.authorityToken,variant:taskHeaderBehaviorVariant(applied),revision:draft.revision,
      mode:session.mode,lifetime:session.epoch,generation:session.generation??0,selectionSessionNonce:session.lastSessionNonce,
      live:scope.live&&session.generation!==null,admissionVerified:scope.admissionVerified,workbenchFocusRef:this.workbenchFocusRef,
    }:undefined;
    const modulePresentation=rendererReady&&applied?projectTaskModulePresentation(applied):undefined;
    const controls=configuration?<ScrollView testID="tasks-choice-host" style={styles.controlsViewport}
      contentContainerStyle={styles.controls} keyboardShouldPersistTaps="handled">
      <View ref={this.workbenchFocusRef} tabIndex={-1} accessibilityLabel="待辦候選配方狀態">
        <Text accessibilityRole="header" style={styles.heading}>待辦選配工作台</Text>
        <Text>預設比較方向為原版／Handbook，首個草稿以 Handbook 為方向；這不表示 H/F 是你的選擇。</Text>
        <Text>H 是臨時整合宿主，不是原版。原版全局主題與完整五版左右預覽尚未接入。</Text>
        <Text>候選編輯不會改動下方產品。詳情、表單、未儲存提示及未知結果恢復保留為同一行為套件。</Text>
        <Text accessibilityLiveRegion="polite">{!available?'目前範圍不可用。':scope.occupied?'候選編輯已暫停，請先依原頁面完成或恢復目前操作。':
          !scope.admissionVerified?'候選配方可編輯；組合預覽尚未開放，現有 H 產品仍可正常互動。':selecting?(sceneCommitted?'選配模式：產品操作暫停。':'正在準備選配模式。'):'產品互動模式。'}</Text>
      </View>
      <View style={styles.versions}>{VARIANT_IDS.map(id=><Text key={id}>{VERSION_LABELS[id]}{id==='original'?'：歷史操作按鈕、分類分頁、搜尋框外框與事項列；分類與搜尋框可一併選配，完整原版來源與全局主題未驗證':'：來源對照，非整版選配'}</Text>)}</View>
      {TASK_SLOT_IDS.map(slot=>{
        const selection=draft.current[slot];
        return <View key={slot} style={styles.slot}>
          <Text accessibilityRole="header" style={styles.slotTitle}>{SLOT_LABELS[slot]}</Text>
          <Text>{slot==='header-actions'?'操作局部或 Handbook 標題與操作外觀；原版操作片段保留 H 頁標題與工具列宿主。':slot==='date-list'?'事項列局部或 Handbook 日期分組與列外觀；空態、載入及分頁仍為 H。':slot==='filters'?'受控分類與篩選外觀；原版分類分頁與搜尋框外框可一併套用，舊單獨片段保留；範圍、日期與提示保留 H，完整原版篩選尚未完成。':'受控月曆與清單布局；沿用 H 元件與保護詳情，實際尺寸及互動仍待驗收。'}</Text>
          <View style={styles.row}>{VARIANT_IDS.map(variant=>{
            const candidates=getTaskSlot(variant,slot)?.narrowCandidates??[];
            return candidates.length ? candidates.map(candidate=><AppButton key={`${variant}:${candidate.candidateId}`}
              label={`${VERSION_LABELS[variant]} · ${COVERAGE_LABELS[candidate.coverage]}（待驗收）`}
              variant="secondary" disabled={!candidateEditable} onPress={()=>{
                const picked=makeTaskRecipeSelection(slot,candidate.candidateId,variant);
                if(picked)this.choose(frame,event,{type:'choose',selection:picked});
              }}/>) : <AppButton key={variant} label={`${VERSION_LABELS[variant]} 未提供選配`} variant="secondary" disabled onPress={()=>{}}/>;
          })}</View>
          <Text>候選籃：{selection?`${VERSION_LABELS[selection.variantId]} · ${COVERAGE_LABELS[selection.coverage]}（待套用／待驗收）`:'未選配；目前沿用 H 宿主'}</Text>
          <AppButton label="清除此槽草稿" accessibilityLabel={`清除${SLOT_LABELS[slot]}草稿`} variant="quiet" disabled={!candidateEditable||!selection} onPress={()=>this.choose(frame,event,{type:'clearSlot',slotId:slot})}/>
          <Text>{checkTaskSlotCapability('original',slot,'compose').prospectiveComposable?'':'完整原版未驗證，不能還原為整版原版；分類＋搜尋框組合及各單獨片段仍屬局部，可在此選配或用配方文字還原，須明確套用。'}</Text>
        </View>;
      })}
      <View style={styles.row}>
        <AppButton label="撤銷候選選配" variant="quiet" disabled={!candidateEditable||!draft.undo.length} onPress={()=>this.choose(frame,event,{type:'undo'})}/>
        <AppButton label="清除候選配方" variant="quiet" disabled={!candidateEditable||TASK_SLOT_IDS.every(slot=>draft.current[slot]===null)} onPress={()=>this.choose(frame,event,{type:'resetPrototype'})}/>
        <AppButton label="還原原版（未提供）" variant="quiet" disabled onPress={()=>{}}/>
      </View>
      <Text>清除只清除候選配方，不清除產品資料，也不表示還原原版。</Text>
      <View style={styles.row}>
        <AppButton label="進入選配模式" variant="secondary" disabled={!canEnter} onPress={()=>this.enter(frame,event)}/>
        <AppButton label="套用到組合預覽（待驗收）" variant="secondary" disabled={!candidateEditable||!scope.admissionVerified||!selecting} onPress={apply}/>
        <AppButton label="返回產品互動" variant="quiet" disabled={!available||!selecting||!sceneCommitted} onPress={exit}/>
      </View>
      <Text>本機儲存尚未接入；此處只處理候選配方文字，重新整理不會自動還原。</Text>
      <AppButton label="產生候選配方文字" variant="quiet" disabled={!candidateEditable} onPress={()=>this.exportDraft(frame,event)}/>
      {exportText?<AppTextField label="候選配方文字（尚未保存）" value={exportText} editable={false} multiline numberOfLines={4} style={styles.recipeText}/>:null}
      {this.state.handoffNotice?<Text accessibilityLiveRegion="polite">{this.state.handoffNotice}</Text>:null}
      <AppTextField label="貼上候選配方文字" value={importText} disabled={!candidateEditable} maxLength={65536} multiline numberOfLines={4} style={styles.recipeText} onChangeText={text=>this.updateImport(frame,event,text)}/>
      <AppButton label="明確還原為候選草稿" variant="quiet" disabled={!candidateEditable||!importText} onPress={()=>this.restore(frame,event,importText)}/>
      <Text accessibilityLiveRegion="polite">{message}</Text>
    </ScrollView>:null;
    return <><CallbackCommitWitness control={this} token={token} frame={frame} request={request} scene={frame.scene}
      apply={apply} exit={exit} isCurrent={()=>this.current(frame)} candidate={candidateWitnessFields(draft.current,applied,draft.revision)}/>{this.props.children({controller,modulePresentation,rowAppearance:legacyTaskRowAppearance(modulePresentation),
      sceneProps:EMPTY_SCENE,controls:controls?<TasksChoiceSceneControls>{controls}</TasksChoiceSceneControls>:null})}</>;
  }
}
const styles=StyleSheet.create({
  // Web's stable outer host owns the cap. Native stays unadmitted and retains
  // the original bounded inline layout because its portal is a passthrough.
  controlsViewport:{...(Platform.OS==='web'?{maxHeight:'100%' as const,flexShrink:1}
    :{height:'45%' as const,maxHeight:360,flexShrink:0}),flexGrow:0,minHeight:0,minWidth:0},
  recipeText:{maxHeight:160,minWidth:0},
  controls:{gap:spacing.md,padding:spacing.md},heading:{fontSize:22,fontWeight:'700'},
  versions:{gap:spacing.xs},slot:{gap:spacing.sm,paddingVertical:spacing.md,borderTopWidth:1,borderTopColor:colors.line},
  slotTitle:{fontSize:17,fontWeight:'600'},row:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm}});
