import type { SharingApi } from './sharing-api.ts';
import type { SharedChildView } from '../shared/sharing-control.ts';

export interface SharedChildState {
  identityKey:string|null; userId:string|null; online:boolean;
  target:{spaceId:string;childId:string}|null; view:SharedChildView|null;
  phase:'none'|'loading'|'ready'|'error'; error:string|null;
}
/** Navigation context only. Every domain still checks its own current Server grant. */
export function sharedChildScopeKey(state:SharedChildState):string|null {
  const v=state.view;
  return state.identityKey&&v&&state.target?.spaceId===v.spaceId&&state.target.childId===v.childId
    ? JSON.stringify(['shared',state.identityKey,v.spaceId,v.childId,v.role,[...v.modules].sort(),v.basis]) : null;
}
export function sharedChildChoiceId(spaceId:string,childId:string):string { return `shared:${spaceId}:${childId}`; }
export class SharedChildController {
  private state:SharedChildState={identityKey:null,userId:null,online:false,target:null,view:null,phase:'none',error:null};
  private request:AbortController|null=null;
  private generation=0;
  private listeners=new Set<()=>void>();
  private api:Pick<SharingApi,'child'>;
  constructor(api:Pick<SharingApi,'child'>){this.api=api;}
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(value:Partial<SharedChildState>){this.state={...this.state,...value};this.listeners.forEach(fn=>fn());}
  private abort(){this.generation++;this.request?.abort();this.request=null;}
  syncContext(identityKey:string|null,userId:string|null,online:boolean){
    if(this.state.identityKey!==identityKey||this.state.userId!==userId){
      this.abort();this.update({identityKey,userId,online,target:null,view:null,phase:'none',error:null});
    }else if(this.state.online!==online){
      if(!online)this.abort();
      this.update({online,phase:this.state.phase==='loading'?(this.state.view?'ready':this.state.target?'error':'none'):this.state.phase});
    }
  }
  async select(spaceId:string,childId:string){
    if(!this.state.identityKey||!this.state.userId||!this.state.online)return;
    this.abort();this.update({target:{spaceId,childId},view:null,phase:'loading',error:null});
    await this.refresh();
  }
  async refresh(){
    const {target,userId,identityKey,online}=this.state;
    if(!target||!userId||!identityKey||!online||this.request)return;
    const request=new AbortController(),generation=++this.generation;this.request=request;
    this.update({phase:'loading',error:null});
    const current=()=>!request.signal.aborted&&generation===this.generation&&this.state.identityKey===identityKey;
    try {
      const view=await this.api.child(target.spaceId,target.childId,userId,request.signal);
      if(!current())return;
      if(view.spaceId!==target.spaceId||view.childId!==target.childId)throw new Error('Shared child target changed');
      this.update({view,phase:'ready',error:null});
    }catch{
      if(current())this.update({view:null,phase:'error',error:'未能核對這個空間的孩子資料。請重新讀取或選擇其他孩子。'});
    }finally{if(this.request===request)this.request=null;}
  }
  invalidate(){this.abort();this.update({view:null,phase:this.state.target?'error':'none',error:this.state.target?'共享權限已改變，請重新讀取。':null});}
  clear(){this.abort();this.update({target:null,view:null,phase:'none',error:null});}
  dispose(){this.abort();this.listeners.clear();}
}
