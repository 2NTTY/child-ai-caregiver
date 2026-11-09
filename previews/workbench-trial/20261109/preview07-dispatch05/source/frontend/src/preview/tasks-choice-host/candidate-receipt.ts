import type { HeaderSession } from '../task-header-actions-hf01/selection.ts';
import { captureHeaderSaveAuthority, type HeaderSaveAuthority } from '../task-header-actions-hf01/save-authority.ts';
import { record } from '../workbench-normal-read/src/registry.mjs';
import { mayEditTaskRecipeDraft, serializeTaskRecipe, type TaskRecipeDraft } from './recipe.ts';

// In-memory presentation only. No task data, applied renderer, session or callback.
export type CandidateMetadata = Readonly<{draft:TaskRecipeDraft;importText:string;exportText:string}>;
export type CandidateReceipt = {readonly scopeKey:string|null;current:CandidateMetadata|null};
// A transient commit request, never stored inside the receipt or exported recipe.
export type CandidatePublication = Readonly<{receipt:CandidateReceipt;expected:CandidateMetadata|null;
  metadata:CandidateMetadata;authority:HeaderSaveAuthority}>;
export function createCandidateReceipt(scopeKey:string|null):CandidateReceipt { return {scopeKey,current:null}; }
function validMetadata(value:unknown):value is CandidateMetadata {
  try {
    record(value,['draft','importText','exportText']);
    const data=value as CandidateMetadata;
    if(typeof data.importText!=='string'||data.importText.length>65536
      ||typeof data.exportText!=='string'||data.exportText.length>65536)return false;
    const serialized=serializeTaskRecipe(data.draft);
    return serialized.status==='valid'&&(data.exportText===''||data.exportText===serialized.json);
  } catch { return false; }
}
function freeze<T>(value:T):T {
  if(value!==null&&typeof value==='object') {
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function readCandidateReceipt(receipt:CandidateReceipt|null,scopeKey:string):CandidateMetadata|null {
  return scopeKey.length>0&&receipt?.scopeKey===scopeKey&&validMetadata(receipt.current)?receipt.current:null;
}
/** Read/copy only. Even an abandoned render or uncommitted frame cannot claim. */
export function prepareCandidatePublication(receipt:CandidateReceipt|null,expected:CandidateMetadata|null,
  metadata:unknown,frame:object,session:HeaderSession):CandidatePublication|null {
  if(!receipt||!session.current||receipt.scopeKey!==session.current.authorityToken
    ||receipt.current!==expected||!validMetadata(metadata)||metadata.draft.revision!==session.current.revision)return null;
  const authority=captureHeaderSaveAuthority(frame,session);
  return authority?Object.freeze({receipt,expected,authority,
    metadata:freeze(JSON.parse(JSON.stringify(metadata)) as CandidateMetadata)}):null;
}
/** Caller supplies only its genuine current mount/frame after React commit. */
export function commitCandidatePublication(request:CandidatePublication|null,receipt:CandidateReceipt|null,
  frame:object,session:HeaderSession|null):CandidateMetadata|null {
  if(!request||!receipt||request.receipt!==receipt||request.expected!==receipt.current
    ||request.authority.frame!==frame||!session||receipt.scopeKey!==session.current?.authorityToken
    ||!mayEditTaskRecipeDraft(request.metadata.draft,session,request.authority.event))return null;
  // Identity rotates even for identical values: a new committed mount excludes
  // every older mount that read the previous snapshot. No lease is persisted.
  receipt.current=request.metadata;
  return request.metadata;
}
