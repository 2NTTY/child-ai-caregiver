// Pure, source-only HF01 choice state. No product owner, React or storage API.
export type HeaderVariant = 'harbour' | 'fourth';
export type Outcome = 'applied' | 'noop' | 'blocked' | 'invalid';
export type SourceFingerprint = Readonly<{
  assemblyMembersSha256: string;
  files: readonly Readonly<{path: string; sha256: string}>[];
}>;
export type HeaderSelection = Readonly<{
  slotId: 'header-actions'; coverage: 'actions-only'; variantId: HeaderVariant;
  adapterVersion: 'hf01-v1'; sourceFingerprint: SourceFingerprint;
  dependenciesFingerprint: string;
}>;
export type HeaderChoice = Readonly<{
  current: HeaderSelection | null; undo: readonly (HeaderSelection | null)[]; revision: number;
}>;
export type ChoiceGate = Readonly<{
  live: boolean; occupied: boolean; expectedRevision: number; actualRevision: number; sourceValid: boolean;
}>;
export type HeaderCommand = {type: 'choose'; selection: HeaderSelection} | {type: 'undo'} | {type: 'resetPrototype'};
export type ChoiceResult = {state: HeaderChoice; outcome: Outcome};
export const RECIPE_KEY = 'tasks-header-actions-hf01:recipe:v1';
const MAX_RECORD_BYTES = 65536;
const MAX_UNDO = 50;
const SOURCE_PINS = {
  "harbour": {
    "assemblyMembersSha256": "3f1fbfbe61217f75898e88276cb06e203d19c7ecf54c4febd4018e64329cc3e1",
    "files": [
      {
        "path": "src/components/tasks/TasksView.tsx",
        "sha256": "8483cfd203691284cdaf7550e7c5adeb6418f00242a38e684d19f0b25a8e9fd4"
      },
      {
        "path": "src/screens/tasksScreen.tsx",
        "sha256": "8f363e127d12a7db13bd0d2b1e7645450d0e6f35e7a280d5f5884b5ebb297dab"
      },
      {
        "path": "src/workspaces/TasksWorkspace.tsx",
        "sha256": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68"
      }
    ]
  },
  "fourth": {
    "assemblyMembersSha256": "690eedec12c76940c236b9f5317783fd835b679dd14a49d1654bd09298d0d9bc",
    "files": [
      {
        "path": "src/components/tasks/TasksView.tsx",
        "sha256": "f19ff82be6aa169991cb80cae336530704ee67f64b4d3c8db3597266d89b1fb8"
      },
      {
        "path": "src/screens/tasksScreen.tsx",
        "sha256": "c5e9edb39172c1d5283ffaf4243afbab57dc57ac9ad65f9efa7e5fe33f5ddc0f"
      },
      {
        "path": "src/workspaces/TasksWorkspace.tsx",
        "sha256": "35b350e164255a1beac5a965e83397a102af72b271f3307c47d463f399cb1c68"
      }
    ]
  }
} as const;
// Freeze nested exports so consumers cannot replace the validator's authority pins.
for (const source of Object.values(SOURCE_PINS)) {
  for (const file of source.files) Object.freeze(file);
  Object.freeze(source.files); Object.freeze(source);
}
export const SOURCE_FINGERPRINTS = Object.freeze(SOURCE_PINS);
// SHA-256 of the canonical sorted-key dependency-file manifest in lineage.json.
export const DEPENDENCIES_FINGERPRINT = 'ff4e1776d4892fdce613f5db3aa8369c06c8ca024bfa20244f33a22c85d197d6';

type Check = 'valid' | 'invalid' | 'unavailable';
const safeRevision = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const sha256 = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(k => typeof k === 'string' && keys.includes(k)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, k)!, 'value'));
}
function jsonArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === value.length + 1 && own.every(k => k === 'length' || (typeof k === 'string'
    && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < value.length
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, k)!, 'value')));
}
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
      && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function selectionCheck(value: unknown): Check {
  if (value === null) return 'valid';
  if (!record(value, ['slotId','coverage','variantId','adapterVersion','sourceFingerprint','dependenciesFingerprint'])
    || value.slotId !== 'header-actions' || value.coverage !== 'actions-only' || value.adapterVersion !== 'hf01-v1') return 'invalid';
  const fingerprint = value.sourceFingerprint;
  if (!record(fingerprint, ['assemblyMembersSha256','files']) || !sha256(fingerprint.assemblyMembersSha256)
    || !jsonArray(fingerprint.files, 3) || fingerprint.files.length !== 3 || !sha256(value.dependenciesFingerprint)) return 'invalid';
  for (const file of fingerprint.files) {
    if (!record(file, ['path','sha256']) || typeof file.path !== 'string' || file.path.length > 512 || !sha256(file.sha256)) return 'invalid';
  }
  if (value.variantId !== 'harbour' && value.variantId !== 'fourth') return 'unavailable';
  const known = SOURCE_FINGERPRINTS[value.variantId];
  if (fingerprint.assemblyMembersSha256 !== known.assemblyMembersSha256
    || value.dependenciesFingerprint !== DEPENDENCIES_FINGERPRINT) return 'unavailable';
  for (let i = 0; i < known.files.length; i++) {
    const file = fingerprint.files[i] as {path: string; sha256: string};
    if (file.path !== known.files[i].path || file.sha256 !== known.files[i].sha256) return 'unavailable';
  }
  return 'valid';
}
function choiceCheck(value: unknown): Check {
  if (!record(value, ['current','undo','revision']) || !safeRevision(value.revision) || !jsonArray(value.undo, MAX_UNDO)) return 'invalid';
  const checks = [selectionCheck(value.current), ...value.undo.map(selectionCheck)];
  if (checks.includes('invalid')) return 'invalid';
  if (utf8Bytes(JSON.stringify(value)) > MAX_RECORD_BYTES) return 'invalid';
  return checks.includes('unavailable') ? 'unavailable' : 'valid';
}
export function validateHeaderChoice(value: unknown): value is HeaderChoice {
  try { return choiceCheck(value) === 'valid'; } catch { return false; }
}
function copySelection(value: HeaderSelection | null): HeaderSelection | null {
  if (value === null) return null;
  return {...value, sourceFingerprint: {
    assemblyMembersSha256: value.sourceFingerprint.assemblyMembersSha256,
    files: value.sourceFingerprint.files.map(file => ({...file})),
  }};
}
function copyChoice(value: HeaderChoice): HeaderChoice {
  return {current:copySelection(value.current), undo:value.undo.map(copySelection), revision:value.revision};
}
export function makeHeaderSelection(variantId: unknown): HeaderSelection | null {
  if (variantId !== 'harbour' && variantId !== 'fourth') return null;
  return copySelection({slotId:'header-actions', coverage:'actions-only', variantId, adapterVersion:'hf01-v1',
    sourceFingerprint:SOURCE_FINGERPRINTS[variantId], dependenciesFingerprint:DEPENDENCIES_FINGERPRINT});
}
function validGate(value: unknown): value is ChoiceGate {
  return record(value, ['live','occupied','expectedRevision','actualRevision','sourceValid'])
    && typeof value.live === 'boolean' && typeof value.occupied === 'boolean' && typeof value.sourceValid === 'boolean'
    && safeRevision(value.expectedRevision) && safeRevision(value.actualRevision);
}
function gateOpen(state: HeaderChoice, gate: ChoiceGate): boolean {
  return gate.live && !gate.occupied && gate.sourceValid
    && gate.expectedRevision === state.revision && gate.actualRevision === state.revision;
}
function sameSelection(a: HeaderSelection | null, b: HeaderSelection | null): boolean {
  // Both records have already passed exact known-lineage validation.
  return a === null || b === null ? a === b : a.variantId === b.variantId;
}
export function reduceHeaderChoice(state: HeaderChoice, command: unknown, gate: ChoiceGate): ChoiceResult {
  const unchanged = (outcome: Outcome): ChoiceResult => ({state, outcome});
  try {
    if (!validateHeaderChoice(state) || !validGate(gate)) return unchanged('invalid');
    if (!record(command, ['type']) && !record(command, ['type','selection'])) return unchanged('invalid');
    if (command.type === 'choose') {
      if (!record(command, ['type','selection']) || command.selection === null || selectionCheck(command.selection) !== 'valid') return unchanged('invalid');
    } else if (!record(command, ['type']) || !['undo','resetPrototype'].includes(command.type as string)) return unchanged('invalid');
    if (!gateOpen(state, gate)) return unchanged('blocked');
    let current: HeaderSelection | null;
    let undo: readonly (HeaderSelection | null)[];
    if (command.type === 'undo') {
      if (!state.undo.length) return unchanged('noop');
      current = state.undo[state.undo.length - 1]; undo = state.undo.slice(0, -1);
    } else {
      current = command.type === 'choose' ? command.selection as HeaderSelection : null;
      if (sameSelection(state.current, current)) return unchanged('noop');
      undo = [...state.undo, state.current].slice(-MAX_UNDO);
    }
    if (state.revision === Number.MAX_SAFE_INTEGER) return unchanged('invalid');
    const next = copyChoice({current, undo, revision:state.revision + 1});
    return validateHeaderChoice(next) ? {state:next,outcome:'applied'} : unchanged('invalid');
  } catch { return unchanged('invalid'); }
}

export type HeaderRecipe = Readonly<{schemaVersion: 1; namespace: typeof RECIPE_KEY; choice: HeaderChoice}>;
export type RecipeParse = {status:'valid'; recipe:HeaderRecipe} | {status:'invalid'|'unavailable'};
function recipeCheck(value: unknown): Check {
  if (!record(value, ['schemaVersion','namespace','choice']) || value.schemaVersion !== 1 || value.namespace !== RECIPE_KEY) return 'invalid';
  const status = choiceCheck(value.choice);
  if (status === 'invalid' || utf8Bytes(JSON.stringify(value)) > MAX_RECORD_BYTES) return 'invalid';
  return status;
}
export function parseHeaderRecipe(json: unknown): RecipeParse {
  try {
    if (typeof json !== 'string' || utf8Bytes(json) > MAX_RECORD_BYTES) return {status:'invalid'};
    const value: unknown = JSON.parse(json);
    const status = recipeCheck(value);
    return status === 'valid' ? {status,recipe:value as HeaderRecipe} : {status};
  } catch { return {status:'invalid'}; }
}
export function serializeHeaderRecipe(state: HeaderChoice): {status:'valid'; json:string} | {status:'invalid'} {
  if (!validateHeaderChoice(state)) return {status:'invalid'};
  const json = JSON.stringify({schemaVersion:1,namespace:RECIPE_KEY,choice:copyChoice(state)});
  return utf8Bytes(json) <= MAX_RECORD_BYTES ? {status:'valid',json} : {status:'invalid'};
}

// These values are transient only. Do not put sessions, scopes, or event stamps in a recipe.
export type HeaderScope = Readonly<{
  authorityToken: string; live: boolean; occupied: boolean; admissionVerified: boolean;
  access: 'editable'|'read_only'|'lost'; variantId: HeaderVariant; revision: number;
}>;
// An object-identity epoch prevents a new owner lifetime from accepting a prior
// lifetime's equal token/revision/generation. Cleanup also renews the epoch.
export type HeaderSession = Readonly<{
  epoch: object; current: HeaderScope | null; mode: 'interact'|'select'; suspended: boolean;
  generation: number | null; lastSessionNonce: number; mounted: boolean; committedGeneration: number | null;
}>;
export type HeaderEvent = Readonly<{
  epoch: object; authorityToken: string; generation: number; mode: 'interact'|'select'; variantId: HeaderVariant; revision: number;
}>;
const SCOPE_KEYS = ['authorityToken','live','occupied','admissionVerified','access','variantId','revision'] as const;
function validScope(value: unknown): value is HeaderScope {
  return record(value, SCOPE_KEYS) && typeof value.authorityToken === 'string' && value.authorityToken.length > 0
    && typeof value.live === 'boolean' && typeof value.occupied === 'boolean' && typeof value.admissionVerified === 'boolean'
    && ['editable','read_only','lost'].includes(value.access as string)
    && ['harbour','fourth'].includes(value.variantId as string) && safeRevision(value.revision);
}
// Exhaustion fails closed permanently rather than wrapping an old generation back into authority.
const nextGeneration = (generation: number | null): number | null =>
  generation !== null && safeRevision(generation) && generation < Number.MAX_SAFE_INTEGER ? generation + 1 : null;
export function createHeaderSession(): HeaderSession {
  return {epoch:Object.freeze({}),current:null,mode:'interact',suspended:false,generation:0,lastSessionNonce:0,mounted:false,committedGeneration:null};
}
export function observeHeaderSession(state: HeaderSession, context: HeaderScope): HeaderSession {
  const current = validScope(context) ? {...context} : null;
  const previous = state.current;
  if (current && previous && SCOPE_KEYS.every(key => current[key] === previous[key])) return state;
  if (!current && !previous) return state;
  const scopeChanged = previous !== null && (current === null || previous.authorityToken !== current.authorityToken || previous.access !== current.access);
  const unsafe = current === null || !current.live || current.access === 'lost' || current.occupied || !current.admissionVerified;
  const suspend = scopeChanged || unsafe;
  return {...state,current,generation:nextGeneration(state.generation),committedGeneration:null,
    mode:suspend ? 'interact' : state.mode, suspended:suspend ? true : state.suspended};
}
// Caller must publish only after a genuine current layout commit. This helper proves no React timing.
export function commitHeaderSession(state: HeaderSession): HeaderSession {
  if (!state.current || state.generation === null) return state;
  return {...state,mounted:true,committedGeneration:state.generation};
}
export function retireHeaderSession(state: HeaderSession): HeaderSession {
  return {...state,epoch:Object.freeze({}),current:null,mode:'interact',suspended:true,mounted:false,
    generation:nextGeneration(state.generation),committedGeneration:null};
}
function eventMatches(state: HeaderSession, event: unknown): event is HeaderEvent {
  if (!state.current || state.generation === null || !record(event, ['epoch','authorityToken','generation','mode','variantId','revision'])) return false;
  return event.epoch === state.epoch && event.authorityToken === state.current.authorityToken && event.generation === state.generation
    && event.mode === state.mode && event.variantId === state.current.variantId && event.revision === state.current.revision;
}
export function captureHeaderEvent(state: HeaderSession): HeaderEvent | null {
  if (!state.mounted || !state.current || state.generation === null || state.committedGeneration !== state.generation) return null;
  return {epoch:state.epoch,authorityToken:state.current.authorityToken,generation:state.generation,mode:state.mode,
    variantId:state.current.variantId,revision:state.current.revision};
}
export function allowsHeaderEvent(state: HeaderSession, event: unknown, purpose: 'create'|'assistant'|'history'|'recipe'): boolean {
  if (!eventMatches(state, event) || !state.mounted || state.committedGeneration !== state.generation) return false;
  const current = state.current!;
  if (!current.live || current.access === 'lost' || current.occupied) return false;
  if (purpose === 'recipe') return state.mode === 'select' && !state.suspended && current.admissionVerified;
  if (state.mode !== 'interact') return false;
  return purpose === 'history' || ((purpose === 'create' || purpose === 'assistant') && current.access === 'editable');
}
export function enterHeaderSelection(state: HeaderSession, event: unknown, nonce: number): {state:HeaderSession;outcome:Outcome} {
  if (!allowsHeaderEvent(state,event,'history') || !state.current!.admissionVerified
    || !safeRevision(nonce) || nonce <= state.lastSessionNonce || state.generation === Number.MAX_SAFE_INTEGER) return {state,outcome:'blocked'};
  return {state:{...state,mode:'select',suspended:false,lastSessionNonce:nonce,
    generation:nextGeneration(state.generation),committedGeneration:null},outcome:'applied'};
}
export function exitHeaderSelection(state: HeaderSession, event: unknown): {state:HeaderSession;outcome:Outcome} {
  // Safe exit is independent of admission, occupancy and layout-commit publication.
  if (!eventMatches(state,event) || !state.current!.live || state.current!.access === 'lost') return {state,outcome:'blocked'};
  if (state.mode === 'interact') return {state,outcome:'noop'};
  return {state:{...state,mode:'interact',suspended:true,generation:nextGeneration(state.generation),committedGeneration:null},outcome:'applied'};
}
export function headerChoiceGate(state: HeaderSession, event: unknown, sourceValid: boolean): ChoiceGate {
  const matches = eventMatches(state,event);
  return {live:allowsHeaderEvent(state,event,'recipe'), occupied:state.current?.occupied ?? true,
    expectedRevision:matches ? event.revision : (state.current?.revision ?? 0),
    actualRevision:state.current?.revision ?? 0,sourceValid:sourceValid === true};
}
export function restoreHeaderChoice(state: HeaderChoice, value: unknown, gate: ChoiceGate,
  session: HeaderSession, event: unknown): {state:HeaderChoice;session:HeaderSession;outcome:Outcome} {
  const unchanged = (outcome: Outcome) => ({state,session,outcome});
  try {
    if (!validateHeaderChoice(state) || !validGate(gate) || recipeCheck(value) !== 'valid') return unchanged('invalid');
    if (!gateOpen(state,gate) || !allowsHeaderEvent(session,event,'recipe') || session.current!.revision !== state.revision) return unchanged('blocked');
    if (state.revision === Number.MAX_SAFE_INTEGER || session.generation === null || session.generation === Number.MAX_SAFE_INTEGER) return unchanged('invalid');
    const restored = copyChoice((value as HeaderRecipe).choice);
    const next = {...restored,revision:state.revision+1};
    // Stored revision is metadata only. Observing the live replacement retires every old event.
    const nextSession = observeHeaderSession(session,{...session.current!,revision:next.revision,
      variantId:next.current?.variantId ?? 'harbour'});
    return {state:next,session:nextSession,outcome:'applied'};
  } catch { return unchanged('invalid'); }
}
