import { toByteArray } from 'base64-js';
import { normalizeChatFileMime, CHAT_FILE_LIMITS, type ChatFileAttachment, type ChatFileReservation } from '../../../src/shared/chat-files.ts';
import { ChatFileApiError, type ChatFileApi } from '../../../src/client/chat-file-api.ts';

export interface LocalChatFileInput { id:string; fileName:string; mimeType:string; bytes:number; readBase64?:()=>Promise<string> }
export interface ChatFileUploadState { localId:string|null; busy:boolean; file:ChatFileAttachment|null; unknown:boolean; notice:string|null }
const initial=():ChatFileUploadState=>({localId:null,busy:false,file:null,unknown:false,notice:null});
/** Owns one in-flight upload and its original ID. Never persists local files or resends an unknown upload. */
export class ChatFileUploadController {
  private state=initial(); private listeners=new Set<()=>void>();
  private scope:{key:string;userId:string;childId:string}|null=null;
  private online=true; private epoch=0; private request:AbortController|null=null;
  private reservation:ChatFileReservation|null=null; private deleteId:string|null=null;
  private api: ChatFileApi;
  private hash: (value: Uint8Array<ArrayBuffer>) => Promise<string>;
  private accessLost: (error: ChatFileApiError) => void;
  private id: () => string;
  constructor(api: ChatFileApi, hash: (value: Uint8Array<ArrayBuffer>) => Promise<string>,
    accessLost: (error: ChatFileApiError) => void, id = () => crypto.randomUUID()) {
    this.api=api; this.hash=hash; this.accessLost=accessLost; this.id=id;
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<ChatFileUploadState>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  syncContext(scope:typeof this.scope,online:boolean){
    this.online=online;
    if(scope?.key!==this.scope?.key){this.epoch++;this.request?.abort();this.request=null;this.reservation=null;this.deleteId=null;this.scope=scope;this.update(initial());}
    else if(!online)this.request?.abort();
  }
  private begin(){
    if(!this.scope||!this.online||this.request)return null;
    const scope=this.scope,epoch=this.epoch,controller=new AbortController();this.request=controller;
    const timer=setTimeout(()=>controller.abort(),60000);this.update({busy:true,notice:null});
    return {scope,signal:controller.signal,current:()=>epoch===this.epoch&&!controller.signal.aborted,
      same:()=>epoch===this.epoch,finish:()=>{clearTimeout(timer);if(this.request===controller)this.request=null;if(epoch===this.epoch)this.update({busy:false});}};
  }
  private failed(error:unknown){
    if(error instanceof ChatFileApiError&&[401,403].includes(error.status)){this.update({file:null,unknown:true,notice:'登入或權限已改變，請重新核對。'});this.accessLost(error);return;}
    const uncertain=!(error instanceof ChatFileApiError)||error.status===0||error.status>=500;
    // Even a known upload rejection may advance the reservation version. Read the original before another write.
    const checkOriginal=!!this.reservation;
    this.update({unknown:checkOriginal,notice:checkOriginal
      ? uncertain?'檔案的原上傳結果尚未確認；請查核原操作，勿重新選取或重送。':'檔案未能接受；請先查核原附件狀態，再修改或移除。'
      :'檔案未能讀取；原草稿保留，可移除後重新選取。'});
  }
  async prepare(input:LocalChatFileInput):Promise<ChatFileAttachment|null>{
    if(this.state.unknown||this.state.localId&&this.state.localId!==input.id)return null;
    if(this.state.file?.state==='ready')return this.scope&&this.online&&!this.request?this.state.file:null;
    const r=this.begin();if(!r)return null;
    try{
      const mime=normalizeChatFileMime(input.mimeType);
      if(!mime||!input.readBase64||input.bytes<1||input.bytes>CHAT_FILE_LIMITS.bytes)throw new ChatFileApiError(400,'invalid_file');
      const base64=await input.readBase64();if(!r.current())return null;
      if(base64.length>Math.ceil(CHAT_FILE_LIMITS.bytes/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64))throw new ChatFileApiError(400,'invalid_file');
      const bytes=new Uint8Array(toByteArray(base64));if(bytes.length!==input.bytes)throw new ChatFileApiError(400,'invalid_file');
      const sha256=await this.hash(bytes);if(!r.current())return null;
      if(this.reservation&&this.reservation.sha256!==sha256)throw new ChatFileApiError(409,'file_changed');
      this.reservation??={opId:this.id(),fileName:input.fileName,mimeType:mime,bytes:bytes.length,sha256};
      this.update({localId:input.id});
      let file=this.state.file??await this.api.reserve(r.scope.childId,this.reservation,r.signal,r.scope.userId);
      if(!r.current())return null;this.update({file});
      if(file.state==='reserved')file=await this.api.upload(file,base64,r.signal,r.scope.userId);
      if(!r.current())return null;
      this.update({file,unknown:file.state!=='ready',notice:file.state==='ready'?null:'檔案尚未確認，請查核原上傳。'});
      return file.state==='ready'?file:null;
    }catch(error){if(r.same())this.failed(error);return null;}finally{if(r.same()&&r.signal.aborted&&this.reservation)this.update({unknown:true,notice:'原操作未確認，請先查核，避免重送檔案。'});r.finish();}
  }
  async check(){
    if(!this.reservation)return;const r=this.begin();if(!r)return;
    try{
      let file=await this.api.get(r.scope.childId,this.reservation.opId,r.signal,r.scope.userId);
      if(['uploading','unknown'].includes(file.state))file=await this.api.resolve(r.scope.childId,file.id,r.signal,r.scope.userId);
      if(!r.current())return;
      this.update({file,unknown:['uploading','unknown'].includes(file.state),notice:file.state==='ready'?'原檔案已上傳，可繼續送出同一則訊息。':file.state==='reserved'?'原預留已核對，尚未上傳；可重試同一檔案。':'原檔案目前不可使用，請移除或稍後再查核。'});
    }catch(error){if(r.same()){
      if(error instanceof ChatFileApiError&&error.status===404)this.update({file:null,unknown:false,notice:'原預留不存在；再次送出仍使用相同原操作。'});
      else this.failed(error);
    }}finally{if(r.same()&&r.signal.aborted&&this.reservation)this.update({unknown:true,notice:'原操作未確認，請先查核，避免重送檔案。'});r.finish();}
  }
  async discard():Promise<boolean>{
    if(!this.reservation){this.update(initial());return true;}
    if(this.state.unknown)return false;const r=this.begin();if(!r)return false;
    try{
      const file=this.state.file??await this.api.get(r.scope.childId,this.reservation.opId,r.signal,r.scope.userId);
      if(!r.current())return false;
      if(file.state==='deleted'||file.state==='deleting'){this.reservation=null;this.deleteId=null;this.update(initial());return true;}
      if(file.messageId)return false;
      this.deleteId??=this.id();await this.api.delete(file,this.deleteId,r.signal,r.scope.userId);
      if(!r.current())return false;
      this.reservation=null;this.deleteId=null;this.update(initial());return true;
    }catch(error){if(r.same())this.failed(error);return false;}finally{if(r.same()&&r.signal.aborted&&this.reservation)this.update({unknown:true,notice:'原操作未確認，請先查核，避免重送檔案。'});r.finish();}
  }
  linked(messageId:string,fileId:string){
    if(this.state.file?.id!==fileId||!messageId)return;
    this.reservation=null;this.deleteId=null;this.update(initial());
  }
  dispose(){this.epoch++;this.request?.abort();this.request=null;this.reservation=null;this.scope=null;this.state=initial();this.listeners.clear();}
}
