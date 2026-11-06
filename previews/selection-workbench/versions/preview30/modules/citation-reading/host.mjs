import {fixture} from './fixture.mjs';
export function safeSourceUrl(value){
  if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return null;
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname&&!u.username&&!u.password?u.href:null}catch{return null}
}
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v)}return x}
export function createHost(){
  let scope='family-a',scenario='ready',messageId='m1',mode='A',query='',notice='',life=1,revision=0,serial=0,disposed=false,selected=null;
  let data=fixture(scope,scenario),snapshot;
  const listeners=new Set();
  function derive(){
    const message=data.messages.find(m=>m.id===messageId),run=data.runs[message?.runId];
    const matches=!!run&&(message.text===run.text||!!run.text&&!!run.reason&&['stopped','unknown'].includes(run.status)&&message.text===`這次回覆未完成：${run.reason}。\n\n${run.text}`);
    const sources=disposed||!matches?[]:run.sources;
    const warnings=['全部文字與來源均為合成示例。引用存在不代表內容真實，也不是醫療結論保證。'];
    if(!matches)warnings.push('正文與 run 不匹配：來源及引用操作已撤下。');
    if(!sources.length)warnings.push('目前沒有可用來源，不能從舊選取恢復內容。');
    if(scenario==='withdrawn')warnings.push('來源【1】已撤回，舊摘錄與操作已失效。');
    if(run?.status==='stopped')warnings.push('這次回覆已停止，內容未完成。');
    if(run?.status==='unknown')warnings.push('結果未知，不能視為成功或完整回覆。');
    if(run?.retrieval==='keyword_degraded')warnings.push('檢索已降級為關鍵字，來源涵蓋可能不完整。');
    if(sources.some(s=>s.state==='stale'))warnings.push('部分來源核對時間過舊或未知，詳讀時仍須核實。');
    const markers=[...(message?.text??'').matchAll(/【([1-9]\d*)】|\[([1-9]\d*)\]/g)].map((m,i)=>{const number=Number(m[1]??m[2]),source=sources.find(s=>s.number===number);return {id:`${messageId}:${i}`,number,index:m.index,length:m[0].length,text:m[0],sourceId:source?.id??null}});
    if(selected&&!sources.some(s=>s.id===selected.sourceId))selected=null;
    return freeze({scope,scenario,messageId,runId:message?.runId,mode,query,notice,life,revision,selected: selected?{...selected}:null,message:message?{...message}:null,sources:sources.map(s=>({...s})),markers,messages:data.messages.map(m=>({...m})),warnings,disposed});
  }
  function publish(){revision++;snapshot=derive();const current=revision;for(const reg of [...listeners]){if(current!==revision)break;if(listeners.has(reg))reg.fn(snapshot)}}
  function binding(){return Object.freeze({scope,life,messageId,runId:snapshot.runId})}
  function valid(b){return !disposed&&b?.scope===scope&&b.life===life&&b.messageId===messageId&&b.runId===snapshot.runId}
  function reset(){life++;serial++;selected=null;query='';notice='';data=fixture(scope,scenario);publish()}
  snapshot=derive();
  return {
    getSnapshot:()=>snapshot,binding,valid,
    subscribe(fn){const reg={fn};listeners.add(reg);return()=>listeners.delete(reg)},
    open(b,sourceId,markerId){if(!valid(b)||!snapshot.sources.some(s=>s.id===sourceId)||!snapshot.markers.some(m=>m.id===markerId&&m.sourceId===sourceId))return false;selected={sourceId,markerId};notice='';publish();return true},
    close(b){if(!valid(b))return false;selected=null;publish();return true},
    url(b,id){if(!valid(b))return null;return safeSourceUrl(snapshot.sources.find(s=>s.id===id)?.url)},
    query(value,b=binding()){if(!valid(b))return false;query=String(value).slice(0,200);publish();return true},
    mode(value){if(disposed||!['A','B'].includes(value))return;mode=value;publish()},
    message(value){if(disposed||!data.messages.some(m=>m.id===value)||messageId===value)return;messageId=value;reset()},
    scope(value){if(disposed||!['family-a','family-b'].includes(value)||scope===value)return;scope=value;reset()},
    scenario(value){if(disposed||!['ready','missing','withdrawn','mismatch','stale','stopped','unknown','degraded'].includes(value))return;scenario=value;reset()},
    defer(){const b=binding(),ticket=++serial;return()=>{if(!valid(b)||ticket!==serial)return false;serial++;notice='合成延遲回呼已接納；沒有發出網絡請求。';publish();return true}},
    dispose(){if(disposed)return;disposed=true;life++;serial++;selected=null;publish();listeners.clear()}
  };
}
