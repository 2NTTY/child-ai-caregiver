// Entirely synthetic, memory-only UI host. This is not a production adapter.
const clone=value=>structuredClone(value);
const items=()=>[
 {id:'ticket',section:'arrangements',group:'安排',text:'核對合成預約卡上的日期與地點',checked:false},
 {id:'route',section:'arrangements',group:'安排',text:'把示例交通安排放進待看清單',checked:false},
 {id:'folder',section:'bag',group:'隨身物品',text:'把空白示例文件夾放進袋子',checked:false},
 {id:'card',section:'bag',group:'隨身物品',text:'備好標示「合成」的識別卡',checked:true},
 {id:'questions',section:'review',group:'出發前核對',text:'重看示例問題清單的標題',checked:false},
 {id:'companion',section:'review',group:'出發前核對',text:'核對示例同行安排',checked:false},
];
export function createFixture({now}={}){
 let epoch=1,context='A',time=0,editedAt=0,version=1,mode='ready',title='小星的到診準備（合成）';
 let base=items(),desired=new Map(),original=null,flight=null,phase='idle',receipt=null,readChecked=false;
 let live=true,suspended=false,writeSeq=0,attemptSeq=0,forced=false,editSequence=0;
 const currentTime=()=>now?now():time;
 const listeners=new Set();
 const usable=()=>live&&!suspended&&mode==='ready';
 const dirty=()=>desired.size>0||original!==null;
 const hidden=()=>!live||['restricted','invalidated','unknown-source'].includes(mode);
 // Force belongs to the current nonempty draft, never to the host or a future draft.
 const publish=()=>{if(!desired.size)forced=false;for(const fn of [...listeners])fn();};
 const binding=()=>Object.freeze({epoch,context,documentId:'demo-preparation',version,authority:'demo-authority-'+context});
 const same=b=>b&&b.epoch===epoch&&b.context===context&&b.documentId==='demo-preparation'&&b.version===version&&b.authority==='demo-authority-'+context;
 const resetData=()=>{base=items();desired.clear();original=null;flight=null;phase='idle';receipt=null;readChecked=false;version=1;forced=false;title='小星的到診準備（合成）';};
 const dispatch=()=>{
  if(!usable()||original||!desired.size||phase==='conflict'||(!forced&&currentTime()<editedAt+3000))return null;
  if([...desired.keys()].some(id=>!base.some(item=>item.id===id))){phase='conflict';receipt=null;readChecked=false;return null;}
  const checks=[...desired].flatMap(([id,checked])=>{const item=base.find(x=>x.id===id);return item&&item.checked!==checked?[{sectionId:item.section,itemId:id,checked}]:[];});
  if(!checks.length){desired.clear();phase='idle';forced=false;return null;}
  const body=Object.freeze({action:'check_items',expectedVersion:version,authorityVersion:'demo-authority-'+context,checks:Object.freeze(checks.map(Object.freeze))});
  original={opId:`DEMO-${epoch}-${++writeSeq}`,body,everUnknown:false};
  flight=Object.freeze({epoch,attempt:++attemptSeq,opId:original.opId,body});phase='saving';readChecked=false;return flight;
 };
 const api={
  binding,
  timerPlan(){if(!usable()||original||phase!=='queued'||!desired.size)return null;return {key:`${epoch}:${editSequence}:${forced}`,delay:forced?0:Math.max(0,editedAt+3000-currentTime())};},
  snapshot(){return {epoch,context,id:'demo-preparation',version,authority:'demo-authority-'+context,mode,title:hidden()?'':title,
    items:hidden()?[]:base.map(item=>({...item,checked:desired.has(item.id)?desired.get(item.id):item.checked,savedChecked:item.checked,draft:desired.has(item.id)})),
    phase,dirty:dirty(),receipt:receipt?clone(receipt):null,writes:writeSeq,operationId:original?.opId??null,
    canEdit:usable()&&!['unknown','conflict'].includes(phase),canRetry:usable()&&phase==='unknown'&&readChecked,
    canRecheck:usable()&&['unknown','conflict'].includes(phase),canReapply:usable()&&phase==='conflict'&&readChecked&&!original,
    canDiscard:live&&!suspended&&!original&&desired.size>0,live,suspended,readChecked,original:original?clone(original):null};},
  subscribe(fn){if(!live)return ()=>{};listeners.add(fn);return ()=>listeners.delete(fn);},
  edit(b,id,checked){if(!usable()||!same(b)||typeof checked!=='boolean'||['unknown','conflict'].includes(phase))return false;
    const item=base.find(x=>x.id===id);if(!item)return false;
    if(!original&&item.checked===checked)desired.delete(id);else desired.set(id,checked);
    editedAt=currentTime();editSequence++;receipt=null;if(!original)phase=desired.size?'queued':'idle';publish();return true;},
  advance(ms){if(!live||!Number.isFinite(ms)||ms<0)return;if(!now)time+=ms;if(!suspended)dispatch();publish();},
  flush(){if(!live||suspended||!desired.size)return null;forced=true;const result=dispatch();publish();return result;},
  pending(){return flight;},
  settle(ticket,result){
    if(!live||suspended||!ticket||ticket!==flight||ticket.epoch!==epoch||!original||!['saved','unknown','conflict'].includes(result))return false;
    flight=null;
    if(result==='saved'){
      for(const check of original.body.checks){const item=base.find(x=>x.id===check.itemId);if(item)item.checked=check.checked;}
      version=original.body.expectedVersion+1;
      for(const [id,value]of desired)if(base.some(x=>x.id===id&&x.checked===value))desired.delete(id);
      receipt=desired.size?null:{opId:original.opId,version,synthetic:true};original=null;readChecked=false;
      phase=desired.size?'queued':'idle';if(desired.size&&forced)dispatch();
    }else if(result==='unknown'||original.everUnknown){original.everUnknown=true;phase='unknown';receipt=null;readChecked=false;}
    else {phase='conflict';original=null;receipt=null;readChecked=false;}
    publish();return true;
  },
  recheck(){if(!usable()||!['unknown','conflict'].includes(phase))return false;
    // Read simulation grants retry/reapply permission, never a save receipt.
    if(phase==='conflict'&&!readChecked)version++;
    readChecked=true;publish();return true;},
  retry(){if(!usable()||phase!=='unknown'||!readChecked||!original||flight)return null;
    flight=Object.freeze({epoch,attempt:++attemptSeq,opId:original.opId,body:original.body});readChecked=false;phase='saving';writeSeq++;publish();return flight;},
  reapply(){if(!usable()||phase!=='conflict'||!readChecked||original||[...desired.keys()].some(id=>!base.some(x=>x.id===id)))return false;
    phase='queued';readChecked=false;forced=true;dispatch();publish();return true;},
  discard(){if(!live||suspended||original)return false;desired.clear();phase='idle';receipt=null;readChecked=false;publish();return true;},
  project(patch){if(!live)return false;if(patch.label!==undefined)title=String(patch.label);
    if(patch.removeItem)base=base.filter(x=>x.id!==patch.removeItem);
    if(patch.itemText)for(const item of base)if(item.id===patch.itemText.id)item.text=patch.itemText.text;
    if(patch.mode){if(['restricted','invalidated','unknown-source'].includes(mode)&&patch.mode!==mode)epoch++;mode=patch.mode;if(mode==='refresh-failed')readChecked=false;if(mode==='offline'&&desired.size&&!original){phase='conflict';receipt=null;readChecked=false;}if(['restricted','invalidated','unknown-source'].includes(mode)){epoch++;desired.clear();original=null;flight=null;phase='idle';receipt=null;readChecked=false;}}
    publish();return true;},
  context(next){if(!live)return false;epoch++;context=next;mode='ready';resetData();publish();return true;},
  suspend(){if(!live||suspended)return false;suspended=true;publish();return true;},
  resume(){if(!live||!suspended)return false;suspended=false;dispatch();publish();return true;},
  dispose(){if(!live)return;live=false;epoch++;desired.clear();original=null;flight=null;phase='idle';receipt=null;base=[];title='';publish();listeners.clear();},
 };
 return api;
}
