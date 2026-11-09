import { captureHeaderSaveAuthority, canCommitHeaderSave, type HeaderSaveAuthority } from "./save-authority";
import { Component, createContext, createRef, useContext, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppButton } from "../../components/ui";
import { spacing } from "../../theme";
import type { HeaderActionsHF01Controller } from "./HeaderActionsHF01FocusBoundary";
import { commitHeaderSession, createHeaderSession, enterHeaderSelection, exitHeaderSelection,
  headerChoiceGate, makeHeaderSelection, observeHeaderSession, reduceHeaderChoice,
  restoreHeaderChoice, retireHeaderSession, serializeHeaderRecipe, validateHeaderChoice,
  type HeaderChoice, type HeaderCommand, type HeaderEvent, type HeaderRecipe,
  type HeaderScope, type HeaderSession } from "./selection";
import { inspectHeaderRecipe, saveHeaderRecipe, unreadHeaderRecipe,
  type HeaderRecipeReceipt, type HeaderRecipeStoragePort } from "./recipe-storage";

export interface HeaderActionsHF01Preview {
  readonly storage: HeaderRecipeStoragePort | null;
}
// No provider is mounted by this packet. The future private entry must be reviewed
// inside the existing owner/guard scope, with its actual portals and native modals.
export const HeaderActionsHF01PreviewContext = createContext<HeaderActionsHF01Preview | null>(null);
export function useTaskHeaderActionsHF01Preview() {
  return useContext(HeaderActionsHF01PreviewContext);
}
// Deliberately not a public prop/configuration/test switch. A future source change
// needs genuine private provider/guard/portal/modal admission evidence first.
const RUNTIME_ADMISSION_VERIFIED = false;
export type HeaderActionsHF01SceneProps = Readonly<{
  pointerEvents?: "none";
  accessibilityElementsHidden?: true;
  importantForAccessibility?: "no-hide-descendants";
  "aria-hidden"?: true;
  inert?: true;
}>;
const EMPTY_SCENE_PROPS: HeaderActionsHF01SceneProps = Object.freeze({});
const SELECTED_SCENE_PROPS: HeaderActionsHF01SceneProps = Object.freeze({
  pointerEvents: "none", accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants",
  ...(Platform.OS === "web" ? { "aria-hidden": true as const, inert: true as const } : {}),
});
// A root scene-props request is not portal coverage or an admission receipt.
interface Binding {
  controller: HeaderActionsHF01Controller | undefined;
  sceneProps: HeaderActionsHF01SceneProps;
  controls: ReactNode;
}
interface Props {
  configuration: HeaderActionsHF01Preview | null;
  // Independently supplied by tasksScreen, never inferred from a child identifier.
  authorityToken: string; live: boolean; occupied: boolean; access: HeaderScope["access"];
  children(binding: Binding): ReactNode;
}
type Frame = Readonly<{ configuration: HeaderActionsHF01Preview | null; scope: HeaderScope; session: HeaderSession }>;
type SaveRequest = Readonly<{
  choice: HeaderChoice; receipt: HeaderRecipeReceipt; configuration: HeaderActionsHF01Preview;
  acceptedCandidate?: HeaderRecipe;
  authority: HeaderSaveAuthority;
}>;
interface State { choice: HeaderChoice; frame: Frame; receipt: HeaderRecipeReceipt; pendingSave: SaveRequest | null }
function scopeFor(props: Props, choice: HeaderChoice): HeaderScope {
  return {authorityToken:props.authorityToken, live:props.live && props.configuration !== null,
    occupied:props.occupied, access:props.access,
    admissionVerified:props.configuration !== null && RUNTIME_ADMISSION_VERIFIED,
    variantId:choice.current?.variantId ?? "harbour", revision:choice.revision};
}
function sameScope(a: HeaderScope, b: HeaderScope): boolean {
  return (Object.keys(a) as (keyof HeaderScope)[]).every(key => a[key] === b[key]);
}
function frameFor(props: Props, choice: HeaderChoice, session: HeaderSession): Frame {
  const scope = scopeFor(props, choice);
  const observed = observeHeaderSession(session, scope);
  // Exhaustion must release suppression as well as revoke events. Never wrap a
  // generation to zero or strand a select scene with no valid exit stamp.
  const effective = observed.generation === null && observed.mode === "select"
    ? observeHeaderSession(retireHeaderSession(observed), scope) : observed;
  return {configuration:props.configuration, scope, session:effective};
}
function initialState(props: Props): State {
  const choice: HeaderChoice = {current:null, undo:[], revision:0};
  return {choice, frame:frameFor(props, choice, createHeaderSession()), receipt:unreadHeaderRecipe(), pendingSave:null};
}
function eventFor(session: HeaderSession): HeaderEvent | null {
  if (!session.current || session.generation === null) return null;
  // A render stamp carries no commit authority; every handler rechecks publication.
  return {epoch:session.epoch, authorityToken:session.current.authorityToken, generation:session.generation,
    mode:session.mode, variantId:session.current.variantId, revision:session.current.revision};
}
function storageMessage(receipt: HeaderRecipeReceipt): string {
  if (receipt.status === "quarantined") return "本機配方已隔離：格式、來源或儲存內容已變；不會套用或覆寫。";
  if (receipt.status === "unsaved") return receipt.candidate
    ? "尚未保存到本機；已有配方須先明確還原，不會覆寫。" : "尚未保存到本機；目前選配只保留在記憶體。";
  if (receipt.status === "candidate") return "找到有效的本機配方，尚未套用。";
  if (receipt.status === "saved") return "操作區配方已保存到本機，只含選配資料。";
  if (receipt.status === "empty") return "本機尚未有此操作區配方。";
  return "尚未讀取本機配方；不會自動套用或記錄 H 選配。";
}

/** Selection metadata only. This class neither owns nor receives task data/actions. */
export class TaskHeaderActionsHF01Control extends Component<Props, State> {
  state: State = initialState(this.props);
  private mounted = false;
  private restart = false;
  private retired: HeaderSession | null = null;
  private committedFrame: Frame | null = null;
  private committedSession: HeaderSession | null = null;
  private finishedSave: SaveRequest | null = null;
  private workbenchFocusRef = createRef<View>();

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const configurationChanged = props.configuration !== state.frame.configuration;
    const scope = scopeFor(props, state.choice);
    if (!configurationChanged && sameScope(scope, state.frame.scope)) return null;
    const session = configurationChanged ? retireHeaderSession(state.frame.session) : state.frame.session;
    // Occupied/lost/mismatched inputs suspend before rendering. The same session
    // supplies controls, renderer and scene suppression in this very commit.
    const receipt = configurationChanged ? unreadHeaderRecipe() : state.receipt;
    // Every observed authority/configuration retirement cancels the deferred
    // intent. Returning to the same facts later cannot automatically retry it.
    return {frame:frameFor(props, state.choice, session), pendingSave:null,
      receipt:state.pendingSave ? {...receipt, status:"unsaved" as const} : receipt};
  }
  componentDidMount() {
    this.mounted = true;
    if (this.restart) {
      this.restart = false;
      const retired = this.retired ?? retireHeaderSession(this.state.frame.session);
      this.retired = null;
      this.setState({frame:frameFor(this.props, this.state.choice, retired), pendingSave:null,
        receipt:this.state.pendingSave ? {...this.state.receipt, status:"unsaved" as const} : this.state.receipt});
      return;
    }
    this.publish();
  }
  componentDidUpdate() {
    this.publish();
    const request = this.state.pendingSave;
    if (!request || request === this.finishedSave) return;
    // Recheck the request's authorized resulting frame, not just whatever new
    // frame was published above. The accepted recipe gate rechecks current
    // commit, lifetime, scope, revision, mode, live/access/occupied/admission.
    if (!this.current(this.state.frame) || request.configuration !== this.props.configuration
      || request.choice !== this.state.choice
      || !canCommitHeaderSave(request.authority, this.state.frame, this.committedSession)) {
      this.cancelSave(request);
      return;
    }
    // Exactly one attempt after this metadata state commits, never inside a state
    // updater/render. No auto retry or ambient storage listener is installed.
    this.finishedSave = request;
    const receipt = saveHeaderRecipe(request.configuration.storage, request.choice, request.receipt, request.acceptedCandidate);
    this.setState(state => state.pendingSave === request ? {receipt, pendingSave:null} : null);
  }
  componentWillUnmount() {
    this.mounted = false;
    this.retired = retireHeaderSession(this.state.frame.session);
    this.restart = true;
    this.committedFrame = null; this.committedSession = null;
    this.finishedSave = this.state.pendingSave;
    // Never persist, navigate, close a dialog or restore focus during cleanup.
  }
  private publish() {
    const frame = this.state.frame;
    if (!this.mounted || frame.configuration !== this.props.configuration
      || !sameScope(frame.scope, scopeFor(this.props, this.state.choice))) return;
    this.committedFrame = frame;
    this.committedSession = commitHeaderSession(frame.session);
  }
  private current(frame: Frame): boolean {
    return this.mounted && this.committedFrame === frame && this.state.frame === frame
      && frame.configuration === this.props.configuration
      && sameScope(frame.scope, scopeFor(this.props, this.state.choice));
  }
  private sessionFor(frame: Frame): HeaderSession | null {
    return this.current(frame) ? this.committedSession : null;
  }
  private cancelSave(request: SaveRequest) {
    this.finishedSave = request;
    this.setState(state => state.pendingSave === request
      ? {receipt:{...state.receipt, status:"unsaved" as const}, pendingSave:null} : null);
  }
  private transition(choice: HeaderChoice, session: HeaderSession, save = false, acceptedCandidate?: HeaderRecipe) {
    const configuration = this.props.configuration;
    const nextFrame = frameFor(this.props, choice, session);
    const authority = save ? captureHeaderSaveAuthority(nextFrame, nextFrame.session) : null;
    const pendingSave = save && configuration && authority
      ? {choice, receipt:this.state.receipt, configuration, acceptedCandidate, authority} : null;
    // Retire dispatched callbacks immediately, including a second queued press
    // before React processes the scheduled metadata update.
    this.committedFrame = null; this.committedSession = null;
    this.setState({choice, frame:nextFrame, pendingSave});
  }
  private enter(frame: Frame, event: HeaderEvent | null) {
    const session = this.sessionFor(frame);
    if (!session || session.lastSessionNonce === Number.MAX_SAFE_INTEGER) return;
    const result = enterHeaderSelection(session, event, session.lastSessionNonce + 1);
    if (result.outcome === "applied") this.transition(this.state.choice, result.state);
  }
  private exit(frame: Frame, event: HeaderEvent | null) {
    const session = this.sessionFor(frame);
    if (!session) return;
    // No recipe/admission/occupied gate here. Automatic suspension also releases
    // suppression synchronously if a stale exit callback is correctly rejected.
    const result = exitHeaderSelection(session, event);
    if (result.outcome === "applied") this.transition(this.state.choice, result.state);
  }
  private choose(frame: Frame, event: HeaderEvent | null, command: HeaderCommand) {
    const session = this.sessionFor(frame);
    if (!session) return;
    const result = reduceHeaderChoice(this.state.choice, command,
      headerChoiceGate(session, event, validateHeaderChoice(this.state.choice)));
    if (result.outcome === "applied") this.transition(result.state, session, true);
  }
  private inspect(frame: Frame) {
    if (!this.current(frame) || !frame.scope.live || frame.scope.access === "lost" || !frame.configuration) return;
    // Inspecting metadata is distinct from applying it; occupied does not hide it.
    const receipt = inspectHeaderRecipe(frame.configuration.storage);
    this.setState({receipt});
  }
  private restore(frame: Frame, event: HeaderEvent | null, receipt: HeaderRecipeReceipt) {
    const session = this.sessionFor(frame);
    if (!session || receipt !== this.state.receipt || !receipt.candidate) return;
    const result = restoreHeaderChoice(this.state.choice, receipt.candidate,
      headerChoiceGate(session, event, true), session, event);
    if (result.outcome === "applied") this.transition(result.state, result.session, true, receipt.candidate);
  }
  private save(frame: Frame, event: HeaderEvent | null) {
    const session = this.sessionFor(frame);
    if (!session || !headerChoiceGate(session, event, true).live) return;
    this.transition(this.state.choice, session, true);
  }
  render() {
    const {frame, choice, receipt} = this.state;
    const {session, scope, configuration} = frame;
    const selecting = session.mode === "select";
    const available = scope.live && scope.access !== "lost";
    const hasGeneration = session.generation !== null && session.generation < Number.MAX_SAFE_INTEGER;
    const canEnter = available && hasGeneration && session.lastSessionNonce < Number.MAX_SAFE_INTEGER
      && !scope.occupied && scope.admissionVerified && !selecting;
    const canChoose = available && hasGeneration && !scope.occupied && scope.admissionVerified && selecting && !session.suspended;
    const serialized = serializeHeaderRecipe(choice);
    const memoryUnsaved = choice.revision > 0 && (receipt.status !== "saved"
      || serialized.status !== "valid" || receipt.expected !== serialized.json);
    const event = eventFor(session);
    const controller: HeaderActionsHF01Controller | undefined = configuration ? {
      authorityToken:scope.authorityToken, variant:choice.current?.variantId ?? "harbour", revision:choice.revision,
      mode: session.mode, lifetime: session.epoch, generation:session.generation ?? 0,
      selectionSessionNonce: session.lastSessionNonce, live:scope.live && session.generation !== null,
      admissionVerified:scope.admissionVerified, workbenchFocusRef:this.workbenchFocusRef,
    } : undefined;
    const controls = configuration ? <View style={styles.controls} testID="task-header-hf01-workbench">
      <View ref={this.workbenchFocusRef} tabIndex={-1} accessibilityLabel="操作區選配狀態">
        <Text>頁首與操作：操作區（局部適配）</Text>
        <Text>標題沿用 H 宿主；H 不是原版，原版全局主題尚未提供。</Text>
        <Text accessibilityLiveRegion="polite">{!available ? "目前範圍不可用。" : scope.occupied
          ? "選配已暫停；現有表單及復原操作仍由原頁面管理。" : !scope.admissionVerified
          ? "選配入口未開放：私人入口及彈窗抑制仍待驗證。" : session.suspended
          ? "選配已暫停，須再次明確進入。" : selecting ? "選配模式：產品操作暫停。" : "互動模式。"}</Text>
      </View>
      <View style={styles.row}>
        <AppButton label="進入選配模式" variant="secondary" disabled={!canEnter} onPress={() => this.enter(frame,event)} />
        <AppButton label="返回互動模式" variant="quiet" disabled={!available || !selecting} onPress={() => this.exit(frame,event)} />
      </View>
      <View style={styles.row}>
        <AppButton label="採用 H 操作區" variant="secondary" disabled={!canChoose} onPress={() => {
          const selection = makeHeaderSelection("harbour"); if (selection) this.choose(frame,event,{type:"choose",selection});
        }} />
        <AppButton label="採用 F 操作區" variant="secondary" disabled={!canChoose} onPress={() => {
          const selection = makeHeaderSelection("fourth"); if (selection) this.choose(frame,event,{type:"choose",selection});
        }} />
      </View>
      <Text>選配籃：{choice.current ? `${choice.current.variantId === "harbour" ? "H" : "F"} 操作區（局部適配）` : "H 宿主基線，未採用"}</Text>
      <View style={styles.row}>
        <AppButton label="撤銷上次選配" variant="quiet" disabled={!canChoose || choice.undo.length === 0} onPress={() => this.choose(frame,event,{type:"undo"})} />
        <AppButton label="清除此操作區選配" variant="quiet" disabled={!canChoose || choice.current === null} onPress={() => this.choose(frame,event,{type:"resetPrototype"})} />
        <AppButton label="還原原版" variant="quiet" disabled onPress={() => {}} />
      </View>
      <Text>還原原版尚未提供；清除選配只返回 H 宿主基線。</Text>
      <Text accessibilityLiveRegion="polite">{memoryUnsaved && receipt.status !== "unsaved" ? "尚未保存到本機；" : ""}{storageMessage(receipt)}</Text>
      <View style={styles.row}>
        <AppButton label="查看本機配方" variant="quiet" disabled={!available} onPress={() => this.inspect(frame)} />
        <AppButton label="明確還原本機配方" variant="quiet" disabled={!canChoose || !receipt.candidate} onPress={() => this.restore(frame,event,receipt)} />
        <AppButton label="保存目前配方" variant="quiet" disabled={!canChoose || !receipt.writable} onPress={() => this.save(frame,event)} />
      </View>
    </View> : null;
    return this.props.children({ controller, sceneProps: selecting ? SELECTED_SCENE_PROPS : EMPTY_SCENE_PROPS, controls });
  }
}
const styles = StyleSheet.create({
  controls:{gap:spacing.sm, padding:spacing.md},
  row:{flexDirection:"row", flexWrap:"wrap", gap:spacing.sm},
});
