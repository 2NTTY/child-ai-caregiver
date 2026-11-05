import {createHost} from './host.mjs';
import {mountInbox} from './view.mjs';
import {createFixturePorts} from './fixtures.mjs';
export function mountDemo(root){
 const doc=root.ownerDocument;
 let host,view,generation=0,alive=true,currentReady=Promise.resolve();
 const demoBar=doc.createElement('div');demoBar.className='demo-bar';
 const scenarioLabel=doc.createElement('label');scenarioLabel.textContent='合成情境 ';const scenario=doc.createElement('select');scenario.name='scenario';
 for(const [value,label] of [['normal','已讀結果'],['empty','空窗口'],['loading','讀取中'],['failure','首次讀取失敗'],['stale','更新失敗／舊快照'],['offline','離線快照'],['denied','失去讀取權限'],['saved-failure','原保存已確認／讀取失敗'],['long','長篇原文'],['whitespace','空白文字']]){const o=doc.createElement('option');o.value=value;o.textContent=label;scenario.append(o)}scenarioLabel.append(scenario);
 const scopeLabel=doc.createElement('label');scopeLabel.textContent='合成身份 ';const identity=doc.createElement('select');identity.name='identity';for(const [value,label]of[['a','小海的私人窗口'],['b','小星的私人窗口']]){const o=doc.createElement('option');o.value=value;o.textContent=label;identity.append(o)}scopeLabel.append(identity);
 const mark=doc.createElement('p');mark.textContent='私有本地候選 / AI01';demoBar.append(mark,scenarioLabel,scopeLabel);
 const target=doc.createElement('div');root.replaceChildren(demoBar,target);
 function start(){
  if(!alive)return;view?.destroy();const token=++generation;
  host=createHost({scope:{identity:`synthetic-${identity.value}`,generation:token,childId:`child-${identity.value}`,scopeKey:`private-${identity.value}`,label:identity.value==='a'?'合成小海':'合成小星'},ports:createFixturePorts(scenario.value)});
  const own=host,mode=scenario.value;view=mountInbox(target,own);
  currentReady=(async()=>{await own.refresh();if(!alive||token!==generation)return;const entries=own.getSnapshot().list.entries;await Promise.all(entries.map(r=>own.readResult(r.runId)));if(!alive||token!==generation)return;if(entries.length)own.select(entries[0].runId);if(mode==='stale')await own.refresh();if(mode==='offline')own.setAvailability({online:false});})();
 }
 scenario.addEventListener('change',start);identity.addEventListener('change',start);start();
 return Object.freeze({get ready(){return currentReady},getHost:()=>host,destroy(){if(!alive)return;alive=false;generation++;scenario.removeEventListener('change',start);identity.removeEventListener('change',start);view?.destroy();root.replaceChildren()}});
}
if(typeof document!=='undefined'){
 const root=document.getElementById('demo');if(root){const demo=mountDemo(root);const stop=event=>{if(event.persisted)return;demo.destroy();window.removeEventListener('pagehide',stop)};window.addEventListener('pagehide',stop);}
}
