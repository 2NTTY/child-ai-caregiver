import{scopeA,scopeB,scenarioData}from'./fixtures.mjs';import{page,filtered}from'./model.mjs';
const clone=x=>structuredClone(x);function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v)}return x}
export function createHost(){let s={...scenarioData('mixed'),scope:clone(scopeA),access:'read_only',epoch:1,view:1,revision:0,detail:0,mode:'shelf',query:'',filter:'all',page:0,pageSize:3,selected:null,expanded:false,scenario:'mixed',pending:null,disposed:false};let serial=0;const listeners=new Set();
 const snapshot=()=>freeze(clone(s));
 function publish(){s.revision++;const r=s.revision;for(const fn of [...listeners]){if(s.revision!==r)break;if(listeners.has(fn))fn(snapshot())}}
 const active=()=>!s.disposed&&s.access!=='lost';
 function valid(t){return active()&&!!t&&t.epoch===s.epoch&&t.view===s.view}
 const row=id=>s.items.find(x=>x.id===id);
 function rowValid(id,t){return valid(t)&&t.id===id&&t.version===row(id)?.version&&page(s).rows.some(x=>x.id===id)}
 function clearSelection(){if(s.selected!==null){s.selected=null;s.expanded=false;s.detail++}}
 function reconcile(){s.page=page(s).index;const x=row(s.selected?.id);if(s.selected&&(!x||x.version!==s.selected.version||!page(s).rows.some(x=>x.id===s.selected.id)))clearSelection()}
 function reset(ctx,access=ctx.access){s={...s,scope:clone(ctx),access,epoch:s.epoch+1,view:s.view+1,detail:s.detail+1,items:[],selected:null,expanded:false,query:'',filter:'all',page:0,pending:null,operation:{state:'none',phase:null,reference:null},readState:access==='lost'?'error':'ready',windowNote:'尚未載入合成窗口。'};publish()}
 function currentRead(t){return active()&&t?.epoch===s.epoch&&t?.view===s.view&&s.pending?.serial===t.serial}
 function rowsValid(items){return Array.isArray(items)&&items.length<=50&&new Set(items.map(x=>x?.id)).size===items.length&&items.every(x=>x&&typeof x.id==='string'&&x.id.length>0&&x.childId===s.scope.childId&&x.ownerUserId===s.scope.userId&&Number.isInteger(x.version)&&x.version>0&&typeof x.sourceLabel==='string'&&typeof x.text==='string'&&['paste','personal_source','public_source'].includes(x.kind)&&['not_requested','running','ready','failed','unknown'].includes(x.fetchState)&&['not_requested','running','available','failed','unknown'].includes(x.extraction?.state))}
 const api={snapshot,subscribe(fn){if(!s.disposed)listeners.add(fn);return()=>listeners.delete(fn)},ticket(id){const x=row(id);return freeze({epoch:s.epoch,view:s.view,id:id??null,version:x?.version??null,detail:s.detail})},valid,
 scope(ctx){if(s.disposed)return false;reset(typeof ctx==='string'?ctx==='b'?scopeB:scopeA:ctx);return true},
 mode(mode,t){if(!valid(t)||!['shelf','lanes'].includes(mode)||mode===s.mode)return false;s.mode=mode;s.view++;s.pending=null;clearSelection();publish();return true},
 query(value,t){if(!valid(t)||typeof value!=='string')return false;s.query=value.slice(0,200);s.page=0;reconcile();publish();return true},
 filter(value,t){if(!valid(t)||!['all','unknown','failed','awaiting','review','reading','disabled'].includes(value))return false;s.filter=value;s.page=0;reconcile();publish();return true},
 movePage(delta,t){if(!valid(t)||![-1,1].includes(delta))return false;const p=page(s),next=p.index+delta;if(next<0||next>=p.count)return false;s.page=next;reconcile();publish();return true},
 select(id,t){if(!rowValid(id,t))return false;s.selected={id,version:row(id).version};s.expanded=false;s.detail++;publish();return true},
 close(t){if(!valid(t)||t.detail!==s.detail||!s.selected)return false;clearSelection();publish();return true},
 toggle(t){if(!valid(t)||t.detail!==s.detail||!s.selected||row(s.selected.id)?.management?.enabled===false)return false;s.expanded=!s.expanded;publish();return true},
 scenario(name,t){if(!valid(t)||!['mixed','empty','partial','stale','error','loading','unknown'].includes(name))return false;const data=scenarioData(name,s.scope);s={...s,...data,scenario:name,page:0,pending:null,detail:s.detail+1,selected:null,expanded:false};publish();return true},
 revoke(t){if(!valid(t))return false;reset(s.scope,'lost');return true},
 beginRead(t){if(!valid(t)||s.pending)return null;const ticket={epoch:s.epoch,view:s.view,serial:++serial};s.pending=ticket;s.readState=s.items.length?'stale':'loading';publish();return freeze(clone(ticket))},
 finishRead(t,value){if(!currentRead(t))return false;if(!rowsValid(value?.items)){api.failRead(t,'error');return false}s.items=clone(value.items);s.pending=null;s.readState='ready';reconcile();publish();return true},
 failRead(t,reason){if(!currentRead(t))return false;if(reason==='denied'){reset(s.scope,'lost');return true}s.pending=null;s.readState=s.items.length?'stale':'error';publish();return true},
 dispose(){if(s.disposed)return;s.disposed=true;s.epoch++;s.view++;s.detail++;s.items=[];s.selected=null;s.expanded=false;s.pending=null;s.operation={state:'none',phase:null,reference:null};publish();listeners.clear()}
 };return api;
}
