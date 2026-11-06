import {createSourceDetailHost} from './host.mjs';
import {createFixture} from './fixtures.mjs';
import {mountSourceDetail} from './view.mjs';
// This is both the real page entry and the whole-entry test entry. No alternate teardown wrapper.
export function startSourceDetail(root,{fixture=createFixture()}={}){
 const doc=root.ownerDocument,win=doc.defaultView;let retired=false,disposeView=()=>{},detach=()=>{};
 const {host,control}=createSourceDetailHost({input:fixture.initialInput,ports:fixture.ports});
 const banner=doc.createElement('p');banner.className='sandbox-banner';banner.textContent='合成選配候選 · 未接正式產品 · 未發布驗收結論';
 const lab=doc.createElement('details');lab.className='lab';const summary=doc.createElement('summary');summary.textContent='合成情境實驗室';
 const hint=doc.createElement('p');hint.textContent='切換完整合成情境，不改真帳戶或原操作。退休情境會清空本頁；重新載入才建立新畫面。';
 const choices=doc.createElement('div');choices.className='lab-choices';for(const scene of fixture.scenarios){const b=doc.createElement('button');b.type='button';b.dataset.scenario=scene.id;b.textContent=scene.label;choices.append(b);}
 const stop=doc.createElement('button');stop.type='button';stop.dataset.retire='';stop.textContent='退休此合成畫面';lab.append(summary,hint,choices,stop);
 const reader=doc.createElement('main');reader.id='sd01-reader';root.replaceChildren(banner,lab,reader);
 function teardown(){
  if(retired)return false;retired=true;
  disposeView();lab.removeEventListener('click',labClick);win?.removeEventListener('pagehide',teardown);root.replaceChildren();
  host.dispose(); // Retires state/registrations first; abort may synchronously reenter this paired entry.
  detach();return true;
 }
 function labClick(e){if(retired)return;const b=e.target.closest?.('button');if(!b||!lab.contains(b))return;if(b.hasAttribute('data-retire')){teardown();return;}if(b.dataset.scenario)fixture.selectScenario(b.dataset.scenario);}
 disposeView=mountSourceDetail(reader,host);detach=fixture.attach({host,control,teardown});lab.addEventListener('click',labClick);win?.addEventListener('pagehide',teardown);
 return Object.freeze({teardown});
}
if(typeof document!=='undefined'){const root=document.querySelector('[data-sd01-app]');if(root)startSourceDetail(root);}
