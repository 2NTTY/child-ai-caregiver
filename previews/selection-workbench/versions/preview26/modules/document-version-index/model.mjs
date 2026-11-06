// DV01 synthetic proposal host. Not an adapter to useFamilyDocuments.
// Receipts are local intent admission only; they never attest to body retrieval.
const clone = value => structuredClone(value);
const emptyIndex = () => ({status:'neverRead',hasSucceeded:false,items:[],nextCursor:null,error:null,readGeneration:0,successfulCycles:0});
const documents = () => [
  {id:'doc-aurora',documentVersion:12,title:'成長整理',context:'虛構文件 A · 晨光觀察站'},
  {id:'doc-aurora-copy',documentVersion:19,title:'成長整理',context:'虛構文件 B · 海風觀察站'},
  {id:'doc-lantern',documentVersion:3,title:'交接準備',context:'虛構文件 C · 燈塔觀察站'}
];
const bindingKeys=['scope','epoch','childId','authorityVersion','generation','filter','documentId','documentVersion','readGeneration'];
export function createHost() {
  let docs=documents(), activeId=docs[0].id, context={scope:'opaque-demo-scope',epoch:'epoch-1',childId:'synthetic-child-a',authorityVersion:'authority-1'};
  let generation=1,filter='all',available=true,unavailableReason=null,selection=null,readCount=0,serial=0;
  let indexes=new Map(docs.map(d=>[d.id,emptyIndex()]));
  const pending=new Map(),listeners=new Set();
  const doc=()=>docs.find(d=>d.id===activeId), idx=()=>indexes.get(activeId);
  const capture=()=>Object.freeze({...context,generation,filter,documentId:activeId,documentVersion:doc().documentVersion,readGeneration:idx().readGeneration});
  const matches=b=>!!b&&bindingKeys.every(k=>Object.is(b[k],capture()[k]));
  const notify=()=>{for(const fn of listeners)fn();};
  const reject=reason=>({accepted:false,reason,ticket:null});
  const cancelPending=()=>{pending.clear();for(const i of indexes.values())if(i.status==='loading')i.status=i.hasSucceeded?'ready':'neverRead';};
  const bump=()=>{generation++;cancelPending();};
  const reconcile=()=>{
    if(!selection)return;
    const i=indexes.get(selection.documentId),d=docs.find(x=>x.id===selection.documentId);
    const row=i?.items.find(r=>r.snapshotId===selection.snapshotId&&r.version===selection.snapshotVersion);
    selection={...selection,available:available&&d?.documentVersion===selection.documentVersion&&!!row&&!row.invalidated,
      reason:!available?'讀取暫不可用':d?.documentVersion!==selection.documentVersion?'文件版本已改變':row?.invalidated?'版本已失效':!row?'目前索引未包含此版本':null};
  };
  const resetIndexes=()=>{indexes=new Map(docs.map(d=>[d.id,emptyIndex()]));};
  const fail=(i,t,message)=>{i.status='failed';i.error={message,lane:t.binding.documentId,cursor:t.cursor,mode:t.mode};};
  const host={
    capture,
    get snapshot(){return clone({documents:docs,document:doc(),context,generation,filter,available,unavailableReason,selection,index:idx(),readCount});},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    loadVersions(binding,requestedMode='first') {
      if(!matches(binding))return reject('stale-binding');
      if(!available)return reject(unavailableReason||'unavailable');
      const i=idx();if(i.status==='lost')return reject('lost');
      if(i.status==='loading')return reject('busy');
      let mode=requestedMode,cursor=null;
      if(mode==='retry'){if(!i.error)return reject('no-failed-read');mode=i.error.mode;cursor=i.error.cursor;}
      else if(mode==='more'){if(!i.hasSucceeded||i.nextCursor===null)return reject('no-more');cursor=i.nextCursor;}
      else if(mode==='first'){if(i.hasSucceeded)return reject('already-read');}
      else if(mode!=='reload')return reject('unknown-mode');
      i.readGeneration++;i.status='loading';i.error=null;readCount++;
      const ticket=Object.freeze({id:`read-${++serial}`,kind:'metadata-read',binding:capture(),mode,cursor});
      pending.set(ticket.id,ticket);notify();return {accepted:true,ticket};
    },
    settle(ticket,outcome) {
      if(!ticket||pending.get(ticket.id)!==ticket)return false;
      if(!matches(ticket.binding)||!available){pending.delete(ticket.id);return false;}
      pending.delete(ticket.id);const i=idx();
      if(outcome?.lost){host.revoke();return true;}
      if(outcome?.error){fail(i,ticket,String(outcome.error));notify();return true;}
      const p=outcome?.page;
      if(!p||p.documentId!==activeId||p.documentVersion!==doc().documentVersion||!Array.isArray(p.items)||!(p.nextCursor===null||typeof p.nextCursor==='string')||p.items.some(r=>!r||typeof r.snapshotId!=='string'||!r.snapshotId||!Number.isInteger(r.version)||r.version<1||typeof r.generatedAt!=='string'||!Number.isFinite(Date.parse(r.generatedAt))||typeof r.invalidated!=='boolean')){
        fail(i,ticket,'合成回覆格式或文件 tuple 不相符');notify();return true;
      }
      if(ticket.mode==='more'&&p.nextCursor===ticket.cursor){fail(i,ticket,'回覆游標未前進，保留原窗口');notify();return true;}
      const items=p.items.map(({snapshotId,version,generatedAt,invalidated})=>({snapshotId,version,generatedAt,invalidated}));
      const merged=new Map((ticket.mode==='more'?i.items:[]).map(r=>[`${r.snapshotId}\0${r.version}`,r]));
      for(const r of items)merged.set(`${r.snapshotId}\0${r.version}`,r);
      i.items=[...merged.values()];i.nextCursor=p.nextCursor;i.hasSucceeded=true;i.status='ready';i.error=null;i.successfulCycles++;reconcile();notify();return true;
    },
    selectVersion(binding,snapshotId,snapshotVersion){
      if(!matches(binding))return reject('stale-binding');
      if(!available||idx().status==='lost')return reject('unavailable');
      const row=idx().items.find(r=>r.snapshotId===snapshotId&&r.version===snapshotVersion);
      if(!row)return reject('row-missing');if(row.invalidated)return reject('invalidated');
      const ticket=Object.freeze({id:`select-${++serial}`,kind:'selection-intent',binding:capture(),snapshotId,snapshotVersion});
      selection={documentId:activeId,documentVersion:doc().documentVersion,snapshotId,snapshotVersion,available:true,reason:null,ticketId:ticket.id};notify();return {accepted:true,ticket};
    },
    setDocument(id){if(id===activeId||!docs.some(d=>d.id===id))return;bump();activeId=id;selection=null;notify();},
    setFilter(next){if(!['all','readable','invalidated'].includes(next)||next===filter)return;bump();filter=next;resetIndexes();reconcile();notify();},
    setContext(change){const next={...context,...change};if(Object.keys(context).every(k=>context[k]===next[k]))return;bump();context=next;resetIndexes();selection=null;notify();},
    setDocumentVersion(id,version){if(!Number.isInteger(version)||version<1)return;const d=docs.find(x=>x.id===id);if(!d||d.documentVersion===version)return;bump();d.documentVersion=version;indexes.set(id,emptyIndex());reconcile();notify();},
    renewGeneration(){bump();reconcile();notify();},
    setAvailability(reason){bump();available=reason===null;unavailableReason=reason;reconcile();notify();},
    revoke(){bump();available=false;unavailableReason='權限已撤回（合成）';resetIndexes();for(const i of indexes.values())i.status='lost';selection=null;notify();},
    restore(){bump();available=true;unavailableReason=null;context={...context,epoch:`restored-${generation}`};resetIndexes();selection=null;notify();}
  };
  return host;
}
