import { projectTaskModulePresentation, taskHeaderBehaviorVariant, legacyTaskRowAppearance } from "./module-presentation.ts";
import { TASK_SLOT_IDS, getTaskNarrowCandidate, type NarrowCandidate } from '../tasks-variant-catalog/catalog.mjs';
import { record } from '../workbench-normal-read/src/registry.mjs';
import { allowsHeaderEvent, headerChoiceGate, type HeaderEvent, type HeaderSession,
  type HeaderVariant, type SourceFingerprint } from '../task-header-actions-hf01/selection.ts';

export const TASK_RECIPE_NAMESPACE = 'tasks-choice-host:candidate:v1';
export type TaskSlotId = typeof TASK_SLOT_IDS[number];
export type TaskRecipeSelection = Readonly<Pick<NarrowCandidate,
  'slotId' | 'candidateId' | 'variantId' | 'hostVariantId' | 'coverage' | 'adapterVersion' | 'sourceFingerprint' | 'dependenciesFingerprint'>>;
export type TaskRecipeSnapshot = Readonly<Record<TaskSlotId, TaskRecipeSelection | null>>;
export type TaskRecipeDraft = Readonly<{
  current: TaskRecipeSnapshot; undo: readonly TaskRecipeSnapshot[]; revision: number;
}>;
export type TaskRecipe = Readonly<{schemaVersion: 1; namespace: typeof TASK_RECIPE_NAMESPACE; draft: TaskRecipeDraft}>;
export type TaskRecipeCommand = {type:'choose';selection:TaskRecipeSelection | null} | {type:'undo'|'resetPrototype'} | {type:'clearSlot';slotId:TaskSlotId};
export type TaskRecipeResult = {state:TaskRecipeDraft;outcome:'updated'|'noop'|'blocked'|'invalid'};
const MAX_BYTES = 65536, MAX_UNDO = 50;
const SELECTION_KEYS = ['slotId','candidateId','variantId','hostVariantId','coverage','adapterVersion','sourceFingerprint','dependenciesFingerprint'];
const safeRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try { record(value, keys); return true; } catch { return false; }
}
function denseArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===value.length+1 && keys.every(key=>key==='length'||(typeof key==='string'
    && /^(0|[1-9][0-9]*)$/.test(key) && Number(key)<value.length
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value')));
}
function sameJson(value: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return value === expected;
  if (Array.isArray(expected)) return denseArray(value,expected.length) && value.length === expected.length
    && expected.every((item,index) => sameJson(value[index],item));
  const keys=Object.keys(expected);
  return exact(value,keys) && keys.every(key => sameJson(value[key],(expected as Record<string,unknown>)[key]));
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function withinLimit(value: unknown): boolean {
  const text = JSON.stringify(value);
  // Valid snapshots contain only catalog-pinned ASCII identifiers/hashes/paths.
  // Account for UTF-8 here as well so malformed external records stay bounded.
  let bytes=0;
  for (const char of text) { const code=char.codePointAt(0)!; bytes+=code<128?1:code<2048?2:code<65536?3:4; if(bytes>MAX_BYTES)return false; }
  return true;
}
export function createTaskRecipeDraft(): TaskRecipeDraft {
  return {current:{'header-actions':null,filters:null,'date-list':null,'calendar-layout':null},undo:[],revision:0};
}
export function makeTaskRecipeSelection(slotId: unknown, candidateId: unknown, variantId: unknown): TaskRecipeSelection | null {
  const candidate=getTaskNarrowCandidate(variantId,slotId,candidateId);
  if (!candidate || candidate.sourceAvailability !== 'available' || !['bounded-source-accepted','source-reviewed-integration-unverified'].includes(candidate.acceptance)
    || !candidate.prospectiveComposable || candidate.hostVariantId !== 'harbour') return null;
  return copy({slotId:candidate.slotId,candidateId:candidate.candidateId,variantId:candidate.variantId,
    hostVariantId:candidate.hostVariantId,coverage:candidate.coverage,adapterVersion:candidate.adapterVersion,
    sourceFingerprint:candidate.sourceFingerprint,dependenciesFingerprint:candidate.dependenciesFingerprint});
}
/** Initial direction only. The Control calls this only for a genuinely empty receipt. */
export function createHandbookTaskRecipeDraft(): TaskRecipeDraft {
  const current: Record<TaskSlotId, TaskRecipeSelection | null> = {...createTaskRecipeDraft().current};
  const candidates: Record<TaskSlotId, NarrowCandidate['candidateId']> = {
    'header-actions':'header-presentation',filters:'filters-presentation',
    'date-list':'date-list-source-regions02','calendar-layout':'calendar-presentation',
  };
  for (const slot of TASK_SLOT_IDS) {
    const selected = makeTaskRecipeSelection(slot, candidates[slot], 'handbook');
    if (!selected) return createTaskRecipeDraft();
    current[slot] = selected;
  }
  return {current,undo:[],revision:0};
}
function validSelection(value: unknown, slot: TaskSlotId): value is TaskRecipeSelection {
  if (!exact(value,SELECTION_KEYS) || value.slotId !== slot) return false;
  const known=makeTaskRecipeSelection(slot,value.candidateId,value.variantId);
  return known !== null && sameJson(value,known);
}
function validSnapshot(value: unknown): value is TaskRecipeSnapshot {
  return exact(value,TASK_SLOT_IDS) && TASK_SLOT_IDS.every(slot => value[slot] === null || validSelection(value[slot],slot));
}
export function validateTaskRecipeDraft(value: unknown): value is TaskRecipeDraft {
  try {
    return exact(value,['current','undo','revision']) && safeRevision(value.revision)
      && validSnapshot(value.current) && denseArray(value.undo,MAX_UNDO) && value.undo.every(validSnapshot)
      && withinLimit({schemaVersion:1,namespace:TASK_RECIPE_NAMESPACE,draft:value});
  } catch { return false; }
}
// Editing a candidate is not entering selection mode or applying a renderer.
// Reuse the current HF commit/epoch authority, without weakening its recipe gate.
export function mayEditTaskRecipeDraft(state: TaskRecipeDraft, session: HeaderSession, event: HeaderEvent | null): boolean {
  return validateTaskRecipeDraft(state) && session.current?.revision === state.revision
    && (allowsHeaderEvent(session,event,'history') || allowsHeaderEvent(session,event,'recipe'));
}
function updated(state: TaskRecipeDraft, current: TaskRecipeSnapshot, undo: readonly TaskRecipeSnapshot[]): TaskRecipeResult {
  if (state.revision === Number.MAX_SAFE_INTEGER) return {state,outcome:'invalid'};
  const next=copy({current,undo:undo.slice(-MAX_UNDO),revision:state.revision+1});
  // Keep the most recent undo snapshots within the same hard recipe bound.
  while(next.undo.length && !withinLimit({schemaVersion:1,namespace:TASK_RECIPE_NAMESPACE,draft:next})) next.undo.shift();
  return validateTaskRecipeDraft(next) ? {state:next,outcome:'updated'} : {state,outcome:'invalid'};
}
export function reduceTaskRecipeDraft(state: TaskRecipeDraft, command: unknown,
  session: HeaderSession, event: HeaderEvent | null): TaskRecipeResult {
  const unchanged=(outcome:TaskRecipeResult['outcome']):TaskRecipeResult=>({state,outcome});
  try {
    if (!validateTaskRecipeDraft(state) || (!exact(command,['type']) && !exact(command,['type','selection']) && !exact(command,['type','slotId']))) return unchanged('invalid');
    if (!mayEditTaskRecipeDraft(state,session,event)) return unchanged('blocked');
    if (command.type === 'undo' && exact(command,['type'])) {
      if (!state.undo.length) return unchanged('noop');
      return updated(state,state.undo[state.undo.length-1],state.undo.slice(0,-1));
    }
    let current:TaskRecipeSnapshot;
    if (command.type === 'resetPrototype' && exact(command,['type'])) current=createTaskRecipeDraft().current;
    else if (command.type === 'clearSlot' && exact(command,['type','slotId']) && TASK_SLOT_IDS.includes(command.slotId as TaskSlotId)) current={...state.current,[command.slotId as TaskSlotId]:null};
    else if (command.type === 'choose' && exact(command,['type','selection'])) {
      const selection=command.selection;
      if (!exact(selection,SELECTION_KEYS) || !TASK_SLOT_IDS.includes(selection.slotId as TaskSlotId)
        || !validSelection(selection,selection.slotId as TaskSlotId)) return unchanged('invalid');
      current={...state.current,[selection.slotId]:selection};
    } else return unchanged('invalid');
    if (sameJson(current,state.current)) return unchanged('noop');
    return updated(state,current,[...state.undo,state.current]);
  } catch { return unchanged('invalid'); }
}
export function serializeTaskRecipe(state: TaskRecipeDraft): {status:'valid';json:string} | {status:'invalid'} {
  return validateTaskRecipeDraft(state)
    ? {status:'valid',json:JSON.stringify({schemaVersion:1,namespace:TASK_RECIPE_NAMESPACE,draft:copy(state)})}
    : {status:'invalid'};
}
export function parseTaskRecipe(json: unknown): {status:'valid';recipe:TaskRecipe} | {status:'invalid'} {
  try {
    if (typeof json !== 'string' || json.length>MAX_BYTES) return {status:'invalid'};
    const value:unknown=JSON.parse(json);
    if (!exact(value,['schemaVersion','namespace','draft']) || value.schemaVersion!==1 || value.namespace!==TASK_RECIPE_NAMESPACE
      || !validateTaskRecipeDraft(value.draft) || !withinLimit(value)) return {status:'invalid'};
    return {status:'valid',recipe:value as TaskRecipe};
  } catch { return {status:'invalid'}; }
}
export function restoreTaskRecipeDraft(state:TaskRecipeDraft, recipe:unknown,
  session:HeaderSession,event:HeaderEvent|null):TaskRecipeResult {
  try {
    if (!exact(recipe,['schemaVersion','namespace','draft']) || recipe.schemaVersion!==1 || recipe.namespace!==TASK_RECIPE_NAMESPACE
      || !validateTaskRecipeDraft(recipe.draft) || !validateTaskRecipeDraft(state)) return {state,outcome:'invalid'};
    if (!mayEditTaskRecipeDraft(state,session,event)) return {state,outcome:'blocked'};
    // Stored revision is never live authority; current scope gets a fresh revision.
    return updated(state,recipe.draft.current,recipe.draft.undo);
  } catch { return {state,outcome:'invalid'}; }
}
export type TaskRecipeProjection = {status:'eligible';headerVariant:HeaderVariant|undefined;rowAppearance:'harbour'|'fourth'|'handbook'|'original-row-fragment01'|undefined}
  | {status:'pending';reason:'runtime-admission-required'|'selection-mode-required'} | {status:'blocked'};
export function projectTaskRecipe(state:TaskRecipeDraft,session:HeaderSession,event:HeaderEvent|null):TaskRecipeProjection {
  if (!validateTaskRecipeDraft(state) || session.current?.revision!==state.revision) return {status:'blocked'};
  if (!session.current.admissionVerified) return {status:'pending',reason:'runtime-admission-required'};
  if (session.mode !== 'select') return {status:'pending',reason:'selection-mode-required'};
  if (!headerChoiceGate(session,event,true).live) return {status:'blocked'};
  // Eligibility is not an applied/committed claim. The host owns the actual commit.
  return {status:'eligible',headerVariant:state.current['header-actions'] ? taskHeaderBehaviorVariant(state.current) : undefined,
    rowAppearance:legacyTaskRowAppearance(projectTaskModulePresentation(state.current))};
}
