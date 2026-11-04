import type { AssistantAttachment } from './assistant-draft.ts';
import type { SelectedPackage } from './production/HandoverImportOwner.ts';

export type IncomingSharePayload = { value: string; shareType: 'text' | 'url' | 'image' | 'audio' | 'video' | 'file'; mimeType?: string };
export interface IncomingSharePlatform {
  read(): readonly IncomingSharePayload[];
  clear(): void;
  subscribe(listener: () => void): () => void;
  prepare(payload: IncomingSharePayload): Promise<AssistantAttachment>;
  preparePackage?(payload: IncomingSharePayload, signal: AbortSignal): Promise<SelectedPackage>;
}
export interface IncomingShareTarget {
  current(): boolean;
  appendText(text: string): boolean;
  appendAttachment(attachment: AssistantAttachment): boolean;
}
export interface IncomingSharePackageTarget {
  current(): boolean;
  choose(pick: (signal: AbortSignal) => Promise<SelectedPackage | null>, signal: AbortSignal): Promise<boolean>;
}
export type IncomingShareItem = { id: number; payload: IncomingSharePayload };
export type IncomingShareSnapshot = { items: readonly IncomingShareItem[]; busyId: number | null; error: string | null };

/** Device-local, unsent input. Only the existing draft owner can accept it. */
export function createIncomingShareInbox(platform: IncomingSharePlatform) {
  let state: IncomingShareSnapshot = {items:[],busyId:null,error:null};
  let identity: string | null = null, generation = 0, serial = 0, mustClearNative = false;
  let scope: string | null = null;
  let packageRead: AbortController | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<IncomingShareSnapshot>) => { state={...state,...patch}; listeners.forEach(fn=>fn()); };
  const clear = () => { generation++; packageRead?.abort(); update({items:[],busyId:null,error:null}); };
  return {
    getSnapshot: () => state,
    subscribe(listener:()=>void) { listeners.add(listener); return ()=>{listeners.delete(listener);}; },
    observeIdentity(next:string|null) {
      if(identity===next)return;
      if(identity!==null) {
        clear(); mustClearNative=true;
        try {platform.clear();mustClearNative=false;} catch { /* Retry cleanup before accepting a new account's native input. */ }
      }
      identity=next;
    },
    observeScope(next:string|null) {
      if(scope===next)return;
      scope=next;generation++;
      packageRead?.abort();
      if(state.busyId!==null)update({busyId:null,error:'目前範圍已變更；尚未接收的內容請重新選擇，已提交的上載請查回原結果。'});
    },
    receive() {
      try {
        if(mustClearNative) {platform.clear();mustClearNative=false;return;}
        const raw=platform.read();
        if(!raw.length)return;
        if(raw.length+state.items.length>20) {update({error:'分享項目太多，請先處理目前內容，再重新分享。'});return;}
        if(raw.some(item=>!item || !['text','url','image','audio','video','file'].includes(item.shareType)
          || typeof item.value!=='string' || !item.value.trim() || item.value.length>10_000
          || item.mimeType!==undefined && (typeof item.mimeType!=='string'||item.mimeType.length>200))) {
          platform.clear();update({error:'分享內容無法讀取或超出每則文字限制，請從來源重新選取。'});return;
        }
        // A second lifecycle callback cannot stage the same native intent twice.
        platform.clear();
        update({items:[...state.items,...raw.map(payload=>({id:++serial,payload:{...payload}}))],error:null});
      } catch {update({error:'未能讀取系統分享內容，請從來源重新分享。'});}
    },
    discard(id:number) { if(state.busyId===id){generation++;packageRead?.abort();} update({items:state.items.filter(item=>item.id!==id),busyId:state.busyId===id?null:state.busyId,error:null}); },
    clear,
    async takePackage(id:number,target:IncomingSharePackageTarget|null):Promise<boolean> {
      const item=state.items.find(value=>value.id===id);
      if(!item||item.payload.shareType!=='file'||!platform.preparePackage||state.busyId!==null||!identity||!target?.current())return false;
      const epoch=generation,actor=identity,controller=new AbortController();packageRead=controller;
      const valid=()=>epoch===generation&&actor===identity&&state.items.some(value=>value.id===id)&&target.current();
      update({busyId:id,error:null});
      try {
        const accepted=await target.choose(async signal=>{
          const file=await platform.preparePackage!(item.payload,AbortSignal.any([signal,controller.signal]));
          if(!valid()||controller.signal.aborted){file.release();return null;}
          return file;
        },controller.signal);
        const current=valid();
        // Once the existing owner adopts a file, its original request is the only recovery path.
        if(accepted&&actor===identity)update({items:state.items.filter(value=>value.id!==id)});
        if(!accepted&&current)update({error:'未能接收資料包，請核對 ZIP 格式及目前裝置的資料包大小限制，或查看設定的原匯入狀態。'});
        return accepted&&current;
      } catch {
        if(epoch===generation)update({error:'未能讀取這份 ZIP 資料包，請核對格式及目前裝置的資料包大小限制；尚未建立匯入批次。'});
        return false;
      } finally {
        if(packageRead===controller)packageRead=null;
        if(epoch===generation&&state.busyId===id)update({busyId:null});
      }
    },
    async take(id:number,target:IncomingShareTarget):Promise<boolean> {
      const item=state.items.find(value=>value.id===id);
      if(!item||state.busyId!==null||!identity||!target.current())return false;
      const epoch=generation, actor=identity;
      update({busyId:id,error:null});
      let attachment:AssistantAttachment|undefined;
      const valid=()=>epoch===generation&&actor===identity&&state.items.some(value=>value.id===id)&&target.current();
      try {
        const text=item.payload.shareType==='text'||item.payload.shareType==='url';
        if(!text)attachment=await platform.prepare(item.payload);
        if(!valid()) {if(epoch===generation)update({error:'目前孩子或帳號已變更，內容未加入草稿。'});return false;}
        const accepted=text?target.appendText(item.payload.value):target.appendAttachment(attachment!);
        if(!accepted) {update({error:'目前草稿未能加入內容。請先送出或移除原附件，並核對文字長度。'});return false;}
        attachment=undefined; // Ownership has moved to the existing draft.
        update({items:state.items.filter(value=>value.id!==id),error:null});
        return true;
      } catch {
        if(epoch===generation)update({error:'未能讀取這份附件，請檢查格式及大小，或從來源重新分享。'});
        return false;
      } finally {
        attachment?.dispose?.();
        if(epoch===generation&&state.busyId===id)update({busyId:null});
      }
    },
  };
}
export type IncomingShareInbox = ReturnType<typeof createIncomingShareInbox>;
