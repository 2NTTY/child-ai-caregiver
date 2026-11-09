// QA-only observation. Nothing here owns product state or persists a receipt.
export type QAKind='wrapper'|'projection'|'presentation'|'navigation';
export type QAFields=Readonly<{scopeKey?:unknown;receipt?:object|null;rootKey?:unknown;rootRouteKey?:unknown}>;
export type QALease=object;
type Row={instance:string;scopeKey?:string|null;receipt?:string|null;rootKey?:string|null;rootRouteKey?:string|null};
type EventRow=Row&{sequence:number;event:'mount'|'update'|'cleanup';kind:QAKind};
const KINDS:readonly QAKind[]=['wrapper','projection','presentation','navigation'];
const SYNTHETIC_SCOPES=new Set([
  '["https://normal-bootstrap.invalid","preview-owner",1]',
  '["https://normal-bootstrap.invalid","preview-owner",1,"c0b00000-0000-4000-8000-000000000001","owner"]',
]);
export function createTasksLifetimeTrace(options:{enabled?:boolean;bootstrapId?:string}={}) {
  const enabled=options.enabled===true;
  const bootstrap=enabled&&/^qa-[a-zA-Z0-9-]{1,40}$/.test(options.bootstrapId??'')?options.bootstrapId!:'qa-off';
  const objects=new WeakMap<object,string>(),keys=new Map<string,string>();
  const leases=new WeakMap<QALease,{kind:QAKind;row:Row}>(),active=new Map<QAKind,QALease>();
  const listeners=new Set<()=>void>();
  const current:Record<QAKind,Row|null>={wrapper:null,projection:null,presentation:null,navigation:null};
  const events:EventRow[]=[];
  let objectCount=0,sequence=0,dropped=0,saturated=false,notifying=false;
  const encode=()=>JSON.stringify({enabled,bootstrap,current,events,dropped,saturated});
  let snapshot=encode();
  const identity=(value:object)=>{
    let id=objects.get(value);
    if(!id){if(objectCount===Number.MAX_SAFE_INTEGER){saturated=true;return 'o-limit';}
      id=`o${++objectCount}`;objects.set(value,id);}
    return id;
  };
  const keyIdentity=(value:unknown):string|null=>{
    if(typeof value!=='string'||!value.length||value.length>512)return null;
    const known=keys.get(value);if(known)return known;
    if(keys.size>=64){saturated=true;return 'k-limit';}
    const id=`k${keys.size+1}`;keys.set(value,id);return id;
  };
  const own=(fields:QAFields,key:keyof QAFields):unknown=>{
    try { const d=Object.getOwnPropertyDescriptor(fields,key);return d&&Object.hasOwn(d,'value')?d.value:undefined; }
    catch { return undefined; }
  };
  const fieldsFor=(kind:QAKind,fields:QAFields):Omit<Row,'instance'>=>{
    if(kind==='navigation')return {rootKey:keyIdentity(own(fields,'rootKey')),rootRouteKey:keyIdentity(own(fields,'rootRouteKey'))};
    const raw=own(fields,'scopeKey'),scopeKey=raw==null?null:typeof raw==='string'&&SYNTHETIC_SCOPES.has(raw)?raw:'[redacted]';
    const receipt=own(fields,'receipt');
    return {scopeKey,...(kind==='presentation'?{receipt:receipt!==null&&typeof receipt==='object'?identity(receipt):null}:{})};
  };
  const publish=(event:EventRow['event'],kind:QAKind,row:Row)=>{
    if(sequence===Number.MAX_SAFE_INTEGER){saturated=true;return false;}
    events.push({...row,sequence:++sequence,event,kind});
    while(events.length>64){events.shift();dropped++;saturated=true;}
    snapshot=encode();
    // All output is bounded ASCII identifiers or the exact synthetic allowlist.
    while(snapshot.length>32768&&events.length){events.shift();dropped++;saturated=true;snapshot=encode();}
    notifying=true;
    try { for(const listener of [...listeners]){try{listener();}catch{/* Diagnostic failures cannot affect product lifetimes. */}} }
    finally { notifying=false; }
    return true;
  };
  return Object.freeze({
    enabled,
    mount(kind:QAKind,instance:object,fields:QAFields={}):QALease|null {
      if(!enabled||notifying||!KINDS.includes(kind)||instance===null||typeof instance!=='object')return null;
      const lease=Object.freeze({}),row={instance:identity(instance),...fieldsFor(kind,fields)};
      leases.set(lease,{kind,row});active.set(kind,lease);current[kind]=row;publish('mount',kind,row);return lease;
    },
    update(lease:QALease|null,fields:QAFields):boolean {
      const entry=lease?leases.get(lease):null;
      if(!enabled||notifying||!entry||active.get(entry.kind)!==lease)return false;
      const row={instance:entry.row.instance,...fieldsFor(entry.kind,fields)};
      if(JSON.stringify(entry.row)===JSON.stringify(row))return false;
      entry.row=row;current[entry.kind]=row;return publish('update',entry.kind,row);
    },
    cleanup(lease:QALease|null):boolean {
      const entry=lease?leases.get(lease):null;
      if(!enabled||notifying||!entry||active.get(entry.kind)!==lease)return false;
      active.delete(entry.kind);current[entry.kind]=null;return publish('cleanup',entry.kind,entry.row);
    },
    subscribe(listener:()=>void):()=>void {
      if(!enabled)return ()=>{};
      listeners.add(listener);return ()=>{listeners.delete(listener);};
    },
    getSnapshot:()=>snapshot,
  });
}
// Explicit build-only QA opt-in, never a page prop, query, storage key or admission switch.
const enabled=process.env.EXPO_PUBLIC_TASKS_LIFETIME_QA==='1';
export const tasksLifetimeQA=createTasksLifetimeTrace({enabled,
  bootstrapId:enabled?`qa-${Math.random().toString(36).slice(2,14)}`:undefined});
