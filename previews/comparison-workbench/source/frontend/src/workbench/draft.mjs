/** Selection state only. No filesystem, storage, rendering or product-action effects. */
import {SLOTS,need,record,validateRegistry,validateSelection,getSelection,selectionEquals} from './registry.mjs';
const clone=value=>structuredClone(value),empty=()=>Object.fromEntries(SLOTS.map(slot=>[slot,null]));
export const MAX_UNDO=64;
function slotShape(slots,original=false){record(slots,SLOTS);for(const slot of SLOTS)if(slots[slot]!==null){validateSelection(slots[slot],slot);if(original)need(slots[slot].variantId==='original','INVALID_ORIGINAL_BASELINE');}
 if(original)need(SLOTS.every(s=>slots[s]===null)||SLOTS.every(s=>slots[s]!==null),'PARTIAL_ORIGINAL_BASELINE');}
function undoShape(history){
 need(Array.isArray(history)&&Object.getPrototypeOf(history)===Array.prototype,'INVALID_UNDO');
 const length=Object.getOwnPropertyDescriptor(history,'length');
 need(length&&Object.hasOwn(length,'value')&&Number.isSafeInteger(length.value)&&length.value>=0&&length.value<=MAX_UNDO,'INVALID_UNDO');
 const keys=Reflect.ownKeys(history);
 need(keys.length===length.value+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<length.value),'INVALID_UNDO');
 // Read descriptors only until every index is confirmed to be plain JSON data.
 const snapshots=[];
 for(let i=0;i<length.value;i++){const d=Object.getOwnPropertyDescriptor(history,String(i));need(d&&Object.hasOwn(d,'value')&&d.enumerable,'INVALID_UNDO');snapshots.push(d.value);}
 for(const snapshot of snapshots)slotShape(snapshot);
}
function stateShape(state){record(state,['schemaVersion','mode','original','slots','undo']);need(state.schemaVersion===1,'UNKNOWN_STATE_SCHEMA');need(['operation','pick'].includes(state.mode),'UNKNOWN_MODE');slotShape(state.original,true);slotShape(state.slots);undoShape(state.undo);}
function freshSlots(slots,registry){for(const slot of SLOTS){const selected=slots[slot];if(selected===null)continue;let current;try{current=getSelection(registry,selected.variantId,slot);}catch{throw Error('STALE_OR_UNAVAILABLE');}need(selectionEquals(selected,current),'STALE_SELECTION');}}
function freshState(state,registry){stateShape(state);validateRegistry(registry);freshSlots(state.original,registry);freshSlots(state.slots,registry);}
function inPick(state){need(state.mode==='pick','PICK_MODE_REQUIRED');}
function changed(state,next){if(SLOTS.every(slot=>selectionEquals(state.slots[slot],next[slot])))return clone(state);need(state.undo.length<MAX_UNDO,'UNDO_LIMIT');return {...clone(state),slots:clone(next),undo:[...clone(state.undo),clone(state.slots)]};}
export function createState(registry){validateRegistry(registry);const row=registry.sources.original;const original=row.status==='source-verified'&&SLOTS.every(s=>row.modules[s]!==null)?Object.fromEntries(SLOTS.map(s=>[s,getSelection(registry,'original',s)])):empty();return {schemaVersion:1,mode:'operation',original:clone(original),slots:clone(original),undo:[]};}
export function setMode(state,mode){stateShape(state);need(['operation','pick'].includes(mode),'UNKNOWN_MODE');return {...clone(state),mode};}
export function interactionTarget(state,intent){stateShape(state);need(['product','selection'].includes(intent),'UNKNOWN_INTENT');return intent==='product'?(state.mode==='operation'?'product-owner':'blocked'):(state.mode==='pick'?'draft-only':'blocked');}
export function pick(state,registry,slot,variant){freshState(state,registry);inPick(state);const selected=getSelection(registry,variant,slot);return changed(state,{...state.slots,[slot]:selected});}
export function restoreOriginal(state,registry){freshState(state,registry);inPick(state);need(SLOTS.every(slot=>state.original[slot]!==null),'ORIGINAL_UNAVAILABLE');return changed(state,state.original);}
export function undo(state,registry){freshState(state,registry);inPick(state);if(!state.undo.length)return clone(state);const target=state.undo.at(-1);freshSlots(target,registry);return {...clone(state),slots:clone(target),undo:clone(state.undo.slice(0,-1))};}
export function saveDraft(state,registry){freshState(state,registry);return JSON.stringify({schemaVersion:1,original:clone(state.original),slots:clone(state.slots)});}
export function loadDraft(text,registry){need(typeof text==='string'&&text.length<=65536&&new TextEncoder().encode(text).length<=65536,'DRAFT_SIZE_OR_TYPE');const draft=JSON.parse(text);record(draft,['schemaVersion','original','slots']);need(draft.schemaVersion===1,'UNKNOWN_DRAFT_SCHEMA');const state={...draft,mode:'operation',undo:[]};freshState(state,registry);return clone(state);}
