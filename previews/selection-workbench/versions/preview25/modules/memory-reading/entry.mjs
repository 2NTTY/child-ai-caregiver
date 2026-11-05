import {createHost} from './host.mjs';
import {mountMemory} from './view.mjs';
import {createFixturePorts,scenarioContext} from './fixtures.mjs';
export function mountDemo(root){
 const doc=root.ownerDocument,win=doc.defaultView,bar=doc.createElement('div'),label=doc.createElement('label'),select=doc.createElement('select'),note=doc.createElement('p'),surface=doc.createElement('div');
 bar.className='scenario-bar';label.textContent='合成驗收情境 ';select.name='scenario';
 for(const[value,name]of Object.entries({normal:'私人正常閱讀',shared:'共享孩子：只讀家庭事實',revoked:'權限已撤回',stale:'上次資料／尚待核對',unknown:'讀取未確認',empty:'已載窗口暫無資料',pages:'空頁仍有更多／多頁',loading:'讀取中，可切換情境',error:'讀取失敗'})){const option=doc.createElement('option');option.value=value;option.textContent=name;select.append(option)}
 label.append(select);note.textContent='情境切換會建立全新合成身份壽命，草稿不會跨情境保存。';bar.append(label,note);root.append(bar,surface);
 let host=null,view=null,stopped=false,paused=false,ready=Promise.resolve();
 function retire(){view?.destroy();host?.dispose();view=null}
 function start(){if(stopped)return;retire();host=createHost({context:scenarioContext(select.value),ports:createFixturePorts(select.value)});view=mountMemory(surface,host);const owner=host;ready=Promise.all(['facts','personal','references'].map(kind=>owner.read(kind)));paused=false}
 const change=()=>{if(!paused)start()},hide=()=>{if(stopped)return;retire();paused=true},show=e=>{if(!stopped&&paused&&e.persisted)start()};
 select.addEventListener('change',change);win?.addEventListener('pagehide',hide);win?.addEventListener('pageshow',show);start();
 return{get ready(){return ready},getHost:()=>host,destroy(){if(stopped)return;stopped=true;retire();select.removeEventListener('change',change);win?.removeEventListener('pagehide',hide);win?.removeEventListener('pageshow',show);bar.remove();surface.remove()}};
}
if(typeof document!=='undefined'){const root=document.getElementById('memory-demo');if(root)mountDemo(root)}
