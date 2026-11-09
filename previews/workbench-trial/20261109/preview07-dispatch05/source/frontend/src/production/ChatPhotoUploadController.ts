import { toByteArray } from 'base64-js';
import { PhotoApiError, type PhotoApi } from '../../../src/client/photo-api.ts';
import { PHOTO_LIMITS, photoMetadataSchema, photoMessageReferenceSchema, type PhotoAttachment, type PhotoMetadata, type PhotoMessageReference } from '../../../src/shared/photos.ts';
import type { PhotoOriginal } from '../photo-view-model.ts';

export interface LocalChatPhotoInput { id:string; photo:PhotoOriginal }
export interface ChatPhotoUploadState { localId:string|null; photo:PhotoAttachment|null; busy:boolean; unknown:boolean; notice:string|null }
type Scope = { key:string; userId:string; childId:string };
const initial=():ChatPhotoUploadState=>({localId:null,photo:null,busy:false,unknown:false,notice:null});
const sameMetadata=(a:PhotoMetadata,b:PhotoMetadata)=>a.fileName===b.fileName&&a.mimeType===b.mimeType&&a.bytes===b.bytes&&a.sha256===b.sha256&&a.source===b.source;

/** Owns one chat reference; removing it never deletes a reusable library photo. */
export class ChatPhotoUploadController {
  private state=initial(); private listeners=new Set<()=>void>();
  private scope:Scope|null=null; private online=true; private epoch=0; private request:AbortController|null=null;
  private metadata:PhotoMetadata|null=null; private unidentifiedResult=false; private unavailable=false;
  private api:PhotoApi; private hash:(bytes:Uint8Array<ArrayBuffer>)=>Promise<string>; private accessLost:(error:PhotoApiError)=>void;
  constructor(api:PhotoApi,hash:(bytes:Uint8Array<ArrayBuffer>)=>Promise<string>,accessLost:(error:PhotoApiError)=>void){this.api=api;this.hash=hash;this.accessLost=accessLost;}
  getSnapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<ChatPhotoUploadState>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private clear(){this.metadata=null;this.unidentifiedResult=false;this.unavailable=false;this.update(initial());}
  syncContext(scope:Scope|null,online:boolean){
    this.online=online;
    if(scope?.key!==this.scope?.key||scope?.userId!==this.scope?.userId||scope?.childId!==this.scope?.childId){
      this.epoch++;this.request?.abort();this.request=null;this.api.resetOnline();this.scope=scope;this.clear();
    }else if(!online)this.request?.abort();
  }
  private begin(){
    if(!this.scope||!this.online||this.request)return null;
    const scope=this.scope,epoch=this.epoch,controller=new AbortController();this.request=controller;
    const timer=setTimeout(()=>controller.abort(),60000);this.update({busy:true,notice:null});
    return {scope,signal:controller.signal,current:()=>epoch===this.epoch&&this.online&&!controller.signal.aborted,
      same:()=>epoch===this.epoch,finish:()=>{clearTimeout(timer);if(this.request===controller)this.request=null;if(epoch===this.epoch)this.update({busy:false});}};
  }
  private checked(photo:PhotoAttachment,scope:Scope){
    if(photo.childId!==scope.childId||photo.ownerUserId!==scope.userId||!this.metadata||!sameMetadata(photo,this.metadata))throw new PhotoApiError(403,'forbidden');
    return photo;
  }
  private ready(photo:PhotoAttachment){return photo.state==='ready'&&!photo.recoveryPending;}
  private failed(error:unknown,attempted:boolean){
    if(error instanceof PhotoApiError&&error.confirmed&&!this.state.photo)this.unidentifiedResult=true;
    if(error instanceof PhotoApiError&&[401,403].includes(error.status)){
      this.update({photo:null,unknown:attempted,notice:'登入或權限已改變，請重新核對。'});this.accessLost(error);return;
    }
    const unknown=!!this.state.photo||this.api.hasPendingOnline()||this.unidentifiedResult||attempted&&(!(error instanceof PhotoApiError)||error.status===0||error.status>=500);
    this.update({unknown,notice:unknown?'照片的原操作尚未確認；請先查核，避免重複上傳。':'照片未能使用；請核對原檔案或重新選取。'});
  }
  async prepare(input:LocalChatPhotoInput):Promise<PhotoAttachment|null>{
    if(this.unavailable||this.state.unknown||this.state.localId&&this.state.localId!==input.id)return null;
    if(this.state.photo&&this.ready(this.state.photo))return this.scope&&this.online&&!this.request?this.state.photo:null;
    const r=this.begin();if(!r)return null;let attempted=false;
    try{
      const original=input.photo;
      if(!original.readBase64||original.bytes<1||original.bytes>PHOTO_LIMITS.bytes)throw new PhotoApiError(400,'invalid_photo');
      const base64=await original.readBase64();if(!r.current())return null;
      if(base64.length>Math.ceil(PHOTO_LIMITS.bytes/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64))throw new PhotoApiError(400,'invalid_photo');
      const bytes=new Uint8Array(toByteArray(base64));if(bytes.length!==original.bytes)throw new PhotoApiError(400,'invalid_photo');
      const sha256=await this.hash(bytes);if(!r.current())return null;
      const parsed=photoMetadataSchema.safeParse({fileName:original.fileName,mimeType:original.mimeType,bytes:bytes.length,sha256,source:'聊天照片'});
      if(!parsed.success||sha256!==original.sha256||this.metadata&&!sameMetadata(this.metadata,parsed.data))throw new PhotoApiError(400,'invalid_photo');
      this.metadata??=parsed.data;this.update({localId:input.id});
      let photo=this.state.photo;
      if(!photo){attempted=true;const result=await this.api.reserve(r.scope.childId,this.metadata,r.signal,r.scope.userId);
        if(!r.current())return null;
        if(!result||!('photo' in result))throw new PhotoApiError(0,null,true);
        photo=this.checked(result.photo,r.scope);this.update({photo});}
      if(!this.ready(photo)){attempted=true;photo=await this.api.upload(photo,base64,r.signal,r.scope.userId);}
      if(!r.current())return null;this.checked(photo,r.scope);
      const ready=this.ready(photo);this.update({photo,unknown:!ready,notice:ready?null:'照片尚未確認，請查核原上傳。'});return ready?photo:null;
    }catch(error){if(r.current())this.failed(error,attempted);return null;}
    finally{if(r.same()&&r.signal.aborted&&attempted)this.update({unknown:true,notice:'原操作未確認，請先查核照片。'});r.finish();}
  }
  async prepareReference(reference:PhotoMessageReference,localId:string):Promise<PhotoAttachment|null>{
    if(this.unavailable||this.state.unknown||this.state.localId&&this.state.localId!==localId||this.api.hasPendingOnline())return null;
    const parsed=photoMessageReferenceSchema.safeParse(reference);if(!parsed.success)return null;
    const r=this.begin();if(!r)return null;
    try{
      this.metadata=parsed.data;this.update({localId,photo:null});
      const photo=await this.api.photo(r.scope.childId,reference.id,r.signal,r.scope.userId);
      if(!r.current())return null;this.checked(photo,r.scope);
      if(photo.id!==reference.id||photo.version<reference.version||!this.ready(photo))throw new PhotoApiError(409,'version_conflict');
      this.update({photo,unknown:false});return photo;
    }catch(error){if(r.current())this.failed(error,false);return null;}finally{r.finish();}
  }
  async check():Promise<void>{
    if(this.unavailable)return;
    const r=this.begin();if(!r)return;let readingPhoto=false;
    try{
      let photo=this.state.photo;
      if(this.api.hasPendingOnline()){
        const receipt=await this.api.reconcilePending(r.signal,r.scope.userId);if(!r.current())return;
        if(receipt?.state==='confirmed'){
          if(!receipt.result||!('photo' in receipt.result)){this.unidentifiedResult=true;throw new PhotoApiError(0,null,true);}
          photo=this.checked(receipt.result.photo,r.scope);this.update({photo});
        }
      }
      if(photo){readingPhoto=true;photo=await this.api.photo(r.scope.childId,photo.id,r.signal,r.scope.userId);if(!r.current())return;this.checked(photo,r.scope);}
      const unknown=this.unidentifiedResult||!!photo?.recoveryPending;
      this.update({photo,unknown,notice:unknown?'原照片結果尚未能核對，請稍後再查。':photo&&this.ready(photo)?'原照片已核對，可繼續送出。':'原操作已查核；可沿用同一照片及原操作重試。'});
    }catch(error){if(r.current()){
      if(readingPhoto&&error instanceof PhotoApiError&&[404,410].includes(error.status)&&!this.api.hasPendingOnline()){
        this.unavailable=true;this.update({photo:null,unknown:false,notice:'原照片已不可使用，請移除此附件引用。'});
      }else this.failed(error,true);
    }}finally{if(r.same()&&r.signal.aborted)this.update({unknown:true,notice:'原操作未確認，請先查核照片。'});r.finish();}
  }
  reset():boolean{if(this.request||this.state.unknown||this.api.hasPendingOnline())return false;this.clear();return true;}
  async discard():Promise<boolean>{return this.reset();}
  linked(messageId:string,photoId:string){if(messageId&&this.state.photo?.id===photoId&&!this.request&&!this.state.unknown&&!this.api.hasPendingOnline())this.clear();}
  dispose(){this.epoch++;this.request?.abort();this.request=null;this.api.resetOnline();this.metadata=null;this.scope=null;this.state=initial();this.listeners.clear();}
}
