// Synthetic projection host. No product adapters, transport, persistence or model ports.
const kinds=['facts','personal','references'];
const empty=()=>({state:'unavailable',items:[],cursor:null,pending:false,error:null});
const clone=x=>structuredClone(x);
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v)}return x}
export function createHost({context,ports}){
  let state={context:clone(context),epoch:1,revision:0,disposed:false,layout:'rooms',section:'facts',selection:null,reads:Object.fromEntries(kinds.map(k=>[k,empty()])),histories:{},summary:null,draft:'',route:'reader',notice:''};
  const listeners=new Set(),pending=new Map();let serial=0;
  const snapshot=()=>freeze(clone(state));
  function publish(){const revision=++state.revision,s=snapshot();for(const registration of [...listeners]){if(state.revision!==revision||state.disposed)break;if(listeners.has(registration))registration.listener(s)}}
  const active=()=>!state.disposed&&state.context.access==='active';
  const allowed=k=>active()&&kinds.includes(k)&&(!state.context.shared||k==='facts');
  function valid(t){return active()&&t?.epoch===state.epoch}
  function row(kind,id){return state.reads[kind]?.items.find(x=>x.id===id)}
  function currentRow(kind,id,t){const x=row(kind,id);return valid(t)&&allowed(kind)&&x&&t.kind===kind&&t.id===id&&t.version===x.version?x:null}
  function abortAll(){for(const p of pending.values())p.controller.abort();pending.clear()}
  function resetContext(ctx){abortAll();state={...state,context:clone(ctx),epoch:state.epoch+1,selection:null,reads:Object.fromEntries(kinds.map(k=>[k,empty()])),histories:{},summary:null,draft:'',route:'reader',notice:''};publish()}
  function visible(kind,items){
    if(!Array.isArray(items)||items.length>100)throw new Error('Malformed synthetic page');
    return items.filter(x=>{
      if(!x||typeof x.id!=='string'||!Number.isInteger(x.version)||x.version<1||typeof x.title!=='string'||typeof x.text!=='string')throw new Error('Malformed synthetic row');
      if(kind==='references')return x.usageScope==='public_noncommercial';
      return x.childId===state.context.childId&&['private','family'].includes(x.visibility)&&(!state.context.shared||x.visibility==='family');
    }).map(clone);
  }
  function parsed(kind,value,cursor){
    if(!value||!['ready','stale','unknown'].includes(value.state)||!(value.nextCursor===null||typeof value.nextCursor==='string'&&value.nextCursor.length>0))throw new Error('Malformed synthetic page');
    if(cursor!==null&&value.nextCursor===cursor)throw new Error('Cursor did not advance');
    return{state:value.state,items:value.state==='unknown'?[]:visible(kind,value.items),cursor:value.state==='unknown'?null:value.nextCursor,pending:false,error:null};
  }
  function merge(previous,next,key=x=>x.id){const map=new Map(previous.map(x=>[key(x),x]));for(const x of next)map.set(key(x),x);return [...map.values()]}
  function begin(key){if(pending.has(key))return null;const request={id:++serial,epoch:state.epoch,controller:new AbortController()};pending.set(key,request);return request}
  const live=(key,request)=>active()&&request.epoch===state.epoch&&pending.get(key)===request;
  const api={
    getSnapshot:snapshot,
    subscribe(listener){const registration={listener};if(!state.disposed)listeners.add(registration);return()=>listeners.delete(registration)},
    ticket(kind,id){const x=row(kind,id);return freeze({epoch:state.epoch,kind,id,version:x?.version})},
    setContext(ctx){if(!state.disposed)resetContext(ctx)},
    revoke(){if(!state.disposed)resetContext({...state.context,access:'revoked'})},
    setLayout(layout,t){if(!state.disposed&&(!t||valid(t))&&['rooms','dossier'].includes(layout)&&layout!==state.layout){state.layout=layout;publish()}},
    setSection(section,t){if(active()&&(!t||valid(t))&&kinds.includes(section)){state.section=section;state.selection=null;state.route='reader';publish()}},
    select(kind,id,t){if(!currentRow(kind,id,t))return false;state.section=kind;state.selection=id;state.route='reader';publish();return true},
    setDraft(text,t){if(active()&&!state.context.shared&&(!t||valid(t))&&typeof text==='string'&&text.length<=10000){state.draft=text;publish();return true}return false},
    closeDraft(t){if(!valid(t))return false;state.route='reader';publish();return true},
    prepare(kind,id,t){const x=currentRow(kind,id,t);if(!x||state.context.shared||kind==='references')return false;
      if(state.draft.trim())state.notice='保留你原本未送出的問題。請在合成草稿核對；尚未送出。';
      else {state.draft=kind==='facts'?`我想核對${state.context.childName}的記憶「${x.title}」：${x.text}\n請先與我釐清疑問，並對照原來源及版本 ${x.version}；不要直接更改記憶。`:`我想繼續核對${state.context.childName}的「${x.title}」。請參照這筆私人工作的原訊息；不要直接更改記憶。`;state.notice='已放入合成草稿並模擬導航；尚未送出，沒有呼叫模型。'}
      state.route='draft';publish();return true;
    },
    async read(kind,{more=false,ticket}={}){
      if(!allowed(kind)||ticket&&!valid(ticket))return false;
      const before=clone(state.reads[kind]),cursor=more?before.cursor:null;
      if(more&&!cursor)return false;const p=begin(kind);if(!p)return false;
      state.reads[kind]={...before,pending:true,state:before.items.length?'stale':'loading',error:null};publish();
      if(!live(kind,p))return false;
      try{const value=await ports.read({kind,context:clone(state.context),cursor,signal:p.controller.signal});if(!live(kind,p))return false;
        const next=parsed(kind,value,cursor);if(more&&next.state!=='unknown')next.items=merge(before.items,next.items);
        state.reads[kind]=next;
        if(kind==='facts'){
          state.summary=!state.context.shared&&next.state!=='unknown'&&typeof value.summary==='string'?value.summary:more&&next.state!=='unknown'?state.summary:null;
          for(const id of Object.keys(state.histories)){if(!next.items.some(x=>x.id===id&&x.version===state.histories[id].version)){delete state.histories[id];const key='history:'+id;pending.get(key)?.controller.abort();pending.delete(key)}}
        }
        if(state.section===kind&&!next.items.some(x=>x.id===state.selection))state.selection=next.items[0]?.id??null;
      }catch(e){if(!live(kind,p))return false;state.reads[kind]={...before,pending:false,state:before.items.length?'stale':'error',error:'合成讀取失敗；沒有寫入操作。'}}
      finally{if(live(kind,p)){pending.delete(kind);state.reads[kind].pending=false;publish()}}
      return true;
    },
    async history(id,t,{more=false}={}){
      const basis=currentRow('facts',id,t);if(!basis)return false;
      const key='history:'+id,before=state.histories[id],cursor=more?before?.cursor:null;
      if(more&&!cursor)return false;const p=begin(key);if(!p)return false;
      state.histories[id]={version:basis.version,state:'loading',items:before?.items??[],cursor:cursor??null,pending:true};publish();
      if(!live(key,p)||!currentRow('facts',id,t))return false;
      try{const value=await ports.history({context:clone(state.context),id,version:basis.version,cursor:cursor??null,signal:p.controller.signal});
        if(!live(key,p)||!currentRow('facts',id,t))return false;
        const result=parsed('facts',value,cursor??null);result.items=result.items.filter(x=>x.id===id&&x.version<=basis.version);
        state.histories[id]={...result,version:basis.version,items:more&&result.state!=='unknown'?merge(before.items,result.items,x=>x.version):result.items};
      }catch(e){if(live(key,p)&&currentRow('facts',id,t))state.histories[id]={version:basis.version,state:'error',items:[],cursor:null,pending:false}}
      finally{if(live(key,p)){pending.delete(key);if(state.histories[id])state.histories[id].pending=false;publish()}}
      return true;
    },
    dispose(){if(state.disposed)return;abortAll();state.disposed=true;state.epoch++;state.revision++;state.reads=Object.fromEntries(kinds.map(k=>[k,empty()]));state.histories={};state.summary=null;state.draft='';listeners.clear()}
  };
  return api;
}
