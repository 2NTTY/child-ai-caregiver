import { CANDIDATE_SLOTS, decodeTaskCandidateFragment } from './candidate-fragment.mjs';
import { createTaskRecipeDraft, makeTaskRecipeSelection, serializeTaskRecipe, parseTaskRecipe, type TaskRecipeSnapshot } from './recipe.ts';
/** Prefills text only. Retained/unknown receipts and all live authority remain untouched. */
export function readTaskRecipePrefill(receiptCurrent:unknown,fragment:unknown):{importText:string;message:string}{
  const empty={importText:'',message:''};
  if(receiptCurrent!==null)return empty;
  const payload=decodeTaskCandidateFragment(fragment);
  if(payload.status==='none')return empty;
  const invalid={importText:'',message:'候選配方連結無效，未帶入任何選配；原有草稿不變。'};
  if(payload.status!=='valid')return invalid;
  const draft=createTaskRecipeDraft(),current={...draft.current};
  for(const slot of CANDIDATE_SLOTS){
    const reference=payload.slots[slot];
    if(reference===null)continue;
    const selection=makeTaskRecipeSelection(slot,reference[1],reference[0]);
    if(!selection)return invalid;
    current[slot]=selection;
  }
  const serialized=serializeTaskRecipe({...draft,current:current as TaskRecipeSnapshot});
  if(serialized.status!=='valid'||parseTaskRecipe(serialized.json).status!=='valid')return invalid;
  return {importText:serialized.json,message:'已從比較頁帶入配方文字；沒有自動還原或套用。'};
}
