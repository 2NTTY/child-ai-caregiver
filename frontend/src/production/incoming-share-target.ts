import type { IncomingShareTarget } from '../incoming-share.ts';
import type { ProductionOwner } from './ProductionOwner.ts';

/** The system share receiver is just another input to the existing private composer. */
export function createProductionShareTarget(owner: ProductionOwner): IncomingShareTarget | null {
  const read = () => {
    const state=owner.getSnapshot(), chat=owner.chatController.getSnapshot(), draft=owner.draftOwner.getSnapshot();
    if(!state.identityKey||!state.scopeKey||!state.activeChild||state.sharedChild.target||!owner.chatWritesAllowed()
      ||chat.busy||chat.userId!==state.records.user?.id||chat.selectedChildId!==state.activeChild.id
      ||draft.scope!==state.scopeKey||chat.drafts[state.activeChild.id]&&chat.drafts[state.activeChild.id]!.phase!=='draft')return null;
    return {identity:state.identityKey,scope:state.scopeKey,childId:state.activeChild.id,chat,draft};
  };
  const initial=read();
  if(!initial)return null;
  const current=()=>{
    const next=read();
    return next&&next.identity===initial.identity&&next.scope===initial.scope&&next.childId===initial.childId?next:null;
  };
  return {
    current:()=>current()!==null,
    appendText(text) {
      const state=current();if(!state)return false;
      const previous=state.chat.drafts[state.childId]?.text??'';
      const combined=previous?previous+'\n\n'+text:text;
      if(combined.length>10_000)return false;
      owner.chatController.setText(combined);
      return owner.chatController.getSnapshot().drafts[state.childId]?.text===combined;
    },
    appendAttachment(attachment) {
      const state=current();if(!state||state.draft.attachments.length||owner.voiceOwner.getSnapshot().localId
        ||owner.fileOwner.getSnapshot().localId||owner.photoOwner.getSnapshot().localId)return false;
      return owner.draftOwner.add(state.scope,attachment);
    },
  };
}
