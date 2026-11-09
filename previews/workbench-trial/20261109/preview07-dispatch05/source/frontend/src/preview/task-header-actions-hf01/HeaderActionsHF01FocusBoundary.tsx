import { Component, type ReactNode, type RefObject } from "react";
import { Platform, type View } from "react-native";
import type { TasksViewModel } from "../../task-view-model";
import type { HeaderAction, HeaderActionRefs, HeaderActionsVariant, TasksHeaderActionsHF01Props } from "../../components/tasks/TasksHeaderActionsHF01";
import { allowsHeaderEvent, commitHeaderSession, createHeaderSession, observeHeaderSession,
  retireHeaderSession, type HeaderEvent, type HeaderSession } from "./selection";

// Task 3 supplies its already-observed effective mode, generation and nonce.
// Its controls AND scene suppression must consume that same state. This local
// boundary cannot admit selection or own a recipe, task store, route or provider.
export interface HeaderActionsHF01Controller {
  authorityToken: string; variant: HeaderActionsVariant; revision: number;
  mode: "interact" | "select"; lifetime: object; generation: number;
  selectionSessionNonce: number; live: boolean; admissionVerified: boolean;
  workbenchFocusRef: RefObject<View | null>;
}
type RenderProps = Omit<TasksHeaderActionsHF01Props, "region">;
type Controls = { toolbar: RenderProps; disclosure: RenderProps };
interface Props {
  controller?: HeaderActionsHF01Controller;
  // Independent workspace.scopeKey from the real host, never inferred from child.id.
  actualAuthorityToken?: string;
  access: TasksViewModel["access"]; occupied: boolean; compact: boolean;
  pageContextRef: RefObject<View | null>;
  onActivate(action: HeaderAction): void;
  children(controls: Controls | null): ReactNode;
}
type Input = Readonly<{
  enabled: boolean; valid: boolean; authority: string; actualAuthority: string;
  lifetime: object | null; generation: number; nonce: number; revision: number;
  variant: HeaderActionsVariant; mode: "interact" | "select";
  live: boolean; admission: boolean; access: TasksViewModel["access"];
  occupied: boolean; compact: boolean;
  pageRef: RefObject<View | null>; workbenchRef: RefObject<View | null> | null;
}>;
type Frame = Readonly<{ input: Input; session: HeaderSession }>;
interface State { frame: Frame; open: boolean; disclosureId: number }
type RefName = keyof HeaderActionRefs;
type ControlName = HeaderAction | "trigger";
type Bank = { frame: Frame; epoch: object; open: boolean; disclosureId: number; nodes: Map<RefName, View>; refs: HeaderActionRefs };
type Snapshot = { epoch: object; input: Input; node: HTMLElement; logical: ControlName | null; open: boolean };
const REF_NAMES: readonly RefName[] = ["toolbarRegion", "disclosureRegion", "trigger", "create", "assistant", "history"];
const CONTROL_NAMES: readonly ControlName[] = ["trigger", "create", "assistant", "history"];
const safeInteger = (n: number) => Number.isSafeInteger(n) && n >= 0;
function inputFor(props: Props): Input {
  const c = props.controller;
  const valid = !!c && typeof c.authorityToken === "string" && c.authorityToken.length > 0
    && c.authorityToken === props.actualAuthorityToken && typeof c.lifetime === "object" && c.lifetime !== null
    && safeInteger(c.generation) && safeInteger(c.selectionSessionNonce) && safeInteger(c.revision)
    && (c.variant === "harbour" || c.variant === "fourth") && (c.mode === "interact" || c.mode === "select")
    && typeof c.live === "boolean" && typeof c.admissionVerified === "boolean";
  return { enabled: !!c, valid, authority: c?.authorityToken ?? "", actualAuthority: props.actualAuthorityToken ?? "",
    lifetime: c?.lifetime ?? null, generation: c?.generation ?? 0, nonce: c?.selectionSessionNonce ?? 0,
    revision: c?.revision ?? 0, variant: c?.variant ?? "harbour", mode: c?.mode ?? "interact",
    live: valid && c?.live === true, admission: valid && c?.admissionVerified === true,
    access: props.access, occupied: props.occupied, compact: props.compact,
    pageRef: props.pageContextRef, workbenchRef: c?.workbenchFocusRef ?? null };
}
function sameInput(a: Input, b: Input): boolean {
  return (Object.keys(a) as (keyof Input)[]).every(key => a[key] === b[key]);
}
function frameFor(input: Input, session: HeaderSession): Frame {
  return { input, session: observeHeaderSession(session, {
    authorityToken: input.valid ? input.actualAuthority : "", live: input.live && input.admission,
    occupied: input.occupied, admissionVerified: input.admission, access: input.access,
    variantId: input.variant, revision: input.revision,
  }) };
}
function webNode(value: unknown): HTMLElement | null {
  // Native refs never get cast to DOM. A native focus adapter is a separate gate.
  return Platform.OS === "web" && typeof HTMLElement !== "undefined" && value instanceof HTMLElement ? value : null;
}
function usable(node: HTMLElement | null): node is HTMLElement {
  if (!node?.isConnected || !node.getClientRects().length || node.hasAttribute("disabled")
    || node.getAttribute("aria-disabled") === "true" || node.closest('[inert],[aria-hidden="true"]')) return false;
  const visibility = node.ownerDocument.defaultView?.getComputedStyle(node).visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

/** Stable no-DOM boundary. Dispatch publication and focus snapshots are separate. */
export class HeaderActionsHF01FocusBoundary extends Component<Props, State, Snapshot | null> {
  state: State = { frame: frameFor(inputFor(this.props), createHeaderSession()), open: false, disclosureId: 0 };
  private mounted = false;
  private epoch: object = {};
  private restart = false;
  private retired: HeaderSession | null = null;
  private committedFrame: Frame | null = null;
  private committedSession: HeaderSession | null = null;
  private committedBank: Bank | null = null;
  private renderBank: Bank | null = null;
  private registrations = new Map<RefName, { bank: Bank; node: View }>();
  private fallbacks: { bank: Bank; page: HTMLElement | null; workbench: HTMLElement | null } | null = null;

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const input = inputFor(props);
    if (sameInput(input, state.frame.input)) return null;
    // Each observed full-stamp transition retires the old object epoch, including
    // A -> B -> A, external mode/generation/nonce changes and compact resize.
    return { frame: frameFor(input, retireHeaderSession(state.frame.session)), open: false };
  }
  componentDidMount() {
    this.mounted = true;
    if (this.restart) {
      this.restart = false;
      const retired = this.retired ?? retireHeaderSession(this.state.frame.session);
      this.retired = null;
      // Strict cleanup/restart must render fresh callbacks/refs before publication.
      this.setState({ frame: frameFor(inputFor(this.props), retired), open: false });
      return;
    }
    this.publish();
  }
  componentWillUnmount() {
    this.mounted = false;
    this.epoch = {};
    this.retired = retireHeaderSession(this.state.frame.session);
    this.restart = true;
    this.committedFrame = null; this.committedSession = null; this.committedBank = null;
    this.renderBank = null; this.fallbacks = null; this.registrations.clear();
    // No cleanup focus, collapse, task action, timer or deferred origin restore.
  }
  private publish() {
    const frame = this.state.frame, bank = this.renderBank;
    if (!this.mounted || !sameInput(frame.input, inputFor(this.props))) return;
    this.committedFrame = frame;
    this.committedSession = commitHeaderSession(frame.session);
    this.committedBank = bank?.frame === frame && bank.epoch === this.epoch && this.currentMenuBank(bank) ? bank : null;
    this.fallbacks = this.committedBank ? { bank: this.committedBank,
      page: webNode(this.props.pageContextRef.current),
      workbench: webNode(this.props.controller?.workbenchFocusRef.current),
    } : null;
  }
  private currentMenuBank(bank: Bank): boolean {
    return bank.open === this.state.open && bank.disclosureId === this.state.disclosureId;
  }
  private bankFor(frame: Frame): Bank {
    if (this.renderBank?.frame === frame && this.renderBank.epoch === this.epoch && this.currentMenuBank(this.renderBank)) return this.renderBank;
    const bank: Bank = { frame, epoch: this.epoch, open: this.state.open, disclosureId: this.state.disclosureId,
      nodes: new Map(), refs: {} as HeaderActionRefs };
    for (const name of REF_NAMES) {
      let ownNode: View | null = null;
      bank.refs[name] = node => {
        if (node) {
          if (bank.epoch !== this.epoch || this.state.frame !== frame || !this.currentMenuBank(bank)
            || !sameInput(frame.input, inputFor(this.props))) return;
          ownNode = node; bank.nodes.set(name, node); this.registrations.set(name, { bank, node });
        } else {
          const registration = this.registrations.get(name);
          if (registration && registration.bank === bank && registration.node === ownNode) this.registrations.delete(name);
          if (bank.nodes.get(name) === ownNode) bank.nodes.delete(name);
          ownNode = null;
        }
      };
    }
    // Keep the previous committed bank intact until getSnapshotBeforeUpdate.
    this.renderBank = bank;
    return bank;
  }
  private current(frame: Frame, bank: Bank): boolean {
    return this.mounted && this.committedFrame === frame && this.state.frame === frame
      && this.committedBank === bank && bank.epoch === this.epoch && this.currentMenuBank(bank)
      && sameInput(frame.input, inputFor(this.props));
  }
  private eventFor(frame: Frame): HeaderEvent | null {
    const { session } = frame;
    if (!session.current || session.generation === null) return null;
    // A render stamp is not a commit. Dispatch compares it to published state.
    return { epoch: session.epoch, authorityToken: session.current.authorityToken,
      generation: session.generation, mode: session.mode, variantId: session.current.variantId, revision: session.current.revision };
  }
  private dispatchAllowed(frame: Frame, bank: Bank, event: HeaderEvent | null, action: HeaderAction): boolean {
    if (!this.mounted || this.committedFrame !== frame || this.state.frame !== frame || !this.current(frame, bank)) return false;
    const input = inputFor(this.props);
    return input.valid && input.live && input.admission && input.mode === "interact"
      && !input.occupied && input.access !== "lost" && this.committedSession !== null
      && allowsHeaderEvent(this.committedSession, event, action);
  }
  private effectiveOpen(): boolean {
    const i = this.state.frame.input;
    return this.state.open && i.valid && i.live && i.admission && i.compact && !i.occupied
      && i.access !== "lost" && i.mode === "interact";
  }
  private controls(frame: Frame, bank: Bank, region: "toolbar" | "disclosure"): RenderProps {
    const input = frame.input, event = this.eventFor(frame), disclosureId = this.state.disclosureId;
    const expanded = this.effectiveOpen();
    return { variant: input.variant, compact: input.compact,
      access: input.valid && input.live && input.admission ? input.access : "lost", occupied: input.occupied,
      selectionMode: input.mode === "select", expanded, scopeToken: input.actualAuthority,
      disclosureSessionId: disclosureId, refs: bank.refs,
      onToggle: () => {
        if (!this.dispatchAllowed(frame, bank, event, "history") || !input.compact
          || this.state.disclosureId !== disclosureId || this.effectiveOpen() !== expanded) return;
        if (region === "disclosure" && !expanded) return;
        this.setState(state => {
          if (state.frame !== frame || state.disclosureId !== disclosureId || state.open !== expanded) return null;
          if (state.open) return { open: false, disclosureId: state.disclosureId };
          if (state.disclosureId === Number.MAX_SAFE_INTEGER) return null;
          return { open: true, disclosureId: state.disclosureId + 1 };
        });
      },
      onActivate: action => {
        if (!this.dispatchAllowed(frame, bank, event, action)) return;
        if (region === "disclosure" && (!this.effectiveOpen() || this.state.disclosureId !== disclosureId)) return;
        this.setState(state => state.frame === frame ? { open: false } : null);
        this.props.onActivate(action);
      },
    };
  }
  getSnapshotBeforeUpdate(_previousProps: Props, previousState: State): Snapshot | null {
    const bank = this.committedBank, old = previousState.frame.input;
    if (!this.mounted || !old.enabled || !old.valid || !bank || bank.frame !== previousState.frame || bank.epoch !== this.epoch
      || Platform.OS !== "web" || typeof document === "undefined") return null;
    if (previousState.frame === this.state.frame && previousState.open === this.state.open) return null;
    const node = webNode(document.activeElement);
    if (!node || !["toolbarRegion", "disclosureRegion"].some(name => webNode(bank.nodes.get(name as RefName))?.contains(node))) return null;
    const logical = CONTROL_NAMES.find(name => webNode(bank.nodes.get(name))?.contains(node)) ?? null;
    return { epoch: this.epoch, input: old, node, logical, open: previousState.open };
  }
  componentDidUpdate(_previousProps: Props, _previousState: State, snapshot: Snapshot | null) {
    this.publish();
    if (snapshot) this.restoreFocus(snapshot);
  }
  private restoreFocus(snapshot: Snapshot) {
    const frame = this.state.frame, bank = this.committedBank, now = frame.input, old = snapshot.input;
    if (!bank || !this.current(frame, bank) || snapshot.epoch !== this.epoch || !now.valid || !now.live || !now.admission
      || !now.enabled || now.access === "lost" || now.actualAuthority !== old.actualAuthority
      || now.authority !== old.authority || now.lifetime !== old.lifetime || now.access !== old.access) return;
    const newerFocus = () => {
      const active = webNode(document.activeElement);
      return active !== snapshot.node && active !== document.body && active !== document.documentElement && usable(active);
    };
    if (newerFocus()) return;
    let targets: (ControlName | "page" | "workbench")[] = [];
    if (now.occupied && !old.occupied) targets = ["page"];
    else if (now.mode !== old.mode || now.revision !== old.revision || now.variant !== old.variant
      || now.generation !== old.generation || now.nonce !== old.nonce) targets = ["workbench"];
    else if (now.compact !== old.compact) {
      const stillVisible = snapshot.logical && this.registrations.get(snapshot.logical);
      if (stillVisible && stillVisible.bank === bank && webNode(stillVisible.node) === snapshot.node && usable(snapshot.node)) return;
      targets = !now.compact && snapshot.logical && snapshot.logical !== "trigger" ? [snapshot.logical, "page"] : ["trigger", "page"];
    } else if (snapshot.open && !this.effectiveOpen()) targets = ["trigger", "page"];
    for (const name of targets) {
      if (!this.current(frame, bank) || snapshot.epoch !== this.epoch || newerFocus()) return;
      let target: HTMLElement | null = null;
      if (name === "page" || name === "workbench") {
        const fallback = this.fallbacks;
        const currentRef = name === "page" ? this.props.pageContextRef : this.props.controller?.workbenchFocusRef;
        if (fallback?.bank === bank && fallback[name] === webNode(currentRef?.current)) target = fallback[name];
      } else {
        const registration = this.registrations.get(name);
        if (registration?.bank === bank) target = webNode(registration.node);
      }
      if (!usable(target)) continue;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) return;
    }
  }
  render() {
    const frame = this.state.frame;
    if (!frame.input.enabled) return this.props.children(null);
    const bank = this.bankFor(frame);
    return this.props.children({ toolbar: this.controls(frame, bank, "toolbar"), disclosure: this.controls(frame, bank, "disclosure") });
  }
}
